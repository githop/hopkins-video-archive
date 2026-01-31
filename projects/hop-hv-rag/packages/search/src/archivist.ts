import { sql, inArray } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import {
  people,
  locations as LocationsRecord,
  activities as ActivitiesRecord,
  sceneToPeople,
  sceneToLocations,
  sceneToActivities,
  type schema,
} from '@hop-hv-rag/db';
import { validateSceneEntities } from '@hop-hv-rag/db/validation';
import {
  ParticipantService,
  LocationService,
  ActivityService,
  logger,
} from '@hop-hv-rag/core';
import {
  streamText,
  embed,
  rerank,
  type LanguageModel,
  type EmbeddingModel,
  type RerankingModel,
} from 'ai';
import type { HybridResult } from './types.ts';
import { type Source, type StreamChunk } from './schemas.ts';

type Db = BunSQLiteDatabase<typeof schema>;

/**
 * FamilyArchivist: Handles hybrid search and RAG synthesis with unified streaming API.
 */
export class FamilyArchivist {
  constructor(
    private genModel: LanguageModel,
    private embedModel: EmbeddingModel,
    private rerankModel: RerankingModel,
    private db: Db,
    private participantService: ParticipantService,
    private locationService: LocationService,
    private activityService: ActivityService,
  ) {}

  async init() {
    await Promise.all([
      this.participantService.load(),
      this.locationService.load(),
      this.activityService.load(),
    ]);
  }

  /**
   * Main entry point for the unified streaming API.
   * Yields reasoning chunks during model thinking, then a final result chunk.
   */
  async *query(userQuery: string): AsyncGenerator<StreamChunk> {
    // 1. Retrieve relevant scenes
    const results = await this.retrieve(userQuery);

    const sources = results ? await this.buildSources(results) : [];
    const context = this.formatContextForLLM(sources);

    if (sources.length === 0) {
      yield {
        type: 'result',
        answer:
          "I couldn't find any relevant scenes in the family archive for that query.",
        sources: [],
        usedSourceIds: [],
      };
      return;
    }

    // 2. Stream generation with reasoning
    const result = streamText({
      model: this.genModel,
      system: this.getSystemPrompt(context),
      prompt: userQuery,
    });

    // 3. Yield reasoning chunks and accumulate answer
    let answer = '';

    for await (const part of result.fullStream) {
      if (part.type === 'reasoning-delta') {
        yield { type: 'reasoning', text: part.text };
      } else if (part.type === 'text-delta') {
        answer += part.text;
      }
    }

    // 4. Extract which citations were actually used
    const usedSourceIds = this.extractUsedCitations(answer, sources);

    // 5. Yield final result with answer and sources
    yield { type: 'result', answer, sources, usedSourceIds };
  }

  /**
   * Build structured Source[] from hybrid search results.
   * Fetches canonical participants, locations, and activities from junction tables.
   */
  private async buildSources(results: HybridResult[]): Promise<Source[]> {
    const sources: Source[] = [];

    for (const [index, r] of results.entries()) {
      // Fetch canonical entities from junction tables
      const participantRows = this.db
        .select({
          id: people.id,
          name: people.name,
          type: people.type,
        })
        .from(people)
        .innerJoin(sceneToPeople, sql`${sceneToPeople.personId} = ${people.id}`)
        .where(sql`${sceneToPeople.sceneId} = ${r.id}`)
        .all();

      const locationRows = this.db
        .select({
          id: LocationsRecord.id,
          name: LocationsRecord.name,
          type: LocationsRecord.type,
        })
        .from(LocationsRecord)
        .innerJoin(
          sceneToLocations,
          sql`${sceneToLocations.locationId} = ${LocationsRecord.id}`,
        )
        .where(sql`${sceneToLocations.sceneId} = ${r.id}`)
        .all();

      const activityRows = this.db
        .select({
          id: ActivitiesRecord.id,
          name: ActivitiesRecord.name,
          type: ActivitiesRecord.type,
        })
        .from(ActivitiesRecord)
        .innerJoin(
          sceneToActivities,
          sql`${sceneToActivities.activityId} = ${ActivitiesRecord.id}`,
        )
        .where(sql`${sceneToActivities.sceneId} = ${r.id}`)
        .all();

      // Validate all entities using centralized helper
      const { participants, locations, activities } = validateSceneEntities({
        participants: participantRows,
        locations: locationRows,
        activities: activityRows,
      });

      // Format timestamp
      const minutes = Math.floor(r.startTime / 60);
      const seconds = Math.floor(r.startTime % 60);
      const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      // Use relative thumbnail path directly
      const thumbnailUrl = r.thumbnailPath || '';

      // Build video URL with timestamp for local streaming
      const videoUrl = `/videos/${r.videoFilename}#t=${Math.floor(r.startTime)}`;
      const hasLocalFile = !!r.localPath;

      sources.push({
        sceneId: r.id,
        citationId: index + 1, // Assign [1], [2], [3], etc.
        sceneTitle: r.title,
        summary: r.summary,
        thumbnailUrl,
        video: {
          id: r.videoId,
          title: r.videoTitle,
          year: r.videoYear,
          yearStart: r.videoYearStart,
          yearEnd: r.videoYearEnd,
          filename: r.videoFilename,
          videoUrl,
          hasLocalFile,
        },
        timestamp: {
          startSeconds: r.startTime,
          endSeconds: r.endTime,
          formatted,
        },
        participants,
        locations,
        activities,
      });
    }

    return sources;
  }

  /**
   * Convert structured Source[] to text for the LLM system prompt.
   */
  private formatContextForLLM(sources: Source[]): string {
    if (sources.length === 0) return 'No relevant scenes found.';

    return sources
      .map((s) => {
        const participantNames =
          s.participants.map((p) => p.name).join(', ') || 'None identified';
        const locationNames =
          s.locations.map((l) => l.name).join(', ') || 'Unknown';
        const activityNames =
          s.activities.map((a) => a.name).join(', ') || 'None identified';

        return [
          `SOURCE [${s.citationId}]`,
          `VIDEO: ${s.video.title}`,
          `FILENAME: ${s.video.filename}`,
          `YEAR: ${s.video.year || 'Unknown'}`,
          `TIMESTAMP: ${s.timestamp.formatted}`,
          `SCENE: ${s.sceneTitle}`,
          `PARTICIPANTS: ${participantNames}`,
          `LOCATIONS: ${locationNames}`,
          `ACTIVITIES: ${activityNames}`,
          `SUMMARY: ${s.summary}`,
          `---`,
        ].join('\n');
      })
      .join('\n\n');
  }

  /**
   * System prompt for the archivist generation.
   */
  private getSystemPrompt(context: string): string {
    return [
      'You are a professional Family Historian and Video Archivist.',
      "Analyze the provided archive fragments to answer the user's question.",
      '',
      'GUIDELINES:',
      '1. Use ONLY the provided context to answer the question.',
      '2. Cite sources using [1], [2], [3] etc. when referencing information.',
      '3. You may cite multiple sources in a single sentence: "Greg plays football [1] and later swims [2]."',
      '4. Cite at the end of sentences or clauses where the information appears.',
      '5. Be descriptive but concise.',
      '',
      'CONTEXT FROM ARCHIVE:',
      context,
    ].join('\n');
  }

  /**
   * Extract which citation IDs were actually used in the answer text.
   */
  private extractUsedCitations(answer: string, sources: Source[]): number[] {
    const citationRegex = /\[(\d+)\]/g;
    const matches = [...answer.matchAll(citationRegex)];
    const citedIds = matches.map((m) => parseInt(m[1], 10));

    // Filter to only valid citation IDs (1 to sources.length)
    const validIds = citedIds.filter((id) => id >= 1 && id <= sources.length);

    // Return unique, sorted citation IDs
    return [...new Set(validIds)].sort((a, b) => a - b);
  }

  /**
   * Retrieve relevant scenes using hybrid search.
   */
  public async retrieve(query: string): Promise<HybridResult[] | null> {
    // 1. Detect Entities in Query
    const [detectedPeople, detectedLocations, detectedActivities] =
      await Promise.all([
        this.detectPeople(query),
        this.detectLocations(query),
        this.detectActivities(query),
      ]);

    if (detectedPeople.length > 0) {
      logger.debug(
        { people: detectedPeople.map((p) => p.name) },
        'Detected people in query',
      );
    }
    if (detectedLocations.length > 0) {
      logger.debug(
        { locations: detectedLocations.map((l) => l.name) },
        'Detected locations in query',
      );
    }
    if (detectedActivities.length > 0) {
      logger.debug(
        { activities: detectedActivities.map((a) => a.name) },
        'Detected activities in query',
      );
    }

    const results = await this.hybridSearch(
      query,
      detectedPeople.map((p) => p.id),
      detectedLocations.map((l) => l.id),
      detectedActivities.map((a) => a.id),
    );

    if (results.length === 0) {
      return null;
    }

    logger.info({ sceneCount: results.length }, 'Found relevant scenes');

    return results;
  }

  private async detectPeople(
    query: string,
  ): Promise<{ id: number; name: string }[]> {
    const names = this.participantService.detectParticipants(query);
    if (names.length === 0) return [];

    return this.db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(inArray(people.name, names))
      .all();
  }

  private async detectLocations(
    query: string,
  ): Promise<{ id: number; name: string }[]> {
    const names = this.locationService.detectLocations(query);
    if (names.length === 0) return [];

    return await this.db
      .select({ id: LocationsRecord.id, name: LocationsRecord.name })
      .from(LocationsRecord)
      .where(inArray(LocationsRecord.name, names))
      .all();
  }

  private async detectActivities(
    query: string,
  ): Promise<{ id: number; name: string }[]> {
    const names = this.activityService.detectActivities(query);
    if (names.length === 0) return [];

    return await this.db
      .select({ id: ActivitiesRecord.id, name: ActivitiesRecord.name })
      .from(ActivitiesRecord)
      .where(inArray(ActivitiesRecord.name, names))
      .all();
  }

  /**
   * Detect a 4-digit year in the query string.
   * Supports years from 1960-2029.
   */
  private detectYearInQuery(query: string): number | null {
    const match = query.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Extract key terms from query for keyword boosting.
   * Identifies quoted phrases and capitalized multi-word sequences (proper nouns).
   */
  private extractKeyTerms(query: string): string[] {
    const terms: string[] = [];

    // Match quoted phrases like "KH Talk"
    const quoted = query.match(/"([^"]+)"/g);
    if (quoted) {
      terms.push(...quoted.map((q) => q.replace(/"/g, '')));
    }

    // Match capitalized sequences (potential proper nouns) like "KH Talk"
    const caps = query.match(/[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*/g);
    if (caps) {
      terms.push(...caps.filter((c) => c.length > 2));
    }

    return [...new Set(terms)];
  }

  /**
   * Check if content contains any of the key terms (case-insensitive).
   */
  private contentContainsKeyTerms(
    content: string,
    keyTerms: string[],
  ): boolean {
    const lowerContent = content.toLowerCase();
    return keyTerms.some((term) => lowerContent.includes(term.toLowerCase()));
  }

  /**
   * Construct a robust FTS5 query from user input.
   * - Detects filename-like patterns (e.g. 1996-97-1.m4v) and treats them as exact phrases
   * - Preserves prefix operators (*) for partial matching
   * - Preserves quoted phrases for exact matching
   * - BM25 scoring naturally down-weights common terms, so no stopword filtering needed
   */
  private constructFtsQuery(query: string): string {
    const filenameMatch = query.match(/\b\d{4}-[\w-.]+\b/g);
    let processedQuery = query;

    if (filenameMatch) {
      filenameMatch.forEach((filename) => {
        // Create a phrase version: "1996 97 1 m4v"
        const phrase = `"${filename.replace(/[^\w]/g, ' ')}"`;
        processedQuery = processedQuery.replace(filename, phrase);
      });
    }

    // Clean up special chars that FTS5 dislikes, but preserve:
    // - alphanumeric characters
    // - spaces
    // - quotes (for phrase queries)
    // - asterisk (for prefix queries like "swim*")
    return processedQuery.replace(/[^\w\s"*]/g, ' ').trim();
  }

  private async hybridSearch(
    query: string,
    personIds: number[],
    locationIds: number[],
    activityIds: number[],
  ): Promise<HybridResult[]> {
    // 1. Vector Search
    const { embedding } = await embed({
      model: this.embedModel,
      value: query,
    });
    const queryVecJson = JSON.stringify(embedding);

    const vectorSql = `
      SELECT 
        s.id,
        s.video_id as videoId,
        s.start_time as startTime,
        s.end_time as endTime,
        s.title,
        s.summary,
        s.transcript,
        s.thumbnail_path as thumbnailPath,
        v.title as videoTitle,
        v.year as videoYear,
        v.year_start as videoYearStart,
        v.year_end as videoYearEnd,
        v.participants as videoParticipants,
        v.locations as videoLocations,
        v.filename as videoFilename,
        v.local_path as localPath
      FROM (
        SELECT rowid, vec_distance_cosine(scene_embedding, '${queryVecJson}') as distance
        FROM vec_scenes
        ORDER BY distance ASC
        LIMIT 40
      ) m
      JOIN scenes s ON s.id = m.rowid
      JOIN videos v ON v.id = s.video_id
    `;

    const vectorResults = this.db.all<HybridResult>(sql.raw(vectorSql));

    // 2. FTS5 Keyword Search (BM25 naturally down-weights common terms)
    const ftsQuery = this.constructFtsQuery(query);
    const ftsResults = this.db.all<HybridResult>(
      sql.raw(`
      SELECT 
        s.id,
        s.video_id as videoId,
        s.start_time as startTime,
        s.end_time as endTime,
        s.title,
        s.summary,
        s.transcript,
        s.thumbnail_path as thumbnailPath,
        v.title as videoTitle,
        v.year as videoYear,
        v.year_start as videoYearStart,
        v.year_end as videoYearEnd,
        v.participants as videoParticipants,
        v.locations as videoLocations,
        v.filename as videoFilename,
        v.local_path as localPath
      FROM fts_scenes f
      JOIN scenes s ON s.id = f.id
      JOIN videos v ON v.id = s.video_id
      WHERE fts_scenes MATCH '${ftsQuery.replace(/'/g, "''")}'
      ORDER BY bm25(fts_scenes)
      LIMIT 40
    `),
    );

    const fused = this.fuse(vectorResults, ftsResults);

    // 4. Neural Re-ranking
    logger.info({ candidateCount: fused.length }, 'Re-ranking candidates');
    const { ranking } = await rerank({
      model: this.rerankModel,
      query,
      documents: fused.map(
        (r) =>
          `SCENE: ${r.title}\nSUMMARY: ${r.summary}\nTRANSCRIPT: ${r.transcript}`,
      ),
    });

    // Apply reranked scores
    ranking.forEach((r) => {
      fused[r.originalIndex].score = r.score;
    });

    // 5. Post-rerank keyword boost
    // Boost scores for documents containing exact query key terms (proper nouns, quoted phrases)
    const keyTerms = this.extractKeyTerms(query);
    if (keyTerms.length > 0) {
      const KEYWORD_BOOST = 1.3;
      for (const result of fused) {
        const content = `${result.title} ${result.summary} ${result.transcript}`;
        if (this.contentContainsKeyTerms(content, keyTerms)) {
          result.score = (result.score || 0) * KEYWORD_BOOST;
        }
      }
    }

    // Sort by boosted scores
    fused.sort((a, b) => (b.score || 0) - (a.score || 0));

    // 6. Additional boost for detected people, locations, and activities
    if (
      personIds.length > 0 ||
      locationIds.length > 0 ||
      activityIds.length > 0
    ) {
      for (const result of fused) {
        let boost = 1.0;

        if (personIds.length > 0) {
          const scenePeople = this.db
            .select({ personId: sceneToPeople.personId })
            .from(sceneToPeople)
            .where(sql`${sceneToPeople.sceneId} = ${result.id}`)
            .all();
          const hasPerson = scenePeople.some((sp: { personId: number }) =>
            personIds.includes(sp.personId),
          );
          if (hasPerson) boost *= 1.5;
        }

        if (locationIds.length > 0) {
          const sceneLocations = this.db
            .select({ locationId: sceneToLocations.locationId })
            .from(sceneToLocations)
            .where(sql`${sceneToLocations.sceneId} = ${result.id}`)
            .all();
          const hasLocation = sceneLocations.some(
            (sl: { locationId: number }) => locationIds.includes(sl.locationId),
          );
          if (hasLocation) boost *= 1.5;
        }

        if (activityIds.length > 0) {
          const sceneActivities = this.db
            .select({ activityId: sceneToActivities.activityId })
            .from(sceneToActivities)
            .where(sql`${sceneToActivities.sceneId} = ${result.id}`)
            .all();
          const hasActivity = sceneActivities.some(
            (sa: { activityId: number }) => activityIds.includes(sa.activityId),
          );
          if (hasActivity) boost *= 1.5;
        }

        if (result.score) {
          result.score *= boost;
        }
      }
    }

    // 7. Temporal boosting based on year in query
    const queryYear = this.detectYearInQuery(query);
    if (queryYear) {
      logger.info({ year: queryYear }, 'Detected year in query');
      for (const result of fused) {
        const { videoYearStart, videoYearEnd } = result;
        if (videoYearStart && videoYearEnd) {
          // Check if query year falls within video's year range
          if (queryYear >= videoYearStart && queryYear <= videoYearEnd) {
            // Year is in range - boost
            result.score = (result.score || 0) * 1.5;
          } else {
            // Calculate distance to nearest edge of range
            const distance = Math.min(
              Math.abs(queryYear - videoYearStart),
              Math.abs(queryYear - videoYearEnd),
            );
            if (distance > 4) {
              // More than 4 years off - penalty
              result.score = (result.score || 0) * 0.5;
            }
            // Within 4 years: no change (neutral)
          }
        }
      }
    }

    return fused.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  }

  private fuse(
    vectorResults: HybridResult[],
    ftsResults: HybridResult[],
  ): HybridResult[] {
    const k = 60;
    const scores = new Map<number, number>();
    const resultMap = new Map<number, HybridResult>();

    [vectorResults, ftsResults].forEach((list) => {
      list.forEach((item, index) => {
        const currentScore = scores.get(item.id) || 0;
        scores.set(item.id, currentScore + 1 / (k + index + 1));
        resultMap.set(item.id, item);
      });
    });

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Take top 10 for potential re-ranking
      .map(([id, score]) => ({ ...resultMap.get(id)!, score }));
  }
}
