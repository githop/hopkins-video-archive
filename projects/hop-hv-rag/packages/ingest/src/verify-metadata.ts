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

  console.log('--- Database Summary ---');
  console.log(`Total Videos:      ${videoCount?.value}`);
  console.log(`Total Segments:    ${transcriptCount?.value}`);

  if (videoCount?.value && videoCount.value > 0) {
    console.log('\n--- Sample Ingestion ---');
    const [sampleVideo] = await db.select().from(videos).limit(1);
    if (sampleVideo) {
      console.log(`Video: ${sampleVideo.filename}`);
      console.log(`Title: ${sampleVideo.title}`);
      console.log(`Year:  ${sampleVideo.year}`);
      console.log(`Drive: ${sampleVideo.driveFileId}`);

      const sampleSegments = await db
        .select()
        .from(transcripts)
        .where(eq(transcripts.videoId, sampleVideo.id))
        .limit(3);

      console.log('Segments (first 3):');
      sampleSegments.forEach((s) => {
        console.log(
          `  [${s.startTime.toFixed(2)} - ${s.endTime.toFixed(2)}] ${s.text}`,
        );
      });
    }
  }
}

main().catch((err) => logger.error(err));
