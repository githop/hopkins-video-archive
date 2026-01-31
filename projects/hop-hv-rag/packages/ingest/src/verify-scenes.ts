import { createDb, videos, scenes } from '@hop-hv-rag/db';
import { count, eq, desc } from 'drizzle-orm';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { logger } from '@hop-hv-rag/core';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      limit: { type: 'string', default: '5' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const limit = parseInt(values.limit as string);

  const [sceneCount] = await db.select({ value: count() }).from(scenes);
  logger.print(`\n📊 Total Scenes in DB: ${sceneCount?.value}\n`);

  let targetScenes;

  if (values.file) {
    const video = (
      await db.select().from(videos).where(eq(videos.filename, values.file))
    )[0];
    if (!video) {
      logger.error(`❌ Video not found: ${values.file}`);
      return;
    }
    logger.print(`--- Scenes for: ${video.filename} ---`);
    targetScenes = await db
      .select()
      .from(scenes)
      .where(eq(scenes.videoId, video.id))
      .orderBy(scenes.startTime);
  } else {
    logger.print(`--- Latest ${limit} Summarized Scenes ---`);
    targetScenes = await db
      .select()
      .from(scenes)
      .orderBy(desc(scenes.id))
      .limit(limit);
  }

  for (const scene of targetScenes) {
    const video = (
      await db.select().from(videos).where(eq(videos.id, scene.videoId))
    )[0];
    const timeStr = `${Math.floor(scene.startTime / 60)}:${(scene.startTime % 60).toString().padStart(2, '0').split('.')[0]}`;

    logger.print(`\n[${video?.filename || 'Unknown'}] @ ${timeStr}`);
    logger.print(`TITLE:        ${scene.title}`);
    logger.print(`SUMMARY:      ${scene.summary}`);
    logger.print(
      `PARTICIPANTS: ${scene.participants ? JSON.parse(scene.participants).join(', ') : 'None'}`,
    );
    logger.print(
      `LOCATIONS:    ${scene.locations ? JSON.parse(scene.locations).join(', ') : 'None'}`,
    );
    logger.print(`--------------------------------------------------`);
  }
}

main().catch((err) => logger.error(err));
