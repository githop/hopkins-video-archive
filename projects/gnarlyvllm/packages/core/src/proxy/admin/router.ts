import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { queryLogs, getLogById, getStats, getDistinctModels, getDistinctPaths, getDistinctPromptTypes } from './api.ts';
import { renderDashboard } from './ui.ts';

export function createAdminRouter(db: Database): Hono {
  const app = new Hono();

  // Redirect /admin to /admin/dashboard
  app.get('/', (c) => c.redirect('/admin/dashboard'));

  // Serve the dashboard HTML
  app.get('/dashboard', (c) => {
    return c.html(renderDashboard());
  });

  // API: List logs with filtering and pagination
  app.get('/api/logs', (c) => {
    const query = c.req.query.bind(c.req);

    const page = query('page') ? parseInt(query('page')!, 10) : 1;
    const limit = query('limit') ? parseInt(query('limit')!, 10) : 25;
    const model = query('model');
    const path = query('path');
    const promptType = query('prompt_type');
    const start = query('start') ? parseInt(query('start')!, 10) : undefined;
    const end = query('end') ? parseInt(query('end')!, 10) : undefined;

    const result = queryLogs(db, { page, limit, model, path, promptType, start, end });
    return c.json(result);
  });

  // API: Get a single log by ID
  app.get('/api/logs/:id', (c) => {
    const id = c.req.param('id');
    const log = getLogById(db, id);

    if (!log) {
      return c.json({ error: 'Log not found' }, 404);
    }

    return c.json({ log });
  });

  // API: Get statistics
  app.get('/api/stats', (c) => {
    const query = c.req.query.bind(c.req);
    const start = query('start') ? parseInt(query('start')!, 10) : undefined;
    const end = query('end') ? parseInt(query('end')!, 10) : undefined;

    const stats = getStats(db, { start, end });
    return c.json(stats);
  });

  // API: Get distinct models (for filter dropdown)
  app.get('/api/models', (c) => {
    const models = getDistinctModels(db);
    return c.json(models);
  });

  // API: Get distinct paths (for filter dropdown)
  app.get('/api/paths', (c) => {
    const paths = getDistinctPaths(db);
    return c.json(paths);
  });

  // API: Get distinct prompt types (for filter dropdown)
  app.get('/api/prompt-types', (c) => {
    const types = getDistinctPromptTypes(db);
    return c.json(types);
  });

  return app;
}
