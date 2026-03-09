import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
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

  return {
    name: PROXY_CONTAINER_NAME,
    image: PROXY_IMAGE,
    ports: [{ host: settings.litellm_port, container: 4000 }],
    env: { GNARLY_ROUTES: JSON.stringify(routeMap) },
    volumes: [{ host: outfile, container: '/app/proxy.js', readonly: true }],
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
