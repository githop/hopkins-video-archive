import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { schema } from '@hop-hv-rag/db';

/**
 * Database type - server-side only, requires Bun runtime
 */
export type Db = BunSQLiteDatabase<typeof schema>;
