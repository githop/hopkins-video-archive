import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  createDb,
  videos,
  chunks,
  chunkSummaries,
  chunkEntityMentions,
  type Video,
} from '@hop-hv-rag/db';
import { getGenModel } from '@hop-hv-rag/ai';
import {
  generateText,
  Output,
  NoObjectGeneratedError,
  type LanguageModel,
} from 'ai';
import { logger } from '@hop-hv-rag/core';
import {
  CHUNK_ENTITY_EXTRACTION_PROMPT,
  ChunkEntityExtractionSchema,
} from './prompts.ts';
import { GenModelFlagOption, parseGenModelFlag } from './cli-flags.ts';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

interface ChunkEntityRow {
  id: number;
  videoId: number;
  startTime: number;
  endTime: number;
  text: string;
  videoTitle: string | null;
  videoFilename: string;
  summary: string | null;
}

interface MentionOutput {
  type: 'PERSON' | 'ROLE' | 'PLACE' | 'SETTING' | 'ACTIVITY';
  raw_text: string;
  evidence_text: string;
  start_time: number;
  end_time: number;
  confidence: 'high' | 'medium' | 'low';
}

async function hashText(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isValidMention(row: ChunkEntityRow, mention: MentionOutput): boolean {
  const evidence = mention.evidence_text.trim();
  if (!evidence) return false;
  if (!row.text.includes(evidence)) return false;
  if (mention.start_time < row.startTime || mention.end_time > row.endTime)
    return false;
  if (mention.end_time <= mention.start_time) return false;
  return true;
}

class EntityExtractor {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: LanguageModel,
  ) {}

  async extractForChunk(
    row: ChunkEntityRow,
    promptHash: string,
    runId: string,
    modelName: string,
  ) {
    const summarySection = row.summary
      ? `\nCHUNK SUMMARY:\n${row.summary}\n`
      : '';

    const prompt = `VIDEO: ${row.videoTitle || row.videoFilename}
FILENAME: ${row.videoFilename}
TIME RANGE: ${row.startTime.toFixed(2)}s - ${row.endTime.toFixed(2)}s
${summarySection}
TRANSCRIPT CHUNK:
${row.text}`;

    try {
      const { output } = await generateText({
        model: this.model,
        system: CHUNK_ENTITY_EXTRACTION_PROMPT,
        output: Output.object({ schema: ChunkEntityExtractionSchema }),
        prompt,
        maxRetries: 3,
      });

      const mentions: MentionOutput[] = output.mentions;
      const validMentions: MentionOutput[] = [];
      const seen = new Set<string>();

      for (const mention of mentions) {
        if (!isValidMention(row, mention)) {
          continue;
        }

        const rawText = mention.raw_text.trim();
        if (!rawText) continue;
        const key = `${mention.type}:${rawText}:${mention.start_time}:${mention.end_time}:${mention.evidence_text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        validMentions.push({
          ...mention,
          raw_text: rawText,
        });
      }

      if (validMentions.length === 0) {
        logger.info({ chunkId: row.id }, 'No valid mentions found');
        return;
      }

      await this.db.insert(chunkEntityMentions).values(
        validMentions.map((mention) => ({
          chunkId: row.id,
          entityType: mention.type,
          rawText: mention.raw_text,
          evidenceText: mention.evidence_text.trim(),
          startTime: mention.start_time,
          endTime: mention.end_time,
          confidence: mention.confidence,
          model: modelName,
          promptHash,
          runId,
          entityId: null,
        })),
      );

      logger.info(
        { chunkId: row.id, count: validMentions.length },
        '✅ Entity mentions saved',
      );
    } catch (error: unknown) {
      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn(
          { chunkId: row.id, text: error.text, response: error.response },
          'No object generated - invalid JSON',
        );
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { chunkId: row.id, error: message },
        'Entity extraction failed',
      );
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'gen-model': GenModelFlagOption,
      'run-id': { type: 'string' },
      'summary-type': { type: 'string', default: 'scene' },
      'batch-size': { type: 'string', default: '50' },
      concurrency: { type: 'string', default: '8' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const summaryType = String(values['summary-type']);
  const batchSize = parseInt(String(values['batch-size']), 10);
  const concurrency = parseInt(String(values.concurrency), 10);
  const promptHash = await hashText(CHUNK_ENTITY_EXTRACTION_PROMPT);
  const runId = values['run-id'] ? String(values['run-id']) : promptHash;

  let targetVideos: Video[] = [];
  if (values.file) {
    targetVideos = await db
      .select()
      .from(videos)
      .where(eq(videos.filename, values.file));
  } else if (values.all) {
    targetVideos = await db.select().from(videos);
  } else {
    logger.error(
      'Usage: bun run ingest:extract-entities --file <filename> | --all [--force] [--run-id <id>] [--batch-size 50] [--concurrency 8]',
    );
    process.exit(1);
  }

  if (targetVideos.length === 0) {
    logger.warn('No videos matched the selection.');
    return;
  }

  const targetVideoIds = targetVideos.map((video) => video.id);

  if (values.force) {
    const chunkIds = await db
      .select({ id: chunks.id })
      .from(chunks)
      .where(inArray(chunks.videoId, targetVideoIds));
    const ids = chunkIds.map((row) => row.id);
    if (ids.length > 0) {
      await db
        .delete(chunkEntityMentions)
        .where(inArray(chunkEntityMentions.chunkId, ids));
    }
  }

  const processed = await db
    .select({ chunkId: chunkEntityMentions.chunkId })
    .from(chunkEntityMentions)
    .where(
      and(
        eq(chunkEntityMentions.runId, runId),
        eq(chunkEntityMentions.promptHash, promptHash),
      ),
    );

  const processedIds = new Set(processed.map((row) => row.chunkId));

  const chunkRows = await db
    .select({
      id: chunks.id,
      videoId: chunks.videoId,
      startTime: chunks.startTime,
      endTime: chunks.endTime,
      text: chunks.text,
      videoTitle: videos.title,
      videoFilename: videos.filename,
    })
    .from(chunks)
    .innerJoin(videos, eq(chunks.videoId, videos.id))
    .where(inArray(chunks.videoId, targetVideoIds))
    .orderBy(chunks.startTime);

  if (chunkRows.length === 0) {
    logger.info('No chunks found for extraction.');
    return;
  }

  const chunkIds = chunkRows.map((row) => row.id);
  const summaryRows = await db
    .select({
      chunkId: chunkSummaries.chunkId,
      summary: chunkSummaries.summary,
    })
    .from(chunkSummaries)
    .where(
      and(
        eq(chunkSummaries.summaryType, summaryType),
        inArray(chunkSummaries.chunkId, chunkIds),
      ),
    )
    .orderBy(desc(chunkSummaries.id));

  const summaryMap = new Map<number, string>();
  for (const row of summaryRows) {
    if (!summaryMap.has(row.chunkId)) {
      summaryMap.set(row.chunkId, row.summary);
    }
  }

  const pending = chunkRows
    .filter((row) => !processedIds.has(row.id))
    .map((row) => ({
      ...row,
      summary: summaryMap.get(row.id) ?? null,
    }));

  if (pending.length === 0) {
    logger.info('No chunks to extract entities from.');
    return;
  }

  logger.info(
    {
      pending: pending.length,
      runId,
      batchSize,
      concurrency,
    },
    'Starting entity extraction',
  );

  const modelName = parseGenModelFlag(values['gen-model']);
  const extractor = new EntityExtractor(db, getGenModel(modelName));

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const active = new Set<Promise<void>>();

    for (const row of batch) {
      const promise = extractor
        .extractForChunk(row, promptHash, runId, modelName)
        .then(() => undefined);

      active.add(promise);
      promise.finally(() => active.delete(promise));

      if (active.size >= concurrency) {
        await Promise.race(active);
      }
    }

    await Promise.all(active);
    logger.info(
      {
        batch: i / batchSize + 1,
        total: Math.ceil(pending.length / batchSize),
      },
      'Batch completed',
    );
  }

  logger.info('Entity extraction complete');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'Extract entities failed');
    process.exit(1);
  });
}
