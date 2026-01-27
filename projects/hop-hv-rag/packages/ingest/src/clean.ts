/**
 * Reset script for the hv-rag database.
 * Deletes the database file and registry files to start fresh.
 * mapping.json is preserved as it contains DriveFileId mappings.
 */

import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

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
  console.log('Resetting database and registry files...');
  console.log('(mapping.json is preserved)\n');

  let deleted = 0;
  const skipped: string[] = [];

  for (const filename of FILES_TO_DELETE) {
    const filePath = join(DATA_DIR, filename);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      await unlink(filePath);
      console.log(`  Deleted: ${filename}`);
      deleted++;
    } else {
      skipped.push(filename);
    }
  }

  console.log(`\nReset complete!`);
  console.log(`  Files deleted: ${deleted}`);
  if (skipped.length > 0) {
    console.log(`  Skipped (not found): ${skipped.join(', ')}`);
  }

  console.log('\nNext steps:');
  console.log('  1. Run: bun run ingest:init-db');
  console.log('  2. Run: bun run ingest:init-vec');
  console.log('  3. Run: bun run ingest:seed');
}

main().catch(console.error);
