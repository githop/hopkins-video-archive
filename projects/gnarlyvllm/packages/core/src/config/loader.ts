import { parse } from 'smol-toml';
import {
  GnarlyConfigSchema,
  type GnarlyConfig,
  type ResolvedModelConfig,
  type Quantization,
  type PerformanceMode,
  type KvCacheDtype,
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
  let performance_mode: PerformanceMode | undefined =
    model.defaults?.performance_mode;
  let kv_cache_dtype: KvCacheDtype | undefined = model.defaults?.kv_cache_dtype;
  let enforce_eager = model.defaults?.enforce_eager;
  let enable_tool_calling = model.defaults?.enable_tool_calling;
  let tool_call_parser = model.defaults?.tool_call_parser;
  let reasoning_parser = model.defaults?.reasoning_parser;
  let enable_expert_parallel = model.defaults?.enable_expert_parallel;
  let swap_space = model.defaults?.swap_space;
  let max_seq_len_to_capture = model.defaults?.max_seq_len_to_capture;
  let max_num_seqs = model.defaults?.max_num_seqs;
  let max_num_batched_tokens = model.defaults?.max_num_batched_tokens;
  let num_scheduler_steps = model.defaults?.num_scheduler_steps;
  let tokenizer = model.defaults?.tokenizer;
  let hf_config_path = model.defaults?.hf_config_path;
  let tensor_parallel_size = model.defaults?.tensor_parallel_size;
  let speculative_config = model.defaults?.speculative_config;
  let language_model_only = model.defaults?.language_model_only;
  let default_chat_template_kwargs =
    model.defaults?.default_chat_template_kwargs;
  let chat_template = model.defaults?.chat_template;
  let enable_prefix_caching = model.defaults?.enable_prefix_caching;
  let hf_overrides = model.defaults?.hf_overrides;

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
      if (overrides.performance_mode !== undefined)
        performance_mode = overrides.performance_mode;
      if (overrides.kv_cache_dtype !== undefined)
        kv_cache_dtype = overrides.kv_cache_dtype;
      if (overrides.enforce_eager !== undefined)
        enforce_eager = overrides.enforce_eager;
      if (overrides.enable_tool_calling !== undefined)
        enable_tool_calling = overrides.enable_tool_calling;
      if (overrides.tool_call_parser !== undefined)
        tool_call_parser = overrides.tool_call_parser;
      if (overrides.reasoning_parser !== undefined)
        reasoning_parser = overrides.reasoning_parser;
      if (overrides.enable_expert_parallel !== undefined)
        enable_expert_parallel = overrides.enable_expert_parallel;
      if (overrides.swap_space !== undefined) swap_space = overrides.swap_space;
      if (overrides.max_seq_len_to_capture !== undefined)
        max_seq_len_to_capture = overrides.max_seq_len_to_capture;
      if (overrides.max_num_seqs !== undefined)
        max_num_seqs = overrides.max_num_seqs;
      if (overrides.max_num_batched_tokens !== undefined)
        max_num_batched_tokens = overrides.max_num_batched_tokens;
      if (overrides.num_scheduler_steps !== undefined)
        num_scheduler_steps = overrides.num_scheduler_steps;
      if (overrides.tokenizer !== undefined) tokenizer = overrides.tokenizer;
      if (overrides.hf_config_path !== undefined)
        hf_config_path = overrides.hf_config_path;
      if (overrides.tensor_parallel_size !== undefined)
        tensor_parallel_size = overrides.tensor_parallel_size;
      if (overrides.speculative_config !== undefined)
        speculative_config = overrides.speculative_config;
      if (overrides.language_model_only !== undefined)
        language_model_only = overrides.language_model_only;
      if (overrides.default_chat_template_kwargs !== undefined)
        default_chat_template_kwargs = overrides.default_chat_template_kwargs;
      if (overrides.chat_template !== undefined)
        chat_template = overrides.chat_template;
      if (overrides.enable_prefix_caching !== undefined)
        enable_prefix_caching = overrides.enable_prefix_caching;
      if (overrides.hf_overrides !== undefined)
        hf_overrides = overrides.hf_overrides;
    }
  }

  return {
    name: modelName,
    ...model,
    gpu_memory_utilization,
    max_model_len,
    quantization,
    performance_mode,
    kv_cache_dtype,
    enforce_eager,
    enable_tool_calling,
    tool_call_parser,
    reasoning_parser,
    enable_expert_parallel,
    swap_space,
    max_seq_len_to_capture,
    max_num_seqs,
    max_num_batched_tokens,
    num_scheduler_steps,
    tokenizer,
    hf_config_path,
    tensor_parallel_size,
    speculative_config,
    language_model_only,
    default_chat_template_kwargs,
    chat_template,
    enable_prefix_caching,
    hf_overrides,
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
