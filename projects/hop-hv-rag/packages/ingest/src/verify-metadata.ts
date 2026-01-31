import { createDb, videos, transcripts } from '@hop-hv-rag/db';
import { count, eq } from 'drizzle-orm';
import { join } from 'node:path';
import { logger } from '@hop-hv-rag/core';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  const db = createDb(DB_PATH);

  const [videoCount] = await db.select({ value: count() }).from(videos);
  const [transcriptCount] = await db
    .select({ value: count() })
    .from(transcripts);

  logger.print('--- Database Summary ---');
  logger.print(`Total Videos:      ${videoCount?.value}`);
  logger.print(`Total Segments:    ${transcriptCount?.value}`);

  if (videoCount?.value && videoCount.value > 0) {
    logger.print('\n--- Sample Ingestion ---');
    const [sampleVideo] = await db.select().from(videos).limit(1);
    if (sampleVideo) {
      logger.print(`Video: ${sampleVideo.filename}`);
      logger.print(`Title: ${sampleVideo.title}`);
      logger.print(`Year:  ${sampleVideo.year}`);
      logger.print(`Drive: ${sampleVideo.driveFileId}`);

      const sampleSegments = await db
        .select()
        .from(transcripts)
        .where(eq(transcripts.videoId, sampleVideo.id))
        .limit(3);

      logger.print('Segments (first 3):');
      sampleSegments.forEach((s) => {
        logger.print(
          `  [${s.startTime.toFixed(2)} - ${s.endTime.toFixed(2)}] ${s.text}`,
        );
      });
    }
  } else {
    logger.print('\nNo videos found in DB.');
  }
}

main().catch((err) => logger.error(err));
