import { and, eq, inArray, sql } from 'drizzle-orm';
import { chunkEntities, entities, videos } from '@hop-hv-rag/db';
import { validateEntities } from '@hop-hv-rag/db/validation';
import { formatTimestamp, logger } from '@hop-hv-rag/core';
import {
  streamText,
  embed,
  rerank,
  type LanguageModel,
  type EmbeddingModel,
  type RerankingModel,
} from 'ai';
import type { HybridResult, Db, ArchivistConfig } from './types.ts';
import { type Source, type StreamChunk } from './schemas.ts';
import { EntityIndex } from './entity-index.ts';
import { FilenameIndex, type FilenameMatch } from './filename-index.ts';

/**
 * FamilyArchivist: Handles hybrid search and RAG synthesis with unified streaming API.
 */
export class FamilyArchivist {
  constructor(
    private genModel: LanguageModel,
    private embedModel: EmbeddingModel,
    private rerankModel: RerankingModel,
    private db: Db,
    private config: ArchivistConfig = {},
  ) {
    this.config = {
      keywordBoost: 1.3,
      entityBoost: 1.5,
      temporalBoost: 1.5,
      temporalPenalty: 0.5,
      filenameBoost: 5.0,
      rrfK: 60,
      ...config,
    };
  }

  private entityIndex = new EntityIndex();
  private filenameIndex = new FilenameIndex();

  async init() {
    await this.entityIndex.load(this.db);
    await this.filenameIndex.load(this.db);
  }

  /**
   * Main entry point for the unified streaming API.
   * Yields reasoning chunks during model thinking, then a final result chunk.
   */
  async *query(userQuery: string): AsyncGenerator<StreamChunk> {
    // 1. Retrieve relevant chunks
    const results = await this.retrieve(userQuery);

    const sources = results ? await this.buildSources(results) : [];
    const context = this.formatContextForLLM(sources);

    if (sources.length === 0) {
      yield {
        type: 'result',
        answer:
          "I couldn't find any relevant chunks in the family archive for that query.",
        sources: [],
        usedSourceIds: [],
      };
      return;
    }

    // 2. Stream generation with reasoning
    const system = this.getSystemPrompt(context);
    logger.debug({ prompt: userQuery });
    logger.debug(system);

    const result = streamText({
      model: this.genModel,
      system,
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
   * Fetches canonical participants, locations, and activities from entity links.
   */
  private async buildSources(results: HybridResult[]): Promise<Source[]> {
    const sources: Source[] = [];

    for (const [index, r] of results.entries()) {
      const entityRows = this.db
        .select({
          id: entities.id,
          name: entities.name,
          entityType: entities.entityType,
          subtype: entities.subtype,
        })
        .from(entities)
        .innerJoin(
          chunkEntities,
          sql`${chunkEntities.entityId} = ${entities.id}`,
        )
        .where(sql`${chunkEntities.chunkId} = ${r.id}`)
        .all();

      // Fetch global summary for the parent video
      const videoRow = this.db
        .select({ globalSummary: videos.globalSummary })
        .from(videos)
        .where(sql`${videos.id} = ${r.videoId}`)
        .get();

      const allEntities = validateEntities(entityRows);
      const participants = allEntities.filter(
        (entity) =>
          entity.entityType === 'PERSON' || entity.entityType === 'ROLE',
      );
      const locations = allEntities.filter(
        (entity) =>
          entity.entityType === 'PLACE' || entity.entityType === 'SETTING',
      );
      const activities = allEntities.filter(
        (entity) => entity.entityType === 'ACTIVITY',
      );

      // Format timestamp
      const formatted = formatTimestamp(r.startTime);

      sources.push({
        chunkId: r.id,
        citationId: index + 1, // Assign [1], [2], [3], etc.
        chunkTitle: r.title,
        summary: r.summary ?? 'No summary available.',
        video: {
          id: r.videoId,
          title: r.videoTitle,
          year: r.videoYear,
          yearStart: r.videoYearStart,
          yearEnd: r.videoYearEnd,
          filename: r.videoFilename,
        },
        timestamp: {
          startSeconds: r.startTime,
          endSeconds: r.endTime,
          formatted,
        },
        participants,
        locations,
        activities,
        globalSummary: videoRow?.globalSummary || null,
      });
    }

    return sources;
  }

  /**
   * Convert structured Source[] to text for the LLM system prompt.
   * Includes global video summaries (deduplicated) before individual chunk sources.
   */
  private formatContextForLLM(sources: Source[]): string {
    if (sources.length === 0) return 'No relevant chunks found.';

    // Extract unique global summaries by video
    const globalSummaries = new Map<
      number,
      { title: string | null; summary: string }
    >();
    for (const s of sources) {
      if (s.globalSummary && !globalSummaries.has(s.video.id)) {
        globalSummaries.set(s.video.id, {
          title: s.video.title,
          summary: s.globalSummary,
        });
      }
    }

    // Format global summaries section
    let context = '';
    if (globalSummaries.size > 0) {
      context += 'GLOBAL VIDEO CONTEXT:\n\n';
      for (const [videoId, data] of globalSummaries) {
        context += `VIDEO: ${data.title || 'Untitled'} (ID: ${videoId})\n`;
        context += `ABSTRACT: ${data.summary}\n\n`;
      }
      context += '---\n\n';
    }

    // Format individual chunk sources
    const chunkContext = sources
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
          `CHUNK: ${s.chunkTitle || 'Untitled'}`,
          `PARTICIPANTS: ${participantNames}`,
          `LOCATIONS: ${locationNames}`,
          `ACTIVITIES: ${activityNames}`,
          `SUMMARY: ${s.summary}`,
          `---`,
        ].join('\n');
      })
      .join('\n\n');

    return context + chunkContext;
  }

  private extractTranscriptSnippet(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 360) return normalized;
    const head = normalized.slice(0, 240).trim();
    const tail = normalized.slice(-90).trim();
    return `${head} ... ${tail}`;
  }

  /**
   * System prompt for the archivist generation.
   */
  private getSystemPrompt(context: string): string {
    return [
      'You are a professional Family Historian and Video Archivist.',
      "Analyze the provided archive fragments to answer the user's question.",
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
   * Retrieve relevant chunks using hybrid search.
   */
  public async retrieve(query: string): Promise<HybridResult[] | null> {
    const detectedEntities = this.entityIndex.detect(query);

    if (detectedEntities.length > 0) {
      logger.debug(
        { entities: detectedEntities.map((e) => e.name) },
        'Detected entities in query',
      );
    }

    const results = await this.hybridSearch(
      query,
      detectedEntities.map((entity) => entity.id),
    );

    if (results.length === 0) {
      return null;
    }

    logger.info({ chunkCount: results.length }, 'Found relevant chunks');

    return results;
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
  private constructFtsQuery(
    query: string,
    filenameMatches: FilenameMatch[] = [],
  ): string {
    const yearFilenameMatch = query.match(/\b\d{4}-[\w-.]+\b/g);
    let processedQuery = query;

    if (yearFilenameMatch) {
      yearFilenameMatch.forEach((filename) => {
        // Create a phrase version: "1996 97 1 m4v"
        const phrase = `"${filename.replace(/[^\w]/g, ' ')}"`;
        processedQuery = processedQuery.replace(filename, phrase);
      });
    }

    const filenameClauses = filenameMatches.map((match) => {
      // Use basename for FTS to match video_filename field
      return `video_filename:"${match.basename}"`;
    });

    // Clean up special chars that FTS5 dislikes, but preserve:
    // - alphanumeric characters
    // - spaces
    // - quotes (for phrase queries)
    // - asterisk (for prefix queries like "swim*")
    let cleanedQuery = processedQuery.replace(/[^\w\s"*]/g, ' ').trim();

    // Combine with filename clauses
    if (filenameClauses.length > 0) {
      cleanedQuery = `${cleanedQuery} OR ${filenameClauses.join(' OR ')}`;
    }

    return cleanedQuery;
  }

  private async hybridSearch(
    query: string,
    entityIds: number[],
  ): Promise<HybridResult[]> {
    // 1. Detect filenames in query
    const filenameMatches = this.filenameIndex.detect(query);
    const targetVideoIds = filenameMatches.map((m) => m.videoId);

    if (filenameMatches.length > 0) {
      logger.debug(
        {
          filenames: filenameMatches.map((m) => m.filename),
          videoIds: targetVideoIds,
        },
        'Detected video filenames in query',
      );
    }

    // 2. Vector Search
    const { embedding } = await embed({
      model: this.embedModel,
      value: query,
    });
    const queryVecJson = JSON.stringify(embedding);

    const vectorSql = `
      SELECT
        c.id,
        c.video_id as videoId,
        c.start_time as startTime,
        c.end_time as endTime,
        c.text as text,
        cs.title as title,
        cs.summary as summary,
        v.title as videoTitle,
        v.year as videoYear,
        v.year_start as videoYearStart,
        v.year_end as videoYearEnd,
        v.filename as videoFilename
      FROM (
        SELECT rowid, vec_distance_cosine(chunk_embedding, '${queryVecJson}') as distance
        FROM vec_chunks
        ORDER BY distance ASC
        LIMIT 40
      ) m
      JOIN chunks c ON c.id = m.rowid
      LEFT JOIN chunk_summaries cs ON cs.id = (
        SELECT cs2.id
        FROM chunk_summaries cs2
        WHERE cs2.chunk_id = c.id AND cs2.summary_type = 'scene'
        ORDER BY cs2.id DESC
        LIMIT 1
      )
      JOIN videos v ON v.id = c.video_id
    `;

    const vectorResults = this.db.all<HybridResult>(sql.raw(vectorSql));

    // 3. FTS5 Keyword Search with filename clauses
    const ftsQuery = this.constructFtsQuery(query, filenameMatches);
    const ftsResults = this.db.all<HybridResult>(
      sql.raw(`
      SELECT
        c.id,
        c.video_id as videoId,
        c.start_time as startTime,
        c.end_time as endTime,
        c.text as text,
        cs.title as title,
        cs.summary as summary,
        v.title as videoTitle,
        v.year as videoYear,
        v.year_start as videoYearStart,
        v.year_end as videoYearEnd,
        v.filename as videoFilename
      FROM fts_chunks f
      JOIN chunks c ON c.id = f.rowid
      LEFT JOIN chunk_summaries cs ON cs.id = (
        SELECT cs2.id
        FROM chunk_summaries cs2
        WHERE cs2.chunk_id = c.id AND cs2.summary_type = 'scene'
        ORDER BY cs2.id DESC
        LIMIT 1
      )
      JOIN videos v ON v.id = c.video_id
      WHERE fts_chunks MATCH '${ftsQuery.replace(/'/g, "''")}'
      ORDER BY bm25(fts_chunks)
      LIMIT 40
    `),
    );

    const fused = this.fuse(vectorResults, ftsResults);

    // 4. Neural Re-ranking
    logger.info({ candidateCount: fused.length }, 'Re-ranking candidates');
    const { ranking } = await rerank({
      model: this.rerankModel,
      query,
      documents: fused.map((r) => {
        const snippet = this.extractTranscriptSnippet(r.text);
        return `CHUNK: ${r.title || 'Untitled'}\nSUMMARY: ${r.summary || ''}\nTRANSCRIPT: ${snippet}`;
      }),
    });

    // Apply reranked scores
    ranking.forEach((r) => {
      fused[r.originalIndex].score = r.score;
    });

    // 5. Post-rerank boosting (non-compounding)
    const keyTerms = this.extractKeyTerms(query);
    const queryYear = this.detectYearInQuery(query);
    const targetVideoIdSet = new Set(targetVideoIds);

    const FILENAME_BOOST = this.config.filenameBoost!;
    const KEYWORD_BOOST = this.config.keywordBoost!;
    const ENTITY_BOOST = this.config.entityBoost!;
    const TEMPORAL_BOOST = this.config.temporalBoost!;
    const TEMPORAL_PENALTY = this.config.temporalPenalty!;
    const MIN_MULTIPLIER = 0.1;

    if (queryYear) {
      logger.info({ year: queryYear }, 'Detected year in query');
    }

    for (const result of fused) {
      const baseScore = result.score || 0;
      let multiplier = 1;

      if (targetVideoIdSet.size > 0 && targetVideoIdSet.has(result.videoId)) {
        multiplier += FILENAME_BOOST - 1;
        logger.debug(
          {
            videoId: result.videoId,
            chunkId: result.id,
            boost: FILENAME_BOOST,
          },
          'Applied filename video boost',
        );
      }

      if (keyTerms.length > 0) {
        const content = `${result.title || ''} ${result.summary || ''} ${result.text}`;
        if (this.contentContainsKeyTerms(content, keyTerms)) {
          multiplier += KEYWORD_BOOST - 1;
        }
      }

      if (entityIds.length > 0) {
        const matchedEntities = this.db
          .select({ weight: chunkEntities.weight })
          .from(chunkEntities)
          .where(
            and(
              eq(chunkEntities.chunkId, result.id),
              inArray(chunkEntities.entityId, entityIds),
            ),
          )
          .all();

        if (matchedEntities.length > 0) {
          const maxWeight = matchedEntities.reduce((max, entry) => {
            const weight = entry.weight ?? 1;
            return Math.max(max, weight);
          }, 0);
          const normalizedWeight = Math.min(1, Math.max(0, maxWeight));
          if (normalizedWeight > 0) {
            multiplier += (ENTITY_BOOST - 1) * normalizedWeight;
          }
        }
      }

      if (queryYear) {
        const { videoYearStart, videoYearEnd } = result;
        if (videoYearStart && videoYearEnd) {
          if (queryYear >= videoYearStart && queryYear <= videoYearEnd) {
            multiplier += TEMPORAL_BOOST - 1;
          } else {
            const distance = Math.min(
              Math.abs(queryYear - videoYearStart),
              Math.abs(queryYear - videoYearEnd),
            );
            if (distance > 4) {
              multiplier += TEMPORAL_PENALTY - 1;
            }
          }
        }
      }

      if (multiplier < MIN_MULTIPLIER) {
        multiplier = MIN_MULTIPLIER;
      }

      result.score = baseScore * multiplier;
    }

    return fused.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  }

  private fuse(
    vectorResults: HybridResult[],
    ftsResults: HybridResult[],
  ): HybridResult[] {
    const k = this.config.rrfK!;
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
