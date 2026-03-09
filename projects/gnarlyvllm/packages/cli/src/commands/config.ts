import { loadConfig, validateConfig, ConfigError } from '@gnarlyvllm/core';

const EXAMPLE_CONFIG = `# gnarlyvllm.toml - Configuration for gnarlyvllm
# See gnarlyvllm.example.toml for full documentation

[settings]
litellm_port = 4000
huggingface_cache = "~/.cache/huggingface"

[models.qwen-7b-chat]
repo = "Qwen/Qwen2.5-7B-Instruct-AWQ"
task = "generate"
port = 8000

[models.qwen-7b-chat.defaults]
gpu_memory_utilization = 0.5
max_model_len = 32768

[stacks.default]
description = "Default chat model"
models = ["qwen-7b-chat"]
`;

export async function configCommand(
  args: string[],
  configPath?: string,
): Promise<number> {
  const [subcommand] = args;

  switch (subcommand) {
    case 'check':
      return checkConfig(configPath);
    case 'init':
      return initConfig();
    default:
      console.error('Usage: gnarlyvllm config <check|init>');
      return 1;
  }
}

async function checkConfig(configPath?: string): Promise<number> {
  try {
    const config = await loadConfig(configPath);
    const errors = validateConfig(config);

    if (errors.length > 0) {
      console.error('Config validation errors:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      return 1;
    }

    console.log('Config is valid!');
    console.log(`  Models: ${Object.keys(config.models).length}`);
    console.log(`  Stacks: ${Object.keys(config.stacks).length}`);
    console.log(`  Proxy port: ${config.settings.litellm_port}`);
    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

async function initConfig(): Promise<number> {
  const file = Bun.file('gnarlyvllm.toml');

  if (await file.exists()) {
    console.error(
      'gnarlyvllm.toml already exists. Remove it first to reinitialize.',
    );
    return 1;
  }

  await Bun.write('gnarlyvllm.toml', EXAMPLE_CONFIG);
  console.log('Created gnarlyvllm.toml');
  console.log('Edit the file to configure your models and stacks.');
  return 0;
}
