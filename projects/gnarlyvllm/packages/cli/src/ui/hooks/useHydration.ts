import { useEffect } from 'react';
import { PROXY_CONTAINER_NAME } from '@gnarlyvllm/core';
import type {
  GnarlyConfig,
  ContainerInfo,
  ContainerStatus,
} from '@gnarlyvllm/core';

export function useHydration(
  config: GnarlyConfig,
  containers: ContainerInfo[],
  orchestrator: any,
  loading: boolean,
) {
  useEffect(() => {
    // Only hydrate if we are idle and not loading
    if (loading || !orchestrator.isIdle || containers.length === 0) return;

    // Running models (without prefix)
    const runningModelNames = containers
      .filter(
        (c) =>
          c.state === 'running' &&
          c.name !== `gnarlyvllm-${PROXY_CONTAINER_NAME}`,
      )
      .map((c) => c.name.replace(/^gnarlyvllm-/, ''));

    if (runningModelNames.length === 0) return;

    // Helper to build ContainerStatus from running containers
    const getStatus = (name: string): ContainerStatus | null => {
      const container = containers.find((c) => c.name === `gnarlyvllm-${name}`);
      const modelConfig = config.models[name];
      if (!container || !modelConfig) return null;

      return {
        name,
        state: 'running',
        port: modelConfig.port,
      };
    };

    // 1. Try to match a stack
    // We check stacks first because they are more specific
    for (const [stackName, stack] of Object.entries(config.stacks)) {
      const stackModels = stack.models;
      // Does the running set contain ALL models in this stack?
      const isStackRunning = stackModels.every((m) =>
        runningModelNames.includes(m),
      );

      if (isStackRunning) {
        const statuses = stackModels
          .map(getStatus)
          .filter((s): s is ContainerStatus => s !== null);
        orchestrator.hydrate({ type: 'stack', name: stackName }, statuses);
        return;
      }
    }

    // 2. Try to match a single model
    for (const modelName of Object.keys(config.models)) {
      if (runningModelNames.includes(modelName)) {
        const status = getStatus(modelName);
        if (status) {
          orchestrator.hydrate({ type: 'model', name: modelName }, [status]);
          return;
        }
      }
    }
  }, [loading, containers, orchestrator.isIdle, config]);
}
