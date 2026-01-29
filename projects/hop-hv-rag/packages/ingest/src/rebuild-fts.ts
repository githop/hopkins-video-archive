import { createDb } from '@hop-hv-rag/db';
import { sql } from 'drizzle-orm';
import { join } from 'node:path';

const DB_PATH = join(import.meta.dir, '../../../data/hv-rag.db');

/**
 * Rebuilds the FTS5 index with Porter stemming tokenizer.
 * This is necessary after changing the tokenizer configuration.
 *
 * Steps:
 * 1. Drop existing FTS table and triggers
 * 2. Recreate FTS table with new tokenizer
 * 3. Recreate sync triggers
 * 4. Repopulate FTS index from scenes table
 */
async function main() {
  console.log(`Rebuilding FTS index at ${DB_PATH}...`);
  const db = createDb(DB_PATH);

  // 1. Drop existing triggers
  console.log('Dropping existing triggers...');
  db.run(sql`DROP TRIGGER IF EXISTS scenes_ai`);
  db.run(sql`DROP TRIGGER IF EXISTS scenes_ad`);
  db.run(sql`DROP TRIGGER IF EXISTS scenes_au`);

  // 2. Drop existing FTS table
  console.log('Dropping existing FTS table...');
  db.run(sql`DROP TABLE IF EXISTS fts_scenes`);

  // 3. Create new FTS table with Porter tokenizer
  console.log('Creating FTS5 table with Porter tokenizer...');
  db.run(sql`
    CREATE VIRTUAL TABLE fts_scenes USING fts5(
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
    )
  `);

  // 4. Recreate triggers
  console.log('Creating sync triggers...');
  db.run(sql`
    CREATE TRIGGER scenes_ai AFTER INSERT ON scenes BEGIN
      INSERT INTO fts_scenes(rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES (new.id, new.id, new.video_id, new.video_filename, new.title, new.summary, new.transcript, new.participants, new.locations, new.activities);
    END
  `);

  db.run(sql`
    CREATE TRIGGER scenes_ad AFTER DELETE ON scenes BEGIN
      INSERT INTO fts_scenes(fts_scenes, rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES('delete', old.id, old.id, old.video_id, old.video_filename, old.title, old.summary, old.transcript, old.participants, old.locations, old.activities);
    END
  `);

  db.run(sql`
    CREATE TRIGGER scenes_au AFTER UPDATE ON scenes BEGIN
      INSERT INTO fts_scenes(fts_scenes, rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES('delete', old.id, old.id, old.video_id, old.video_filename, old.title, old.summary, old.transcript, old.participants, old.locations, old.activities);
      INSERT INTO fts_scenes(rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
      VALUES (new.id, new.id, new.video_id, new.video_filename, new.title, new.summary, new.transcript, new.participants, new.locations, new.activities);
    END
  `);

  // 5. Repopulate FTS index from scenes table
  console.log('Repopulating FTS index from scenes table...');
  db.run(sql`
    INSERT INTO fts_scenes(rowid, id, video_id, video_filename, title, summary, transcript, participants, locations, activities)
    SELECT id, id, video_id, video_filename, title, summary, transcript, participants, locations, activities
    FROM scenes
  `);

  // 6. Verify
  const countResult = db.all<{ count: number }>(
    sql`SELECT COUNT(*) as count FROM fts_scenes`,
  );
  const scenesCount = db.all<{ count: number }>(
    sql`SELECT COUNT(*) as count FROM scenes`,
  );

  console.log(`\nFTS rebuild complete!`);
  console.log(`  Scenes in database: ${scenesCount[0]?.count ?? 0}`);
  console.log(`  Rows in FTS index:  ${countResult[0]?.count ?? 0}`);

  // 7. Test stemming
  console.log('\nTesting Porter stemming...');
  const swimTest = db.all<{ title: string }>(
    sql`SELECT s.title FROM fts_scenes f JOIN scenes s ON s.id = f.id WHERE fts_scenes MATCH 'swim' LIMIT 3`,
  );
  const swimmingTest = db.all<{ title: string }>(
    sql`SELECT s.title FROM fts_scenes f JOIN scenes s ON s.id = f.id WHERE fts_scenes MATCH 'swimming' LIMIT 3`,
  );

  console.log(`  Query "swim" results: ${swimTest.length}`);
  console.log(`  Query "swimming" results: ${swimmingTest.length}`);

  if (swimTest.length > 0 && swimmingTest.length > 0) {
    // Check if they return overlapping results (stemming working)
    const swimTitles = new Set(swimTest.map((r) => r.title));
    const overlap = swimmingTest.filter((r) => swimTitles.has(r.title));
    if (overlap.length > 0) {
      console.log(
        `  Porter stemming verified - "swim" and "swimming" share ${overlap.length} results`,
      );
    }
  }
}

main().catch(console.error);
