/**
 * Container orchestration operations
 * Extracted from CLI commands for reuse in state machine
 */

import {
  listContainers,
  getContainer,
  removeContainer,
  stopContainer,
  runContainer,
  pullImage,
  imageExists,
} from '../podman/client.ts';
import {
  buildVllmContainerOptions,
  waitForVllmReady,
  checkVllmHealth,
  VLLM_IMAGE,
} from '../vllm/container.ts';
import {
  buildProxyContainerOptions,
  waitForProxyReady,
  PROXY_IMAGE,
  PROXY_CONTAINER_NAME,
} from '../proxy/index.ts';
import {
  loadConfig,
  resolveModelConfig,
  resolveStackModels,
  type GnarlyConfig,
  type ResolvedModelConfig,
  type Settings,
} from '../config/index.ts';
import type { ContainerStatus } from './types.ts';

/**
 * Stop all vLLM containers (excluding Proxy)
 */
export async function stopAllVllmContainers(): Promise<void> {
  const result = await listContainers(true);
  if (!result.success || !result.data) return;

  const vllmContainers = result.data.filter(
    (c) => c.name !== `gnarlyvllm-${PROXY_CONTAINER_NAME}`,
  );

  for (const container of vllmContainers) {
    if (container.state === 'running') {
      await stopContainer(container.name.replace(/^gnarlyvllm-/, ''));
    }
    await removeContainer(container.name.replace(/^gnarlyvllm-/, ''), true);
  }
}

/**
 * Ensure images are pulled
 */
export async function ensureImages(): Promise<void> {
  if (!(await imageExists(VLLM_IMAGE))) {
    const result = await pullImage(VLLM_IMAGE);
    if (!result.success) {
      throw new Error(`Failed to pull vLLM image: ${result.error}`);
    }
  }

  if (!(await imageExists(PROXY_IMAGE))) {
    const result = await pullImage(PROXY_IMAGE);
    if (!result.success) {
      throw new Error(`Failed to pull Proxy image: ${result.error}`);
    }
  }
}

/**
 * Start a single model
 */
export async function startModel(
  config: GnarlyConfig,
  modelName: string,
): Promise<ContainerStatus> {
  const model = resolveModelConfig(config, modelName);
  const hfToken = Bun.env.HF_TOKEN;

  // Ensure images
  await ensureImages();

  // Check for existing container
  const existing = await getContainer(modelName);
  if (existing) {
    if (existing.state === 'running' && (await checkVllmHealth(model.port))) {
      return {
        name: modelName,
        state: 'running',
        port: model.port,
      };
    }
    await removeContainer(modelName, true);
  }

  // Build and run container
  const containerOptions = buildVllmContainerOptions({
    name: modelName,
    model,
    settings: config.settings,
    hfToken,
  });

  const runResult = await runContainer(containerOptions);
  if (!runResult.success) {
    return {
      name: modelName,
      state: 'failed',
      port: model.port,
      error: runResult.error,
    };
  }

  // Wait for ready
  const ready = await waitForVllmReady(model.port, 300000, 3000, modelName);
  if (!ready) {
    const container = await getContainer(modelName);
    const error =
      container?.state === 'exited' || container?.state === 'stopped'
        ? 'Container exited unexpectedly'
        : 'Timeout waiting for model to load';

    return {
      name: modelName,
      state: 'failed',
      port: model.port,
      error,
    };
  }

  return {
    name: modelName,
    state: 'running',
    port: model.port,
  };
}

/**
 * Start all models in a stack
 */
export async function startStack(
  config: GnarlyConfig,
  stackName: string,
): Promise<ContainerStatus[]> {
  const models = resolveStackModels(config, stackName);
  const hfToken = Bun.env.HF_TOKEN;

  // Ensure images
  await ensureImages();

  const statuses: ContainerStatus[] = [];

  // Start models sequentially to avoid GPU memory contention
  for (const model of models) {
    const existing = await getContainer(model.name);
    if (existing) {
      if (existing.state === 'running' && (await checkVllmHealth(model.port))) {
        statuses.push({
          name: model.name,
          state: 'running',
          port: model.port,
        });
        continue;
      }
      await removeContainer(model.name, true);
    }

    const containerOptions = buildVllmContainerOptions({
      name: model.name,
      model,
      settings: config.settings,
      hfToken,
    });

    const runResult = await runContainer(containerOptions);
    if (!runResult.success) {
      statuses.push({
        name: model.name,
        state: 'failed',
        port: model.port,
        error: runResult.error,
      });
      continue;
    }

    // Wait for this model to be ready before starting next
    const ready = await waitForVllmReady(model.port, 300000, 3000, model.name);
    if (!ready) {
      const container = await getContainer(model.name);
      const error =
        container?.state === 'exited' || container?.state === 'stopped'
          ? 'Container exited unexpectedly'
          : 'Timeout waiting for model to load';

      statuses.push({
        name: model.name,
        state: 'failed',
        port: model.port,
        error,
      });
    } else {
      statuses.push({
        name: model.name,
        state: 'running',
        port: model.port,
      });
    }
  }

  return statuses;
}

/**
 * Ensure Gnarly Proxy is running with correct models
 */
export async function ensureProxy(
  models: ResolvedModelConfig[],
  settings: Settings,
): Promise<void> {
  // Always restart the proxy to ensure fresh route map and bundled script
  const existing = await getContainer(PROXY_CONTAINER_NAME);
  if (existing) {
    await stopContainer(PROXY_CONTAINER_NAME);
    await removeContainer(PROXY_CONTAINER_NAME, true);
  }

  // Build and run container
  const containerOptions = await buildProxyContainerOptions(models, settings);
  const result = await runContainer(containerOptions);
  if (!result.success) {
    throw new Error(`Failed to start Proxy: ${result.error}`);
  }

  // Wait for ready
  const ready = await waitForProxyReady(settings.litellm_port, 10000);
  if (!ready) {
    throw new Error('Proxy failed to start within timeout');
  }
}
