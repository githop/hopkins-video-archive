import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { logger } from '@hop-hv-rag/core';
import { createDb } from '@hop-hv-rag/db';

const DB_PATH = join(import.meta.dir, '../../../data/hv-rag.db');

async function main() {
  logger.info({ dbPath: DB_PATH }, 'Rebuilding chunk FTS index');
  const db = createDb(DB_PATH);

  logger.info('Dropping existing fts_chunks table');
  db.run(sql`DROP TABLE IF EXISTS fts_chunks`);

  logger.info('Creating fts_chunks table');
  db.run(sql`
    CREATE VIRTUAL TABLE fts_chunks USING fts5(
      chunk_id UNINDEXED,
      video_id UNINDEXED,
      video_filename,
      title,
      summary,
      text,
      entities,
      tokenize='porter unicode61'
    )
  `);

  logger.info('Populating fts_chunks');
  db.run(sql`
    INSERT INTO fts_chunks(rowid, chunk_id, video_id, video_filename, title, summary, text, entities)
    SELECT
      c.id as rowid,
      c.id as chunk_id,
      c.video_id as video_id,
      v.filename as video_filename,
      cs.title as title,
      cs.summary as summary,
      c.text as text,
      GROUP_CONCAT(e.name, ', ') as entities
    FROM chunks c
    JOIN videos v ON v.id = c.video_id
    LEFT JOIN (
      SELECT chunk_id, title, summary
      FROM chunk_summaries
      WHERE summary_type = 'scene'
      AND id IN (
        SELECT MAX(id)
        FROM chunk_summaries
        WHERE summary_type = 'scene'
        GROUP BY chunk_id
      )
    ) cs ON cs.chunk_id = c.id
    LEFT JOIN chunk_entities ce ON ce.chunk_id = c.id
    LEFT JOIN entities e ON e.id = ce.entity_id
    GROUP BY c.id
  `);

  const chunkCount = db.all<{ count: number }>(
    sql`SELECT COUNT(*) as count FROM chunks`,
  );
  const ftsCount = db.all<{ count: number }>(
    sql`SELECT COUNT(*) as count FROM fts_chunks`,
  );

  logger.info({ chunksInDb: chunkCount[0]?.count ?? 0 }, 'Chunk count');
  logger.info({ rowsInFts: ftsCount[0]?.count ?? 0 }, 'FTS chunk count');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'FTS chunk rebuild failed');
    process.exit(1);
  });
}
