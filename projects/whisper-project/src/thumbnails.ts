/**
 * Thumbnail Generation Script
 *
 * Extracts chunk-level thumbnails from video files using FFmpeg.
 * Queries hop-hv-rag database for chunk timestamps and generates thumbnails
 * at the midpoint of each chunk, named by the chunk start time.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { CONFIG } from "./config";
import { FFMPEG } from "./ffmpeg";
import { Logger } from "./logger";

interface ChunkRow {
  chunk_id: number;
  video_id: number;
  video_filename: string;
  start_time: number;
  end_time: number;
}

/**
 * Get timestamp for thumbnail (middle of scene)
 */
function getThumbnailTimestamp(startTime: number, endTime: number): number {
  return (startTime + endTime) / 2;
}

/**
 * Generate thumbnail output path and directory structure
 * Filename uses chunk start time for stable, regenerable naming
 */
function getThumbnailPath(
  videoFilename: string,
  chunkStartTime: number,
): { dir: string; fullPath: string } {
  const videoBase = videoFilename.replace(/\.[^/.]+$/, '');
  const timestampStr = String(Math.floor(chunkStartTime)).padStart(5, "0");

  const dir = join(CONFIG.THUMBNAILS_DIR, videoBase);
  const filename = `${timestampStr}.jpg`;
  const fullPath = join(dir, filename);

  return { dir, fullPath };
}

/**
 * Query all chunks that need thumbnails
 */
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

/**
 * Check if a thumbnail already exists
 */
async function thumbnailExists(path: string): Promise<boolean> {
  const file = Bun.file(path);
  return await file.exists();
}

/**
 * Main thumbnail generation function
 */
export async function generateThumbnails(options: {
  dryRun?: boolean;
  videoFilter?: string;
  concurrency?: number;
}) {
  const { dryRun = false, videoFilter, concurrency = 4 } = options;

  Logger.info("Starting thumbnail generation...");

  // Ensure thumbnails directory exists
  if (!dryRun) {
    await mkdir(CONFIG.THUMBNAILS_DIR, { recursive: true });
  }

  // Connect to database (read-only for querying chunk data)
  const db = new Database(CONFIG.HV_RAG_DB, { readonly: true });
  const chunks = getChunks(db);

  Logger.info(
    `Found ${chunks.length} chunks across ${new Set(chunks.map((c) => c.video_id)).size} videos`,
  );

  // Filter chunks by video if requested
  let filtered = chunks;
  if (videoFilter) {
    filtered = chunks.filter((c) =>
      c.video_filename.includes(videoFilter),
    );
    Logger.info(
      `Filtered to ${filtered.length} chunks matching "${videoFilter}"`,
    );
  }

  // Track progress
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  // Process in batches based on concurrency
  const semaphore = new Semaphore(concurrency);

  await Promise.all(
    filtered.map(async (chunk) => {
      await semaphore.acquire();

      try {
        const videoPath = join(CONFIG.VIDEOS_DIR, chunk.video_filename);

        // Check if video file exists
        const videoFile = Bun.file(videoPath);
        if (!(await videoFile.exists())) {
          Logger.warn(
            `Video file not found: ${videoPath} (skipping chunk ${chunk.chunk_id})`,
          );
          skipped++;
          return;
        }

        // Extract frame at midpoint, name file by start time
        const timestamp = getThumbnailTimestamp(
          chunk.start_time,
          chunk.end_time,
        );
        const { dir, fullPath } = getThumbnailPath(
          chunk.video_filename,
          chunk.start_time,
        );

        // Skip if thumbnail already exists
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

        // Create output directory
        await mkdir(dir, { recursive: true });

        // Extract thumbnail
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

  db.close();

  Logger.info(`
Thumbnail generation complete:
  - Processed: ${processed}
  - Skipped (existing): ${skipped}
  - Failed: ${failed}
  - Total: ${processed + skipped + failed}
  `);
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.permits++;
    }
  }
}

/**
 * CLI entry point
 */
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const videoFilter = args.find((a) => a.startsWith("--video="))?.split("=")[1];
  const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg
    ? parseInt(concurrencyArg.split("=")[1] ?? "4")
    : 4;

  // Validate concurrency
  if (isNaN(concurrency) || concurrency < 1 || concurrency > 16) {
    Logger.error("Invalid concurrency. Must be between 1 and 16.");
    process.exit(1);
  }

  generateThumbnails({ dryRun, videoFilter, concurrency }).catch((error) => {
    Logger.error(`Thumbnail generation failed: ${error}`);
    process.exit(1);
  });
}
