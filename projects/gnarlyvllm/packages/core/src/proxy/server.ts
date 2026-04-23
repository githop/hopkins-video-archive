import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Database } from 'bun:sqlite';
import { initDb, logProxyRequest, type LogContext } from './logger.ts';
import { createAdminRouter } from './admin/router.ts';

type RouteInfo = { port: number; task: string; repo: string };
const rawRoutes = Bun.env.GNARLY_ROUTES;

if (!rawRoutes) {
  console.error('Fatal: GNARLY_ROUTES missing');
  process.exit(1);
}

const routeMap: Record<string, RouteInfo> = JSON.parse(rawRoutes);

// Read logging configuration from environment
const logEnabled = Bun.env.GNARLY_LOG_ENABLED === 'true';
const logDbPath = Bun.env.GNARLY_LOG_DB_PATH;
const logCaptureBodies = Bun.env.GNARLY_LOG_CAPTURE_BODIES !== 'false';
const logSkipPaths = (Bun.env.GNARLY_LOG_SKIP_PATHS || '').split(',').filter(Boolean);

// Initialize logging if enabled
let db: Database | undefined;
let logContext: LogContext | undefined;

if (logEnabled && logDbPath) {
  try {
    db = await initDb(logDbPath);
    logContext = {
      db,
      captureBodies: logCaptureBodies,
      skipPaths: logSkipPaths,
    };
    console.log(`Proxy logging enabled: ${logDbPath}`);
    console.log(`Capture bodies: ${logCaptureBodies}, Skip paths: ${logSkipPaths.join(', ') || 'none'}`);
  } catch (e: any) {
    console.error('Failed to initialize proxy logging:', e.message);
    // Continue without logging
  }
}

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

// Mount admin router if logging is enabled
if (db) {
  const adminRouter = createAdminRouter(db);
  app.route('/admin', adminRouter);
}

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

    const vllmBodyStr = JSON.stringify(vllmBody);
    const targetUrl = `http://host.containers.internal:${route.port}/v1/score`;

    // If logging is enabled, use the logging wrapper
    if (logContext) {
      return await logProxyRequest(
        logContext,
        {
          method: 'POST',
          url: c.req.url,
          model: modelName,
          requestBody: JSON.stringify(body),
          upstreamFetch: async () => {
            const res = await fetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: vllmBodyStr,
            });

            if (!res.ok) {
              const text = await res.text();
              return new Response(text, { status: res.status, headers: res.headers });
            }

            // Transform the response
            const data = (await res.json()) as any;
            const results = data.data.map((item: any, index: number) => ({
              index,
              relevance_score: item.score,
            }));

            const transformedBody = JSON.stringify({
              id: crypto.randomUUID(),
              results,
              meta: { api_version: { version: '1' } },
            });

            return new Response(transformedBody, {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        }
      );
    }

    // Non-logging path (original behavior)
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: vllmBodyStr,
    });

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
    let requestBodyStr: string | undefined;

    if (c.req.method === 'POST') {
      try {
        const clonedReq = c.req.raw.clone();
        const body = (await clonedReq.json()) as any;
        modelName = body.model;

        if (modelName && routeMap[modelName]) {
          body.model = routeMap[modelName].repo;
          requestBodyStr = JSON.stringify(body);
          proxyBody = requestBodyStr;
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

    // If logging is enabled, use the logging wrapper
    if (logContext) {
      return await logProxyRequest(
        logContext,
        {
          method: c.req.method,
          url: c.req.url,
          model: modelName,
          requestBody: requestBodyStr,
          upstreamFetch: () => fetch(proxyReq),
        }
      );
    }

    // Non-logging path (original behavior)
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

// Server configuration - bind to all interfaces by default for network access
// Can be overridden via GNARLY_HOSTNAME env var (e.g., '127.0.0.1' for localhost only)
const hostname = Bun.env.GNARLY_HOSTNAME || '0.0.0.0';

export default {
  port: 4000,
  hostname,
  idleTimeout: 120, // Allow for long model warmup/inference
  fetch: app.fetch,
};
