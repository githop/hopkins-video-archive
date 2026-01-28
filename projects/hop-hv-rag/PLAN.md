# Implementation Plan: LLM Smart Pass for Temporal Metadata

## Overview

Add year range extraction to the ingest pipeline and temporal boosting to RAG search. This addresses the problem where queries like "what happened at christmas in 1984" return results from 1993 and 1986 videos because the search pipeline has no temporal awareness.

## Problem Statement

- `videos.year` is **null for all 184 videos**
- The `parseFilename()` function was designed as a stub, deferring to an "LLM Smart Pass" that was never implemented
- Semantic similarity alone finds "Christmas 1991" when searching for "Christmas 1984"
- Sources include videos from wrong years, degrading search quality

## Solution

1. **Schema Change**: Add `year_start` and `year_end` columns to use year ranges as the primitive
2. **LLM Smart Pass**: New `extract-temporal.ts` script to populate year ranges from video content
3. **Search Enhancement**: Add soft boosting to `rag-query.ts` based on temporal relevance

---

# Part A: Code Changes

## Phase 1: Schema Migration

**File:** `packages/db/src/schema.ts`

Add two integer columns to the `videos` table:

```typescript
export const videos = sqliteTable('videos', {
  // ... existing fields ...
  yearStart: integer('year_start'), // e.g., 1984
  yearEnd: integer('year_end'), // e.g., 1985 (same as start for single-year)
});
```

Keep the existing `year` column as-is (nullable, unused) to avoid migration complexity.

## Phase 2: Temporal Extraction Script

**File:** `packages/ingest/src/extract-temporal.ts` (new)

### 2.1 Zod Schema for LLM Output

```typescript
import { z } from 'zod';

const TemporalSchema = z.object({
  yearStart: z.number().int().min(1970).max(2030),
  yearEnd: z.number().int().min(1970).max(2030),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string(),
});

type TemporalExtraction = z.infer<typeof TemporalSchema>;
```

### 2.2 LLM Prompt

```typescript
function getTemporalPrompt(filename: string, sceneContext: string): string {
  return `You are analyzing a home video from the Hopkins family archive.
Based on the filename and scene content, determine the year(s) when this video was recorded.

FILENAME: ${filename}

SCENES:
${sceneContext}

RULES:
- yearStart and yearEnd define the recording period
- If the video spans a single year, set both to the same value
- Use explicit year mentions in scene content as PRIMARY evidence (highest confidence)
- Use filename year patterns (e.g., "1984-1985") as SECONDARY evidence
- confidence levels:
  - "high": Explicit year stated in scene content (e.g., "Christmas 1984", "Greg's birthday in 1986")
  - "medium": Year inferred from filename pattern with supporting context
  - "low": Pure guess based on filename alone with no corroborating content

OUTPUT: JSON object with yearStart, yearEnd, confidence, evidence`;
}
```

### 2.3 Core Logic

```typescript
async function extractTemporalMetadata(
  db: ReturnType<typeof createDb>,
  model: LanguageModel,
  video: Video,
): Promise<void> {
  // 1. Fetch all scenes for this video
  const videoScenes = db
    .select({ title: scenes.title, summary: scenes.summary })
    .from(scenes)
    .where(eq(scenes.videoId, video.id))
    .all();

  if (videoScenes.length === 0) {
    console.log(`   ⚠️ No scenes for ${video.filename}, skipping`);
    return;
  }

  // 2. Build scene context for LLM
  const sceneContext = videoScenes
    .map((s) => `- ${s.title}: ${s.summary}`)
    .join('\n');

  // 3. Call LLM with structured output
  const { object } = await generateObject({
    model,
    schema: TemporalSchema,
    prompt: getTemporalPrompt(video.filename, sceneContext),
  });

  // 4. Skip low confidence results
  if (object.confidence === 'low') {
    console.log(`   ⏭️ ${video.filename}: Low confidence, skipping`);
    console.log(`      Evidence: ${object.evidence}`);
    return;
  }

  // 5. Update database
  db.update(videos)
    .set({
      yearStart: object.yearStart,
      yearEnd: object.yearEnd,
    })
    .where(eq(videos.id, video.id))
    .run();

  console.log(
    `   ✅ ${video.filename}: ${object.yearStart}-${object.yearEnd} (${object.confidence})`,
  );
  console.log(`      Evidence: ${object.evidence}`);
}
```

### 2.4 CLI Entry Point

```typescript
async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      model: { type: 'string', default: 'summarizer-bulk' },
      concurrency: { type: 'string', default: '16' },
    },
    strict: true,
  });

  // Validate args
  if (!values.all && !values.file) {
    console.error('Usage: bun ingest:temporal --all | --file <filename>');
    process.exit(1);
  }

  const db = createDb(DB_PATH);
  const model = getGenModel(values.model);

  // Get videos to process
  let videosToProcess: Video[];
  if (values.file) {
    videosToProcess = db
      .select()
      .from(videos)
      .where(like(videos.filename, `%${values.file}%`))
      .all();
  } else {
    // --all: get videos without year data (unless --force)
    videosToProcess = values.force
      ? db.select().from(videos).all()
      : db.select().from(videos).where(isNull(videos.yearStart)).all();
  }

  console.log(`Processing ${videosToProcess.length} videos...\n`);

  // Process with concurrency limit
  const semaphore = new Semaphore(parseInt(values.concurrency));
  await Promise.all(
    videosToProcess.map(async (video) => {
      await semaphore.acquire();
      try {
        await extractTemporalMetadata(db, model, video);
      } catch (error) {
        console.error(`   ❌ ${video.filename}: ${error}`);
      } finally {
        semaphore.release();
      }
    }),
  );

  console.log('\nDone!');
}
```

### 2.5 Model and Concurrency Settings

**Default model**: `summarizer-bulk` (Qwen3-4B-AWQ)

- Optimized for high concurrency (`max_num_seqs = 32`)
- 8K context window is plenty for scene summaries (~1-2K tokens per video)
- Same quality as `summarizer` but better throughput for batch processing

**Default concurrency**: `16`

- Leaves headroom below model's 32-seq limit
- Processes 184 videos efficiently
- Can be tuned via `--concurrency` flag if needed

### 2.6 Add Script to package.json

**File:** `packages/ingest/package.json`

```json
{
  "scripts": {
    "ingest:temporal": "bun src/extract-temporal.ts"
  }
}
```

## Phase 3: Search Enhancement

**File:** `packages/search/src/rag-query.ts`

### 3.1 Update HybridResult Type

**File:** `packages/search/src/types.ts`

```typescript
export interface HybridResult {
  // ... existing fields ...
  videoYearStart: number | null;
  videoYearEnd: number | null;
}
```

### 3.2 Update SQL Queries

In `hybridSearch()`, update both vector and FTS SQL queries to include year columns:

```sql
SELECT
  -- ... existing fields ...
  v.year_start as videoYearStart,
  v.year_end as videoYearEnd
FROM ...
```

### 3.3 Add Year Detection Helper

```typescript
/**
 * Detect a 4-digit year in the query string.
 * Supports years from 1960-2029.
 */
function detectYearInQuery(query: string): number | null {
  const match = query.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}
```

### 3.4 Add Temporal Boosting

Add after the existing entity boosting section (around line 515):

```typescript
// 7. Temporal boosting based on year in query
const queryYear = detectYearInQuery(query);
if (queryYear) {
  console.log(`   Detected year: ${queryYear}`);
  for (const result of fused) {
    const { videoYearStart, videoYearEnd } = result;
    if (videoYearStart && videoYearEnd) {
      // Check if query year falls within video's year range
      if (queryYear >= videoYearStart && queryYear <= videoYearEnd) {
        // Year is in range - boost
        result.score = (result.score || 0) * 1.5;
      } else {
        // Calculate distance to nearest edge of range
        const distance = Math.min(
          Math.abs(queryYear - videoYearStart),
          Math.abs(queryYear - videoYearEnd),
        );
        if (distance > 4) {
          // More than 4 years off - penalty
          result.score = (result.score || 0) * 0.5;
        }
        // Within 4 years: no change (neutral)
      }
    }
  }
}
```

### 3.5 Update Source Building

In `buildSources()`, include year range in the video object:

```typescript
sources.push({
  // ... existing fields ...
  video: {
    id: r.videoId,
    title: r.videoTitle,
    yearStart: r.videoYearStart,
    yearEnd: r.videoYearEnd,
    driveId: r.videoDriveFileId,
  },
});
```

## Files Summary

| File                                      | Action                                  |
| ----------------------------------------- | --------------------------------------- |
| `packages/db/src/schema.ts`               | Add `yearStart`, `yearEnd` columns      |
| `packages/ingest/src/extract-temporal.ts` | **New** - LLM extraction script         |
| `packages/ingest/package.json`            | Add `ingest:temporal` script            |
| `packages/search/src/types.ts`            | Add year fields to `HybridResult`       |
| `packages/search/src/rag-query.ts`        | Add year detection + soft boosting      |
| `packages/search/src/schemas.ts`          | Update `Source` video schema (optional) |

---

# Part B: Execution Steps

Run these steps after all code changes are complete and servers are running.

## Step 1: Push Schema Migration

```bash
bun run db:push
```

Verify:

```bash
sqlite3 data/hv-rag.db ".schema videos"
# Should show year_start and year_end columns
```

## Step 2: Run Temporal Extraction

**Prerequisites**: vLLM server must be running.

```bash
bun run ingest:temporal --all
```

Verify:

```bash
sqlite3 data/hv-rag.db "SELECT filename, year_start, year_end FROM videos WHERE year_start IS NOT NULL ORDER BY year_start LIMIT 20;"
```

## Step 3: Test Search

```bash
bun run search:rag -- "what happened at christmas in 1984"
```

**Expected**: Sources from 1984-1985 videos rank highest, console shows "Detected year: 1984"

### Edge Case Tests

```bash
# Query without year - should work as before
bun run search:rag -- "who went fishing"

# Query with year range video
bun run search:rag -- "what happened in 1985"
# Should match both "1985.json" and "1984-1985.json" videos
```

---

# Part C: Expected Outcome

## Before (current behavior)

```
Query: "what happened at christmas in 1984"
Sources:
- 1984-1985 cont @ 21:02  ✓
- 1993-2 @ 3:02           ✗ wrong year (talks about 1991)
- 1986 @ 27:13            ✗ wrong year
- 1984-1985 cont @ 30:00  ✓
- 1984-1985 @ 33:02       ✓
```

## After (with temporal boosting)

```
Query: "what happened at christmas in 1984"
   Detected year: 1984
Sources:
- 1984-1985 @ 33:02       ✓ (1.5x boost - year in range)
- 1984-1985 cont @ 21:02  ✓ (1.5x boost - year in range)
- 1984-1985 cont @ 30:00  ✓ (1.5x boost - year in range)
- 1986 @ 27:13            (0.5x penalty - 2 years off, but >4 threshold not met, neutral)
- 1993-2 @ 3:02           (0.5x penalty - 9 years off)
```

---

# Implementation Notes (Part A Complete)

- **Semaphore Implementation**: Included a `Semaphore` class in `extract-temporal.ts` as no shared utility was found.
- **Package Scripts**: Added `ingest:temporal` to `packages/ingest/package.json` while maintaining existing script naming conventions (e.g., `summarize` vs `ingest:summarize`).
- **Schema Updates**: Updated `SourceSchema` in `packages/search/src/schemas.ts` to include optional `yearStart` and `yearEnd` fields.
- **Search Logic**: Restructured `hybridSearch` in `rag-query.ts` to ensure temporal boosting logic executes even if entities are detected (Step 6), preventing early returns from skipping temporal analysis.
