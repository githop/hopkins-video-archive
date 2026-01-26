import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { FamilyArchivist } from './rag-query.ts';
import { getGenModel, getEmbedModel } from '@hop-hv-rag/ai';

const app = new Hono();

// Enable CORS for the UI
app.use('/*', cors());

const archivist = new FamilyArchivist(
  getGenModel('summarizer'),
  getEmbedModel('embed-small'),
);

// Initialize archivist (loads registries)
await archivist.init();

app.post('/api/chat', async (c) => {
  const body = await c.req.json();
  console.log('Received body:', JSON.stringify(body, null, 2));
  const { messages } = body;

  try {
    const result = await archivist.streamAsk(messages);
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('Error in /api/chat:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

const port = 3200;
console.log(`🚀 Search server running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
