import { join } from 'node:path';
import { createDb } from '@hop-hv-rag/db';
import { sql } from 'drizzle-orm';
import { logger } from '@hop-hv-rag/core';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

const BATCH_SIZE = 500;

async function main() {
  logger.info('🔄 Starting Extraction Status Migration...');
  logger.info(`Database: ${DB_PATH}`);

  const db = createDb(DB_PATH);

  try {
    // 1. Create the chunk_extraction_status table if it doesn't exist
    logger.info('Creating chunk_extraction_status table...');
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS chunk_extraction_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL REFERENCES chunks(id) UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'empty')),
        error_message TEXT,
        created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
    logger.info('Table created (or already exists).');

    // 2. Find chunks without status rows
    logger.info('Finding chunks without status rows...');
    const chunksWithoutStatus = await db.all<{ id: number }>(sql`
      SELECT c.id
      FROM chunks c
      LEFT JOIN chunk_extraction_status ces ON c.id = ces.chunk_id
      WHERE ces.id IS NULL
    `);

    if (chunksWithoutStatus.length === 0) {
      logger.info(
        '✅ All chunks already have status rows. Migration complete!',
      );
      return;
    }

    logger.info(
      { count: chunksWithoutStatus.length },
      `Found chunks without status rows`,
    );

    // 3. Find which chunks have mentions
    logger.info('Checking which chunks have existing mentions...');
    const chunkIdsWithMentions = await db.all<{ chunk_id: number }>(sql`
      SELECT DISTINCT chunk_id
      FROM chunk_entity_mentions
      WHERE chunk_id IN (
        SELECT c.id
        FROM chunks c
        LEFT JOIN chunk_extraction_status ces ON c.id = ces.chunk_id
        WHERE ces.id IS NULL
      )
    `);

    const chunksWithMentions = new Set(
      chunkIdsWithMentions.map((row) => row.chunk_id),
    );
    const chunksWithoutMentions =
      chunksWithoutStatus.length - chunksWithMentions.size;

    logger.info(
      {
        withMentions: chunksWithMentions.size,
        withoutMentions: chunksWithoutMentions,
      },
      'Chunk status summary',
    );

    // 4. Build status rows for insertion
    interface StatusRow {
      chunkId: number;
      status: 'success' | 'pending';
    }

    const statusRows: StatusRow[] = chunksWithoutStatus.map((chunk) => ({
      chunkId: chunk.id,
      status: chunksWithMentions.has(chunk.id) ? 'success' : 'pending',
    }));

    // 5. Batch insert status rows
    logger.info('Inserting status rows...');
    let insertedSuccess = 0;
    let insertedPending = 0;

    for (let i = 0; i < statusRows.length; i += BATCH_SIZE) {
      const batch = statusRows.slice(i, i + BATCH_SIZE);
      const batchValues = batch
        .map((row) => `(${row.chunkId}, '${row.status}')`)
        .join(', ');

      await db.run(
        sql.raw(`
          INSERT INTO chunk_extraction_status (chunk_id, status)
          VALUES ${batchValues}
        `),
      );

      for (const row of batch) {
        if (row.status === 'success') {
          insertedSuccess++;
        } else {
          insertedPending++;
        }
      }

      logger.info(
        {
          processed: Math.min(i + BATCH_SIZE, statusRows.length),
          total: statusRows.length,
        },
        'Batch inserted',
      );
    }

    // 6. Report final counts
    logger.info('\n✅ Migration complete!');
    logger.info('Final status counts:');
    logger.info(
      `  - success: ${insertedSuccess} (chunks with existing mentions)`,
    );
    logger.info(`  - pending: ${insertedPending} (chunks without mentions)`);
    logger.info(`  - total: ${insertedSuccess + insertedPending}`);

    logger.print('\nNext steps:');
    logger.print('  1. Run: bun run ingest:extract-entities --all');
    logger.print('     This will process pending chunks');
  } catch (error) {
    logger.error(error, 'Migration failed');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, 'Unhandled error in migration');
  process.exit(1);
});
