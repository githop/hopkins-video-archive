import { sql, inArray } from 'drizzle-orm';
import {
  people,
  locations,
  activities,
  sceneToPeople,
  sceneToLocations,
  sceneToActivities,
  createDb,
} from '@hop-hv-rag/db';
import { join } from 'node:path';

import {
  ParticipantService,
  LocationService,
  ActivityService,
} from '@hop-hv-rag/core';
import { getEmbedModel, getGenModel, getRerankModel } from '@hop-hv-rag/ai';
import {
  streamText,
  embed,
  rerank,
  type LanguageModel,
  type EmbeddingModel,
  type RerankingModel,
} from 'ai';
import type { HybridResult } from './types.ts';
import {
  ParticipantSchema,
  LocationSchema,
  ActivitySchema,
  type Source,
  type StreamChunk,
  type Participant,
  type Location,
  type Activity,
} from './schemas.ts';
import { Spinner } from './spinner.ts';

/**
 * Configuration
 */
const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');
const REGISTRY_PATH = join(DATA_DIR, 'participant-registry.json');
const LOCATION_REGISTRY_PATH = join(DATA_DIR, 'location-registry.json');
const ACTIVITY_REGISTRY_PATH = join(DATA_DIR, 'activity-registry.json');

/**
 * FamilyArchivist: Handles hybrid search and RAG synthesis with unified streaming API.
 */
export class FamilyArchivist {
  private db: ReturnType<typeof createDb>;
  private participantService: ParticipantService;
  private locationService: LocationService;
  private activityService: ActivityService;

  constructor(
    private genModel: LanguageModel,
    private embedModel: EmbeddingModel,
    private rerankModel: RerankingModel,
  ) {
    this.db = createDb(DB_PATH);
    this.participantService = new ParticipantService(REGISTRY_PATH);
    this.locationService = new LocationService(LOCATION_REGISTRY_PATH);
    this.activityService = new ActivityService(ACTIVITY_REGISTRY_PATH);
  }

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
      // Fetch canonical participants from junction table
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

      const participants: Participant[] = participantRows.map((p) =>
        ParticipantSchema.parse(p),
      );

      // Fetch canonical locations from junction table
      const locationRows = this.db
        .select({
          id: locations.id,
          name: locations.name,
          type: locations.type,
        })
        .from(locations)
        .innerJoin(
          sceneToLocations,
          sql`${sceneToLocations.locationId} = ${locations.id}`,
        )
        .where(sql`${sceneToLocations.sceneId} = ${r.id}`)
        .all();

      const locs: Location[] = locationRows.map((l) => LocationSchema.parse(l));

      // Fetch canonical activities from junction table
      const activityRows = this.db
        .select({
          id: activities.id,
          name: activities.name,
          type: activities.type,
        })
        .from(activities)
        .innerJoin(
          sceneToActivities,
          sql`${sceneToActivities.activityId} = ${activities.id}`,
        )
        .where(sql`${sceneToActivities.sceneId} = ${r.id}`)
        .all();

      const acts: Activity[] = activityRows.map((a) => ActivitySchema.parse(a));

      // Format timestamp
      const minutes = Math.floor(r.startTime / 60);
      const seconds = Math.floor(r.startTime % 60);
      const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      // Use relative thumbnail path directly
      const thumbnailUrl = r.thumbnailPath || '';

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
          driveId: r.videoDriveFileId,
        },
        timestamp: {
          startSeconds: r.startTime,
          endSeconds: r.endTime,
          formatted,
        },
        participants,
        locations: locs,
        activities: acts,
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
          `DRIVE_ID: ${s.video.driveId}`,
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
      console.log(
        `   Detected people: ${detectedPeople.map((p) => p.name).join(', ')}`,
      );
    }
    if (detectedLocations.length > 0) {
      console.log(
        `   Detected locations: ${detectedLocations.map((l) => l.name).join(', ')}`,
      );
    }
    if (detectedActivities.length > 0) {
      console.log(
        `   Detected activities: ${detectedActivities.map((a) => a.name).join(', ')}`,
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

    console.log(`   Found ${results.length} relevant scenes.`);

    return results;
  }

  private async detectPeople(query: string) {
    const names = this.participantService.detectParticipants(query);
    if (names.length === 0) return [];

    return this.db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(inArray(people.name, names))
      .all();
  }

  private async detectLocations(query: string) {
    const names = this.locationService.detectLocations(query);
    if (names.length === 0) return [];

    return await this.db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(inArray(locations.name, names))
      .all();
  }

  private async detectActivities(query: string) {
    const names = this.activityService.detectActivities(query);
    if (names.length === 0) return [];

    return await this.db
      .select({ id: activities.id, name: activities.name })
      .from(activities)
      .where(inArray(activities.name, names))
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
        v.drive_file_id as videoDriveFileId
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
        v.drive_file_id as videoDriveFileId
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
    console.log(`   Re-ranking ${fused.length} candidates...`);
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
      console.log(`   Detected year: ${queryYear}`);
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

/**
 * CLI Entry Point
 */
async function main() {
  const query = Bun.argv.slice(2).join(' ');
  if (!query) {
    console.error('Usage: bun search:rag <your question>');
    process.exit(1);
  }

  const archivist = new FamilyArchivist(
    getGenModel('summarizer'),
    getEmbedModel('embed-small'),
    getRerankModel('rerank'),
  );
  await archivist.init();

  console.log('Searching the archive...\n');

  let reasoningStarted = false;
  const spinner = new Spinner('Thinking');

  for await (const chunk of archivist.query(query)) {
    if (chunk.type === 'reasoning') {
      if (!reasoningStarted) {
        spinner.start();
        reasoningStarted = true;
      }
    } else if (chunk.type === 'result') {
      if (reasoningStarted) {
        spinner.stop();
      }

      console.log('--- Response ---\n');
      console.log(chunk.answer);

      if (chunk.sources.length > 0) {
        // Group sources by used vs unused
        const usedSources = chunk.sources.filter((s) =>
          chunk.usedSourceIds.includes(s.citationId),
        );
        const unusedSources = chunk.sources.filter(
          (s) => !chunk.usedSourceIds.includes(s.citationId),
        );

        if (usedSources.length > 0) {
          console.log('\n--- Cited Sources ---\n');
          for (const s of usedSources) {
            console.log(
              `[${s.citationId}] ${s.video.title} @ ${s.timestamp.formatted}`,
            );
            console.log(`  ${s.sceneTitle}`);
            console.log(
              `  https://drive.google.com/file/d/${s.video.driveId}\n`,
            );
          }
        }

        if (unusedSources.length > 0) {
          console.log('\n--- Additional Context ---\n');
          for (const s of unusedSources) {
            console.log(
              `[${s.citationId}] ${s.video.title} @ ${s.timestamp.formatted}`,
            );
            console.log(`  ${s.sceneTitle}`);
          }
        }
      }
    }
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
