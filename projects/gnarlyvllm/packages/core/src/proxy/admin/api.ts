import type { Database } from 'bun:sqlite';

export interface LogRecord {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  model: string | null;
  status_code: number | null;
  duration_ms: number;
  request_body: string | null;
  response_body: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  prompt_type: string | null;
}

export interface LogsResponse {
  logs: LogRecord[];
  total: number;
  page: number;
  pages: number;
}

export interface StatsResponse {
  totalRequests: number;
  avgDurationMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  topModels: { model: string; count: number }[];
  topPromptTypes: { prompt_type: string; count: number }[];
}

/**
 * Query logs with filtering and pagination
 */
export function queryLogs(
  db: Database,
  options: {
    page?: number;
    limit?: number;
    model?: string;
    path?: string;
    promptType?: string;
    start?: number;
    end?: number;
  },
): LogsResponse {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const offset = (page - 1) * limit;

  // Build WHERE clause dynamically
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (options.model) {
    conditions.push('model = $model');
    params.$model = options.model;
  }
  if (options.path) {
    conditions.push('path = $path');
    params.$path = options.path;
  }
  if (options.promptType) {
    conditions.push('prompt_type = $promptType');
    params.$promptType = options.promptType;
  }
  if (options.start) {
    conditions.push('timestamp >= $start');
    params.$start = options.start;
  }
  if (options.end) {
    conditions.push('timestamp <= $end');
    params.$end = options.end;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM proxy_logs ${whereClause}`);
  const { count } = countStmt.get(params) as { count: number };

  // Get paginated results
  const query = `
    SELECT * FROM proxy_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $limit OFFSET $offset
  `;
  const stmt = db.prepare(query);
  const rows = stmt.all({ ...params, $limit: limit, $offset: offset }) as LogRecord[];

  const totalPages = Math.ceil(count / limit);

  return {
    logs: rows,
    total: count,
    page,
    pages: totalPages,
  };
}

/**
 * Get a single log by ID
 */
export function getLogById(db: Database, id: string): LogRecord | null {
  const stmt = db.prepare('SELECT * FROM proxy_logs WHERE id = $id');
  return stmt.get({ $id: id }) as LogRecord | null;
}

/**
 * Get statistics for the dashboard
 */
export function getStats(
  db: Database,
  options: { start?: number; end?: number } = {},
): StatsResponse {
  const conditions: string[] = [];
  const params: Record<string, number> = {};

  if (options.start) {
    conditions.push('timestamp >= $start');
    params.$start = options.start;
  }
  if (options.end) {
    conditions.push('timestamp <= $end');
    params.$end = options.end;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Total requests
  const totalStmt = db.prepare(`SELECT COUNT(*) as count FROM proxy_logs ${whereClause}`);
  const totalResult = totalStmt.get(params) as { count: number };

  // Average duration
  const avgStmt = db.prepare(`
    SELECT AVG(duration_ms) as avg FROM proxy_logs ${whereClause}
  `);
  const avgResult = avgStmt.get(params) as { avg: number | null };

  // Token totals
  const tokensStmt = db.prepare(`
    SELECT 
      COALESCE(SUM(prompt_tokens), 0) as total_prompt,
      COALESCE(SUM(completion_tokens), 0) as total_completion
    FROM proxy_logs ${whereClause}
  `);
  const tokensResult = tokensStmt.get(params) as {
    total_prompt: number;
    total_completion: number;
  };

  // Top models
  const topModelsStmt = db.prepare(`
    SELECT model, COUNT(*) as count
    FROM proxy_logs
    ${whereClause}
    GROUP BY model
    ORDER BY count DESC
    LIMIT 10
  `);
  const topModels = topModelsStmt.all(params) as Array<{ model: string; count: number }>;

  // Top prompt types
  const ptWhereClause = whereClause
    ? `${whereClause} AND prompt_type IS NOT NULL`
    : 'WHERE prompt_type IS NOT NULL';
  const topPromptTypesStmt = db.prepare(`
    SELECT prompt_type, COUNT(*) as count
    FROM proxy_logs
    ${ptWhereClause}
    GROUP BY prompt_type
    ORDER BY count DESC
    LIMIT 10
  `);
  const topPromptTypes = topPromptTypesStmt.all(params) as Array<{ prompt_type: string; count: number }>;

  return {
    totalRequests: totalResult.count,
    avgDurationMs: Math.round(avgResult.avg ?? 0),
    totalPromptTokens: tokensResult.total_prompt,
    totalCompletionTokens: tokensResult.total_completion,
    topModels: topModels.map((m) => ({ model: m.model ?? 'unknown', count: m.count })),
    topPromptTypes: topPromptTypes.map((p) => ({ prompt_type: p.prompt_type, count: p.count })),
  };
}

/**
 * Get distinct models for the filter dropdown
 */
export function getDistinctModels(db: Database): string[] {
  const stmt = db.prepare('SELECT DISTINCT model FROM proxy_logs WHERE model IS NOT NULL ORDER BY model');
  const rows = stmt.all() as Array<{ model: string | null }>;
  return rows.map((r) => r.model!).filter(Boolean);
}

/**
 * Get distinct paths for the filter dropdown
 */
export function getDistinctPaths(db: Database): string[] {
  const stmt = db.prepare('SELECT DISTINCT path FROM proxy_logs ORDER BY path');
  const rows = stmt.all() as Array<{ path: string }>;
  return rows.map((r) => r.path);
}

/**
 * Get distinct prompt types for the filter dropdown
 */
export function getDistinctPromptTypes(db: Database): string[] {
  const stmt = db.prepare('SELECT DISTINCT prompt_type FROM proxy_logs WHERE prompt_type IS NOT NULL ORDER BY prompt_type');
  const rows = stmt.all() as Array<{ prompt_type: string | null }>;
  return rows.map((r) => r.prompt_type!).filter(Boolean);
}
