import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { initDb, extractTokenUsage, detectPromptType, insertLog, clearLogs } from './logger.ts';

describe('logger', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gnarlyvllm-test-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initDb', () => {
    it('should create the database and tables', async () => {
      const db = await initDb(dbPath);
      
      // Verify table exists
      const tableInfo = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='proxy_logs'");
      expect(tableInfo.get()).toEqual({ name: 'proxy_logs' });
      
      db.close();
    });

    it('should create indexes', async () => {
      const db = await initDb(dbPath);
      
      // Verify indexes exist
      const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='proxy_logs'");
      const indexNames = indexes.all() as Array<{ name: string }>;
      const names = indexNames.map(i => i.name);
      
      expect(names).toContain('idx_proxy_logs_timestamp');
      expect(names).toContain('idx_proxy_logs_model');
      expect(names).toContain('idx_proxy_logs_path');
      
      db.close();
    });

    it('should enable WAL mode', async () => {
      const db = await initDb(dbPath);
      
      const journalMode = db.query("PRAGMA journal_mode");
      expect(journalMode.get()).toEqual({ journal_mode: 'wal' });
      
      db.close();
    });
  });

  describe('extractTokenUsage', () => {
    it('should extract usage from non-streaming chat completion response', () => {
      const bodyText = JSON.stringify({
        choices: [{ message: { content: 'Hello' } }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 5,
          total_tokens: 17,
        },
      });

      const result = extractTokenUsage(bodyText, '/v1/chat/completions');
      
      expect(result).toEqual({
        prompt_tokens: 12,
        completion_tokens: 5,
        total_tokens: 17,
      });
    });

    it('should extract usage from embeddings response', () => {
      const bodyText = JSON.stringify({
        data: [{ embedding: [0.1, 0.2] }],
        usage: {
          prompt_tokens: 8,
          total_tokens: 8,
        },
      });

      const result = extractTokenUsage(bodyText, '/v1/embeddings');
      
      expect(result).toEqual({
        prompt_tokens: 8,
        completion_tokens: undefined,
        total_tokens: 8,
      });
    });

    it('should extract usage from streaming response final chunk', () => {
      const bodyText = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
        'data: [DONE]',
      ].join('\n');

      const result = extractTokenUsage(bodyText, '/v1/chat/completions');
      
      expect(result).toEqual({
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      });
    });

    it('should return empty for rerank path', () => {
      const bodyText = JSON.stringify({
        results: [{ index: 0, relevance_score: 0.95 }],
      });

      const result = extractTokenUsage(bodyText, '/v1/rerank');
      
      expect(result).toEqual({});
    });

    it('should return empty for score path', () => {
      const result = extractTokenUsage('{"data": []}', '/v1/score');
      expect(result).toEqual({});
    });

    it('should return empty for empty body', () => {
      const result = extractTokenUsage('', '/v1/chat/completions');
      expect(result).toEqual({});
    });

    it('should return empty for invalid JSON', () => {
      const result = extractTokenUsage('not json', '/v1/chat/completions');
      expect(result).toEqual({});
    });

    it('should return empty when usage is missing', () => {
      const bodyText = JSON.stringify({
        choices: [{ message: { content: 'Hello' } }],
      });

      const result = extractTokenUsage(bodyText, '/v1/chat/completions');
      expect(result).toEqual({});
    });

    it('should handle streaming without usage chunk', () => {
      const bodyText = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: [DONE]',
      ].join('\n');

      const result = extractTokenUsage(bodyText, '/v1/chat/completions');
      expect(result).toEqual({});
    });
  });

  describe('detectPromptType', () => {
    it('should detect rag prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are a professional Family Historian and Video Archivist. Analyze the provided archive fragments.' }],
      });
      expect(detectPromptType(body)).toBe('rag');
    });

    it('should detect chunk-summary prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are an expert film archivist cataloging the Hopkins family video archive. Create a title and summary.' }],
      });
      expect(detectPromptType(body)).toBe('chunk-summary');
    });

    it('should detect entity-extraction prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are an expert archivist extracting evidence-grounded entity mentions from transcript chunks.' }],
      });
      expect(detectPromptType(body)).toBe('entity-extraction');
    });

    it('should detect participant-clustering prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are an expert family archivist for the Hopkins family video archive. Your goal is to normalize participant names while preserving their unique identity.' }],
      });
      expect(detectPromptType(body)).toBe('participant-clustering');
    });

    it('should detect location-clustering prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are an expert family archivist for the Hopkins family video archive. Your goal is to normalize location names while preserving their geographic or contextual identity.' }],
      });
      expect(detectPromptType(body)).toBe('location-clustering');
    });

    it('should detect activity-clustering prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are an expert at categorizing family activities and events from home video archives.' }],
      });
      expect(detectPromptType(body)).toBe('activity-clustering');
    });

    it('should detect temporal-extraction prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are an expert film archivist for the Hopkins family video archive specializing in chronological analysis. Determine recording year(s).' }],
      });
      expect(detectPromptType(body)).toBe('temporal-extraction');
    });

    it('should return chat for unrecognized system prompts', () => {
      const body = JSON.stringify({
        messages: [{ role: 'system', content: 'You are a helpful assistant.' }],
      });
      expect(detectPromptType(body)).toBe('chat');
    });

    it('should return embeddings for embedding requests', () => {
      expect(detectPromptType('{"input":"test"}', '/v1/embeddings')).toBe('embeddings');
    });

    it('should return rerank for rerank requests', () => {
      expect(detectPromptType('{"query":"test"}', '/v1/rerank')).toBe('rerank');
    });

    it('should return undefined for invalid JSON on chat path', () => {
      expect(detectPromptType('not json')).toBeUndefined();
    });

    it('should return chat for missing system message', () => {
      const body = JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      });
      expect(detectPromptType(body)).toBe('chat');
    });
  });

  describe('insertLog', () => {
    it('should insert a log record', async () => {
      const db = await initDb(dbPath);
      
      insertLog(db, {
        id: 'test-id-1',
        timestamp: Date.now(),
        method: 'POST',
        path: '/v1/chat/completions',
        model: 'gpt-4',
        status_code: 200,
        duration_ms: 1500,
        request_body: '{"messages": []}',
        response_body: '{"choices": []}',
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        error_message: undefined,
        prompt_type: 'rag',
      });

      const record = db.query('SELECT * FROM proxy_logs WHERE id = $id').get({ $id: 'test-id-1' }) as any;
      
      expect(record).toMatchObject({
        id: 'test-id-1',
        method: 'POST',
        path: '/v1/chat/completions',
        model: 'gpt-4',
        status_code: 200,
        duration_ms: 1500,
        request_body: '{"messages": []}',
        response_body: '{"choices": []}',
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        error_message: null,
        prompt_type: 'rag',
      });
      
      db.close();
    });

    it('should handle null values', async () => {
      const db = await initDb(dbPath);
      
      insertLog(db, {
        id: 'test-id-2',
        timestamp: Date.now(),
        method: 'GET',
        path: '/health',
        model: undefined,
        status_code: undefined,
        duration_ms: 50,
        request_body: undefined,
        response_body: undefined,
        prompt_tokens: undefined,
        completion_tokens: undefined,
        total_tokens: undefined,
        error_message: undefined,
        prompt_type: undefined,
      });

      const record = db.query('SELECT * FROM proxy_logs WHERE id = $id').get({ $id: 'test-id-2' }) as any;
      
      expect(record.model).toBeNull();
      expect(record.status_code).toBeNull();
      expect(record.request_body).toBeNull();
      expect(record.response_body).toBeNull();
      expect(record.prompt_tokens).toBeNull();
      expect(record.prompt_type).toBeNull();
      
      db.close();
    });
  });

  describe('clearLogs', () => {
    it('should delete all logs', async () => {
      const db = await initDb(dbPath);
      
      // Insert some logs
      for (let i = 0; i < 5; i++) {
        insertLog(db, {
          id: `test-id-${i}`,
          timestamp: Date.now(),
          method: 'POST',
          path: '/v1/chat/completions',
          model: 'gpt-4',
          status_code: 200,
          duration_ms: 1000,
          request_body: undefined,
          response_body: undefined,
          prompt_tokens: undefined,
          completion_tokens: undefined,
          total_tokens: undefined,
          error_message: undefined,
          prompt_type: undefined,
        });
      }

      // Verify logs exist
      const countBefore = db.query('SELECT COUNT(*) as count FROM proxy_logs').get() as { count: number };
      expect(countBefore.count).toBe(5);

      // Clear logs
      const result = clearLogs(db);
      expect(result.deleted).toBe(5);

      // Verify all logs deleted
      const countAfter = db.query('SELECT COUNT(*) as count FROM proxy_logs').get() as { count: number };
      expect(countAfter.count).toBe(0);
      
      db.close();
    });
  });
});
