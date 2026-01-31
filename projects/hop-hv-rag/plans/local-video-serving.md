# Local Video Serving Implementation Plan

**Status:** Ready to implement  
**Priority:** High  
**Estimated Effort:** 2-3 hours  
**Created:** 2026-01-30

---

## Overview

Enable local video streaming with timestamp support. Clicking "Watch Scene" will open a modal with an HTML5 video player that starts at the scene's timestamp.

## Current State

- **184 videos** available locally in `../whisper-project/videos/`
- **Total size:** 114GB
- All video files are `.m4v` or `.mp4` format
- Database has `filename` but no `local_path` column
- UI currently has no video playback capability

## Desired Behavior

1. **Modal Player:** Clicking "Watch Scene" opens a modal with video player
2. **Timestamp Start:** Video auto-starts at scene timestamp (`#t=95` format)
3. **Play to End:** No auto-pause, plays from scene start to video end
4. **Unavailable Handling:** Videos without local files show "Video unavailable" or hide the watch button
5. **Efficient Streaming:** HTTP range requests enable seeking without full download

---

## Implementation Steps

### Step 1: Database Migration

**File:** `packages/db/src/schema.ts`

Add `local_path` column to videos table:

```typescript
export const videos = sqliteTable('videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filename: text('filename').notNull(),
  localPath: text('local_path'), // NEW: Absolute or relative path
  title: text('title'),
  // ... rest of columns
});
```

**Migration SQL:**

```sql
ALTER TABLE videos ADD COLUMN local_path TEXT;
UPDATE videos SET local_path = '../whisper-project/videos/' || filename
WHERE EXISTS (
  SELECT 1 FROM (
    SELECT '1984-1985.m4v' as fn UNION ALL
    -- ... list all 184 filenames
  ) AS local_files
  WHERE local_files.fn = videos.filename
);
```

### Step 2: Video Streaming Endpoint

**File:** `packages/search/src/server.ts`

Add video serving route with HTTP range request support:

```typescript
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';

// After thumbnails route (line ~111)
const VIDEO_DIR = '../whisper-project/videos'; // Will be CLI configurable

app.get('/videos/:filename', async (c) => {
  const filename = c.req.param('filename');
  const videoPath = join(VIDEO_DIR, filename);

  // Verify file exists
  try {
    const stats = statSync(videoPath);
    const fileSize = stats.size;
    const range = c.req.header('range');

    // Determine MIME type
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'mp4' ? 'video/mp4' : 'video/x-m4v';

    if (range) {
      // Parse range header
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = createReadStream(videoPath, { start, end });

      c.res.headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      c.res.headers.set('Accept-Ranges', 'bytes');
      c.res.headers.set('Content-Length', String(chunkSize));
      c.res.headers.set('Content-Type', mimeType);
      c.status(206);

      return stream;
    } else {
      // Full file (or browser will request ranges anyway)
      const stream = createReadStream(videoPath);
      c.res.headers.set('Content-Type', mimeType);
      c.res.headers.set('Accept-Ranges', 'bytes');
      c.res.headers.set('Content-Length', String(fileSize));
      return stream;
    }
  } catch (error) {
    return c.json({ error: 'Video not found' }, 404);
  }
});
```

### Step 3: Update Source Schema

**File:** `packages/search/src/schemas.ts`

Add video URL fields to Source schema:

```typescript
export const SourceSchema = z.object({
  sceneId: z.number(),
  citationId: z.number(),
  sceneTitle: z.string().nullable(),
  summary: z.string(),
  thumbnailUrl: z.string(),
  video: z.object({
    id: z.number(),
    title: z.string().nullable(),
    year: z.number().nullable(),
    yearStart: z.number().nullable().optional(),
    yearEnd: z.number().nullable().optional(),
    filename: z.string(),
    videoUrl: z.string(), // NEW: /videos/filename.m4v#t=95
    hasLocalFile: z.boolean(), // NEW: true if local file exists
  }),
  timestamp: z.object({
    startSeconds: z.number(),
    endSeconds: z.number(),
    formatted: z.string(),
  }),
  participants: z.array(PersonSchema),
  locations: z.array(LocationSchema),
  activities: z.array(ActivitySchema),
});
```

### Step 4: Update RAG Types (Remove Drive References)

**Files:**

- `packages/search/src/types.ts`
- `packages/search/src/archivist.ts` (formatContextForLLM method)

Update types to use `filename` instead of `driveId`:

```typescript
// In types.ts - Update HybridResult
export interface HybridResult extends Scene {
  videoTitle: string;
  videoYear: number;
  videoYearStart: number | null;
  videoYearEnd: number | null;
  videoParticipants: string;
  videoLocations: string;
  videoFilename: string; // NEW: replaces videoDriveFileId
  canonicalParticipants?: string;
  canonicalLocations?: string;
  score?: number;
}

// In types.ts - Update SceneResult
export interface SceneResult {
  id: number;
  title: string | null;
  videoTitle: string;
  videoYear: number | null;
  filename: string; // NEW: replaces driveId
  startTime: number;
  timestampLabel: string;
  summary: string;
}
```

Update the LLM context format in archivist.ts (line ~210):

```typescript
// OLD (remove):
`DRIVE_ID: ${s.video.driveId}`,

// NEW:
`FILENAME: ${s.video.filename}`,
`TIMESTAMP: ${s.timestamp.formatted}`,
```

The system prompt doesn't need changes - it focuses on answering questions, not video playback.

### Step 5: Update Archivist to Build Video URLs

**File:** `packages/search/src/archivist.ts`

Locate where `Source` objects are constructed (around search results) and update:

```typescript
// In the function that builds Source objects (likely in query() or search methods)
const buildVideoUrl = (filename: string, startSeconds: number): string => {
  return `/videos/${filename}#t=${Math.floor(startSeconds)}`;
};

// When constructing Source:
video: {
  id: video.id,
  title: video.title,
  year: video.year,
  yearStart: video.yearStart,
  yearEnd: video.yearEnd,
  filename: video.filename,
  videoUrl: buildVideoUrl(video.filename, scene.startTime),
  hasLocalFile: !!video.localPath,
}
```

### Step 6: Create VideoModal Component

**New File:** `packages/ui/src/components/VideoModal.tsx`

```tsx
import { useEffect, useRef } from 'react';
import type { Source } from '@hop-hv-rag/search';

interface VideoModalProps {
  source: Source | null;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoModal({ source, isOpen, onClose }: VideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isOpen && videoRef.current && source) {
      // Ensure video starts at correct time when modal opens
      videoRef.current.currentTime = source.timestamp.startSeconds;
      videoRef.current.play().catch(() => {
        // Auto-play might be blocked, user can click play
      });
    }
  }, [isOpen, source]);

  if (!isOpen || !source) return null;

  const { video, timestamp, sceneTitle } = source;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl mx-4 bg-black rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 bg-gray-900">
          <div>
            <h3 className="text-white font-medium">
              {sceneTitle || video.title}
            </h3>
            <p className="text-gray-400 text-sm">
              Starting at {timestamp.formatted}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Video Player */}
        <div className="relative aspect-video">
          {video.hasLocalFile ? (
            <video
              ref={videoRef}
              src={video.videoUrl}
              controls
              className="w-full h-full"
              playsInline
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full bg-gray-800 text-white">
              <p className="text-lg">Video file not available</p>
              <p className="text-sm text-gray-400 mt-2">{video.filename}</p>
            </div>
          )}
        </div>

        {/* Scene Info */}
        <div className="p-4 bg-gray-900 text-gray-300 text-sm">
          <p>{source.summary}</p>
        </div>
      </div>
    </div>
  );
}
```

### Step 7: Update UI Card Components

**Files:**

- `packages/ui/src/components/VideoCard.tsx`
- `packages/ui/src/components/SceneCard.tsx`
- `packages/ui/src/components/SourceCard.tsx`

Each card needs:

1. State to control modal open/close
2. Click handler to open modal with the source
3. VideoModal component imported and rendered

Example for `VideoCard.tsx`:

```tsx
import { useState } from 'react';
import { VideoModal } from './VideoModal';

export function VideoCard({ source, isUsed }: VideoCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Only show watch button if video has local file
  const canWatch = source.video.hasLocalFile;

  return (
    <>
      <div className="...">
        {/* ... existing card content ... */}

        {canWatch ? (
          <button onClick={() => setIsModalOpen(true)} className="...">
            Watch Scene
          </button>
        ) : (
          <span className="text-gray-400 text-sm">Video unavailable</span>
        )}
      </div>

      <VideoModal
        source={source}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
```

### Step 8: Add CLI Flag for Video Directory

**File:** `packages/search/src/server.ts`

Add CLI option (similar to existing `--data`, `--ui` flags):

```typescript
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: 'string', short: 'p', default: '3200' },
    data: { type: 'string', short: 'd', default: join(PROJECT_ROOT, 'data') },
    ui: {
      type: 'string',
      short: 'u',
      default: join(PROJECT_ROOT, 'packages/ui/dist'),
    },
    videoDir: {
      // NEW
      type: 'string',
      default: '../whisper-project/videos',
    },
    ...parseArgsModelOptions,
  },
  strict: false,
});

const VIDEO_DIR =
  typeof values.videoDir === 'string'
    ? values.videoDir
    : '../whisper-project/videos';
```

---

## Files to Modify

1. ✅ `packages/db/src/schema.ts` - Add `local_path` column
2. ✅ `packages/search/src/server.ts` - Add video endpoint + CLI flag
3. ✅ `packages/search/src/schemas.ts` - Add `videoUrl` and `hasLocalFile` to Source
4. ✅ `packages/search/src/types.ts` - Replace `driveId` with `filename` in types
5. ✅ `packages/search/src/archivist.ts` - Update LLM context format + build URLs
6. ✅ `packages/ui/src/components/VideoModal.tsx` - New component (create)
7. ✅ `packages/ui/src/components/VideoCard.tsx` - Use modal
8. ✅ `packages/ui/src/components/SceneCard.tsx` - Use modal
9. ✅ `packages/ui/src/components/SourceCard.tsx` - Use modal

---

## Testing Checklist

- [ ] Database migration runs without errors
- [ ] Server starts with `--video-dir` flag
- [ ] Video endpoint returns 206 Partial Content with Range header
- [ ] Video endpoint returns full file without Range header
- [ ] Archivist generates correct URLs: `/videos/filename.m4v#t=XX`
- [ ] LLM context shows `FILENAME:` instead of `DRIVE_ID:` in source context
- [ ] Modal opens when clicking "Watch Scene"
- [ ] Video starts at correct timestamp
- [ ] Video plays without downloading entire file (check Network tab)
- [ ] Videos without local files show "Video unavailable" (no watch button)
- [ ] Modal closes with X button and outside click
- [ ] All three card components (VideoCard, SceneCard, SourceCard) updated

---

## Migration Script

Create a one-time migration to populate `local_path`:

```bash
# Check which videos exist locally
sqlite3 data/hv-rag.db "SELECT filename FROM videos;" > /tmp/db_files.txt
ls ../whisper-project/videos/ > /tmp/local_files.txt

# Create update statements
while read filename; do
  if [ -f "../whisper-project/videos/$filename" ]; then
    echo "UPDATE videos SET local_path = '../whisper-project/videos/$filename' WHERE filename = '$filename';"
  fi
done < /tmp/db_files.txt > /tmp/update_paths.sql

# Run updates
sqlite3 data/hv-rag.db < /tmp/update_paths.sql
```

---

## Notes

- **MIME Types:** `.m4v` files should use `video/x-m4v` or `video/mp4`. Most browsers handle `video/mp4` for both.
- **CORS:** The video endpoint needs proper CORS headers for cross-origin requests (already set in server).
- **Performance:** With range requests, only ~2-8MB chunks download at a time. 114GB total won't impact server memory.
- **Security:** The video endpoint should validate filenames to prevent directory traversal (`../etc/passwd`). Use `path.basename()` or similar.
- **Unavailable Videos:** Videos without `local_path` will show as unavailable. Users can still see scene info and thumbnails.
- **RAG Prompts:** The LLM context format changes from `DRIVE_ID:` to `FILENAME:` - this doesn't affect the LLM's ability to answer questions, just changes the metadata format provided to it.

---

## Resume Instructions

To resume this implementation:

1. Read this plan document
2. Start with Step 1 (database migration)
3. Test each step before moving to next
4. Run final testing checklist
5. Update AGENTS.md with new `--video-dir` option documentation

**Key files to reference:**

- Current schema: `packages/db/src/schema.ts`
- Current server: `packages/search/src/server.ts`
- Current Source type: `packages/search/src/schemas.ts`

**Questions to resolve:**

- Should we use absolute paths or relative paths in `local_path`?
- Do we need video transcoding for better browser compatibility?
- Should we cache video metadata (duration, dimensions)?
