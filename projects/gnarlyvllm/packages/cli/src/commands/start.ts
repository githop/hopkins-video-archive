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
  generateLiteLLMConfig,
  buildLiteLLMContainerOptions,
  waitForLiteLLMReady,
  LITELLM_IMAGE,
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
    console.log(`  - litellm (proxy) @ :${config.settings.litellm_port}`);
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
    if (!(await imageExists(LITELLM_IMAGE))) {
      console.log(`Pulling ${LITELLM_IMAGE}...`);
      const pullResult = await pullImage(LITELLM_IMAGE);
      if (!pullResult.success) {
        console.error(`Failed to pull LiteLLM image: ${pullResult.error}`);
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

    // Start LiteLLM proxy
    console.log('');
    console.log('Starting LiteLLM proxy...');

    // Remove existing litellm container
    const existingLitellm = await getContainer('litellm');
    if (existingLitellm) {
      await removeContainer('litellm', true);
    }

    // Generate LiteLLM config for running models only
    const litellmConfig = generateLiteLLMConfig(runningModels, config.settings);
    const litellmContainerOptions = await buildLiteLLMContainerOptions({
      config: litellmConfig,
      settings: config.settings,
    });

    const litellmResult = await runContainer(litellmContainerOptions);
    if (!litellmResult.success) {
      console.error(`Failed to start LiteLLM: ${litellmResult.error}`);
      return 1;
    }

    // Wait for LiteLLM to be ready
    const litellmReady = await waitForLiteLLMReady(
      config.settings.litellm_port,
      60000,
      1000,
      'litellm',
    );
    if (!litellmReady) {
      const container = await getContainer('litellm');
      if (
        container &&
        (container.state === 'exited' || container.state === 'stopped')
      ) {
        console.error(
          'LiteLLM container exited unexpectedly. Check logs with: gnarlyvllm logs litellm',
        );
      } else {
        console.error(
          'LiteLLM failed to start. Check logs with: gnarlyvllm logs litellm',
        );
      }
      return 1;
    }

    console.log('  litellm: ready');

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
    console.log(
      `  ● ${'litellm'.padEnd(20)} ${'running'.padEnd(10)} :${config.settings.litellm_port}`,
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
