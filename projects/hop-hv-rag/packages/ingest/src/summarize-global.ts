import {
  createDb,
  videos,
  chunks,
  chunkSummaries,
  type Video,
} from '@hop-hv-rag/db';
import { getGenModel } from '@hop-hv-rag/ai';
import { formatTimestamp, logger } from '@hop-hv-rag/core';
import { generateText, type LanguageModel } from 'ai';
import { and, desc, eq, sql } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { GLOBAL_SUMMARY_PROMPT } from './prompts.ts';
import { GenModelFlagOption, parseGenModelFlag } from './cli-flags.ts';
import { GlobalSummaryTUI } from './global-summary-tui.ts';

const DATA_DIR = resolve(process.cwd(), '../../data');
const DB_PATH = `${DATA_DIR}/hv-rag.db`;

class GlobalArchivist {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: LanguageModel,
  ) {}

  async processVideo(
    video: Video,
    options: { force?: boolean },
  ): Promise<number> {
    if (!options.force && video.globalSummary) {
      logger.info({ videoId: video.id }, '⏭️  Skipping existing summary');
      return 0;
    }

    logger.info({ videoId: video.id }, '🎥 Summarizing video');

    const summaryRows = await this.db
      .select({
        chunkId: chunkSummaries.chunkId,
        title: chunkSummaries.title,
        summary: chunkSummaries.summary,
        startTime: chunks.startTime,
      })
      .from(chunkSummaries)
      .innerJoin(chunks, eq(chunkSummaries.chunkId, chunks.id))
      .where(
        and(
          eq(chunks.videoId, video.id),
          eq(chunkSummaries.summaryType, 'scene'),
        ),
      )
      .orderBy(desc(chunkSummaries.id));

    const latestByChunk = new Map<number, any>();
    for (const row of summaryRows) {
      if (!latestByChunk.has(row.chunkId)) {
        latestByChunk.set(row.chunkId, row);
      }
    }

    const chunkSummariesSorted = Array.from(latestByChunk.values()).sort(
      (a, b) => a.startTime - b.startTime,
    );

    if (chunkSummariesSorted.length === 0) {
      logger.warn({ videoId: video.id }, '⚠️  No chunk summaries found');
      return 0;
    }

    const chunkContext = chunkSummariesSorted
      .map(
        (row) =>
          `[${formatTimestamp(row.startTime)}] ${row.title || 'Untitled'}: ${row.summary}`,
      )
      .join('\n');

    const userPrompt = `Video Title: ${video.title || video.filename}
Recorded Date: ${video.recordedAt || 'Unknown'}

CHUNK LOG:
${chunkContext}`;

    const { text } = await generateText({
      model: this.model,
      system: GLOBAL_SUMMARY_PROMPT,
      prompt: userPrompt,
    });

    const summary = text.trim();

    await this.db
      .update(videos)
      .set({ globalSummary: summary })
      .where(eq(videos.id, video.id));

    logger.info({ videoId: video.id }, '✅ Summary saved');
    return chunkSummariesSorted.length;
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
      concurrency: { type: 'string', default: '4' },
      verbose: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const archivist = new GlobalArchivist(
    db,
    getGenModel(parseGenModelFlag(values['gen-model'])),
  );

  const maxConcurrency = parseInt(values.concurrency!, 10);
  const isVerbose = Boolean(values.verbose);

  let targetVideos: Video[] = [];
  if (values.file) {
    targetVideos = await db
      .select()
      .from(videos)
      .where(eq(videos.filename, values.file));
  } else if (values.all) {
    targetVideos = await db.select().from(videos);
  } else {
    console.error(
      'Usage: bun ingest:global --file <filename> | --all [--force] [--verbose]',
    );
    process.exit(1);
  }

  let totalChunks = 0;
  for (const video of targetVideos) {
    const chunkCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(chunks)
      .where(eq(chunks.videoId, video.id))
      .get();
    totalChunks += chunkCount?.count ?? 0;
  }

  const tui = isVerbose ? null : new GlobalSummaryTUI();

  if (tui) {
    logger.level = 'silent';
    await tui.start(targetVideos.length, totalChunks, maxConcurrency);
  }

  const stats = {
    totalVideos: targetVideos.length,
    completedVideos: 0,
    totalChunks,
    completedChunks: 0,
    errors: [] as any[],
    warnings: [] as any[],
    failedVideos: [] as any[],
  };

  const activePromises = new Set<Promise<void>>();

  for (const video of targetVideos) {
    const startTime = Date.now();
    const promise = archivist
      .processVideo(video, { force: values.force })
      .then((chunkCount) => {
        stats.completedVideos++;
        stats.completedChunks += chunkCount;
        if (tui) {
          tui.recordVideoComplete({
            videoId: video.id,
            filename: video.filename,
            chunkCount,
            durationMs: Date.now() - startTime,
            timestamp: Date.now(),
            hadError: false,
          });
          tui.updateProgress(stats.completedVideos, stats.completedChunks);
        } else {
          logger.info({ filename: video.filename }, '✅ Video complete');
        }
      })
      .catch((err) => {
        stats.completedVideos++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        stats.errors.push({ filename: video.filename, error: errorMessage });
        stats.failedVideos.push({ filename: video.filename });
        if (tui) {
          tui.recordVideoComplete({
            videoId: video.id,
            filename: video.filename,
            chunkCount: 0,
            durationMs: Date.now() - startTime,
            timestamp: Date.now(),
            hadError: true,
            errorMessage,
          });
          tui.updateProgress(stats.completedVideos, stats.completedChunks);
        } else {
          logger.error(
            { filename: video.filename, error: errorMessage },
            '❌ Video error',
          );
        }
      })
      .finally(() => {
        activePromises.delete(promise);
        if (tui) tui.setInFlightCount(activePromises.size);
      });

    activePromises.add(promise);
    if (tui) tui.setInFlightCount(activePromises.size);

    if (activePromises.size >= maxConcurrency) {
      await Promise.race(activePromises);
    }
  }

  await Promise.all(activePromises);

  if (tui) {
    tui.finalize(stats);
  } else {
    logger.info('🏁 All videos processed.');
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
