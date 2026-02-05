# Client-Side Media URL Construction

**Status:** Ready to implement  
**Priority:** Medium  
**Estimated Effort:** 30-45 minutes  
**Depends on:** Entity/chunk refactor (completed 2026-02-04)  
**Created:** 2026-02-05

---

## Overview

Move all media URL construction (thumbnails, videos, transcripts) from the server to the client. The server currently builds `thumbnailUrl` and `videoUrl` strings inside each `Source` object before sending them to the client. Since these URLs follow a deterministic naming convention based on `filename` + `startTime` — both of which the client already receives — the server is doing redundant work.

The transcript URL is already built client-side in `VideoModal.tsx`. This plan consolidates all three URL patterns into a single client-side utility and removes the server-side construction.

## Motivation

1. **Smaller API payloads** — two string fields (`thumbnailUrl`, `videoUrl`) removed from every `Source` in the streamed response
2. **Single source of truth** — all URL logic lives in one utility instead of being split between server (`archivist.ts`) and client (`VideoModal.tsx`)
3. **More flexible UI** — the client can build URLs for any timestamp without a server round-trip (e.g., hover previews, alternate thumbnails)
4. **Consistency** — transcript URLs are already client-derived; this aligns the other two patterns

## Current State

### URL Patterns (all deterministic)

| Asset | Pattern | Example |
|-------|---------|---------|
| Thumbnail | `/thumbnails/<basename>/<padded-start>.jpg` | `/thumbnails/1984-1985/00095.jpg` |
| Video | `/videos/<filename>#t=<seconds>` | `/videos/1984-1985.m4v#t=95` |
| Transcript | `/transcripts/<basename>.vtt` | `/transcripts/1984-1985.vtt` |

Where `<basename>` = filename with extension stripped (e.g., `1984-1985.m4v` → `1984-1985`).

### Server-side construction (to be removed)

**`packages/search/src/archivist.ts`**, lines 218-225:

```typescript
const thumbnailUrl = this.buildThumbnailUrl(r.videoFilename, r.startTime);
const videoUrl = `/videos/${r.videoFilename}#t=${Math.floor(r.startTime)}`;
```

**`packages/search/src/archivist.ts`**, lines 318-322 (`buildThumbnailUrl` method):

```typescript
private buildThumbnailUrl(videoFilename: string, startTime: number): string {
    const videoFolder = videoFilename.replace(/\.[^/.]+$/, '');
    const timestampPadded = Math.floor(startTime).toString().padStart(5, '0');
    return `/thumbnails/${videoFolder}/${timestampPadded}.jpg`;
}
```

### Client-side construction (already exists, to be consolidated)

**`packages/ui/src/components/VideoModal.tsx`**, lines 27-29:

```typescript
const baseFilename = video.filename.replace(/\.[^/.]+$/, '');
const transcriptUrl = `/transcripts/${baseFilename}.vtt`;
```

### Schema fields (to be removed)

**`packages/search/src/schemas.ts`**, lines 10-34:

```typescript
export const SourceSchema = z.object({
  // ...
  thumbnailUrl: z.string(),          // line 15 — REMOVE
  video: z.object({
    // ...
    filename: z.string(),             // line 22 — KEEP (this is the source data)
    videoUrl: z.string(),             // line 23 — REMOVE
  }),
  // ...
});
```

### Components consuming these fields

| Component | Field used | Line |
|-----------|-----------|------|
| `VideoCard.tsx` | `source.thumbnailUrl` | 30 |
| `SourceCard.tsx` | `source.thumbnailUrl` | 36 |
| `VideoModal.tsx` | `video.videoUrl` | 62 |
| `VideoModal.tsx` | inline transcript URL from `video.filename` | 28-29 |

---

## Implementation Steps

### Step 1: Create client-side utility

**New file:** `packages/ui/src/utils/mediaUrls.ts`

This directory does not exist yet. Create `packages/ui/src/utils/` and add the file.

```typescript
/**
 * Client-side media URL construction.
 *
 * All media assets follow a deterministic naming convention derived from the
 * video filename, so the client can build URLs without server assistance.
 */

/** Strip file extension: "1984-1985.m4v" → "1984-1985" */
function basename(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}

/** Thumbnail URL for a specific video timestamp. */
export function thumbnailUrl(filename: string, startSeconds: number): string {
  const folder = basename(filename);
  const padded = Math.floor(startSeconds).toString().padStart(5, '0');
  return `/thumbnails/${folder}/${padded}.jpg`;
}

/** Video streaming URL with fragment timestamp. */
export function videoUrl(filename: string, startSeconds: number): string {
  return `/videos/${filename}#t=${Math.floor(startSeconds)}`;
}

/** VTT transcript URL. */
export function transcriptUrl(filename: string): string {
  return `/transcripts/${basename(filename)}.vtt`;
}
```

### Step 2: Remove `thumbnailUrl` and `videoUrl` from `SourceSchema`

**File:** `packages/search/src/schemas.ts`

Change the `SourceSchema` definition from:

```typescript
export const SourceSchema = z.object({
  chunkId: z.number(),
  citationId: z.number(), // [1], [2], [3], etc.
  chunkTitle: z.string().nullable(),
  summary: z.string(),
  thumbnailUrl: z.string(),
  video: z.object({
    id: z.number(),
    title: z.string().nullable(),
    year: z.number().nullable(),
    yearStart: z.number().nullable().optional(),
    yearEnd: z.number().nullable().optional(),
    filename: z.string(), // Video filename for local streaming
    videoUrl: z.string(), // URL with timestamp: /videos/filename.m4v#t=95
  }),
  timestamp: z.object({
    startSeconds: z.number(),
    endSeconds: z.number(),
    formatted: z.string(), // "MM:SS"
  }),
  participants: z.array(EntitySchema),
  locations: z.array(EntitySchema),
  activities: z.array(EntitySchema),
  globalSummary: z.string().nullable().optional(),
});
```

To:

```typescript
export const SourceSchema = z.object({
  chunkId: z.number(),
  citationId: z.number(), // [1], [2], [3], etc.
  chunkTitle: z.string().nullable(),
  summary: z.string(),
  video: z.object({
    id: z.number(),
    title: z.string().nullable(),
    year: z.number().nullable(),
    yearStart: z.number().nullable().optional(),
    yearEnd: z.number().nullable().optional(),
    filename: z.string(), // Video filename — client derives media URLs from this
  }),
  timestamp: z.object({
    startSeconds: z.number(),
    endSeconds: z.number(),
    formatted: z.string(), // "MM:SS"
  }),
  participants: z.array(EntitySchema),
  locations: z.array(EntitySchema),
  activities: z.array(EntitySchema),
  globalSummary: z.string().nullable().optional(),
});
```

Also update the JSDoc comment on line 8 — change "scene" to "chunk" while you're here:

```typescript
/**
 * Schema for a source chunk returned from the archive search
 */
```

### Step 3: Remove server-side URL construction from `archivist.ts`

**File:** `packages/search/src/archivist.ts`

#### 3a. In `buildSources()` method (lines 217-251), remove the URL construction and the fields from the pushed object.

Change this block:

```typescript
      // Format timestamp
      const minutes = Math.floor(r.startTime / 60);
      const seconds = Math.floor(r.startTime % 60);
      const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      const thumbnailUrl = this.buildThumbnailUrl(r.videoFilename, r.startTime);

      // Build video URL with timestamp for streaming
      const videoUrl = `/videos/${r.videoFilename}#t=${Math.floor(r.startTime)}`;

      sources.push({
        chunkId: r.id,
        citationId: index + 1, // Assign [1], [2], [3], etc.
        chunkTitle: r.title,
        summary: r.summary ?? 'No summary available.',
        thumbnailUrl,
        video: {
          id: r.videoId,
          title: r.videoTitle,
          year: r.videoYear,
          yearStart: r.videoYearStart,
          yearEnd: r.videoYearEnd,
          filename: r.videoFilename,
          videoUrl,
        },
        timestamp: {
          startSeconds: r.startTime,
          endSeconds: r.endTime,
          formatted,
        },
        participants,
        locations,
        activities,
        globalSummary: videoRow?.globalSummary || null,
      });
```

To:

```typescript
      // Format timestamp
      const minutes = Math.floor(r.startTime / 60);
      const seconds = Math.floor(r.startTime % 60);
      const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      sources.push({
        chunkId: r.id,
        citationId: index + 1, // Assign [1], [2], [3], etc.
        chunkTitle: r.title,
        summary: r.summary ?? 'No summary available.',
        video: {
          id: r.videoId,
          title: r.videoTitle,
          year: r.videoYear,
          yearStart: r.videoYearStart,
          yearEnd: r.videoYearEnd,
          filename: r.videoFilename,
        },
        timestamp: {
          startSeconds: r.startTime,
          endSeconds: r.endTime,
          formatted,
        },
        participants,
        locations,
        activities,
        globalSummary: videoRow?.globalSummary || null,
      });
```

#### 3b. Delete the `buildThumbnailUrl` method entirely (lines 318-322):

```typescript
// DELETE this entire method:
  private buildThumbnailUrl(videoFilename: string, startTime: number): string {
    const videoFolder = videoFilename.replace(/\.[^/.]+$/, '');
    const timestampPadded = Math.floor(startTime).toString().padStart(5, '0');
    return `/thumbnails/${videoFolder}/${timestampPadded}.jpg`;
  }
```

### Step 4: Update `VideoCard.tsx`

**File:** `packages/ui/src/components/VideoCard.tsx`

Add import and replace `source.thumbnailUrl`:

```typescript
// ADD import at top (after existing imports):
import { thumbnailUrl } from '../utils/mediaUrls.ts';

// Line 30 — CHANGE:
src={source.thumbnailUrl}
// TO:
src={thumbnailUrl(source.video.filename, source.timestamp.startSeconds)}
```

### Step 5: Update `SourceCard.tsx`

**File:** `packages/ui/src/components/SourceCard.tsx`

Same pattern as VideoCard:

```typescript
// ADD import at top (after existing imports):
import { thumbnailUrl } from '../utils/mediaUrls.ts';

// Line 36 — CHANGE:
src={source.thumbnailUrl}
// TO:
src={thumbnailUrl(source.video.filename, source.timestamp.startSeconds)}
```

### Step 6: Update `VideoModal.tsx`

**File:** `packages/ui/src/components/VideoModal.tsx`

This component needs the most changes — it currently uses `video.videoUrl` directly and builds transcript URLs inline.

```typescript
// ADD import at top (after existing imports):
import { videoUrl, transcriptUrl } from '../utils/mediaUrls.ts';

// Lines 27-29 — REMOVE the inline transcript URL construction:
// DELETE:
const baseFilename = video.filename.replace(/\.[^/.]+$/, '');
const transcriptUrl = `/transcripts/${baseFilename}.vtt`;

// Line 62 — CHANGE:
src={video.videoUrl}
// TO:
src={videoUrl(video.filename, timestamp.startSeconds)}

// Line 70 — CHANGE:
src={transcriptUrl}
// TO:
src={transcriptUrl(video.filename)}
```

Note: since the imported function is also named `transcriptUrl`, the local variable on lines 27-29 must be removed (not just renamed), otherwise it shadows the import.

---

## Files Modified (Summary)

| # | File | Action |
|---|------|--------|
| 1 | `packages/ui/src/utils/mediaUrls.ts` | **CREATE** — new utility with `thumbnailUrl()`, `videoUrl()`, `transcriptUrl()` |
| 2 | `packages/search/src/schemas.ts` | **EDIT** — remove `thumbnailUrl` and `videoUrl` from `SourceSchema` |
| 3 | `packages/search/src/archivist.ts` | **EDIT** — remove URL construction in `buildSources()`, delete `buildThumbnailUrl()` method |
| 4 | `packages/ui/src/components/VideoCard.tsx` | **EDIT** — import utility, replace `source.thumbnailUrl` |
| 5 | `packages/ui/src/components/SourceCard.tsx` | **EDIT** — import utility, replace `source.thumbnailUrl` |
| 6 | `packages/ui/src/components/VideoModal.tsx` | **EDIT** — import utility, replace inline transcript/video URL construction |

---

## Verification

After all changes, run from the `hop-hv-rag` project root:

```bash
bun run typecheck
```

This validates all packages in the monorepo. The type checker will catch any remaining references to the removed `thumbnailUrl` or `videoUrl` fields on the `Source` type.

### Manual testing

1. Start the server: `bun run search:serve`
2. Open the UI and run a query
3. Verify thumbnails load in the source cards (check browser DevTools Network tab — requests should go to `/thumbnails/<basename>/<padded>.jpg`)
4. Click a card to open the video modal — verify video loads and starts at the correct timestamp
5. Verify subtitles/transcript track loads in the video player

---

## Notes

- **No database changes** — this is purely an API response shape change and UI refactoring
- **No server endpoint changes** — the `/thumbnails/*`, `/videos/:filename`, and `/transcripts/:filename` routes remain unchanged
- **The `formatContextForLLM` method in `archivist.ts` is unaffected** — it uses `s.video.filename` and `s.timestamp.formatted`, not the removed URL fields
- **The `HybridResult` and `ChunkResult` types in `types.ts` are unaffected** — they don't carry URL fields
- **ESM imports** — per project convention, use extensioned imports (e.g., `'../utils/mediaUrls.ts'`)

---

## Resume Instructions

To implement this feature in a new session:

1. Read this plan document and `AGENTS.md` for project conventions
2. Implement steps 1-6 in order (Step 1 creates the utility that later steps depend on)
3. Run `bun run typecheck` from `projects/hop-hv-rag/`
4. Fix any type errors (most likely: a missed reference to `thumbnailUrl` or `videoUrl` on the `Source` type)
5. Rebuild UI: `bun run build` from `packages/ui/`
6. Manual smoke test with `bun run search:serve`
