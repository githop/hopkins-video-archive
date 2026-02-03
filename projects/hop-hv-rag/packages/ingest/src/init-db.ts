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
      participants TEXT,
      locations TEXT,
      activities TEXT,
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
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id),
      video_filename TEXT,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      title TEXT,
      summary TEXT NOT NULL,
      transcript TEXT,
      participants TEXT,
      locations TEXT,
      activities TEXT,
      thumbnail_path TEXT
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
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS people_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES people(id),
      raw_name TEXT NOT NULL UNIQUE
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS video_to_people (
      video_id INTEGER NOT NULL REFERENCES videos(id),
      person_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY (video_id, person_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS scene_to_people (
      scene_id INTEGER NOT NULL REFERENCES scenes(id),
      person_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY (scene_id, person_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS location_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      raw_name TEXT NOT NULL UNIQUE
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS video_to_locations (
      video_id INTEGER NOT NULL REFERENCES videos(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      PRIMARY KEY (video_id, location_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS scene_to_locations (
      scene_id INTEGER NOT NULL REFERENCES scenes(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      PRIMARY KEY (scene_id, location_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS activity_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL REFERENCES activities(id),
      raw_name TEXT NOT NULL UNIQUE
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

  db.run(sql`
    CREATE TABLE IF NOT EXISTS video_to_activities (
      video_id INTEGER NOT NULL REFERENCES videos(id),
      activity_id INTEGER NOT NULL REFERENCES activities(id),
      PRIMARY KEY (video_id, activity_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS scene_to_activities (
      scene_id INTEGER NOT NULL REFERENCES scenes(id),
      activity_id INTEGER NOT NULL REFERENCES activities(id),
      PRIMARY KEY (scene_id, activity_id)
    )
  `);

  logger.info('Standard tables created.');

  logger.info('Creating FTS5 table...');
  // Virtual table for Full-Text Search
  // We index the title, summary, transcript, participants, locations, and activities
  // Using Porter tokenizer for English stemming (swim/swimming/swims all match)
  // Combined with unicode61 for proper unicode handling and case folding
  db.run(sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_scenes USING fts5(
      id UNINDEXED,
      video_id UNINDEXED,
      video_filename,
      title,
      summary,
      transcript,
      participants,
      locations,
      activities,
      content='scenes',
      content_rowid='id',
      tokenize='porter unicode61'
    );
  `);

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

  // Triggers to keep FTS in sync with the scenes table
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS scenes_ai AFTER INSERT ON scenes BEGIN
      INSERT INTO fts_scenes(rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES (new.id, new.id, new.video_id, new.video_filename, new.title, new.summary, new.transcript, new.participants, new.locations, new.activities);
    END;
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS scenes_ad AFTER DELETE ON scenes BEGIN
      INSERT INTO fts_scenes(fts_scenes, rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES('delete', old.id, old.id, old.video_id, old.video_filename, old.title, old.summary, old.transcript, old.participants, old.locations, old.activities);
    END;
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS scenes_au AFTER UPDATE ON scenes BEGIN
      INSERT INTO fts_scenes(fts_scenes, rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES('delete', old.id, old.id, old.video_id, old.video_filename, old.title, old.summary, old.transcript, old.participants, old.locations, old.activities);
      INSERT INTO fts_scenes(rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES (new.id, new.id, new.video_id, new.video_filename, new.title, new.summary, new.transcript, new.participants, new.locations, new.activities);
    END;
  `);

  logger.info('FTS tables and triggers created.');
}

main().catch((err) => logger.error(err));
