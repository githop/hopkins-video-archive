import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { FamilyArchivist } from './rag-query.ts';
import { createStreamResponse } from './stream-utils.ts';
import { getGenModel, getEmbedModel, getRerankModel } from '@hop-hv-rag/ai';

const app = new Hono();

// Enable CORS for the UI
app.use('/*', cors());

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
