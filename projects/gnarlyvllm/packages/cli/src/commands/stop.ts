import {
  listContainers,
  stopContainer,
  removeContainer,
  cleanupAllContainers,
  getContainer,
} from '@gnarlyvllm/core';

export async function stopCommand(
  args: string[],
  _configPath?: string,
): Promise<number> {
  const [name] = args;

  if (!name) {
    // Stop all gnarlyvllm containers
    console.log('Stopping all gnarlyvllm containers...');

    const result = await cleanupAllContainers();

    if (result.data && result.data.length > 0) {
      console.log('Stopped and removed:');
      for (const containerName of result.data) {
        const displayName = containerName.replace(/^gnarlyvllm-/, '');
        console.log(`  - ${displayName}`);
      }
    } else {
      console.log('No containers to stop.');
    }

    if (!result.success && result.error) {
      console.error('');
      console.error('Errors:');
      console.error(result.error);
      return 1;
    }

    return 0;
  }

  // Stop specific container or stack
  // First check if it's a container
  const container = await getContainer(name);

  if (container) {
    console.log(`Stopping ${name}...`);

    if (container.state === 'running') {
      const stopResult = await stopContainer(name);
      if (!stopResult.success) {
        console.error(`Failed to stop: ${stopResult.error}`);
        return 1;
      }
    }

    const rmResult = await removeContainer(name);
    if (!rmResult.success) {
      console.error(`Failed to remove: ${rmResult.error}`);
      return 1;
    }

    console.log(`Stopped and removed: ${name}`);
    return 0;
  }

  // Maybe it's a stack name - stop all containers that are part of the stack
  // For now, just report not found
  console.error(`Container not found: ${name}`);
  console.log('');

  // List what's available
  const listResult = await listContainers(true);
  if (listResult.success && listResult.data && listResult.data.length > 0) {
    console.log('Running containers:');
    for (const c of listResult.data) {
      const displayName = c.name.replace(/^gnarlyvllm-/, '');
      console.log(`  - ${displayName}`);
    }
  }

  return 1;
}
