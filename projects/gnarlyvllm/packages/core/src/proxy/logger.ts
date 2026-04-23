import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LogRecord {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  model: string | undefined;
  status_code: number | undefined;
  duration_ms: number;
  request_body: string | undefined;
  response_body: string | undefined;
  prompt_tokens: number | undefined;
  completion_tokens: number | undefined;
  total_tokens: number | undefined;
  error_message: string | undefined;
  prompt_type: string | undefined;
}

export interface LogConfig {
  enabled: boolean;
  dbPath: string;
  captureBodies: boolean;
  skipPaths: string[];
}

/**
 * Initialize the SQLite database with the proxy_logs table and indexes.
 * Enables WAL mode for concurrent read/write access.
 */
export async function initDb(dbPath: string): Promise<Database> {
  // Ensure parent directory exists
  const parentDir = dirname(dbPath);
  await mkdir(parentDir, { recursive: true });

  const db = new Database(dbPath);

  // Enable WAL mode for concurrent access
  db.exec('PRAGMA journal_mode = WAL;');

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_logs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      model TEXT,
      status_code INTEGER,
      duration_ms INTEGER NOT NULL,
      request_body TEXT,
      response_body TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      error_message TEXT
    );
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_proxy_logs_timestamp ON proxy_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_proxy_logs_model ON proxy_logs(model);
    CREATE INDEX IF NOT EXISTS idx_proxy_logs_path ON proxy_logs(path);
  `);

  // Migration: add prompt_type column if it doesn't exist (ignore error if already present)
  try {
    db.exec('ALTER TABLE proxy_logs ADD COLUMN prompt_type TEXT');
  } catch {
    // Column already exists
  }

  // Create index on prompt_type
  db.exec('CREATE INDEX IF NOT EXISTS idx_proxy_logs_prompt_type ON proxy_logs(prompt_type)');

  return db;
}

/**
 * Detect the prompt type from a request body and path.
 * For chat completions, analyzes the system prompt.
 * For other paths, uses the endpoint as the type.
 */
export function detectPromptType(
  requestBody: string | undefined,
  path: string = '/v1/chat/completions',
): string | undefined {
  // For non-chat endpoints, classify by path
  if (path === '/v1/embeddings') return 'embeddings';
  if (path === '/v1/rerank') return 'rerank';

  if (!requestBody) return undefined;

  try {
    const parsed = JSON.parse(requestBody);
    const messages = parsed.messages || [];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    if (!systemMsg?.content) return 'chat';

    const content = systemMsg.content.toLowerCase();

    if (content.includes('family historian and video archivist')) return 'rag';
    if (content.includes('chronological analysis') || content.includes('recording year')) return 'temporal-extraction';
    if (content.includes('normalizing participant') || content.includes('participant names')) return 'participant-clustering';
    if (content.includes('normalizing location') || content.includes('location names')) return 'location-clustering';
    if (content.includes('categorizing family activities')) return 'activity-clustering';
    if (content.includes('extracting evidence-grounded entity mentions')) return 'entity-extraction';
    if (content.includes('film archivist cataloging') || content.includes('hopkins family video archive')) {
      if (content.includes('title') && content.includes('summary')) return 'chunk-summary';
      if (content.includes('synthesize') || content.includes('global archival abstract')) return 'global-summary';
      if (content.includes('chunk')) return 'chunk-summary';
      return 'summarization';
    }

    return 'chat';
  } catch {
    return undefined;
  }
}

/**
 * Insert a log record into the database.
 * Uses a prepared statement for performance.
 */
export function insertLog(db: Database, record: LogRecord): void {
  const stmt = db.prepare(`
    INSERT INTO proxy_logs (
      id, timestamp, method, path, model, status_code, duration_ms,
      request_body, response_body, prompt_tokens, completion_tokens, total_tokens, error_message, prompt_type
    ) VALUES (
      $id, $timestamp, $method, $path, $model, $status_code, $duration_ms,
      $request_body, $response_body, $prompt_tokens, $completion_tokens, $total_tokens, $error_message, $prompt_type
    )
  `);

  stmt.run({
    $id: record.id,
    $timestamp: record.timestamp,
    $method: record.method,
    $path: record.path,
    $model: record.model ?? null,
    $status_code: record.status_code ?? null,
    $duration_ms: record.duration_ms,
    $request_body: record.request_body ?? null,
    $response_body: record.response_body ?? null,
    $prompt_tokens: record.prompt_tokens ?? null,
    $completion_tokens: record.completion_tokens ?? null,
    $total_tokens: record.total_tokens ?? null,
    $error_message: record.error_message ?? null,
    $prompt_type: record.prompt_type ?? null,
  });
}

/**
 * Clear all logs from the database.
 * Returns the number of deleted rows.
 */
export function clearLogs(db: Database): { deleted: number } {
  const result = db.run('DELETE FROM proxy_logs');
  return { deleted: result.changes };
}

/**
 * Extract token usage from a response body.
 * Handles both regular JSON responses and streaming SSE responses.
 */
export function extractTokenUsage(
  bodyText: string,
  path: string,
): {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} {
  // Skip if empty or not JSON-looking
  if (!bodyText || (!bodyText.startsWith('{') && !bodyText.startsWith('data:'))) {
    return {};
  }

  try {
    // For rerank and score routes, no usage field is expected
    if (path === '/v1/rerank' || path === '/v1/score') {
      return {};
    }

    // For embeddings and chat completions, extract from JSON
    if (path === '/v1/chat/completions' || path === '/v1/embeddings') {
      // Check if this is a streaming response (SSE format)
      if (bodyText.includes('data:')) {
        // Parse SSE format - look for usage in the final chunk
        const lines = bodyText.split('\n');
        // Look for the last line with data: that might contain usage
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.usage) {
                return {
                  prompt_tokens: parsed.usage.prompt_tokens,
                  completion_tokens: parsed.usage.completion_tokens,
                  total_tokens: parsed.usage.total_tokens,
                };
              }
            } catch {}
          }
        }
        return {};
      } else {
        // Non-streaming JSON response
        const parsed = JSON.parse(bodyText);
        if (parsed.usage) {
          return {
            prompt_tokens: parsed.usage.prompt_tokens,
            completion_tokens: parsed.usage.completion_tokens,
            total_tokens: parsed.usage.total_tokens,
          };
        }
      }
    }
  } catch {
    // Silently fail parsing - return empty
  }

  return {};
}

/**
 * Async function to collect a stream into text.
 * Used for logging the response body from a teed stream.
 */
export async function collectStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const blob = new Blob(chunks);
    return await blob.text();
  } catch (e) {
    // Stream read error - return empty
    return '';
  } finally {
    reader.releaseLock();
  }
}

export type LogContext = {
  db: Database;
  captureBodies: boolean;
  skipPaths: string[];
};

export type LogProxyRequestOptions = {
  method: string;
  url: string;
  model?: string;
  requestBody?: string;
  upstreamFetch: () => Promise<Response>;
};

/**
 * Log context for async logging - stores metadata for deferred insertion
 */
type PendingLog = {
  id: string;
  startTime: number;
  method: string;
  path: string;
  model: string | undefined;
  requestBody: string | undefined;
  statusCode: number | undefined;
  responseBodyText: string | undefined;
  errorMessage: string | undefined;
  promptType: string | undefined;
};

/**
 * Log a proxy request and its response.
 * Uses tee() to capture the response body without blocking the client stream.
 * Returns the response immediately and logs asynchronously.
 */
export async function logProxyRequest(
  ctx: LogContext,
  options: LogProxyRequestOptions,
): Promise<Response> {
  const start = Date.now();
  const path = new URL(options.url).pathname;

  // Check if path should be skipped
  if (ctx.skipPaths.includes(path)) {
    return options.upstreamFetch();
  }

  // Pre-detect prompt type from request body and path
  const promptType = detectPromptType(options.requestBody, path);

  const pendingLog: PendingLog = {
    id: crypto.randomUUID(),
    startTime: start,
    method: options.method,
    path,
    model: options.model,
    requestBody: ctx.captureBodies ? options.requestBody : undefined,
    statusCode: undefined,
    responseBodyText: undefined,
    errorMessage: undefined,
    promptType,
  };

  try {
    const upstreamResponse = await options.upstreamFetch();
    pendingLog.statusCode = upstreamResponse.status;

    // If body capture is disabled or no body, return directly and log
    if (!ctx.captureBodies || !upstreamResponse.body) {
      // Fire-and-forget log insertion
      Promise.resolve().then(() => {
        try {
          insertLog(ctx.db, {
            id: pendingLog.id,
            timestamp: pendingLog.startTime,
            method: pendingLog.method,
            path: pendingLog.path,
            model: pendingLog.model,
            status_code: pendingLog.statusCode,
            duration_ms: Date.now() - pendingLog.startTime,
            request_body: pendingLog.requestBody,
            response_body: undefined,
            prompt_tokens: undefined,
            completion_tokens: undefined,
            total_tokens: undefined,
            error_message: undefined,
            prompt_type: pendingLog.promptType,
          });
        } catch {}
      });

      const newHeaders = new Headers(upstreamResponse.headers);
      newHeaders.delete('Transfer-Encoding');
      return new Response(null, {
        status: upstreamResponse.status,
        headers: newHeaders,
      });
    }

    // Tee the stream to capture for logging while returning to client
    const [clientStream, logStream] = upstreamResponse.body.tee();

    // Start async collection of log stream
    (async () => {
      try {
        const responseBodyText = await collectStreamText(logStream);
        pendingLog.responseBodyText = responseBodyText;

        // Extract token usage from the response body
        const tokens = extractTokenUsage(responseBodyText, path);

        // Insert the log record
        insertLog(ctx.db, {
          id: pendingLog.id,
          timestamp: pendingLog.startTime,
          method: pendingLog.method,
          path: pendingLog.path,
          model: pendingLog.model,
          status_code: pendingLog.statusCode,
          duration_ms: Date.now() - pendingLog.startTime,
          request_body: pendingLog.requestBody,
          response_body: responseBodyText || undefined,
          prompt_tokens: tokens.prompt_tokens,
          completion_tokens: tokens.completion_tokens,
          total_tokens: tokens.total_tokens,
          error_message: undefined,
          prompt_type: pendingLog.promptType,
        });
      } catch {
        // Silently fail logging
      }
    })();

    // Return client response immediately
    const newHeaders = new Headers(upstreamResponse.headers);
    newHeaders.delete('Transfer-Encoding');
    return new Response(clientStream, {
      status: upstreamResponse.status,
      headers: newHeaders,
    });
  } catch (e: any) {
    // Log the error and re-throw
    pendingLog.errorMessage = e.message;
    pendingLog.statusCode = 500;

    try {
      insertLog(ctx.db, {
        id: pendingLog.id,
        timestamp: pendingLog.startTime,
        method: pendingLog.method,
        path: pendingLog.path,
        model: pendingLog.model,
        status_code: 500,
        duration_ms: Date.now() - pendingLog.startTime,
        request_body: pendingLog.requestBody,
        response_body: undefined,
        prompt_tokens: undefined,
        completion_tokens: undefined,
        total_tokens: undefined,
        error_message: e.message,
        prompt_type: pendingLog.promptType,
      });
    } catch {}

    throw e;
  }
}
