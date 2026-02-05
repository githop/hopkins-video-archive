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
