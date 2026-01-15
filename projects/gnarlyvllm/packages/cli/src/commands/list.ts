import { loadConfig, ConfigError } from '@gnarlyvllm/core';

export async function listCommand(
  _args: string[],
  configPath?: string,
): Promise<number> {
  try {
    const config = await loadConfig(configPath);

    console.log('gnarlyvllm list');
    console.log('─'.repeat(50));

    // List models
    const models = Object.entries(config.models);
    if (models.length > 0) {
      console.log('Models:');
      for (const [name, model] of models) {
        console.log(`  - ${name.padEnd(20)} ${model.repo} (${model.task})`);
      }
    } else {
      console.log('No models defined.');
    }

    // List stacks
    const stacks = Object.entries(config.stacks);
    if (stacks.length > 0) {
      console.log('');
      console.log('Stacks:');
      for (const [name, stack] of stacks) {
        console.log(`  - ${name.padEnd(20)} [${stack.models.join(', ')}]`);
        if (stack.description) {
          console.log(`    ${stack.description}`);
        }
      }
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
