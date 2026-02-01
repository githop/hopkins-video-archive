import {
  loadConfig,
  resolveModelConfig,
  ConfigError,
  runContainer,
  getContainer,
  removeContainer,
  buildVllmContainerOptions,
  waitForVllmReady,
  checkVllmHealth,
  getVllmModelInfo,
  VLLM_IMAGE,
  pullImage,
  imageExists,
  generateLiteLLMConfig,
  buildLiteLLMContainerOptions,
  waitForLiteLLMReady,
  LITELLM_IMAGE,
  streamContainerLogs,
} from '@gnarlyvllm/core';

export async function serveCommand(
  args: string[],
  configPath?: string,
): Promise<number> {
  const [modelName] = args;

  if (!modelName) {
    console.error('Error: Model name required');
    console.error('Usage: gnarlyvllm serve <model>');
    return 1;
  }

  try {
    const config = await loadConfig(configPath);
    const model = resolveModelConfig(config, modelName);

    console.log(`Starting model: ${model.name}`);
    console.log(`  Repo: ${model.repo}`);
    console.log(`  Task: ${model.task}`);
    console.log(`  Port: ${model.port}`);
    if (model.quantization) {
      console.log(`  Quantization: ${model.quantization}`);
    }
    if (model.gpu_memory_utilization) {
      console.log(`  GPU Memory: ${model.gpu_memory_utilization}`);
    }
    if (model.max_model_len) {
      console.log(`  Max Context: ${model.max_model_len}`);
    }
    console.log('');

    // Check if container already exists
    const existing = await getContainer(modelName);
    if (existing) {
      if (existing.state === 'running') {
        console.log(`Model ${modelName} is already running.`);

        // Check if API is healthy
        if (await checkVllmHealth(model.port)) {
          const modelInfo = await getVllmModelInfo(model.port);
          console.log(`API healthy at http://localhost:${model.port}/v1`);
          if (modelInfo) {
            console.log(`Model loaded: ${modelInfo.id}`);
          }
        }
        return 0;
      }

      // Remove stopped container
      console.log('Removing existing stopped container...');
      await removeContainer(modelName, true);
    }

    // Check if image exists, pull if needed
    if (!(await imageExists(VLLM_IMAGE))) {
      console.log(`Pulling image: ${VLLM_IMAGE}`);
      const pullResult = await pullImage(VLLM_IMAGE);
      if (!pullResult.success) {
        console.error(`Failed to pull image: ${pullResult.error}`);
        return 1;
      }
    }

    if (!(await imageExists(LITELLM_IMAGE))) {
      console.log(`Pulling image: ${LITELLM_IMAGE}`);
      const pullResult = await pullImage(LITELLM_IMAGE);
      if (!pullResult.success) {
        console.error(`Failed to pull image: ${pullResult.error}`);
        return 1;
      }
    }

    // Get HF token from environment
    const hfToken = Bun.env.HF_TOKEN;

    // Build container options
    const containerOptions = buildVllmContainerOptions({
      name: modelName,
      model,
      settings: config.settings,
      hfToken,
    });

    console.log('Starting vLLM container...');

    const runResult = await runContainer(containerOptions);
    if (!runResult.success) {
      console.error(`Failed to start container: ${runResult.error}`);
      return 1;
    }

    console.log(`Container started: ${runResult.data}`);
    console.log('');
    console.log('Waiting for model to load (this may take a few minutes)...');
    console.log('Streaming logs...');
    console.log('─'.repeat(50));

    // Stream logs in background
    const logProc = streamContainerLogs(modelName);

    // Wait for vLLM to be ready
    const ready = await waitForVllmReady(model.port, 300000, 3000, modelName);

    // Stop log streaming
    logProc.kill();
    console.log('─'.repeat(50));

    if (!ready) {
      const container = await getContainer(modelName);
      console.error('');
      if (
        container &&
        (container.state === 'exited' || container.state === 'stopped')
      ) {
        console.error(
          'Model container exited unexpectedly. Check the logs above for errors.',
        );
      } else {
        console.error('Model failed to start within timeout.');
      }
      return 1;
    }

    console.log('Model is ready.');

    // Start LiteLLM proxy
    console.log('Starting LiteLLM proxy...');

    // Remove existing litellm container if any
    const existingLitellm = await getContainer('litellm');
    if (existingLitellm) {
      await removeContainer('litellm', true);
    }

    const litellmConfig = generateLiteLLMConfig([model], config.settings);
    const litellmContainerOptions = await buildLiteLLMContainerOptions({
      config: litellmConfig,
      settings: config.settings,
    });

    const litellmResult = await runContainer(litellmContainerOptions);
    if (!litellmResult.success) {
      console.error(`Failed to start LiteLLM: ${litellmResult.error}`);
      return 1;
    }

    const litellmReady = await waitForLiteLLMReady(
      config.settings.litellm_port,
      60000,
      1000,
      'litellm',
    );
    if (!litellmReady) {
      console.error('LiteLLM failed to start within timeout.');
      return 1;
    }

    console.log('LiteLLM proxy is ready.');
    console.log('');
    console.log('─'.repeat(50));
    console.log('Model served successfully!');
    console.log('');
    console.log(
      `  Unified API:  http://localhost:${config.settings.litellm_port}/v1`,
    );
    console.log(`  vLLM Backend: http://localhost:${model.port}/v1`);
    console.log('');

    const modelInfo = await getVllmModelInfo(model.port);
    if (modelInfo) {
      console.log(`  Model ID: ${modelInfo.id}`);
    }

    console.log('');
    console.log('Example usage:');
    console.log(
      `  curl http://localhost:${config.settings.litellm_port}/v1/chat/completions \\`,
    );
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(
      `    -d '{"model": "${model.name}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
    );

    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Config error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
