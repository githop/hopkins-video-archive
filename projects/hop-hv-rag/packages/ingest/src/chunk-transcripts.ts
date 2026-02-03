import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import {
  createDb,
  videos,
  transcripts,
  chunks,
  chunkSummaries,
  chunkEntityMentions,
  chunkEntities,
  videoEntities,
  type Transcript,
  type Video,
} from '@hop-hv-rag/db';
import { logger } from '@hop-hv-rag/core';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

const DEFAULTS = {
  targetDurationSec: 120,
  maxDurationSec: 180,
  minDurationSec: 45,
  overlapSec: 15,
  maxWords: 350,
  gapSec: 4,
};

interface ChunkPlan {
  startTime: number;
  endTime: number;
  text: string;
  wordCount: number;
  segments: Transcript[];
}

interface ChunkingOptions {
  targetDurationSec: number;
  maxDurationSec: number;
  minDurationSec: number;
  overlapSec: number;
  maxWords: number;
  gapSec: number;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function endsSentence(text: string): boolean {
  return /[.!?]\s*$/.test(text.trim());
}

function formatChunkText(segments: Transcript[]): string {
  return segments
    .map((segment) => `[${segment.startTime.toFixed(2)}s] ${segment.text}`)
    .join('\n');
}

function buildChunks(
  segments: Transcript[],
  options: ChunkingOptions,
): ChunkPlan[] {
  const plans: ChunkPlan[] = [];
  if (segments.length === 0) return plans;

  let index = 0;

  while (index < segments.length) {
    const startIndex = index;
    const startTime = segments[startIndex].startTime;
    let wordCount = 0;
    let lastBoundaryIndex = -1;
    let lastBoundaryDuration = 0;

    let cutIndex = startIndex;

    for (let i = startIndex; i < segments.length; i++) {
      const segment = segments[i];
      const next = segments[i + 1];
      wordCount += countWords(segment.text);

      const endTime = segment.endTime;
      const duration = endTime - startTime;
      const gapBoundary =
        next !== undefined &&
        next.startTime - segment.endTime >= options.gapSec;
      const sentenceBoundary = endsSentence(segment.text);

      if (gapBoundary || sentenceBoundary) {
        lastBoundaryIndex = i;
        lastBoundaryDuration = duration;
      }

      const maxReached =
        duration >= options.maxDurationSec || wordCount >= options.maxWords;
      const targetReached = duration >= options.targetDurationSec;
      const boundaryReady =
        lastBoundaryIndex >= startIndex &&
        lastBoundaryDuration >= options.minDurationSec;

      if (maxReached) {
        cutIndex = boundaryReady ? lastBoundaryIndex : i;
        break;
      }

      if (targetReached && boundaryReady) {
        cutIndex = lastBoundaryIndex;
        break;
      }

      cutIndex = i;
    }

    const selectedSegments = segments.slice(startIndex, cutIndex + 1);
    const chunkStartTime = selectedSegments[0]?.startTime ?? startTime;
    const chunkEndTime =
      selectedSegments[selectedSegments.length - 1]?.endTime ?? startTime;
    const chunkWordCount = selectedSegments.reduce(
      (sum, seg) => sum + countWords(seg.text),
      0,
    );

    plans.push({
      startTime: chunkStartTime,
      endTime: chunkEndTime,
      text: formatChunkText(selectedSegments),
      wordCount: chunkWordCount,
      segments: selectedSegments,
    });

    let nextIndex = cutIndex + 1;

    if (options.overlapSec > 0) {
      const overlapStart = chunkEndTime - options.overlapSec;
      const overlapIndex = segments.findIndex(
        (seg, idx) => idx > startIndex && seg.startTime >= overlapStart,
      );
      if (overlapIndex !== -1) {
        nextIndex = overlapIndex;
      }
    }

    if (nextIndex <= startIndex) {
      nextIndex = startIndex + 1;
    }

    index = nextIndex;
  }

  return plans;
}

async function hashText(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

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

  await db
    .delete(chunkEntities)
    .where(inArray(chunkEntities.chunkId, chunkIds));
  await db
    .delete(chunkEntityMentions)
    .where(inArray(chunkEntityMentions.chunkId, chunkIds));
  await db
    .delete(chunkSummaries)
    .where(inArray(chunkSummaries.chunkId, chunkIds));
  await db.delete(chunks).where(eq(chunks.videoId, video.id));
  await db.delete(videoEntities).where(eq(videoEntities.videoId, video.id));

  logger.info(
    { videoId: video.id, chunkCount: chunkIds.length },
    'Deleted existing chunks for video',
  );
}

async function processVideo(
  db: ReturnType<typeof createDb>,
  video: Video,
  options: ChunkingOptions & { force: boolean },
) {
  if (options.force) {
    await deleteVideoChunks(db, video);
  }

  const segments = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.videoId, video.id))
    .orderBy(transcripts.startTime);

  if (segments.length === 0) {
    logger.warn({ videoId: video.id }, 'No transcript segments found');
    return;
  }

  const plans = buildChunks(segments, options);

  const existingHashes = await db
    .select({ chunkHash: chunks.chunkHash })
    .from(chunks)
    .where(eq(chunks.videoId, video.id));

  const existingHashSet = new Set(existingHashes.map((row) => row.chunkHash));

  let inserted = 0;
  let previousChunkId: number | null = null;
  let previousChunkEnd: number | null = null;

  for (const plan of plans) {
    const hashInput = [
      `video:${video.id}`,
      ...plan.segments.map(
        (seg) =>
          `${seg.id}:${seg.startTime.toFixed(2)}-${seg.endTime.toFixed(2)}`,
      ),
    ].join('|');
    const chunkHash = await hashText(hashInput);

    if (existingHashSet.has(chunkHash)) {
      continue;
    }

    const overlapFromChunkId: number | null =
      previousChunkId && previousChunkEnd && plan.startTime < previousChunkEnd
        ? previousChunkId
        : null;

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

    previousChunkId = chunkRow.id;
    previousChunkEnd = plan.endTime;
    inserted++;
  }

  logger.info(
    {
      videoId: video.id,
      filename: video.filename,
      planned: plans.length,
      inserted,
    },
    'Chunked video',
  );
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      target: { type: 'string', default: String(DEFAULTS.targetDurationSec) },
      max: { type: 'string', default: String(DEFAULTS.maxDurationSec) },
      min: { type: 'string', default: String(DEFAULTS.minDurationSec) },
      overlap: { type: 'string', default: String(DEFAULTS.overlapSec) },
      maxWords: { type: 'string', default: String(DEFAULTS.maxWords) },
      gap: { type: 'string', default: String(DEFAULTS.gapSec) },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);

  let targetVideos: Video[] = [];
  if (values.file) {
    targetVideos = await db
      .select()
      .from(videos)
      .where(eq(videos.filename, values.file));
  } else if (values.all) {
    targetVideos = await db.select().from(videos);
  } else {
    logger.error(
      'Usage: bun run ingest:chunk --file <filename> | --all [--force] [--overlap 15] [--target 120] [--max 180] [--min 45] [--maxWords 350] [--gap 4]',
    );
    process.exit(1);
  }

  const options: ChunkingOptions & { force: boolean } = {
    targetDurationSec: parseInt(String(values.target), 10),
    maxDurationSec: parseInt(String(values.max), 10),
    minDurationSec: parseInt(String(values.min), 10),
    overlapSec: parseInt(String(values.overlap), 10),
    maxWords: parseInt(String(values.maxWords), 10),
    gapSec: parseInt(String(values.gap), 10),
    force: values.force ?? false,
  };

  logger.info(
    {
      videoCount: targetVideos.length,
      options,
    },
    'Starting transcript chunking',
  );

  for (const video of targetVideos) {
    await processVideo(db, video, options);
  }

  logger.info('Chunking complete');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'Chunking failed');
    process.exit(1);
  });
}
