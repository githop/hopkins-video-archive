import { Hono } from 'hono';
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

// Serve thumbnail images manually for better control
const DATA_DIR = join(import.meta.dir, '../../../data');
const THUMBNAILS_DIR = join(DATA_DIR, 'thumbnails');

app.get('/thumbnails/*', async (c) => {
  const path = c.req.path.replace('/thumbnails/', '');

  // Security: Prevent directory traversal
  if (path.includes('..')) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const filePath = join(THUMBNAILS_DIR, path);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return c.json({ error: 'Thumbnail not found' }, 404);
  }

  return c.newResponse(file.stream(), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

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

const port = 3200;
console.log(`Search server running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
