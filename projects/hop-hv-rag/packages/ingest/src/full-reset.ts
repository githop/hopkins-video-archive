/**
 * Full reset and setup script.
 * Deletes the database, reinitializes everything, and chunks transcripts.
 * Ready for chunk summarization after running.
 */

import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { logger } from '@hop-hv-rag/core';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

async function runStep(name: string, fn: () => Promise<void>) {
  logger.info(`\n${'='.repeat(50)}`);
  logger.info(`Step: ${name}`);
  logger.info('='.repeat(50));
  await fn();
}

async function main() {
  logger.info('Starting full database reset and setup...');

  // Step 1: Delete existing database
  await runStep('1. Clean database', async () => {
    const file = Bun.file(DB_PATH);
    if (await file.exists()) {
      await unlink(DB_PATH);
      logger.info(`  Deleted: ${DB_PATH}`);
    } else {
      logger.info('  No existing database found');
    }
  });

  // Step 2: Initialize database tables
  await runStep('2. Initialize database', async () => {
    const { execSync } = await import('node:child_process');
    execSync('bun run init-db', {
      cwd: join(import.meta.dir, '..'),
      stdio: 'inherit',
    });
  });

  // Step 3: Initialize vector tables
  await runStep('3. Initialize vector tables', async () => {
    const { execSync } = await import('node:child_process');
    execSync('bun run init-vec', {
      cwd: join(import.meta.dir, '..'),
      stdio: 'inherit',
    });
  });

  // Step 4: Seed metadata
  await runStep('4. Seed metadata', async () => {
    const { execSync } = await import('node:child_process');
    execSync('bun run seed', {
      cwd: join(import.meta.dir, '..'),
      stdio: 'inherit',
    });
  });

  // Step 5: Chunk transcripts
  await runStep('5. Chunk transcripts', async () => {
    const { execSync } = await import('node:child_process');
    execSync('bun run ingest:chunk --all', {
      cwd: join(import.meta.dir, '..'),
      stdio: 'inherit',
    });
  });

  logger.info('\n' + '='.repeat(50));
  logger.info('Setup complete! Database is ready for chunk summarization.');
  logger.info('='.repeat(50));
  logger.info('\nNext step:');
  logger.info('  bun run ingest:summarize-chunks');
}

main().catch((err) => {
  logger.error(err, 'Setup failed');
  process.exit(1);
});
