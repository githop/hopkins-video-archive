# Entity Extraction Status Tracking Implementation Plan

**Status**: Ready for Implementation  
**Date**: 2026-02-05  
**Context**: This plan implements status tracking for the entity extraction pipeline to distinguish between failed extractions and chunks with zero entities extracted.

## Division of Responsibilities

**Agent (Code Implementation):**

- Implement all code changes described in this plan
- Create schema definitions and SQL table creation
- Modify extraction pipeline logic
- Create migration script for backfilling existing data
- Ensure TypeScript types are valid

**User (Operations & Verification):**

- Run migration script on existing database
- Execute test commands and verify behavior
- Monitor extraction pipeline during testing
- Approve deployment after verification

## Overview

The current entity extraction system has a brittleness problem: we cannot distinguish between:

1. A chunk that was never processed
2. A chunk that was processed but had 0 entities extracted
3. A chunk that failed during extraction

This plan adds a `chunk_extraction_status` table to track extraction state for every chunk, enabling reliable retry semantics and clear visibility into processing status.

## Key Decisions

1. **Status table fields**: Minimal - only what's needed to track state and debug
2. **One status per chunk**: Status rows are created during chunk creation, updated during extraction
3. **No extraction-specific fields**: Model, promptHash, runId remain on `chunkEntityMentions` where they belong
4. **Simplified error handling**: Remove complex error type attachment, just use error messages
5. **Job planner handles retry logic**: No dedicated retry command - just run extraction repeatedly until no pending/failed chunks remain

## Database Schema

### New Table: `chunk_extraction_status`

```sql
CREATE TABLE IF NOT EXISTS chunk_extraction_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'empty')),
  error_message TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);
```

**Fields:**

- `id`: Primary key
- `chunk_id`: Foreign key to chunks table (UNIQUE constraint enforces 1:1 relationship)
- `status`: One of four states:
  - `pending`: Chunk created, waiting for extraction
  - `success`: Extraction completed, entities found and stored
  - `failed`: Extraction failed (LLM parse error, API error, etc.)
  - `empty`: Extraction completed, but no valid entities found
- `error_message`: Optional error details when status='failed'
- `created_at`: Timestamp for audit purposes

**Status Semantics:**

- `pending` → waiting to be processed or currently being processed
- `success` → extraction successful, check `chunkEntityMentions` for entities
- `failed` → extraction failed, check `error_message` for details, will be retried
- `empty` → extraction successful but no valid entities found

## Files to Modify

### 1. `/packages/db/src/schema.ts`

Add Drizzle ORM table definition:

```typescript
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

export type ChunkExtractionStatus = typeof chunkExtractionStatus.$inferSelect;
```

Add to exports at bottom of file.

### 2. `/packages/ingest/src/init-db.ts`

Add raw SQL table creation in the `main()` function after existing tables:

```typescript
// Add after chunk_entities table creation (around line 126)

db.run(sql`
  CREATE TABLE IF NOT EXISTS chunk_extraction_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('pending', 'success', 'failed', 'empty')),
    error_message TEXT,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )
`);

logger.info('Extraction status table created.');
```

### 3. `/packages/ingest/src/chunk-transcripts.ts`

**Location**: `processVideo()` function, after chunk insertion (around line 247-268)

**Changes needed:**

1. Import `chunkExtractionStatus` from `@hop-hv-rag/db`
2. After inserting a chunk, also insert status row:

```typescript
// After inserting chunk (around line 247-258):
const insertedRows: Array<{ id: number }> = await db
  .insert(chunks)
  .values({
    videoId: video.id,
    startTime: plan.startTime,
    endTime: plan.endTime,
    text: plan.text,
    tokenCount: plan.wordCount,
    overlapFromChunkId,
    chunkHash,
  })
  .returning({ id: chunks.id });

const chunkRow = insertedRows[0];

if (!chunkRow) {
  continue;
}

// NEW: Insert pending status for new chunk
await db.insert(chunkExtractionStatus).values({
  chunkId: chunkRow.id,
  status: 'pending',
});

previousChunkId = chunkRow.id;
previousChunkEnd = plan.endTime;
inserted++;
```

3. Update `deleteVideoChunks()` function (around line 165-193) to handle status table:

```typescript
async function deleteVideoChunks(
  db: ReturnType<typeof createDb>,
  video: Video,
) {
  const existing = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.videoId, video.id));

  const chunkIds = existing.map((row) => row.id);
  if (chunkIds.length === 0) return;

  // Existing deletions...
  await db
    .delete(chunkEntities)
    .where(inArray(chunkEntities.chunkId, chunkIds));
  await db
    .delete(chunkEntityMentions)
    .where(inArray(chunkEntityMentions.chunkId, chunkIds));
  await db
    .delete(chunkSummaries)
    .where(inArray(chunkSummaries.chunkId, chunkIds));

  // NEW: Also delete extraction status rows
  await db
    .delete(chunkExtractionStatus)
    .where(inArray(chunkExtractionStatus.chunkId, chunkIds));

  await db.delete(chunks).where(eq(chunks.videoId, video.id));
  await db.delete(videoEntities).where(eq(videoEntities.videoId, video.id));

  logger.info(
    { videoId: video.id, chunkCount: chunkIds.length },
    'Deleted existing chunks and statuses for video',
  );
}
```

**Note**: We DELETE status rows on chunk deletion because the 1:1 relationship means when a chunk is deleted, its status must also be deleted.

### 4. `/packages/ingest/src/extract-entities.ts`

This is the most significant set of changes. Multiple areas need modification:

#### 4a. Update Imports

Add `chunkExtractionStatus` to imports from `@hop-hv-rag/db`.

#### 4b. Simplify Error Handling

Remove the complex error type attachment pattern. Current code (around line 297-314):

```typescript
// OLD - REMOVE THIS PATTERN:
if (NoObjectGeneratedError.isInstance(error)) {
  logger.warn(...);
  const err = new Error('AI failed to generate valid mentions');
  (err as Error & { errorType?: string }).errorType = 'ai-parse';  // REMOVE
  throw err;
}

const message = error instanceof Error ? error.message : String(error);
logger.error(...);
const err = new Error(message);
(err as Error & { errorType?: string }).errorType = 'api';  // REMOVE
throw err;
```

Replace with simple error throwing:

```typescript
// NEW - SIMPLIFIED:
if (NoObjectGeneratedError.isInstance(error)) {
  logger.warn(...);
  throw new Error('AI failed to generate valid mentions');
}

const message = error instanceof Error ? error.message : String(error);
logger.error(...);
throw new Error(message);
```

#### 4c. Update Job Planner Logic

Current logic (around line 140-165) looks for existing mentions. Replace with status-based logic:

```typescript
// In JobPlanner.planVideoJobs():

// OLD: Check for existing mentions
const processedMentions = await this.db
  .select({ chunkId: chunkEntityMentions.chunkId })
  .from(chunkEntityMentions)
  .where(
    this.resumeAnyPrompt
      ? and(
          eq(chunkEntityMentions.runId, this.runId),
          inArray(chunkEntityMentions.chunkId, chunkIds),
        )
      : and(
          eq(chunkEntityMentions.runId, this.runId),
          eq(chunkEntityMentions.promptHash, this.promptHash),
          inArray(chunkEntityMentions.chunkId, chunkIds),
        ),
  );

const processedIds = new Set(processedMentions.map((row) => row.chunkId));
const pendingChunks = allChunks.filter((chunk) => !processedIds.has(chunk.id));

// NEW: Check for pending/failed statuses
const statusRows = await this.db
  .select({
    chunkId: chunkExtractionStatus.chunkId,
    status: chunkExtractionStatus.status,
  })
  .from(chunkExtractionStatus)
  .where(inArray(chunkExtractionStatus.chunkId, chunkIds));

const statusByChunkId = new Map(
  statusRows.map((row) => [row.chunkId, row.status]),
);

// Filter to chunks that are pending or failed
const pendingChunks = allChunks.filter((chunk) => {
  const status = statusByChunkId.get(chunk.id);
  return status === 'pending' || status === 'failed';
});

// If force mode, we already deleted old statuses in deleteVideoMentions,
// so all chunks will have status='pending' from the re-chunking
```

**Important**: The `resumeAnyPrompt` flag concept no longer applies. We always check status table now. Remove references to `resumeAnyPrompt` in the job planner.

#### 4d. Update Chunk Processing

In `ChunkEntityExtractor.processChunkJob()`, add status updates:

```typescript
async function processChunkJob(
  job: ChunkJob,
  promptHash: string,
  runId: string,
  modelName: string,
): Promise<number> {
  const { video, chunk, summary } = job;

  // ... existing prompt building ...

  try {
    const { output } = await generateText({ ... });

    const mentions: MentionOutput[] = output.mentions;
    // ... validation logic ...

    if (validMentions.length > 0) {
      await this.db.insert(chunkEntityMentions).values(...);

      // NEW: Update status to success
      await this.db
        .update(chunkExtractionStatus)
        .set({ status: 'success' })
        .where(eq(chunkExtractionStatus.chunkId, chunk.id));
    } else {
      // NEW: Update status to empty (no valid entities)
      await this.db
        .update(chunkExtractionStatus)
        .set({ status: 'empty' })
        .where(eq(chunkExtractionStatus.chunkId, chunk.id));
    }

    logger.info(...);
    return validMentions.length;

  } catch (error: unknown) {
    // Simplified error handling (see 4b)
    const message = error instanceof Error ? error.message : String(error);

    // NEW: Update status to failed with error message
    await this.db
      .update(chunkExtractionStatus)
      .set({
        status: 'failed',
        errorMessage: message,
      })
      .where(eq(chunkExtractionStatus.chunkId, chunk.id));

    logger.error(...);
    throw error;  // Re-throw so outer error tracking still works
  }
}
```

#### 4e. Update Delete Logic

In `JobPlanner.deleteVideoMentions()` (around line 205-217), add deletion of status rows:

```typescript
private async deleteVideoMentions(videoId: number): Promise<void> {
  const chunkRows = await this.db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.videoId, videoId));

  const ids = chunkRows.map((row) => row.id);
  if (ids.length === 0) return;

  await this.db
    .delete(chunkEntityMentions)
    .where(inArray(chunkEntityMentions.chunkId, ids));

  // NEW: Delete status rows
  await this.db
    .delete(chunkExtractionStatus)
    .where(inArray(chunkExtractionStatus.chunkId, ids));
}
```

**Note**: This is only called when `--force` is used. The status rows will be recreated as 'pending' when chunks are re-inserted by the chunking script.

### 5. `/packages/ingest/src/reset-entities.ts`

This file handles resetting entity data. It should reset statuses to 'pending' instead of deleting them.

**Current behavior**: Deletes mentions, entities, etc.

**New behavior**: Also reset statuses:

```typescript
// After deleting mentions, add:
await db.update(chunkExtractionStatus).set({
  status: 'pending',
  errorMessage: null,
});
```

This allows re-running extraction without re-chunking.

### 6. `/packages/ingest/src/migrate-extraction-status.ts` (NEW FILE)

Create a migration script to backfill status for existing chunks. This is needed because ~650 chunks currently exist without status tracking.

**Logic:**

1. Create the `chunk_extraction_status` table if not exists
2. For each existing chunk WITHOUT a status row:
   - If chunk has mentions in `chunkEntityMentions` → insert `status='success'`
   - If chunk has NO mentions → insert `status='pending'` (will be reprocessed)
3. Skip chunks that already have status rows (idempotent)

**Key Points:**

- **NON-DESTRUCTIVE**: Never deletes or modifies existing data
- **Idempotent**: Can run multiple times safely
- **No reset needed**: Doesn't require `reset-entities` or re-chunking
- **Backwards compatible**: Existing extraction code continues to work during migration

**Implementation Requirements:**

- Use raw SQL for table creation (same SQL as init-db.ts)
- Query existing chunks without status rows
- Batch insert operations (e.g., 500 at a time) for performance
- Log progress (chunks with mentions vs without)
- Report final counts per status

## Expected System Behavior

### For Existing Chunks (Migration Path)

1. User runs migration script → Creates table, backfills statuses
2. Chunks with mentions get `status='success'`
3. Chunks without mentions get `status='pending'`
4. User runs extraction → Pending chunks get processed

### Retry Behavior

Running extraction multiple times will:

- Skip `success` and `empty` chunks
- Re-process `pending` chunks (including crashed/interrupted ones)
- Re-process `failed` chunks with error tracking

### Force Flag Behavior

Using `--force` on chunking will:

- Delete old chunks + their status rows
- Create new chunks with `status='pending'`

Using `--force` on extraction will:

- Delete mentions for target chunks
- Delete status rows for target chunks
- Re-processing will treat them as new (status IS NULL, job planner handles this)

## Implementation Verification

After implementing all code changes, the system should support:

- [ ] Migration script creates table and backfills existing chunks
- [ ] Chunks with existing mentions get `status='success'`
- [ ] Chunks without mentions get `status='pending'`
- [ ] New chunks automatically get `status='pending'` on creation
- [ ] Job planner finds only `pending` and `failed` chunks
- [ ] Successful extraction updates status to `success`
- [ ] Failed extraction updates status to `failed` with error message
- [ ] Empty extraction (0 valid entities) updates status to `empty`
- [ ] Retry logic processes `failed` chunks on subsequent runs
- [ ] `--force` flag clears statuses and allows reprocessing
- [ ] `reset-entities` resets statuses to `pending` without deleting them
- [ ] TypeScript types are valid (run `bun run typecheck`)

## Verification Queries

These SQL queries can be used to verify the implementation:

```sql
-- Count chunks by status
SELECT status, COUNT(*) FROM chunk_extraction_status GROUP BY status;

-- Find failed chunks with errors
SELECT chunk_id, error_message, created_at
FROM chunk_extraction_status
WHERE status = 'failed';

-- Check a specific video's extraction progress
SELECT ces.status, COUNT(*)
FROM chunk_extraction_status ces
JOIN chunks c ON c.id = ces.chunk_id
WHERE c.video_id = ?
GROUP BY ces.status;

-- Find chunks without status (should be 0 after migration)
SELECT COUNT(*) FROM chunks c
LEFT JOIN chunk_extraction_status ces ON c.id = ces.chunk_id
WHERE ces.id IS NULL;
```

## Potential Edge Cases

1. **Chunk deleted but status remains**: Handled by CASCADE DELETE in schema
2. **Status update fails**: Transaction rollback should prevent inconsistent state
3. **Process crashes mid-chunk**: Status remains 'pending', will be retried
4. **Duplicate chunk processing**: Status update is idempotent (same final state)
5. **Migration run multiple times**: Should be idempotent, skip existing status rows

## Future Enhancements (Out of Scope)

- Add retry count field to track how many times a chunk failed
- Add `updated_at` timestamp to track when status last changed
- Add index on status column for faster pending/failed queries
- Add CLI command to show extraction statistics per video
