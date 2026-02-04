import { join } from 'node:path';
import { createDb } from '@hop-hv-rag/db';
import { sql } from 'drizzle-orm';
import { logger } from '@hop-hv-rag/core';
import {
  entities,
  entityVariants,
  chunkEntityMentions,
  chunkEntities,
  videoEntities,
} from '@hop-hv-rag/db';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function main() {
  logger.info('🧹 Starting Entity Data Reset...');
  logger.info(`Database: ${DB_PATH}`);

  const db = createDb(DB_PATH);

  try {
    // 1. Delete materialized links first
    logger.info('Deleting materialized entity links...');
    await db.delete(chunkEntities);
    await db.delete(videoEntities);

    // 2. Delete variants (mappings)
    logger.info('Deleting entity variants...');
    await db.delete(entityVariants);

    // 3. Delete mentions (raw extractions)
    logger.info('Deleting chunk entity mentions...');
    await db.delete(chunkEntityMentions);

    // 4. Finally, delete the entities themselves
    logger.info('Deleting canonical entities...');
    await db.delete(entities);

    // 5. Reset SQLite sequences for these tables so IDs start from 1 again
    logger.info('Resetting auto-increment sequences...');
    await db.run(
      sql`DELETE FROM sqlite_sequence WHERE name IN ('entities', 'entity_variants', 'chunk_entity_mentions')`,
    );

    // 6. Vacuum to reclaim space
    logger.info('Vacuuming database...');
    await db.run(sql`VACUUM`);

    logger.info('\n✅ Entity data successfully cleared!');
    logger.print('\nNext steps:');
    logger.print('  1. Run: bun run ingest:extract-entities --all');
    logger.print('  2. Run: bun run cluster-participants');
    logger.print('  3. Run: bun run cluster-locations');
    logger.print('  4. Run: bun run cluster-activities');
    logger.print('  5. Run: bun run ingest:materialize-entities');
  } catch (error) {
    logger.error(error, 'Failed to reset entity data');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, 'Unhandled error in reset-entities');
  process.exit(1);
});
