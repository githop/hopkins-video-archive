import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { FamilyArchivist } from './rag-query.ts';
import { createStreamResponse } from './stream-utils.ts';
import { getGenModel, getEmbedModel, getRerankModel } from '@hop-hv-rag/ai';
import { join } from 'node:path';

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

// Serve thumbnail images using Hono's serveStatic for Bun
const DATA_DIR = join(import.meta.dir, '../../../data');
const THUMBNAILS_DIR = join(DATA_DIR, 'thumbnails');

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

const archivist = new FamilyArchivist(
  getGenModel('summarizer'),
  getEmbedModel('embed-small'),
  getRerankModel('rerank'),
);

// Initialize archivist (loads registries)
await archivist.init();

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

  console.log(`Received query: "${query}"`);

  const generator = archivist.query(query);
  return createStreamResponse(generator);
});

// Serve the compiled frontend
const UI_DIST = join(import.meta.dir, '../../ui/dist');
app.use('/*', serveStatic({ root: UI_DIST }));
app.get('*', serveStatic({ path: join(UI_DIST, 'index.html') }));

const port = 3200;
const hostname = '0.0.0.0';

export default {
  port,
  hostname,
  fetch: app.fetch,
};
