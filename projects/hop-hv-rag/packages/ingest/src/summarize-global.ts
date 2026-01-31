import {
  createDb,
  videos,
  scenes,
  type Video,
  type Scene,
} from '@hop-hv-rag/db';
import { getGenModel, type GenerationModelName } from '@hop-hv-rag/ai';
import { logger } from '@hop-hv-rag/core';
import { generateText, type LanguageModel } from 'ai';
import { eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { GLOBAL_SUMMARY_PROMPT } from './prompts.ts';

/**
 * Configuration & Constants
 */
const DATA_DIR = resolve(process.cwd(), '../../data');
const DB_PATH = `${DATA_DIR}/hv-rag.db`;

/**
 * GlobalArchivist: Generates a global "Archival Abstract" for a video
 * by synthesizing its constituent scenes.
 */
class GlobalArchivist {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: LanguageModel,
  ) {}

  /**
   * Main entry point for processing a video
   */
  async processVideo(video: Video, options: { force?: boolean }) {
    // If not forced, check if summary exists (idempotency)
    if (!options.force && video.globalSummary) {
      logger.info(
        { videoId: video.id, filename: video.filename },
        '⏭️  Global summary exists. Skipping.',
      );
      return;
    }

    logger.info(
      { videoId: video.id, filename: video.filename },
      '🎥 Generating global summary',
    );

    // Fetch all scenes for this video
    const videoScenes = await this.db
      .select()
      .from(scenes)
      .where(eq(scenes.videoId, video.id))
      .orderBy(scenes.startTime);

    if (videoScenes.length === 0) {
      logger.warn(
        { videoId: video.id },
        '⚠️  No scenes found. Cannot generate global summary.',
      );
      return;
    }

    try {
      const summary = await this.generateGlobalSummary(video, videoScenes);

      // Update the video record
      await this.db
        .update(videos)
        .set({
          globalSummary: summary,
        })
        .where(eq(videos.id, video.id));

      logger.info(
        { videoId: video.id, summaryLength: summary.length },
        '✅ Global summary saved',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { videoId: video.id, error: message },
        '❌ Failed to generate global summary',
      );
    }
  }

  /**
   * Orchestrates the LLM call
   */
  private async generateGlobalSummary(
    video: Video,
    videoScenes: Scene[],
  ): Promise<string> {
    // Construct context from scenes
    const sceneContext = videoScenes
      .map((s) => {
        const time = this.formatTime(s.startTime);
        return `[${time}] ${s.title || 'Untitled'}: ${s.summary}`;
      })
      .join('\n');

    const systemPrompt = this.getSystemPrompt();
    const userPrompt = `Video Title: ${video.title || video.filename}
Recorded Date: ${video.recordedAt || 'Unknown'}

SCENE LOG:
${sceneContext}`;

    logger.debug(
      {
        videoId: video.id,
        sceneCount: videoScenes.length,
        promptLength: userPrompt.length,
      },
      '🔍 LLM Context Payload',
    );

    const { text } = await generateText({
      model: this.model,
      system: systemPrompt,
      prompt: userPrompt,
    });

    return text.trim();
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private getSystemPrompt(): string {
    return GLOBAL_SUMMARY_PROMPT;
  }
}

/**
 * CLI Entry Point
 */
async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      model: { type: 'string', default: 'summarizer-bulk-14b' },
      concurrency: { type: 'string', default: '4' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);

  const archivist = new GlobalArchivist(
    db,
    getGenModel(values.model as GenerationModelName),
  );

  const concurrency = parseInt(values.concurrency!);

  // Determine target videos
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
      'Usage: bun ingest:global --file <filename> | --all [--force] [--model <name>] [--concurrency <n>]',
    );
    process.exit(1);
  }

  logger.info(
    { videoCount: targetVideos.length, concurrency },
    '🎬 Global Archivist starting...',
  );

  const activePromises = new Set<Promise<void>>();

  for (const video of targetVideos) {
    const promise = archivist
      .processVideo(video, {
        force: values.force,
      })
      .catch((error) => {
        logger.error(
          {
            videoId: video.id,
            error: error instanceof Error ? error.message : String(error),
          },
          '❌ Critical error processing video',
        );
      });

    activePromises.add(promise);

    promise.finally(() => activePromises.delete(promise));

    if (activePromises.size >= concurrency) {
      await Promise.race(activePromises);
    }
  }

  await Promise.all(activePromises);

  logger.info('🏁 All videos processed.');
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Fatal error in main');
  process.exit(1);
});
