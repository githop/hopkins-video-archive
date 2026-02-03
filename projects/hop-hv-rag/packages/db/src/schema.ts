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
  participants: text('participants'), // JSON array
  locations: text('locations'), // JSON array
  activities: text('activities'), // JSON array
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

// 3. SCENES (Programmatic chunks with narrative summaries)
export const scenes = sqliteTable('scenes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: integer('video_id')
    .references(() => videos.id)
    .notNull(),
  videoFilename: text('video_filename'),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  title: text('title'),
  summary: text('summary').notNull(),
  transcript: text('transcript'), // The raw text for this chunk
  participants: text('participants'), // JSON array
  locations: text('locations'), // JSON array
  activities: text('activities'), // JSON array
  thumbnailPath: text('thumbnail_path'),
});

// 3B. CHUNKS (Adaptive transcript chunks)
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

// 4. PEOPLE (Canonical Entities)
export const people = sqliteTable('people', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type').notNull(), // 'PERSON' | 'ROLE'
});

// 5. PEOPLE VARIANTS (Mapping noisy strings to canonical IDs)
export const peopleVariants = sqliteTable('people_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id')
    .references(() => people.id)
    .notNull(),
  rawName: text('raw_name').notNull().unique(),
});

// 6. LOCATIONS (Canonical Entities)
export const locations = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type').notNull(), // 'PLACE' | 'SETTING'
});

// 7. LOCATION VARIANTS (Mapping noisy strings to canonical IDs)
export const locationVariants = sqliteTable('location_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locationId: integer('location_id')
    .references(() => locations.id)
    .notNull(),
  rawName: text('raw_name').notNull().unique(),
});

// 8. ACTIVITIES (Canonical Entities)
export const activities = sqliteTable('activities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type').notNull(), // 'SPORT' | 'RECREATION' | 'HOLIDAY' | 'MILESTONE'
});

// 9. ACTIVITY VARIANTS (Mapping noisy strings to canonical IDs)
export const activityVariants = sqliteTable('activity_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  activityId: integer('activity_id')
    .references(() => activities.id)
    .notNull(),
  rawName: text('raw_name').notNull().unique(),
});

// 9B. ENTITIES (Unified canonical)
export const entities = sqliteTable('entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  entityType: text('entity_type').notNull(),
  subtype: text('subtype'),
  normalizedKey: text('normalized_key'),
});

// 9C. ENTITY VARIANTS
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

// 9D. CHUNK ENTITY MENTIONS (Evidence grounded)
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

// 9E. CHUNK ENTITIES (Materialized links)
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

// 9F. VIDEO ENTITIES (Materialized links)
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

// 10. JUNCTION TABLES
export const videoToPeople = sqliteTable(
  'video_to_people',
  {
    videoId: integer('video_id')
      .references(() => videos.id)
      .notNull(),
    personId: integer('person_id')
      .references(() => people.id)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.videoId, t.personId] }),
  }),
);

export const sceneToPeople = sqliteTable(
  'scene_to_people',
  {
    sceneId: integer('scene_id')
      .references(() => scenes.id)
      .notNull(),
    personId: integer('person_id')
      .references(() => people.id)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sceneId, t.personId] }),
  }),
);

export const videoToLocations = sqliteTable(
  'video_to_locations',
  {
    videoId: integer('video_id')
      .references(() => videos.id)
      .notNull(),
    locationId: integer('location_id')
      .references(() => locations.id)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.videoId, t.locationId] }),
  }),
);

export const sceneToLocations = sqliteTable(
  'scene_to_locations',
  {
    sceneId: integer('scene_id')
      .references(() => scenes.id)
      .notNull(),
    locationId: integer('location_id')
      .references(() => locations.id)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sceneId, t.locationId] }),
  }),
);

export const videoToActivities = sqliteTable(
  'video_to_activities',
  {
    videoId: integer('video_id')
      .references(() => videos.id)
      .notNull(),
    activityId: integer('activity_id')
      .references(() => activities.id)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.videoId, t.activityId] }),
  }),
);

export const sceneToActivities = sqliteTable(
  'scene_to_activities',
  {
    sceneId: integer('scene_id')
      .references(() => scenes.id)
      .notNull(),
    activityId: integer('activity_id')
      .references(() => activities.id)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sceneId, t.activityId] }),
  }),
);

export type Video = typeof videos.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type ChunkSummary = typeof chunkSummaries.$inferSelect;
export type Person = typeof people.$inferSelect;
export type PersonVariant = typeof peopleVariants.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type LocationVariant = typeof locationVariants.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type ActivityVariant = typeof activityVariants.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type EntityVariant = typeof entityVariants.$inferSelect;
export type ChunkEntityMention = typeof chunkEntityMentions.$inferSelect;
export type ChunkEntity = typeof chunkEntities.$inferSelect;
export type VideoEntity = typeof videoEntities.$inferSelect;
