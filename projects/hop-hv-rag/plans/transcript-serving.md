# VTT Transcript Serving Implementation Plan

**Status:** Ready to implement  
**Priority:** Medium  
**Estimated Effort:** 20 minutes  
**Depends on:** Local video serving (already implemented)

---

## Overview

Serve VTT transcript files alongside videos to enable live subtitles in the video player. Uses existing naming convention where transcript filename matches video filename.

## Current State

- **184 VTT files** in `../whisper-project/transcripts/`
- **Naming convention:** `{video-filename-base}.vtt` (e.g., `1984-1985.m4v` → `1984-1985.vtt`)
- Video serving already implemented with modal player

## Desired Behavior

1. **Transcript endpoint:** Serve VTT files at `/transcripts/:filename`
2. **Live subtitles:** Display synchronized captions in video player
3. **Fallback:** Videos without transcripts play normally (no subtitle track)
4. **Same CLI flag:** Use `--video-dir` to derive transcript path

---

## Implementation Steps

### Step 1: Server Endpoint

**File:** `packages/search/src/server.ts`

Add transcript serving route (simpler than video - no range requests):

```typescript
const TRANSCRIPTS_DIR = join(VIDEO_DIR, '..', 'transcripts');

app.get('/transcripts/:filename', async (c) => {
  const filename = basename(c.req.param('filename'));
  const transcriptPath = join(TRANSCRIPTS_DIR, filename);

  logger.debug({ filename, transcriptPath }, 'Transcript request');

  try {
    const file = Bun.file(transcriptPath);

    if (!(await file.exists())) {
      return c.json({ error: 'Transcript not found' }, 404);
    }

    return new Response(file, {
      headers: {
        'Content-Type': 'text/vtt',
        'Cache-Control': 'public, max-age=86400', // 24 hour cache
      },
    });
  } catch (error) {
    logger.warn({ filename, error }, 'Transcript not found');
    return c.json({ error: 'Transcript not found' }, 404);
  }
});
```

### Step 2: Update Source Schema

**File:** `packages/search/src/schemas.ts`

Add transcript fields to video object:

```typescript
video: z.object({
  id: z.number(),
  title: z.string().nullable(),
  year: z.number().nullable(),
  yearStart: z.number().nullable().optional(),
  yearEnd: z.number().nullable().optional(),
  filename: z.string(),
  videoUrl: z.string(),
  hasLocalFile: z.boolean(),
  transcriptUrl: z.string().optional(), // NEW: /transcripts/filename.vtt
  hasTranscript: z.boolean().optional(), // NEW: derived from filename
}),
```

### Step 3: Update Archivist

**File:** `packages/search/src/archivist.ts`

In `buildSources()` method, derive transcript URL from filename:

```typescript
// Derive transcript filename from video filename
const baseFilename = r.videoFilename.replace(/\.[^/.]+$/, '');
const transcriptFilename = `${baseFilename}.vtt`;
const transcriptUrl = `/transcripts/${transcriptFilename}`;

// Assume transcript exists (file check happens at request time)
const hasTranscript = true;

// When constructing Source:
video: {
  id: r.videoId,
  title: r.videoTitle,
  year: r.videoYear,
  yearStart: r.videoYearStart,
  yearEnd: r.videoYearEnd,
  filename: r.videoFilename,
  videoUrl,
  hasLocalFile,
  transcriptUrl,
  hasTranscript,
}
```

### Step 4: Update VideoModal

**File:** `packages/ui/src/components/VideoModal.tsx`

Add `<track>` element for subtitles:

```tsx
{
  video.hasLocalFile && (
    <video
      ref={videoRef}
      src={video.videoUrl}
      controls
      className="w-full h-full"
      playsInline
    >
      {video.hasTranscript && video.transcriptUrl && (
        <track
          kind="subtitles"
          src={video.transcriptUrl}
          default
          label="English"
        />
      )}
    </video>
  );
}
```

Add CSS styling for subtitles (optional):

```css
video::cue {
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  font-size: 16px;
  padding: 4px 8px;
}
```

---

## Files to Modify

1. ✅ `packages/search/src/server.ts` - Add `/transcripts/:filename` endpoint
2. ✅ `packages/search/src/schemas.ts` - Add `transcriptUrl` and `hasTranscript` to Source
3. ✅ `packages/search/src/archivist.ts` - Build transcript URLs from filenames
4. ✅ `packages/ui/src/components/VideoModal.tsx` - Add `<track>` element for subtitles

---

## Testing Checklist

- [ ] Server serves VTT files with correct MIME type
- [ ] Transcript endpoint returns 404 for missing files
- [ ] Archivist generates correct transcript URLs
- [ ] Video player displays subtitle track
- [ ] Subtitles sync correctly with video
- [ ] Videos without transcripts play normally
- [ ] Browser DevTools Network tab shows VTT requests

---

## Notes

- **No database migration needed** - transcript URLs are derived from video filenames at runtime
- **Naming convention:** Transcript filename = video filename base + `.vtt`
- **Performance:** VTT files are small text files, no range request needed
- **Format:** VTT is web-native and works with HTML5 video `<track>` element

---

## Resume Instructions

To implement this feature:

1. Read this plan document
2. Implement Step 1 (server endpoint)
3. Implement Step 2 (schema update)
4. Implement Step 3 (archivist update)
5. Implement Step 4 (VideoModal update)
6. Run testing checklist
7. Rebuild UI: `cd packages/ui && bun run build`
8. Restart server and test with a video
