import { createDb, scenes, videos } from '@hop-hv-rag/db';
import { eq, sql } from 'drizzle-orm';
import { resolve } from 'node:path';

const DATA_DIR = resolve(process.cwd(), '../../data');
const DB_PATH = `${DATA_DIR}/hv-rag.db`;
const THUMBNAILS_DIR = `${DATA_DIR}/thumbnails`;

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  success: (msg: string) => console.log(`[SUCCESS] ${msg}`),
};

async function backfillThumbnails() {
  logger.info('Starting thumbnail path backfill...');
  logger.info(`Database: ${DB_PATH}`);
  logger.info(`Thumbnails directory: ${THUMBNAILS_DIR}`);

  const db = createDb(DB_PATH);

  try {
    // Get all scenes that need thumbnail paths
    const allScenes = await db
      .select({
        sceneId: scenes.id,
        videoFilename: videos.filename,
        startTime: scenes.startTime,
        thumbnailPath: scenes.thumbnailPath,
      })
      .from(scenes)
      .leftJoin(videos, eq(scenes.videoId, videos.id));

    // Update ALL scenes to ensure correct path format (not just those without paths)
    const scenesToUpdate = allScenes;
    logger.info(
      `Updating all ${scenesToUpdate.length} scenes with correct thumbnail paths (out of ${allScenes.length} total)`,
    );

    let updated = 0;
    let errors = 0;

    for (const scene of scenesToUpdate) {
      try {
        const videoFolder = scene.videoFilename?.replace(/\.[^/.]+$/, '');
        if (!videoFolder) {
          logger.error(`Scene ${scene.sceneId}: No video filename found`);
          errors++;
          continue;
        }

        const timestampPadded = Math.floor(scene.startTime)
          .toString()
          .padStart(5, '0');
        const thumbnailPath = `/${videoFolder}/${timestampPadded}.jpg`;

        await db
          .update(scenes)
          .set({ thumbnailPath })
          .where(eq(scenes.id, scene.sceneId));

        updated++;

        if (updated % 100 === 0) {
          logger.info(
            `Progress: ${updated}/${scenesToUpdate.length} scenes updated`,
          );
        }
      } catch (error) {
        logger.error(`Failed to update scene ${scene.sceneId}: ${error}`);
        errors++;
      }
    }

    logger.success(`Backfill complete! Updated ${updated} scenes.`);
    if (errors > 0) {
      logger.error(`Encountered ${errors} errors during backfill.`);
    }

    // Verify results
    const remainingResult = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(scenes)
      .where(sql`${scenes.thumbnailPath} IS NULL`);
    const remainingCount = remainingResult[0]?.count || 0;
    logger.info(`Scenes still without thumbnail paths: ${remainingCount}`);
  } catch (error) {
    logger.error(`Fatal error during backfill: ${error}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  backfillThumbnails();
}
