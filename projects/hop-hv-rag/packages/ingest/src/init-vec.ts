import { createDb } from '@hop-hv-rag/db';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  console.log(`Initializing vector tables in: ${DB_PATH}`);
  const db = createDb(DB_PATH);

  // We use the 'sql' template for raw sqlite-vec operations
  // vec0 is the virtual table type for sqlite-vec
  // dimension count: 1024 for Qwen3-Embedding-0.6B (embed-small)

  console.log('Creating vec_scenes...');
  await db.run(
    sql.raw(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_scenes USING vec0(
      rowid INTEGER PRIMARY KEY,
      scene_embedding FLOAT[1024]
    );
  `),
  );

  console.log('✅ Vector tables initialized successfully.');
}

main().catch(console.error);
