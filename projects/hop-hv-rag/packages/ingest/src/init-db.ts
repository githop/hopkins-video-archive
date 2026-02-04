import { createDb } from '@hop-hv-rag/db';
import { sql } from 'drizzle-orm';
import { join } from 'node:path';
import { logger } from '@hop-hv-rag/core';

const DB_PATH = join(import.meta.dir, '../../../data/hv-rag.db');

async function main() {
  logger.info(`Initializing database at ${DB_PATH}...`);
  const db = createDb(DB_PATH);

  // 1. Create standard tables
  // In a real app we'd use drizzle-kit, but for this bootstrap we'll do raw SQL
  // to ensure sqlite-vec is also handled.

  logger.info('Creating tables...');

  db.run(sql`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drive_file_id TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      title TEXT,
      recorded_at TEXT,
      year INTEGER,
      year_start INTEGER,
      year_end INTEGER,
      global_summary TEXT,
      created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id),
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id),
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      token_count INTEGER,
      overlap_from_chunk_id INTEGER,
      chunk_hash TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS chunk_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id INTEGER NOT NULL REFERENCES chunks(id),
      summary_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      subtype TEXT,
      normalized_key TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS entity_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      raw_text TEXT NOT NULL UNIQUE,
      normalized_raw TEXT,
      source TEXT,
      confidence REAL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS chunk_entity_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id INTEGER NOT NULL REFERENCES chunks(id),
      entity_type TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      evidence_text TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      confidence TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      entity_id INTEGER REFERENCES entities(id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS chunk_entities (
      chunk_id INTEGER NOT NULL REFERENCES chunks(id),
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      mention_count INTEGER NOT NULL,
      weight REAL,
      PRIMARY KEY (chunk_id, entity_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS video_entities (
      video_id INTEGER NOT NULL REFERENCES videos(id),
      entity_id INTEGER NOT NULL REFERENCES entities(id),
      mention_count INTEGER NOT NULL,
      PRIMARY KEY (video_id, entity_id)
    )
  `);

  logger.info('Standard tables created.');

  db.run(sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
      chunk_id UNINDEXED,
      video_id UNINDEXED,
      video_filename,
      title,
      summary,
      text,
      entities,
      tokenize='porter unicode61'
    );
  `);

  logger.info('FTS tables created.');
}

main().catch((err) => logger.error(err));
