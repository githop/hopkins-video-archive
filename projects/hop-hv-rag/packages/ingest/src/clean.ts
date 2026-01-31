/**
 * Reset script for the hv-rag database.
 * Deletes the database file and registry files to start fresh.
 * mapping.json is preserved as it contains DriveFileId mappings.
 */

import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { logger } from '@hop-hv-rag/core';

const DATA_DIR = join(import.meta.dir, '../../../data');

const FILES_TO_DELETE = [
  'hv-rag.db',
  'participant-registry.json',
  'location-registry.json',
  'activity-registry.json',
  'unique-participants.json',
  'unique-locations.json',
  'unique-activities.json',
];

async function main() {
  logger.info('Resetting database and registry files...');
  logger.info('(mapping.json is preserved)\n');

  let deleted = 0;
  const skipped: string[] = [];

  for (const filename of FILES_TO_DELETE) {
    const filePath = join(DATA_DIR, filename);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      await unlink(filePath);
      logger.info(`  Deleted: ${filename}`);
      deleted++;
    } else {
      skipped.push(filename);
    }
  }

  logger.info(`\nReset complete!`);
  logger.info(`  Files deleted: ${deleted}`);
  if (skipped.length > 0) {
    logger.info(`  Skipped (not found): ${skipped.join(', ')}`);
  }

  logger.print('\nNext steps:');
  logger.print('  1. Run: bun run ingest:init-db');
  logger.print('  2. Run: bun run ingest:init-vec');
  logger.print('  3. Run: bun run ingest:seed');
}

main().catch((err) => {
  logger.error(err, 'Error during reset');
});
