import { createDb, videos, type Video } from '@hop-hv-rag/db';
import { getEmbedModel, type EmbeddingModelName } from '@hop-hv-rag/ai';
import { embedMany, type EmbeddingModel } from 'ai';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { logger } from '@hop-hv-rag/core';

/**
 * Configuration
 */
const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

/**
 * VideoEmbedder: Orchestrates the vectorization of global video summaries.
 */
class VideoEmbedder {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: EmbeddingModel,
  ) {}

  /**
   * Processes a list of videos in batches to generate and save embeddings.
   */
  async embedVideos(videoList: Video[], batchSize: number) {
    logger.info(
      { videoCount: videoList.length, batchSize },
      'Starting embedding for videos',
    );

    for (let i = 0; i < videoList.length; i += batchSize) {
      const batch = videoList.slice(i, i + batchSize);
      await this.processBatch(batch, i / batchSize + 1);
    }
  }

  private async processBatch(batch: Video[], batchNumber: number) {
    logger.info(
      { batchNumber, videoCount: batch.length },
      'Processing embedding batch',
    );

    // Only embed videos with global summaries
    const validVideos = batch.filter((v) => v.globalSummary);

    if (validVideos.length === 0) {
      logger.info({ batchNumber }, 'No videos with global summaries in batch');
      return;
    }

    const textValues = validVideos.map((v) => v.globalSummary!);

    try {
      const { embeddings } = await embedMany({
        model: this.model,
        values: textValues,
      });

      for (let j = 0; j < validVideos.length; j++) {
        const video = validVideos[j];
        const embedding = embeddings[j];

        await this.db.run(
          sql.raw(`
          INSERT OR REPLACE INTO vec_videos(rowid, video_embedding)
          VALUES (${video.id}, '${JSON.stringify(embedding)}')
        `),
        );
      }

      logger.info(
        { batchNumber, embeddedCount: validVideos.length },
        'Embedding batch saved',
      );
    } catch (error: any) {
      logger.error(
        { batchNumber, error: error.message },
        'Embedding batch failed',
      );
    }
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
      model: { type: 'string', default: 'embed-small' },
      batchSize: { type: 'string', default: '50' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const embedder = new VideoEmbedder(
    db,
    getEmbedModel(values.model as EmbeddingModelName),
  );
  const batchSize = parseInt(values.batchSize!);

  let targetVideos: Video[] = [];

  if (values.file) {
    targetVideos = await db
      .select()
      .from(videos)
      .where(eq(videos.filename, values.file));
  } else if (values.all) {
    if (values.force) {
      // Get all videos with global summaries
      targetVideos = await db
        .select()
        .from(videos)
        .where(sql`${videos.globalSummary} IS NOT NULL`);
    } else {
      // Find videos missing from vec_videos
      const existingRes = await db.all<{ rowid: number }>(
        sql.raw(`SELECT rowid FROM vec_videos`),
      );
      const existingIds = new Set(existingRes.map((r) => r.rowid));

      const allVideos = await db
        .select()
        .from(videos)
        .where(sql`${videos.globalSummary} IS NOT NULL`);
      targetVideos = allVideos.filter((v) => !existingIds.has(v.id));
    }
  } else {
    logger.error(
      'Usage: bun ingest:embed-videos --file <filename> | --all [--force] [--batchSize <n>]',
    );
    process.exit(1);
  }

  if (targetVideos.length === 0) {
    logger.info('All videos with global summaries are already vectorized');
    return;
  }

  await embedder.embedVideos(targetVideos, batchSize);
  logger.info('Embedding complete');
}

main().catch((err) => {
  logger.error(err, 'Embedding failed');
  process.exit(1);
});
