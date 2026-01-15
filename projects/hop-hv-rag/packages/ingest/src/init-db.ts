import { createDb } from '@hop-hv-rag/db';
import { sql } from 'drizzle-orm';
import { join } from 'node:path';

const DB_PATH = join(import.meta.dir, '../../../data/hv-rag.db');

async function main() {
  console.log(`Initializing database at ${DB_PATH}...`);
  const db = createDb(DB_PATH);

  // 1. Create standard tables
  // In a real app we'd use drizzle-kit, but for this bootstrap we'll do raw SQL
  // to ensure sqlite-vec is also handled.

  console.log('Creating tables...');

  db.run(sql`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drive_file_id TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      title TEXT,
      recorded_at TEXT,
      year INTEGER,
      global_summary TEXT,
      participants TEXT,
      locations TEXT,
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
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      title TEXT,
      summary TEXT NOT NULL,
      transcript TEXT,
      participants TEXT,
      locations TEXT
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

  console.log('Standard tables created.');

  console.log('Creating FTS5 table...');
  // Virtual table for Full-Text Search
  // We index the title, summary, transcript, participants, and locations
  db.run(sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_scenes USING fts5(
      id UNINDEXED,
      video_id UNINDEXED,
      title,
      summary,
      transcript,
      participants,
      locations,
      content='scenes',
      content_rowid='id'
    );
  `);

  // Triggers to keep FTS in sync with the scenes table
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS scenes_ai AFTER INSERT ON scenes BEGIN
      INSERT INTO fts_scenes(rowid, id, video_id, title, summary, transcript, participants, locations)
      VALUES (new.id, new.id, new.video_id, new.title, new.summary, new.transcript, new.participants, new.locations);
    END;
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS scenes_ad AFTER DELETE ON scenes BEGIN
      INSERT INTO fts_scenes(fts_scenes, rowid, id, video_id, title, summary, transcript, participants, locations)
      VALUES('delete', old.id, old.id, old.video_id, old.title, old.summary, old.transcript, old.participants, old.locations);
    END;
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS scenes_au AFTER UPDATE ON scenes BEGIN
      INSERT INTO fts_scenes(fts_scenes, rowid, id, video_id, title, summary, transcript, participants, locations)
      VALUES('delete', old.id, old.id, old.video_id, old.title, old.summary, old.transcript, old.participants, old.locations);
      INSERT INTO fts_scenes(rowid, id, video_id, title, summary, transcript, participants, locations)
      VALUES (new.id, new.id, new.video_id, new.title, new.summary, new.transcript, new.participants, new.locations);
    END;
  `);

  console.log('FTS tables and triggers created.');
}

main().catch(console.error);
