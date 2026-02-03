import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { and, eq, inArray, desc } from 'drizzle-orm';
import {
  createDb,
  videos,
  chunks,
  chunkSummaries,
  chunkEntityMentions,
  type Video,
  type Chunk,
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
import { TUI } from './tui.ts';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

interface ChunkJob {
  video: Video;
  chunk: Chunk;
  chunkIndex: number;
  totalChunks: number;
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

interface ProgressCallbacks {
  onChunkComplete: (video: Video, mentionCount: number) => void;
  onVideoComplete: (video: Video, totalMentions: number) => void;
  onVideoError: (video: Video, error: string) => void;
  onVideoWarning: (video: Video, message: string) => void;
}

async function hashText(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isValidMention(chunk: Chunk, mention: MentionOutput): boolean {
  // 1. Time bounds check
  if (mention.start_time < chunk.startTime || mention.end_time > chunk.endTime)
    return false;
  if (mention.end_time < mention.start_time) return false;

  const evidence = mention.evidence_text.trim();
  if (!evidence) return false;

  // 2. Strict containment check (original)
  if (chunk.text.includes(evidence)) return true;

  // 3. Case-insensitive check
  const textLower = chunk.text.toLowerCase();
  const evidenceLower = evidence.toLowerCase();
  if (textLower.includes(evidenceLower)) return true;

  // 4. Punctuation-agnostic check (remove trailing punctuation)
  const cleanEvidence = evidenceLower.replace(/[.,;!?]+$/, '');
  if (textLower.includes(cleanEvidence)) return true;

  return false;
}

class JobPlanner {
  constructor(
    private db: ReturnType<typeof createDb>,
    private summaryType: string,
    private promptHash: string,
    private runId: string,
    private resumeAnyPrompt: boolean,
  ) {}

  async planJobs(
    videosToProcess: Video[],
    options: { force?: boolean },
  ): Promise<{
    jobs: ChunkJob[];
    videosToProcess: Video[];
    videosSkipped: Video[];
  }> {
    const jobs: ChunkJob[] = [];
    const videosReady: Video[] = [];
    const videosSkipped: Video[] = [];

    for (const video of videosToProcess) {
      const videoJobs = await this.planVideoJobs(video, options);

      if (videoJobs.length === 0 && !options.force) {
        videosSkipped.push(video);
      } else {
        videosReady.push(video);
        jobs.push(...videoJobs);
      }
    }

    return { jobs, videosToProcess: videosReady, videosSkipped };
  }

  private async planVideoJobs(
    video: Video,
    options: { force?: boolean },
  ): Promise<ChunkJob[]> {
    if (options.force) {
      await this.deleteVideoMentions(video.id);
    }

    const allChunks = await this.db
      .select()
      .from(chunks)
      .where(eq(chunks.videoId, video.id))
      .orderBy(chunks.startTime);

    if (allChunks.length === 0) {
      return [];
    }

    const chunkIds = allChunks.map((chunk) => chunk.id);

    // Fetch existing mentions to determine what's pending
    const processedMentions = await this.db
      .select({ chunkId: chunkEntityMentions.chunkId })
      .from(chunkEntityMentions)
      .where(
        this.resumeAnyPrompt
          ? and(
              eq(chunkEntityMentions.runId, this.runId),
              inArray(chunkEntityMentions.chunkId, chunkIds),
            )
          : and(
              eq(chunkEntityMentions.runId, this.runId),
              eq(chunkEntityMentions.promptHash, this.promptHash),
              inArray(chunkEntityMentions.chunkId, chunkIds),
            ),
      );

    const processedIds = new Set(processedMentions.map((row) => row.chunkId));
    const pendingChunks = allChunks.filter(
      (chunk) => !processedIds.has(chunk.id),
    );

    if (pendingChunks.length === 0) {
      return [];
    }

    // Fetch summaries for pending chunks
    const pendingChunkIds = pendingChunks.map((c) => c.id);
    const summaryRows = await this.db
      .select({
        chunkId: chunkSummaries.chunkId,
        summary: chunkSummaries.summary,
      })
      .from(chunkSummaries)
      .where(
        and(
          eq(chunkSummaries.summaryType, this.summaryType),
          inArray(chunkSummaries.chunkId, pendingChunkIds),
        ),
      )
      .orderBy(desc(chunkSummaries.id));

    const summaryMap = new Map<number, string>();
    for (const row of summaryRows) {
      if (!summaryMap.has(row.chunkId)) {
        summaryMap.set(row.chunkId, row.summary);
      }
    }

    const indexById = new Map<number, number>();
    allChunks.forEach((chunk, index) => {
      indexById.set(chunk.id, index);
    });

    return pendingChunks.map((chunk) => ({
      video,
      chunk,
      chunkIndex: indexById.get(chunk.id) ?? 0,
      totalChunks: allChunks.length,
      summary: summaryMap.get(chunk.id) ?? null,
    }));
  }

  private async deleteVideoMentions(videoId: number): Promise<void> {
    const chunkRows = await this.db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.videoId, videoId));

    const ids = chunkRows.map((row) => row.id);
    if (ids.length === 0) return;

    await this.db
      .delete(chunkEntityMentions)
      .where(inArray(chunkEntityMentions.chunkId, ids));
  }
}

class ChunkEntityExtractor {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: LanguageModel,
  ) {}

  async processChunkJob(
    job: ChunkJob,
    promptHash: string,
    runId: string,
    modelName: string,
  ): Promise<number> {
    const { video, chunk, summary } = job;
    const summarySection = summary ? `\nCHUNK SUMMARY:\n${summary}\n` : '';

    const prompt = `VIDEO: ${video.title || video.filename}
FILENAME: ${video.filename}
TIME RANGE: ${chunk.startTime.toFixed(2)}s - ${chunk.endTime.toFixed(2)}s
${summarySection}
TRANSCRIPT CHUNK:
${chunk.text}`;

    try {
      const { output } = await generateText({
        model: this.model,
        system: CHUNK_ENTITY_EXTRACTION_PROMPT,
        output: Output.object({ schema: ChunkEntityExtractionSchema }),
        prompt,
        maxRetries: 3,
        timeout: 5 * 60 * 1000,
      });

      const mentions: MentionOutput[] = output.mentions;
      const validMentions: MentionOutput[] = [];
      const seen = new Set<string>();

      for (const mention of mentions) {
        if (!isValidMention(chunk, mention)) {
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

      if (validMentions.length > 0) {
        await this.db.insert(chunkEntityMentions).values(
          validMentions.map((mention) => ({
            chunkId: chunk.id,
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
      }

      logger.info(
        { chunkId: chunk.id, count: validMentions.length },
        '✅ Entity mentions saved',
      );

      return validMentions.length;
    } catch (error: unknown) {
      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn(
          { chunkId: chunk.id, text: error.text, response: error.response },
          'No object generated - invalid JSON',
        );
        const err = new Error('AI failed to generate valid mentions');
        (err as Error & { errorType?: string }).errorType = 'ai-parse';
        throw err;
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { chunkId: chunk.id, error: message },
        'Entity extraction failed',
      );
      const err = new Error(message);
      (err as Error & { errorType?: string }).errorType = 'api';
      throw err;
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
      'resume-any-prompt': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '8' },
      verbose: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const summaryType = String(values['summary-type']);
  const promptHash = await hashText(CHUNK_ENTITY_EXTRACTION_PROMPT);
  const runId = values['run-id'] ? String(values['run-id']) : promptHash;
  const maxConcurrency = parseInt(String(values.concurrency), 10);
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
    logger.error(
      'Usage: bun run ingest:extract-entities --file <filename> | --all [--force] [--run-id <id>] [--resume-any-prompt] [--summary-type scene] [--concurrency 8] [--verbose]',
    );
    process.exit(1);
  }

  if (targetVideos.length === 0) {
    logger.warn('No videos matched the selection.');
    return;
  }

  logger.info(
    { videoCount: targetVideos.length },
    '📋 Planning phase: Calculating chunks...',
  );

  const planner = new JobPlanner(
    db,
    summaryType,
    promptHash,
    runId,
    Boolean(values['resume-any-prompt']),
  );

  const { jobs, videosToProcess, videosSkipped } = await planner.planJobs(
    targetVideos,
    { force: values.force },
  );

  if (videosSkipped.length > 0) {
    for (const video of videosSkipped) {
      logger.info(
        { filename: video.filename },
        '✅ Video fully processed (skipping)',
      );
    }
  }

  if (jobs.length === 0) {
    logger.info('🏁 No work to do - all videos already processed.');
    process.exit(0);
  }

  logger.info(
    {
      totalJobs: jobs.length,
      videosToProcess: videosToProcess.length,
      videosSkipped: videosSkipped.length,
    },
    `🚀 Interleaved execution: ${jobs.length} chunks across ${videosToProcess.length} videos`,
  );

  const stats = {
    totalVideos: videosToProcess.length,
    completedVideos: 0,
    totalChunks: jobs.length,
    completedChunks: 0,
    totalScenes: 0, // Using this for total mentions
    errors: [] as Array<{ videoId: number; filename: string; error: string }>,
    warnings: [] as Array<{
      videoId: number;
      filename: string;
      message: string;
    }>,
    failedChunks: [] as Array<{
      videoId: number;
      filename: string;
      chunkNum: number;
      totalChunks: number;
      errorType: 'ai-parse' | 'api' | 'unknown';
      errorMessage: string;
    }>,
  };

  const videoProgress = new Map<
    number,
    {
      video: Video;
      totalChunks: number;
      completedChunks: number;
      mentions: number;
    }
  >();

  for (const video of videosToProcess) {
    const videoJobs = jobs.filter((job) => job.video.id === video.id);
    const totalChunks = videoJobs.length;
    videoProgress.set(video.id, {
      video,
      totalChunks,
      completedChunks: 0,
      mentions: 0,
    });
  }

  const tui = isVerbose ? null : new TUI();

  if (!isVerbose) {
    logger.level = 'silent';
    await tui!.start(stats.totalChunks, stats.totalVideos, maxConcurrency);
  } else {
    logger.info(
      { jobs: jobs.length, maxConcurrency },
      '🎬 Starting interleaved processing...',
    );
  }

  process.on('SIGINT', () => {
    if (!isVerbose && tui) {
      tui.stop();
    }
    console.log('\n\n⚠️ Interrupted - exiting immediately');
    process.exit(1);
  });

  const progressCallbacks: ProgressCallbacks = {
    onChunkComplete: (video, mentionCount) => {
      stats.totalScenes += mentionCount; // TUI uses totalScenes field for items found
      const progress = videoProgress.get(video.id);
      if (!progress) return;
      progress.mentions += mentionCount;
      if (!isVerbose && tui) {
        tui.updateProgress(
          stats.completedChunks,
          stats.completedVideos,
          stats.totalScenes,
        );
      }
    },
    onVideoComplete: (video, totalMentions) => {
      stats.completedVideos++;
      if (!isVerbose && tui) {
        tui.updateProgress(
          stats.completedChunks,
          stats.completedVideos,
          stats.totalScenes,
        );
      } else {
        logger.info(
          {
            videoId: video.id,
            filename: video.filename,
            mentions: totalMentions,
          },
          '✅ Video complete',
        );
      }
    },
    onVideoError: (video, error) => {
      stats.errors.push({ videoId: video.id, filename: video.filename, error });
      if (!isVerbose && tui) {
        tui.showError(`${video.filename}: ${error}`, 10000);
      } else {
        logger.error({ videoId: video.id, error }, '❌ Video error');
      }
    },
    onVideoWarning: (video, message) => {
      stats.warnings.push({
        videoId: video.id,
        filename: video.filename,
        message,
      });
      if (isVerbose) {
        logger.warn({ videoId: video.id }, `⚠️ ${message}`);
      }
    },
  };

  const modelName = parseGenModelFlag(values['gen-model']);
  const extractor = new ChunkEntityExtractor(db, getGenModel(modelName));

  const activePromises = new Set<Promise<unknown>>();

  for (const job of jobs) {
    if (activePromises.size >= maxConcurrency) {
      await Promise.race(activePromises);
    }

    const progress = videoProgress.get(job.video.id);
    if (!progress) continue;

    const chunkStartTime = Date.now();
    let chunkError: string | null = null;
    let chunkErrorType: 'ai-parse' | 'api' | 'unknown' = 'unknown';
    let mentionCount = 0;

    const promise = extractor
      .processChunkJob(job, promptHash, runId, modelName)
      .then((count) => {
        mentionCount = count;
        progressCallbacks.onChunkComplete(job.video, count);
        return { count, error: null, errorType: null };
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const errorType = (error as Error & { errorType?: string }).errorType;
        chunkError = message;
        chunkErrorType =
          errorType === 'ai-parse'
            ? 'ai-parse'
            : errorType === 'api'
              ? 'api'
              : 'unknown';

        stats.failedChunks.push({
          videoId: job.video.id,
          filename: job.video.filename,
          chunkNum: job.chunkIndex + 1,
          totalChunks: job.totalChunks,
          errorType: chunkErrorType,
          errorMessage: message,
        });

        progressCallbacks.onVideoError(job.video, message);
        return { count: 0, error: message, errorType: chunkErrorType };
      })
      .finally(() => {
        stats.completedChunks++;
        progress.completedChunks++;
        if (progress.completedChunks >= progress.totalChunks) {
          progressCallbacks.onVideoComplete(job.video, progress.mentions);
        }
        if (!isVerbose && tui) {
          tui.recordChunkComplete({
            videoId: job.video.id,
            filename: job.video.filename,
            chunkNum: job.chunkIndex + 1,
            totalChunks: job.totalChunks,
            title: chunkError ? null : `${mentionCount} entities`, // Reuse title field for entity count
            durationMs: Date.now() - chunkStartTime,
            timestamp: Date.now(),
            hadError: chunkError !== null,
            errorType: chunkErrorType,
            errorMessage: chunkError ?? undefined,
          });
          tui.setInFlightCount(activePromises.size);
          tui.updateProgress(
            stats.completedChunks,
            stats.completedVideos,
            stats.totalScenes,
          );
        }
      });

    activePromises.add(promise);

    if (!isVerbose && tui) {
      tui.setInFlightCount(activePromises.size);
    }

    promise.finally(() => {
      activePromises.delete(promise);
      if (!isVerbose && tui) {
        tui.setInFlightCount(activePromises.size);
      }
    });
  }

  await Promise.all(activePromises);

  if (!isVerbose && tui) {
    tui.finalize({
      totalVideos: stats.totalVideos,
      completedVideos: stats.completedVideos,
      totalChunks: stats.totalChunks,
      completedChunks: stats.completedChunks,
      totalScenes: stats.totalScenes, // Repurposed for total mentions
      errors: stats.errors,
      warnings: stats.warnings,
      failedChunks: stats.failedChunks,
    });
  } else {
    logger.info('🏁 All videos processed.');
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'Extract entities failed');
    process.exit(1);
  });
}
