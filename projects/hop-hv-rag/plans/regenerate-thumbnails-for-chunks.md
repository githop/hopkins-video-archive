# Regenerate Thumbnails for Chunk Boundaries

**Status:** Ready to implement  
**Priority:** High  
**Estimated Effort:** 1 hour  
**Depends on:** Entity/chunk refactor (completed 2026-02-04)  
**Created:** 2026-02-05

---

## Overview

The thumbnail generation script in `whisper-project` is broken — it queries the deleted `scenes` table. The existing 1,140 thumbnails on disk were generated from old scene boundaries that no longer match the 2,043 chunk boundaries in the database. Most chunk-based thumbnail lookups in the UI are returning 404s.

This plan updates the script to query the `chunks` table and regenerates all thumbnails.

## The Problem

### 1. Script is broken

`projects/whisper-project/src/thumbnails.ts` line 56 queries `FROM scenes s` — but the `scenes` table was deleted in commit `87db05d` (2026-02-04). Running `bun run thumbs` will fail at runtime.

### 2. Systematic thumbnail 404s in the UI

The archivist builds thumbnail URLs from chunk `startTime` values:

```
/thumbnails/1984-1985/00158.jpg   ← chunk starts at 158s
```

But the files on disk were generated from old scene start times:

```
/thumbnails/1984-1985/00181.jpg   ← scene started at 181s
```

For `1984-1985.m4v`, only 4 of 29 chunks happen to align with an existing thumbnail. The other 25 return 404.

### 3. No backfill path

The old `backfill-thumbnails.ts` was deleted in the refactor. There is no script to regenerate thumbnails aligned to chunk boundaries.

## Current State

**Thumbnail generation script:** `projects/whisper-project/src/thumbnails.ts`

- Queries the deleted `scenes` table (line 52-68)
- Uses `SceneRow` interface with `scene_id`, `video_id`, `video_filename`, `start_time`, `end_time`
- Extracts frame at scene **midpoint**: `(startTime + endTime) / 2` (line 26-28)
- Names file by scene **start time**: `Math.floor(startTime).padStart(5, '0')` (line 40)
- Outputs to `projects/hop-hv-rag/data/thumbnails/<video-basename>/<padded>.jpg`
- Has `--dry-run`, `--video=<filter>`, and `--concurrency=N` CLI flags
- Uses a `Semaphore` class for bounded concurrency (lines 202-229)
- Skips thumbnails that already exist on disk (line 151)

**FFmpeg extraction:** `projects/whisper-project/src/ffmpeg.ts` lines 63-92

- Uses input seeking (`-ss` before `-i`) for fast extraction
- Outputs 320x240 JPEG with letterbox padding
- Quality setting from `CONFIG.THUMBNAIL.QUALITY` (value: 2)

**Config:** `projects/whisper-project/src/config.ts` lines 44-51

- `HV_RAG_DB`: `../hop-hv-rag/data/hv-rag.db`
- `THUMBNAILS_DIR`: `../hop-hv-rag/data/thumbnails`
- `THUMBNAIL.WIDTH`: 320, `HEIGHT`: 240, `QUALITY`: 2

**Existing thumbnails on disk:**

- 181 video folders
- 1,140 `.jpg` files total
- Named by old scene start times

**Database state:**

- `chunks` table: 2,043 rows with `start_time` and `end_time`
- `scenes` table: deleted, does not exist

---

## Implementation Steps

### Step 1: Update the `SceneRow` interface to `ChunkRow`

**File:** `projects/whisper-project/src/thumbnails.ts`

Rename the interface and update the field names to reflect chunks:

```typescript
// BEFORE (lines 15-21):
interface SceneRow {
  scene_id: number;
  video_id: number;
  video_filename: string;
  start_time: number;
  end_time: number;
}

// AFTER:
interface ChunkRow {
  chunk_id: number;
  video_id: number;
  video_filename: string;
  start_time: number;
  end_time: number;
}
```

### Step 2: Update the SQL query to use `chunks` table

**File:** `projects/whisper-project/src/thumbnails.ts`

Replace the `getScenes` function with `getChunks`:

```typescript
// BEFORE (lines 52-68):
function getScenes(db: Database): SceneRow[] {
  return db
    .query(
      `
    SELECT
      s.id as scene_id,
      s.video_id,
      v.filename as video_filename,
      s.start_time,
      s.end_time
    FROM scenes s
    JOIN videos v ON s.video_id = v.id
    ORDER BY v.filename, s.start_time
  `,
    )
    .all() as SceneRow[];
}

// AFTER:
function getChunks(db: Database): ChunkRow[] {
  return db
    .query(
      `
    SELECT
      c.id as chunk_id,
      c.video_id,
      v.filename as video_filename,
      c.start_time,
      c.end_time
    FROM chunks c
    JOIN videos v ON c.video_id = v.id
    ORDER BY v.filename, c.start_time
  `,
    )
    .all() as ChunkRow[];
}
```

### Step 3: Fix the `getThumbnailPath` basename extraction

**File:** `projects/whisper-project/src/thumbnails.ts`

The current code (line 39) chains `basename(videoFilename, ".m4v").replace(".mp4", "")` which is fragile. Use the same regex pattern as the rest of the codebase:

```typescript
// BEFORE (lines 34-47):
function getThumbnailPath(
  videoFilename: string,
  sceneStartTime: number,
  timestamp: number,
): { dir: string; fullPath: string } {
  const videoBase = basename(videoFilename, '.m4v').replace('.mp4', '');
  const timestampStr = String(Math.floor(sceneStartTime)).padStart(5, '0');

  const dir = join(CONFIG.THUMBNAILS_DIR, videoBase);
  const filename = `${timestampStr}.jpg`;
  const fullPath = join(dir, filename);

  return { dir, fullPath };
}

// AFTER:
function getThumbnailPath(
  videoFilename: string,
  chunkStartTime: number,
): { dir: string; fullPath: string } {
  const videoBase = videoFilename.replace(/\.[^/.]+$/, '');
  const timestampStr = String(Math.floor(chunkStartTime)).padStart(5, '0');

  const dir = join(CONFIG.THUMBNAILS_DIR, videoBase);
  const filename = `${timestampStr}.jpg`;
  const fullPath = join(dir, filename);

  return { dir, fullPath };
}
```

Note: the `timestamp` parameter was unused for path computation (it was only used for frame extraction), so remove it. The `import { basename } from "node:path"` on line 9 can also be removed since nothing else uses it.

### Step 4: Update `generateThumbnails` to use chunks

**File:** `projects/whisper-project/src/thumbnails.ts`

Update all references from scenes to chunks in the main function. The key changes in `generateThumbnails` (lines 81-197):

```typescript
// Line 96-97 — CHANGE:
const scenes = getScenes(db);
// TO:
const chunks = getChunks(db);

// Lines 99-101 — CHANGE:
Logger.info(
  `Found ${scenes.length} scenes across ${new Set(scenes.map((s) => s.video_id)).size} videos`,
);
// TO:
Logger.info(
  `Found ${chunks.length} chunks across ${new Set(chunks.map((c) => c.video_id)).size} videos`,
);

// Lines 103-112 — CHANGE:
let filteredScenes = scenes;
if (videoFilter) {
  filteredScenes = scenes.filter((s) => s.video_filename.includes(videoFilter));
  Logger.info(
    `Filtered to ${filteredScenes.length} scenes matching "${videoFilter}"`,
  );
}
// TO:
let filtered = chunks;
if (videoFilter) {
  filtered = chunks.filter((c) => c.video_filename.includes(videoFilter));
  Logger.info(
    `Filtered to ${filtered.length} chunks matching "${videoFilter}"`,
  );
}

// Lines 122-186 — CHANGE all occurrences of `filteredScenes` to `filtered`,
// `scene` to `chunk`, and `scene.scene_id` to `chunk.chunk_id`:
await Promise.all(
  filtered.map(async (chunk) => {
    await semaphore.acquire();

    try {
      const videoPath = join(CONFIG.VIDEOS_DIR, chunk.video_filename);

      const videoFile = Bun.file(videoPath);
      if (!(await videoFile.exists())) {
        Logger.warn(
          `Video file not found: ${videoPath} (skipping chunk ${chunk.chunk_id})`,
        );
        skipped++;
        return;
      }

      // Extract frame at midpoint, name file by start time
      const timestamp = getThumbnailTimestamp(chunk.start_time, chunk.end_time);
      const { dir, fullPath } = getThumbnailPath(
        chunk.video_filename,
        chunk.start_time,
      );

      if (await thumbnailExists(fullPath)) {
        Logger.info(`Thumbnail exists: ${fullPath}`);
        skipped++;
        return;
      }

      if (dryRun) {
        Logger.info(
          `[DRY RUN] Would create: ${fullPath} at ${timestamp.toFixed(1)}s`,
        );
        processed++;
        return;
      }

      await mkdir(dir, { recursive: true });

      try {
        await FFMPEG.extractThumbnail(videoPath, timestamp, fullPath);

        processed++;
        Logger.info(
          `✓ ${chunk.video_filename} [${chunk.chunk_id}]: ${fullPath}`,
        );
      } catch (error) {
        Logger.error(
          `Failed to extract thumbnail for chunk ${chunk.chunk_id}: ${error}`,
        );
        failed++;
      }
    } finally {
      semaphore.release();
    }
  }),
);
```

### Step 5: Update the JSDoc comment at the top of the file

**File:** `projects/whisper-project/src/thumbnails.ts`

```typescript
// BEFORE (lines 1-7):
/**
 * Thumbnail Generation Script
 *
 * Extracts scene-level thumbnails from video files using FFmpeg.
 * Queries hop-hv-rag database for scene timestamps and generates thumbnails.
 * Does NOT update the database - Phase 2 will handle that integration.
 */

// AFTER:
/**
 * Thumbnail Generation Script
 *
 * Extracts chunk-level thumbnails from video files using FFmpeg.
 * Queries hop-hv-rag database for chunk timestamps and generates thumbnails
 * at the midpoint of each chunk, named by the chunk start time.
 */
```

### Step 6: Clean up unused import

**File:** `projects/whisper-project/src/thumbnails.ts`

```typescript
// Line 9 — CHANGE:
import { join, basename } from 'node:path';
// TO:
import { join } from 'node:path';
```

`basename` was only used in the old `getThumbnailPath` for extension stripping. The new version uses a regex instead.

### Step 7: Verify with dry run (agent) then regenerate (collaborative)

**IMPORTANT: Steps 7a-7b are safe for the agent to run autonomously. Steps 7c-7e have side effects (deleting files, writing ~2,000 thumbnails, ~4 min FFmpeg processing) and MUST be done collaboratively with the user. Present the dry run output, confirm the plan looks correct, and let the user decide when to proceed.**

#### 7a. Type check (safe — no side effects)

```bash
# From projects/whisper-project/
bun x tsc --noEmit
```

#### 7b. Dry run (safe — read-only, no files written)

```bash
# From projects/whisper-project/
bun run thumbs:dry
```

Expected output: `Found 2043 chunks across N videos` and a list of `[DRY RUN] Would create: ...` lines. Present this output to the user for review.

#### 7c. Delete old thumbnails (SIDE EFFECTS — user approval required)

```bash
rm -rf ../hop-hv-rag/data/thumbnails/*
```

#### 7d. Generate new thumbnails (SIDE EFFECTS — user approval required)

```bash
# Single video first to validate
bun run thumbs -- --video=1984-1985

# Then full regeneration after user confirms single-video output looks good
bun run thumbs
```

#### 7e. Verify output (safe — read-only)

After generation, the user and agent can collaboratively verify:

- Correct number of thumbnails created (should match chunk count per video)
- Filenames match `Math.floor(chunk.start_time).padStart(5, '0')` pattern
- Images are valid JPEGs at 320x240 showing mid-chunk content

The full run will:

- Query 2,043 chunks from the database
- Extract a frame at the midpoint of each chunk
- Name each file by `Math.floor(chunk.start_time).padStart(5, '0')`
- Output to `../hop-hv-rag/data/thumbnails/<video-basename>/`
- Skip any that already exist (relevant if re-running after a partial failure)

---

## Files Modified (Summary)

| #   | File                                         | Action                                                                                                                                                                      |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `projects/whisper-project/src/thumbnails.ts` | **EDIT** — rename `SceneRow` to `ChunkRow`, `getScenes` to `getChunks`, update SQL from `scenes` to `chunks`, fix basename extraction, update all scene references to chunk |

This is a single-file change. The FFmpeg extraction (`ffmpeg.ts`), config (`config.ts`), and CLI flags are all unchanged.

---

## Verification

### Agent-safe (no side effects — run autonomously)

- **Type check:** `bun x tsc --noEmit` from `projects/whisper-project/`
- **Dry run:** `bun run thumbs:dry` from `projects/whisper-project/` — confirm it reports the expected chunk count and output paths
- **DB queries:** read-only queries against `hv-rag.db` to spot-check chunk counts, start times, etc.

### Collaborative (side effects — require user approval before running)

The agent should present dry run results and get explicit user go-ahead before any of these:

1. **Delete old thumbnails:** `rm -rf ../hop-hv-rag/data/thumbnails/*`
2. **Single-video test:** `bun run thumbs -- --video=1984-1985` — user and agent review output together
3. **Full regeneration:** `bun run thumbs` — only after single-video test passes
4. **End-to-end smoke test:** Start the server (`bun run search:serve` from `projects/hop-hv-rag/`), run a query in the UI, verify thumbnails load (no 404s in DevTools Network tab)

---

## Notes

- **Midpoint extraction, start-time naming:** The frame is extracted at `(startTime + endTime) / 2` for visually representative content, but the file is named by `Math.floor(startTime)` so the client can look it up using only the chunk start time. This matches the convention used in `archivist.ts:buildThumbnailUrl` and the planned `mediaUrls.ts` client utility.
- **Overlap chunks:** Some chunks have `overlapFromChunkId` set, meaning they share ~15 seconds of content with the previous chunk. Their thumbnails will still be unique since the midpoint differs.
- **Processing time:** At ~0.5s per FFmpeg extraction with concurrency 4, expect ~4 minutes for 2,043 thumbnails.
- **Disk space:** At ~10-15KB per 320x240 JPEG, expect ~20-30MB total (small).
- **Idempotent:** The script skips existing thumbnails. To force full regeneration, delete the thumbnails directory first.

---

## Resume Instructions

To implement this in a new session:

1. Read this plan and `projects/whisper-project/AGENTS.md` for project conventions
2. Edit `projects/whisper-project/src/thumbnails.ts` (Steps 1-6 — all changes are in this one file)
3. Run `bun x tsc --noEmit` from `projects/whisper-project/` to type check
4. Run `bun run thumbs:dry` to verify the query works and produces expected output
5. **STOP and present results to the user.** Steps 6-8 have side effects and must be done collaboratively.
6. With user approval: delete old thumbnails (`rm -rf ../hop-hv-rag/data/thumbnails/*`)
7. With user approval: run `bun run thumbs` for full regeneration
8. With user approval: smoke test with `bun run search:serve` from `projects/hop-hv-rag/`

**Key files:**

- Script to edit: `projects/whisper-project/src/thumbnails.ts`
- FFmpeg wrapper (no changes): `projects/whisper-project/src/ffmpeg.ts`
- Config (no changes): `projects/whisper-project/src/config.ts`
- Database: `projects/hop-hv-rag/data/hv-rag.db`
- Output dir: `projects/hop-hv-rag/data/thumbnails/`
