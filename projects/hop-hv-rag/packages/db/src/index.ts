import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import * as sqliteVec from 'sqlite-vec';

export * from './schema';

export function createDb(path: string) {
  const sqlite = new Database(path);
  sqliteVec.load(sqlite);
  return drizzle(sqlite, { schema });
}
