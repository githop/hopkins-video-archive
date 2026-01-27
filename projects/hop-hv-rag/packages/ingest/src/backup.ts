/**
 * Backup script for the hv-rag database and registry files.
 * Creates a timestamped folder in data/backups/ with copies of all data files.
 */

import { join } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';

const DATA_DIR = join(import.meta.dir, '../../../data');
const BACKUPS_DIR = join(DATA_DIR, 'backups');

const FILES_TO_BACKUP = [
  'hv-rag.db',
  'mapping.json',
  'participant-registry.json',
  'location-registry.json',
  'activity-registry.json',
  'unique-participants.json',
  'unique-locations.json',
  'unique-activities.json',
];

function getTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

async function main() {
  const timestamp = getTimestamp();
  const backupDir = join(BACKUPS_DIR, timestamp);

  console.log(`Creating backup at: ${backupDir}`);

  // Create backup directory
  await mkdir(backupDir, { recursive: true });

  let backedUp = 0;
  const skipped: string[] = [];

  for (const filename of FILES_TO_BACKUP) {
    const srcPath = join(DATA_DIR, filename);
    const destPath = join(backupDir, filename);

    const file = Bun.file(srcPath);
    if (await file.exists()) {
      await copyFile(srcPath, destPath);
      console.log(`  Backed up: ${filename}`);
      backedUp++;
    } else {
      skipped.push(filename);
    }
  }

  console.log(`\nBackup complete!`);
  console.log(`  Files backed up: ${backedUp}`);
  if (skipped.length > 0) {
    console.log(`  Skipped (not found): ${skipped.join(', ')}`);
  }
  console.log(`  Location: ${backupDir}`);
}

main().catch(console.error);
