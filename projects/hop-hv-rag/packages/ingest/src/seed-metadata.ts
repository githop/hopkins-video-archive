import { createDb, videos, transcripts } from '@hop-hv-rag/db';
import { parseFilename, logger } from '@hop-hv-rag/core';
import { join, basename } from 'node:path';
import { Glob } from 'bun';

const DATA_DIR = join(import.meta.dir, '../../../data');
const TRANSCRIPTS_DIR = join(DATA_DIR, 'transcripts');
const MAPPING_PATH = join(DATA_DIR, 'mapping.json');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  const db = createDb(DB_PATH);

  // 1. Load Mapping
  logger.info('Loading mapping.json');
  const mapping = await Bun.file(MAPPING_PATH).json();

  // Create a lookup for easy matching: "1995-2" -> "0B-..."
  const driveMap = new Map<string, string>();
  const filenameMap = new Map<string, string>();
  for (const [filename, driveId] of Object.entries(mapping)) {
    const base = filename.replace(/\.[^/.]+$/, '');
    driveMap.set(base, driveId as string);
    filenameMap.set(base, filename);
  }

  // 2. Scan Transcripts
  logger.info({ transcriptsDir: TRANSCRIPTS_DIR }, 'Scanning for JSON files');
  const glob = new Glob('*.json');
  const files = Array.from(glob.scanSync(TRANSCRIPTS_DIR));
  logger.info({ fileCount: files.length }, 'Found transcript files');

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const base = basename(file, '.json');
    const driveFileId = driveMap.get(base);

    if (!driveFileId) {
      logger.warn({ file }, 'No drive mapping found, skipping');
      skipped++;
      continue;
    }

    const fullPath = join(TRANSCRIPTS_DIR, file);
    const content = await Bun.file(fullPath).json();
    const metadata = parseFilename(file);

    try {
      await db.transaction(async (tx) => {
        // Insert Video
        const [videoResult] = await tx
          .insert(videos)
          .values({
            driveFileId,
            filename: filenameMap.get(base)!,
            title: metadata.title,
            year: metadata.year,
            recordedAt: metadata.recordedAt,
          })
          .returning({ id: videos.id });

        if (!videoResult) throw new Error('Failed to insert video');

        // Insert Transcripts
        const segments = content.segments || [];
        if (segments.length > 0) {
          const transcriptValues = segments.map((s: any) => ({
            videoId: videoResult.id,
            startTime: s.start,
            endTime: s.end,
            text: s.text.trim(),
          }));

          // Chunk large inserts if necessary (SQLite has limits)
          const CHUNK_SIZE = 500;
          for (let i = 0; i < transcriptValues.length; i += CHUNK_SIZE) {
            await tx
              .insert(transcripts)
              .values(transcriptValues.slice(i, i + CHUNK_SIZE));
          }
        }
      });
      processed++;
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint failed')) {
        logger.warn({ file }, 'Already ingested, skipping');
        skipped++;
      } else {
        logger.error({ file, err }, 'Error processing file');
        errors++;
      }
    }
  }

  logger.info({ processed, skipped, errors }, 'Metadata ingestion complete');
}

main().catch((err) => {
  logger.error(err, 'Metadata ingestion failed');
  process.exit(1);
});
