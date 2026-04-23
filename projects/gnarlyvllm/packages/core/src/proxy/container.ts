import { join, dirname, basename } from 'node:path';
import { mkdir, cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { ContainerRunOptions } from '../podman/client.ts';
import type { Settings, ResolvedModelConfig } from '../config/schema.ts';

export const PROXY_IMAGE = 'docker.io/oven/bun:alpine';
export const PROXY_CONTAINER_NAME = 'proxy';

export async function buildProxyContainerOptions(
  models: ResolvedModelConfig[],
  settings: Settings,
): Promise<ContainerRunOptions> {
  const routeMap = models.reduce(
    (acc, m) => {
      acc[m.name] = { port: m.port, task: m.task, repo: m.repo };
      return acc;
    },
    {} as Record<string, { port: number; task: string; repo: string }>,
  );

  // Bundle the proxy script so it has no node_modules dependency in the container
  const tmpDir = join(process.cwd(), '.tmp');
  await mkdir(tmpDir, { recursive: true });

  const entrypoint = join(import.meta.dir, 'server.ts');
  const outfile = join(tmpDir, 'proxy.js');

  await Bun.build({
    entrypoints: [entrypoint],
    outdir: tmpDir,
    target: 'bun',
    naming: 'proxy.js',
  });

  // Copy admin dashboard assets into .tmp so they're available in the container
  const adminSrcDir = join(import.meta.dir, 'admin');
  const adminTmpDir = join(tmpDir, 'admin');
  await cp(adminSrcDir, adminTmpDir, { recursive: true, force: true });

  // Prepare logging configuration
  const logEnabled = settings.proxy_log_enabled ?? false;
  const dbPathRaw = settings.proxy_log_db_path || '~/.local/share/gnarlyvllm/proxy-logs.db';
  const dbPath = dbPathRaw.replace(/^~/, homedir());
  const dbDir = dirname(dbPath);
  const dbName = basename(dbPath);

  // Create the directory on the host if logging is enabled
  if (logEnabled) {
    await mkdir(dbDir, { recursive: true });
  }

  // Container-internal path for the DB
  const containerDbDir = '/data/gnarly';
  const containerDbPath = join(containerDbDir, dbName);

  // Build volumes array - mount entire .tmp dir as /app so proxy.js and admin/ assets are available
  const volumes: ContainerRunOptions['volumes'] = [
    { host: tmpDir, container: '/app', readonly: true },
  ];

  // Mount the DB directory if logging is enabled
  if (logEnabled) {
    volumes.push({ host: dbDir, container: containerDbDir, readonly: false });
  }

  return {
    name: PROXY_CONTAINER_NAME,
    image: PROXY_IMAGE,
    ports: [{ host: settings.litellm_port, container: 4000 }],
    env: {
      GNARLY_ROUTES: JSON.stringify(routeMap),
      GNARLY_HOSTNAME: settings.proxy_hostname || '0.0.0.0',
      GNARLY_LOG_ENABLED: String(logEnabled),
      GNARLY_LOG_DB_PATH: containerDbPath,
      GNARLY_LOG_CAPTURE_BODIES: String(settings.proxy_log_capture_bodies ?? true),
      GNARLY_LOG_SKIP_PATHS: (settings.proxy_log_skip_paths || []).join(','),
    },
    volumes,
    command: ['bun', 'run', '/app/proxy.js'],
    detach: true,
    pull: 'missing',
  };
}

export async function waitForProxyReady(
  port: number,
  timeoutMs = 10000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch {}
    await Bun.sleep(500);
  }
  return false;
}
