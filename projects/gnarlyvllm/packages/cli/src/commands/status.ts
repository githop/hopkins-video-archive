import {
  listContainers,
  isPodmanAvailable,
  getPodmanVersion,
  loadConfig,
  ConfigError,
  type ContainerInfo,
} from '@gnarlyvllm/core';

export async function statusCommand(
  _args: string[],
  configPath?: string,
): Promise<number> {
  // Check podman availability
  if (!(await isPodmanAvailable())) {
    console.error('Podman is not available. Please install podman.');
    return 1;
  }

  const podmanVersion = await getPodmanVersion();

  console.log('gnarlyvllm status');
  console.log('─'.repeat(50));
  console.log(`Podman: v${podmanVersion}`);
  console.log('');

  // List running containers
  const result = await listContainers(true);
  if (!result.success) {
    console.error('Failed to list containers:', result.error);
    return 1;
  }

  const containers = result.data || [];
  const running = containers.filter((c) => c.state === 'running');
  const stopped = containers.filter((c) => c.state !== 'running');

  if (running.length > 0) {
    console.log('Running:');
    for (const container of running) {
      printContainer(container);
    }
  } else {
    console.log('No models running.');
  }

  if (stopped.length > 0) {
    console.log('');
    console.log('Stopped:');
    for (const container of stopped) {
      printContainer(container);
    }
  }

  // Show available stacks from config
  try {
    const config = await loadConfig(configPath);
    const stacks = Object.entries(config.stacks);
    if (stacks.length > 0) {
      console.log('');
      console.log('Available stacks:');
      for (const [name, stack] of stacks) {
        console.log(`  - ${name} (${stack.models.length} models)`);
        if (stack.description) {
          console.log(`    ${stack.description}`);
        }
      }
    }

    const models = Object.keys(config.models);
    if (models.length > 0) {
      console.log('');
      console.log('Available models:');
      for (const name of models) {
        console.log(`  - ${name}`);
      }
    }
  } catch (err) {
    if (!(err instanceof ConfigError)) {
      throw err;
    }
    // Config not found - that's okay for status
  }

  return 0;
}

function printContainer(container: ContainerInfo): void {
  const stateIndicator = container.state === 'running' ? '●' : '○';
  const stateColor =
    container.state === 'running' ? 'running' : container.state;

  // Remove gnarlyvllm- prefix for display
  const displayName = container.name.replace(/^gnarlyvllm-/, '');

  const ports =
    container.ports.length > 0
      ? container.ports.map((p) => p.split('/')[0]).join(', ')
      : '-';

  console.log(
    `  ${stateIndicator} ${displayName.padEnd(20)} ${stateColor.padEnd(10)} ${ports}`,
  );
}
