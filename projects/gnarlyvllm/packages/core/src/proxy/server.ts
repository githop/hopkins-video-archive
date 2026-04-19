import { Hono } from 'hono';
import { logger } from 'hono/logger';

type RouteInfo = { port: number; task: string; repo: string };
const rawRoutes = Bun.env.GNARLY_ROUTES;

if (!rawRoutes) {
  console.error('Fatal: GNARLY_ROUTES missing');
  process.exit(1);
}

const routeMap: Record<string, RouteInfo> = JSON.parse(rawRoutes);
const app = new Hono();

app.use('*', logger());
app.get('/health', (c) => c.text('OK'));

app.get('/v1/models', (c) => {
  const models = Object.keys(routeMap).map((name) => ({
    id: name,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'gnarlyvllm',
  }));
  return c.json({ data: models, object: 'list' });
});

// Bridge Reranking: Cohere format -> vLLM /v1/score format
app.post('/v1/rerank', async (c) => {
  try {
    const body = (await c.req.json()) as any;
    const modelName = body.model;
    const route = routeMap[modelName];

    if (!route || route.task !== 'score') {
      return c.json({ error: `Rerank model '${modelName}' not found` }, 404);
    }

    const vllmBody = {
      model: route.repo,
      text_1: body.query,
      text_2: body.documents,
    };
    const res = await fetch(
      `http://host.containers.internal:${route.port}/v1/score`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vllmBody),
      },
    );

    if (!res.ok) return c.text(await res.text(), res.status as any);

    const data = (await res.json()) as any;
    const results = data.data.map((item: any, index: number) => ({
      index,
      relevance_score: item.score,
    }));

    return c.json({
      id: crypto.randomUUID(),
      results,
      meta: { api_version: { version: '1' } },
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Byte-Pipe Router (Chat, Embeddings)
app.all('/v1/*', async (c) => {
  try {
    let modelName: string | undefined;
    let proxyBody: ReadableStream | string | undefined = c.req.raw.body as any;
    const headers = new Headers(c.req.header());

    if (c.req.method === 'POST') {
      try {
        const clonedReq = c.req.raw.clone();
        const body = (await clonedReq.json()) as any;
        modelName = body.model;

        if (modelName && routeMap[modelName]) {
          body.model = routeMap[modelName].repo;
          proxyBody = JSON.stringify(body);
          headers.delete('content-length');
        }
      } catch {}
    }

    if (!modelName) return c.json({ error: "Missing 'model'" }, 400);

    const route = routeMap[modelName];
    if (!route) return c.json({ error: `Model '${modelName}' not found` }, 404);

    const path = new URL(c.req.url).pathname;
    const targetUrl = `http://host.containers.internal:${route.port}${path}`;

    const proxyReq = new Request(targetUrl, {
      method: c.req.method,
      headers: headers,
      body: proxyBody as any,
      // @ts-ignore
      duplex: 'half',
    });

    const response = await fetch(proxyReq);

    const newHeaders = new Headers(response.headers);
    newHeaders.delete('Transfer-Encoding');

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default {
  port: 4000,
  idleTimeout: 120, // Allow for long model warmup/inference
  fetch: app.fetch,
};
