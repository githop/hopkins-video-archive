import React from 'react';
import {
  isPodmanAvailable,
  getPodmanVersion,
  loadConfig,
} from '@gnarlyvllm/core';
import { renderApp } from '../ui/renderer.tsx';
import { Dashboard } from '../ui/Dashboard.tsx';

export async function dashboardCommand(
  _args: string[],
  configPath?: string,
): Promise<number> {
  // Check podman availability
  if (!(await isPodmanAvailable())) {
    console.error('Podman is not available. Please install podman.');
    return 1;
  }

  const podmanVersion = (await getPodmanVersion()) || 'unknown';

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (err) {
    console.error(
      'Failed to load config:',
      err instanceof Error ? err.message : String(err),
    );
    return 1;
  }

  await renderApp(<Dashboard podmanVersion={podmanVersion} config={config} />);

  // Keep alive - the Dashboard component handles exit via process.exit()
  return new Promise(() => {});
}
