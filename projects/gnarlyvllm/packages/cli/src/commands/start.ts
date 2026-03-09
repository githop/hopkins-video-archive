import {
  loadConfig,
  resolveStackModels,
  ConfigError,
  runContainer,
  getContainer,
  removeContainer,
  buildVllmContainerOptions,
  waitForVllmReady,
  checkVllmHealth,
  VLLM_IMAGE,
  pullImage,
  imageExists,
  ensureProxy,
  PROXY_IMAGE,
  type ResolvedModelConfig,
} from '@gnarlyvllm/core';

type ModelStatus = {
  name: string;
  status: 'pending' | 'starting' | 'running' | 'failed';
  port: number;
  error?: string;
};

export async function startCommand(
  args: string[],
  configPath?: string,
): Promise<number> {
  const [stackName] = args;

  if (!stackName) {
    console.error('Error: Stack name required');
    console.error('Usage: gnarlyvllm start <stack>');
    return 1;
  }

  try {
    const config = await loadConfig(configPath);
    const models = resolveStackModels(config, stackName);
    const stack = config.stacks[stackName];

    console.log(`Starting stack: ${stackName}`);
    if (stack.description) {
      console.log(`  ${stack.description}`);
    }
    console.log('');
    console.log('Models:');
    for (const model of models) {
      console.log(`  - ${model.name} (${model.task}) @ :${model.port}`);
    }
    console.log(`  - proxy (gnarly) @ :${config.settings.litellm_port}`);
    console.log('');

    // Track status
    const statuses: ModelStatus[] = models.map((m) => ({
      name: m.name,
      status: 'pending',
      port: m.port,
    }));

    // Pull images if needed
    console.log('Checking images...');
    if (!(await imageExists(VLLM_IMAGE))) {
      console.log(`Pulling ${VLLM_IMAGE}...`);
      const pullResult = await pullImage(VLLM_IMAGE);
      if (!pullResult.success) {
        console.error(`Failed to pull vLLM image: ${pullResult.error}`);
        return 1;
      }
    }
    if (!(await imageExists(PROXY_IMAGE))) {
      console.log(`Pulling ${PROXY_IMAGE}...`);
      const pullResult = await pullImage(PROXY_IMAGE);
      if (!pullResult.success) {
        console.error(`Failed to pull Proxy image: ${pullResult.error}`);
        return 1;
      }
    }
    console.log('Images ready.');
    console.log('');

    // Get HF token
    const hfToken = Bun.env.HF_TOKEN;

    // Start vLLM containers sequentially
    // Each model must be fully loaded before starting the next to avoid GPU memory contention
    console.log('Starting vLLM containers...');

    for (const model of models) {
      const status = statuses.find((s) => s.name === model.name)!;
      status.status = 'starting';

      // Check for existing container
      const existing = await getContainer(model.name);
      if (existing) {
        if (existing.state === 'running') {
          console.log(`  ${model.name}: already running`);
          if (await checkVllmHealth(model.port)) {
            status.status = 'running';
            continue;
          }
        }
        await removeContainer(model.name, true);
      }

      console.log(`  ${model.name}: starting...`);

      const containerOptions = buildVllmContainerOptions({
        name: model.name,
        model,
        settings: config.settings,
        hfToken,
      });

      const runResult = await runContainer(containerOptions);
      if (!runResult.success) {
        console.error(`  ${model.name}: FAILED - ${runResult.error}`);
        status.status = 'failed';
        status.error = runResult.error;
        // Continue with other models, don't fail entire stack
        continue;
      }

      // Wait for this model to be ready before starting the next
      // This prevents GPU memory contention when multiple models try to allocate simultaneously
      console.log(
        `  ${model.name}: loading model (this may take several minutes)...`,
      );
      const ready = await waitForVllmReady(
        model.port,
        300000,
        3000,
        model.name,
      );
      if (ready) {
        status.status = 'running';
        console.log(`  ${model.name}: ready`);
      } else {
        status.status = 'failed';
        const container = await getContainer(model.name);
        if (
          container &&
          (container.state === 'exited' || container.state === 'stopped')
        ) {
          status.error = 'Container exited unexpectedly';
          console.log(`  ${model.name}: FAILED (container exited)`);
        } else {
          status.error = 'Timeout waiting for model to load';
          console.log(`  ${model.name}: FAILED (timeout)`);
        }
      }
    }

    // Check if we have any running models
    const runningModels = models.filter((m) => {
      const status = statuses.find((s) => s.name === m.name)!;
      return status.status === 'running';
    });

    if (runningModels.length === 0) {
      console.error('');
      console.error('No models started successfully. Aborting.');
      return 1;
    }

    // Start Gnarly Proxy
    console.log('');
    console.log('Starting Gnarly Proxy...');

    try {
      await ensureProxy(runningModels, config.settings);
    } catch (err: any) {
      console.error(`Failed to start Proxy: ${err.message}`);
      return 1;
    }

    console.log('  proxy: ready');

    // Print summary
    console.log('');
    console.log('─'.repeat(50));
    console.log('Stack started successfully!');
    console.log('');
    console.log('Status:');
    for (const status of statuses) {
      const indicator = status.status === 'running' ? '●' : '○';
      const statusText =
        status.status === 'running' ? 'running' : status.status;
      console.log(
        `  ${indicator} ${status.name.padEnd(20)} ${statusText.padEnd(10)} :${status.port}`,
      );
    }
    const proxyIndicator = '●';
    console.log(
      `  ${proxyIndicator} ${'proxy'.padEnd(20)} ${'running'.padEnd(10)} :${config.settings.litellm_port}`,
    );

    console.log('');
    console.log(
      `Unified endpoint: http://localhost:${config.settings.litellm_port}/v1`,
    );
    console.log('');
    console.log('Available models:');
    for (const model of runningModels) {
      console.log(`  - ${model.name}`);
    }

    // Report any failures
    const failedModels = statuses.filter((s) => s.status === 'failed');
    if (failedModels.length > 0) {
      console.log('');
      console.log('Failed models:');
      for (const status of failedModels) {
        console.log(`  - ${status.name}: ${status.error}`);
      }
      return 1; // Exit with error if any models failed
    }

    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Config error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
