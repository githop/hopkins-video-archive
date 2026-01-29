// Export schema definitions and types
export * from './schema.ts';

// Export validation module separately to avoid naming conflicts
// Consumers should import from '@hop-hv-rag/db/validation' for Zod schemas
export * as validation from './validation.ts';

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.ts';
import * as sqliteVec from 'sqlite-vec';

export { schema };

export function createDb(path: string) {
  const sqlite = new Database(path);
  sqliteVec.load(sqlite);
  return drizzle(sqlite, { schema });
}
