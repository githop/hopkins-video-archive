# Implementation Plan: Idempotent Parallel Ingestion

## Overview

Refine the `ingest:summarize` command to be fully idempotent and fault-tolerant. The goal is to allow the command to be re-run safely to "fill in the gaps" (missing chunks) without duplicating work or requiring manual "repair" flags.

## Core Philosophy

- **Database is Truth**: Existence of a record in the `scenes` table is the only indicator of progress.
- **Granular Locking**: We track progress at the _Chunk_ level (3-minute segments), not the Video level.
- **Fault Isolation**: A failure in one video should not crash the parallel batch.

---

## Phase 1: Robust Progress Tracking (The "Check")

**File:** `packages/ingest/src/summarize-scenes.ts`

### 1.1 Update `Chunk` Interface

Add precise window metadata to the `Chunk` interface to allow for exact matching against existing DB records.

```typescript
interface Chunk {
  windowStart: number; // e.g., 0, 180, 360
  windowEnd: number; // e.g., 180, 360, 540
  // ... existing fields
}
```

### 1.2 Update `processVideo` for Idempotency

Modify `processVideo` to perform a "Gap Analysis" before starting work.

1.  **Generate Candidates**: Calculate the deterministic time windows for the video based on transcript duration (Logic already exists in `createChunks`, just needs to expose the windows).
2.  **Fetch Existing**: Query `scenes` for this `videoId` to get all existing `startTime`s.
3.  **Filter**: Remove any Candidate Chunk where an Existing Scene matches the `windowStart` (within a small tolerance, e.g., ±1s).
4.  **Logging**:
    - If 0 chunks remain: Log `✅ Video fully processed` and return.
    - If chunks remain: Log `ℹ️ Processing [N] missing chunks ([M] skipped)` and proceed.

### 1.3 "Smart" Main Loop

Remove the high-level optimization that skips a video if _any_ scene exists.

- **Old Logic**: `if (sceneCount > 0) continue;`
- **New Logic**: Pass _all_ videos to `processVideo`. Let the logic in 1.2 determine if work is needed.

---

## Phase 2: Fault Tolerance (The "Safety Net")

**File:** `packages/ingest/src/summarize-scenes.ts`

### 2.1 Parallel Error Boundaries

Wrap the worker execution in the semaphore loop with a `try/catch` block.

- **Current**: Relies on `processVideo` not throwing.
- **New**: Explicitly catch errors in the loop.
  - Log: `❌ Critical error processing video [ID]: [Error]`
  - Action: Release the semaphore permit so other videos can continue.

### 2.2 Verify Chunk Persistence

Ensure `db.insert` happens immediately after generation (already implemented) so that a crash 90% through a video still saves the 90% of chunks that finished.

---

## Phase 3: Verification

### 3.1 Partial Failure Test

1.  Run the pipeline on a small video.
2.  Manually delete 1 scene from the DB (`DELETE FROM scenes WHERE id = ...`).
3.  Re-run the command without `--force`.
4.  **Expectation**: Script logs "Skipping X existing chunks, processing 1 missing chunk" and restores the deleted scene.

### 3.2 Concurrency Test

1.  Run with `--video-concurrency 4`.
2.  **Expectation**: Multiple videos processed in parallel, with logs interleaved, saturating the GPU.
