import { mkdir } from "node:fs/promises";

/**
 * Simple throttle function to limit concurrency of async operations
 */
export async function throttle<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<any>
): Promise<void> {
  const promises: Promise<any>[] = [];
  const pool = new Set<Promise<any>>();

  for (const item of items) {
    const p: Promise<any> = fn(item).then(() => pool.delete(p));
    promises.push(p);
    pool.add(p);
    if (pool.size >= limit) {
      await Promise.race(pool);
    }
  }

  await Promise.all(promises);
}

/**
 * Ensures a directory exists
 */
export async function ensureDir(path: string) {
  try {
    await mkdir(path, { recursive: true });
  } catch (err: any) {
    if (err.code !== "EEXIST") throw err;
  }
}
