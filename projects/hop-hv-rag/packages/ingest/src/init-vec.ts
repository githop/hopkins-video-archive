import { createDb } from '@hop-hv-rag/db';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { logger } from '@hop-hv-rag/core';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  logger.info(`Initializing vector tables in: ${DB_PATH}`);
  const db = createDb(DB_PATH);

  // We use the 'sql' template for raw sqlite-vec operations
  // vec0 is the virtual table type for sqlite-vec
  // dimension count: 1024 for Qwen3-Embedding-0.6B (embed-qwen3-0.6b)

  logger.info('Creating vec_chunks...');
  await db.run(
    sql.raw(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      rowid INTEGER PRIMARY KEY,
      chunk_embedding FLOAT[1024]
    );
  `),
  );

  logger.info('Creating vec_videos...');
  await db.run(
    sql.raw(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_videos USING vec0(
      rowid INTEGER PRIMARY KEY,
      video_embedding FLOAT[1024]
    );
  `),
  );

  logger.info('✅ Vector tables initialized successfully.');
}

main().catch((err) => logger.error(err));
