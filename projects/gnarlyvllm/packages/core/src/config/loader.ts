import { parse } from 'smol-toml';
import {
  GnarlyConfigSchema,
  type GnarlyConfig,
  type ResolvedModelConfig,
  type Quantization,
} from './schema.ts';

const CONFIG_FILENAME = 'gnarlyvllm.toml';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Load and validate config from gnarlyvllm.toml in the current directory
 */
export async function loadConfig(path?: string): Promise<GnarlyConfig> {
  const configPath = path ?? CONFIG_FILENAME;
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    throw new ConfigError(
      `Config file not found: ${configPath}\nRun 'gnarlyvllm config init' to create one.`,
    );
  }

  const content = await file.text();

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (err) {
    throw new ConfigError(
      `Failed to parse TOML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = GnarlyConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid config:\n${issues}`);
  }

  return result.data;
}

/**
 * Resolve a model config with optional stack overrides applied
 */
export function resolveModelConfig(
  config: GnarlyConfig,
  modelName: string,
  stackName?: string,
): ResolvedModelConfig {
  const model = config.models[modelName];
  if (!model) {
    throw new ConfigError(`Model not found: ${modelName}`);
  }

  // Start with model defaults
  let gpu_memory_utilization = model.defaults?.gpu_memory_utilization;
  let max_model_len = model.defaults?.max_model_len;
  let quantization: Quantization | undefined = model.defaults?.quantization;
  let enforce_eager = model.defaults?.enforce_eager;
  let enable_tool_calling = model.defaults?.enable_tool_calling;
  let reasoning_parser = model.defaults?.reasoning_parser;
  let max_num_seqs = model.defaults?.max_num_seqs;
  let max_num_batched_tokens = model.defaults?.max_num_batched_tokens;
  let num_scheduler_steps = model.defaults?.num_scheduler_steps;

  // Apply stack overrides if specified
  if (stackName) {
    const stack = config.stacks[stackName];
    if (!stack) {
      throw new ConfigError(`Stack not found: ${stackName}`);
    }
    if (!stack.models.includes(modelName)) {
      throw new ConfigError(
        `Model '${modelName}' is not part of stack '${stackName}'`,
      );
    }

    const overrides = stack.overrides?.[modelName];
    if (overrides) {
      if (overrides.gpu_memory_utilization !== undefined)
        gpu_memory_utilization = overrides.gpu_memory_utilization;
      if (overrides.max_model_len !== undefined)
        max_model_len = overrides.max_model_len;
      if (overrides.quantization !== undefined)
        quantization = overrides.quantization;
      if (overrides.enforce_eager !== undefined)
        enforce_eager = overrides.enforce_eager;
      if (overrides.enable_tool_calling !== undefined)
        enable_tool_calling = overrides.enable_tool_calling;
      if (overrides.reasoning_parser !== undefined)
        reasoning_parser = overrides.reasoning_parser;
      if (overrides.max_num_seqs !== undefined)
        max_num_seqs = overrides.max_num_seqs;
      if (overrides.max_num_batched_tokens !== undefined)
        max_num_batched_tokens = overrides.max_num_batched_tokens;
      if (overrides.num_scheduler_steps !== undefined)
        num_scheduler_steps = overrides.num_scheduler_steps;
    }
  }

  return {
    name: modelName,
    ...model,
    gpu_memory_utilization,
    max_model_len,
    quantization,
    enforce_eager,
    enable_tool_calling,
    reasoning_parser,
    max_num_seqs,
    max_num_batched_tokens,
    num_scheduler_steps,
  };
}

/**
 * Get all models for a stack with overrides applied
 */
export function resolveStackModels(
  config: GnarlyConfig,
  stackName: string,
): ResolvedModelConfig[] {
  const stack = config.stacks[stackName];
  if (!stack) {
    throw new ConfigError(`Stack not found: ${stackName}`);
  }

  return stack.models.map((modelName) =>
    resolveModelConfig(config, modelName, stackName),
  );
}

/**
 * Validate that all model references in stacks exist
 */
export function validateConfig(config: GnarlyConfig): string[] {
  const errors: string[] = [];
  const modelNames = new Set(Object.keys(config.models));

  for (const [stackName, stack] of Object.entries(config.stacks)) {
    for (const modelName of stack.models) {
      if (!modelNames.has(modelName)) {
        errors.push(
          `Stack '${stackName}' references unknown model '${modelName}'`,
        );
      }
    }

    // Check override references
    if (stack.overrides) {
      for (const modelName of Object.keys(stack.overrides)) {
        if (!stack.models.includes(modelName)) {
          errors.push(
            `Stack '${stackName}' has override for '${modelName}' which is not in its models list`,
          );
        }
      }
    }
  }

  // Check for port conflicts
  const ports = new Map<number, string>();
  for (const [name, model] of Object.entries(config.models)) {
    const existing = ports.get(model.port);
    if (existing) {
      errors.push(
        `Port ${model.port} is used by both '${existing}' and '${name}'`,
      );
    }
    ports.set(model.port, name);
  }

  return errors;
}
