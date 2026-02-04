import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { FamilyArchivist } from './archivist.ts';
import { createStreamResponse } from './stream-utils.ts';
import {
  getGenModel,
  getEmbedModel,
  getRerankModel,
  resolveConfig,
  logModelConfig,
  parseArgsModelOptions,
  parseCliToModelConfig,
} from '@hop-hv-rag/ai';
import { createDb } from '@hop-hv-rag/db';
import { logger } from '@hop-hv-rag/core';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';

// Calculate project root (2 levels up from packages/search)
const PROJECT_ROOT = join(import.meta.dirname, '..', '..', '..');

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
      type: 'string',
      default: join(PROJECT_ROOT, '..', 'whisper-project', 'videos'),
    },
    transcriptsDir: {
      type: 'string',
      // default: sibling of videoDir/transcripts if not provided
    },
    ...parseArgsModelOptions,
  },
  strict: false,
});

// Extract values with proper types
const DATA_DIR =
  typeof values.data === 'string' ? values.data : join(process.cwd(), 'data');
const UI_DIST =
  typeof values.ui === 'string'
    ? values.ui
    : join(process.cwd(), 'projects/hop-hv-rag/packages/ui/dist');
const PORT = parseInt(
  typeof values.port === 'string' ? values.port : '3200',
  10,
);
const THUMBNAILS_DIR = join(DATA_DIR, 'thumbnails');
const VIDEO_DIR =
  typeof values.videoDir === 'string'
    ? values.videoDir
    : join(PROJECT_ROOT, '..', 'whisper-project', 'videos');

const TRANSCRIPTS_DIR =
  typeof values.transcriptsDir === 'string'
    ? values.transcriptsDir
    : join(VIDEO_DIR, '..', 'transcripts');

// Initialize services and database with explicit paths
const dbPath = join(DATA_DIR, 'hv-rag.db');
const db = createDb(dbPath);

// Resolve model configuration (Zod validates CLI args)
const modelConfig = resolveConfig(parseCliToModelConfig(values));
logModelConfig(modelConfig);

// Serve thumbnail images using Hono's serveStatic for Bun

const archivist = new FamilyArchivist(
  getGenModel(modelConfig.generation),
  getEmbedModel(modelConfig.embedding),
  getRerankModel(modelConfig.reranking),
  db,
);

// Initialize archivist (loads entity index)
await archivist.init();

const app = new Hono();

// Enable CORS for the UI - allow all origins for development
app.use(
  '/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

app.use('/thumbnails/*', async (c, next) => {
  await next();
  if (c.res.ok) {
    c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
});

app.get(
  '/thumbnails/*',
  serveStatic({
    root: THUMBNAILS_DIR,
    rewriteRequestPath: (path) => path.replace(/^\/thumbnails/, ''),
  }),
);

/**
 * Video streaming endpoint with HTTP range request support.
 * Enables efficient seeking and playback without full file download.
 */
app.get('/videos/:filename', async (c) => {
  const filename = basename(c.req.param('filename'));
  const videoPath = join(VIDEO_DIR, filename);

  logger.debug({ filename, videoPath }, 'Video request');

  const file = Bun.file(videoPath);

  if (!(await file.exists())) {
    logger.warn({ filename }, 'Video not found');
    return c.json({ error: 'Video not found' }, 404);
  }

  const fileSize = file.size;
  const range = c.req.header('range');

  // Determine MIME type based on extension
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeType = ext === 'mp4' ? 'video/mp4' : 'video/x-m4v';

  if (range) {
    // Parse range header for partial content
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    logger.debug({ filename, start, end, chunkSize }, 'Serving video range');

    // Use Bun's slice for efficient range serving
    const chunk = file.slice(start, end + 1);

    return new Response(chunk, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': mimeType,
      },
    });
  }

  // Full file request (browsers typically use ranges anyway)
  logger.debug({ filename, fileSize }, 'Serving full video');

  return new Response(file, {
    headers: {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(fileSize),
    },
  });
});

/**
 * Transcript serving endpoint for VTT subtitle files.
 */
app.get('/transcripts/:filename', async (c) => {
  const filename = basename(c.req.param('filename'));
  const transcriptPath = join(TRANSCRIPTS_DIR, filename);

  logger.debug({ filename, transcriptPath }, 'Transcript request');

  try {
    const file = Bun.file(transcriptPath);

    if (!(await file.exists())) {
      logger.warn({ filename }, 'Transcript not found');
      return c.json({ error: 'Transcript not found' }, 404);
    }

    return new Response(file, {
      headers: {
        'Content-Type': 'text/vtt',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    logger.warn({ filename, error }, 'Transcript error');
    return c.json({ error: 'Transcript not found' }, 404);
  }
});

/**
 * Unified query endpoint.
 * Accepts { query: string } and returns NDJSON stream of StreamChunks.
 */
app.post('/api/query', async (c) => {
  const body = await c.req.json();
  const { query } = body;

  if (!query || typeof query !== 'string') {
    return c.json({ error: 'Query is required' }, 400);
  }

  logger.info({ query }, 'Received query');

  const generator = archivist.query(query);
  return createStreamResponse(generator);
});

// Serve the compiled frontend
app.use('/*', serveStatic({ root: UI_DIST }));
app.get('*', serveStatic({ path: join(UI_DIST, 'index.html') }));

const hostname = '0.0.0.0';

export default {
  port: PORT,
  hostname,
  fetch: app.fetch,
};
