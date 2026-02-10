import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { logger } from '@hop-hv-rag/core';
import { createDb, chunkEntities, videoEntities } from '@hop-hv-rag/db';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      force: { type: 'boolean', default: false },
      'run-id': { type: 'string' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);

  if (values.force) {
    logger.info('Clearing existing materialized entity links');
    await db.delete(chunkEntities);
    await db.delete(videoEntities);
  }

  const runId = values['run-id'] ? String(values['run-id']) : null;
  const runFilter = runId ? `AND run_id = '${runId.replace(/'/g, "''")}'` : '';

  logger.info({ runId: runId ?? 'all' }, 'Materializing chunk_entities');
  await db.run(
    sql.raw(`
      WITH counts AS (
        SELECT chunk_id, entity_id, COUNT(*) as mention_count
        FROM chunk_entity_mentions
        WHERE entity_id IS NOT NULL
        ${runFilter}
        GROUP BY chunk_id, entity_id
      ),
      maxes AS (
        SELECT chunk_id, MAX(mention_count) as max_mentions
        FROM counts
        GROUP BY chunk_id
      )
      INSERT INTO chunk_entities (chunk_id, entity_id, mention_count, weight)
      SELECT
        c.chunk_id,
        c.entity_id,
        c.mention_count,
        CASE
          WHEN m.max_mentions IS NULL OR m.max_mentions <= 0 THEN NULL
          ELSE LOG(1 + c.mention_count) / LOG(1 + m.max_mentions)
        END as weight
      FROM counts c
      JOIN maxes m ON m.chunk_id = c.chunk_id
      ON CONFLICT(chunk_id, entity_id) DO UPDATE SET
        mention_count = excluded.mention_count,
        weight = excluded.weight
    `),
  );

  logger.info({ runId: runId ?? 'all' }, 'Materializing video_entities');
  await db.run(
    sql.raw(`
      INSERT INTO video_entities (video_id, entity_id, mention_count)
      SELECT c.video_id, m.entity_id, COUNT(*) as mention_count
      FROM chunk_entity_mentions m
      JOIN chunks c ON c.id = m.chunk_id
      WHERE m.entity_id IS NOT NULL
      ${runFilter.replace(/run_id/g, 'm.run_id')}
      GROUP BY c.video_id, m.entity_id
      ON CONFLICT(video_id, entity_id) DO UPDATE SET
        mention_count = excluded.mention_count
    `),
  );

  logger.info('Entity materialization complete');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'Materialize entities failed');
    process.exit(1);
  });
}
