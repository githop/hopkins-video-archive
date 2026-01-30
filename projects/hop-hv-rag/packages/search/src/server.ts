import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { FamilyArchivist } from './archivist.ts';
import { createStreamResponse } from './stream-utils.ts';
import { getGenModel, getEmbedModel, getRerankModel } from '@hop-hv-rag/ai';
import { createDb } from '@hop-hv-rag/db';
import {
  ParticipantService,
  LocationService,
  ActivityService,
  logger,
} from '@hop-hv-rag/core';
import { join } from 'node:path';
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

// Initialize services and database with explicit paths
const dbPath = join(DATA_DIR, 'hv-rag.db');
const participantPath = join(DATA_DIR, 'participant-registry.json');
const locationPath = join(DATA_DIR, 'location-registry.json');
const activityPath = join(DATA_DIR, 'activity-registry.json');

const db = createDb(dbPath);
const participantService = new ParticipantService(participantPath);
const locationService = new LocationService(locationPath);
const activityService = new ActivityService(activityPath);

// Serve thumbnail images using Hono's serveStatic for Bun

const archivist = new FamilyArchivist(
  getGenModel('summarizer'),
  getEmbedModel('embed-small'),
  getRerankModel('rerank'),
  db,
  participantService,
  locationService,
  activityService,
);

// Initialize archivist (loads registries)
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
