import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 1. VIDEOS
export const videos = sqliteTable('videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  driveFileId: text('drive_file_id').notNull().unique(),
  filename: text('filename').notNull(),
  title: text('title'),
  recordedAt: text('recorded_at'),
  year: integer('year'),
  yearStart: integer('year_start'),
  yearEnd: integer('year_end'),
  globalSummary: text('global_summary'),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`),
});

// 2. TRANSCRIPTS
export const transcripts = sqliteTable('transcripts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: integer('video_id')
    .references(() => videos.id)
    .notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  text: text('text').notNull(),
});

// 3. CHUNKS (Adaptive transcript chunks)
export const chunks = sqliteTable('chunks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: integer('video_id')
    .references(() => videos.id)
    .notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  text: text('text').notNull(),
  tokenCount: integer('token_count'),
  overlapFromChunkId: integer('overlap_from_chunk_id'),
  chunkHash: text('chunk_hash').notNull().unique(),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`),
});

// 3C. CHUNK SUMMARIES (Versioned)
export const chunkSummaries = sqliteTable('chunk_summaries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chunkId: integer('chunk_id')
    .references(() => chunks.id)
    .notNull(),
  summaryType: text('summary_type').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  model: text('model').notNull(),
  promptHash: text('prompt_hash').notNull(),
  runId: text('run_id').notNull(),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`),
});

// 4. ENTITIES (Unified canonical)
export const entities = sqliteTable('entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  entityType: text('entity_type').notNull(),
  subtype: text('subtype'),
  normalizedKey: text('normalized_key'),
});

// 5. ENTITY VARIANTS
export const entityVariants = sqliteTable('entity_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entityId: integer('entity_id')
    .references(() => entities.id)
    .notNull(),
  rawText: text('raw_text').notNull().unique(),
  normalizedRaw: text('normalized_raw'),
  source: text('source'),
  confidence: real('confidence'),
});

// 6. CHUNK ENTITY MENTIONS (Evidence grounded)
export const chunkEntityMentions = sqliteTable('chunk_entity_mentions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chunkId: integer('chunk_id')
    .references(() => chunks.id)
    .notNull(),
  entityType: text('entity_type').notNull(),
  rawText: text('raw_text').notNull(),
  evidenceText: text('evidence_text').notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  confidence: text('confidence').notNull(),
  model: text('model').notNull(),
  promptHash: text('prompt_hash').notNull(),
  runId: text('run_id').notNull(),
  entityId: integer('entity_id').references(() => entities.id),
});

// 7. CHUNK ENTITIES (Materialized links)
export const chunkEntities = sqliteTable(
  'chunk_entities',
  {
    chunkId: integer('chunk_id')
      .references(() => chunks.id)
      .notNull(),
    entityId: integer('entity_id')
      .references(() => entities.id)
      .notNull(),
    mentionCount: integer('mention_count').notNull(),
    weight: real('weight'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.chunkId, t.entityId] }),
  }),
);

// 8. VIDEO ENTITIES (Materialized links)
export const videoEntities = sqliteTable(
  'video_entities',
  {
    videoId: integer('video_id')
      .references(() => videos.id)
      .notNull(),
    entityId: integer('entity_id')
      .references(() => entities.id)
      .notNull(),
    mentionCount: integer('mention_count').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.videoId, t.entityId] }),
  }),
);

// 9. CHUNK EXTRACTION STATUS (Tracks entity extraction state)
export const chunkExtractionStatus = sqliteTable('chunk_extraction_status', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chunkId: integer('chunk_id')
    .references(() => chunks.id)
    .notNull()
    .unique(),
  status: text('status', {
    enum: ['pending', 'success', 'failed', 'empty'],
  }).notNull(),
  errorMessage: text('error_message'),
  createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`),
});

export type Video = typeof videos.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type ChunkSummary = typeof chunkSummaries.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type EntityVariant = typeof entityVariants.$inferSelect;
export type ChunkEntityMention = typeof chunkEntityMentions.$inferSelect;
export type ChunkEntity = typeof chunkEntities.$inferSelect;
export type VideoEntity = typeof videoEntities.$inferSelect;
export type ChunkExtractionStatus = typeof chunkExtractionStatus.$inferSelect;
