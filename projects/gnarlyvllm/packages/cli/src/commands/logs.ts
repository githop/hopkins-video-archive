import {
  getContainer,
  streamContainerLogs,
  getContainerLogs,
} from '@gnarlyvllm/core';

export async function logsCommand(
  args: string[],
  _configPath?: string,
): Promise<number> {
  const [modelName] = args;

  if (!modelName) {
    console.error('Error: Model name required');
    console.error('Usage: gnarlyvllm logs <model>');
    return 1;
  }

  // Check if container exists
  const container = await getContainer(modelName);
  if (!container) {
    console.error(`Container not found: ${modelName}`);
    console.log('Is the model running? Check with: gnarlyvllm status');
    return 1;
  }

  // Get recent logs first
  const logsResult = await getContainerLogs(modelName, { tail: 50 });
  if (logsResult.data) {
    console.log(logsResult.data);
  }

  // Then stream new logs
  console.log('─'.repeat(50));
  console.log('Streaming logs (Ctrl+C to stop)...');
  console.log('');

  const proc = streamContainerLogs(modelName);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    proc.kill();
    process.exit(0);
  });

  await proc.exited;
  return 0;
}
