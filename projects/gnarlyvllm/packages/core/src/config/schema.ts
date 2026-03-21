import { z } from 'zod';

// Model task types supported by vLLM
export const ModelTaskSchema = z.enum(['generate', 'embed', 'score']);
export type ModelTask = z.infer<typeof ModelTaskSchema>;

// Performance modes supported by vLLM
export const PerformanceModeSchema = z.enum([
  'balanced',
  'interactivity',
  'throughput',
]);
export type PerformanceMode = z.infer<typeof PerformanceModeSchema>;

// KV cache data types supported by vLLM
export const KvCacheDtypeSchema = z.enum([
  'auto',
  'fp16',
  'bf16',
  'fp8',
  'fp8_e4m3',
  'fp8_e5m2',
]);
export type KvCacheDtype = z.infer<typeof KvCacheDtypeSchema>;

// Quantization methods supported by vLLM
export const QuantizationSchema = z.enum([
  'awq',
  'awq_marlin',
  'gptq',
  'gptq_marlin',
  'fp8',
  'bitsandbytes',
  'gguf',
  'compressed-tensors',
]);
export type Quantization = z.infer<typeof QuantizationSchema>;

// Model defaults (can be overridden in stacks)
export const ModelDefaultsSchema = z.object({
  gpu_memory_utilization: z.number().min(0).max(1).optional(),
  max_model_len: z.union([z.number().int().positive(), z.string()]).optional(),
  quantization: QuantizationSchema.optional(),
  performance_mode: PerformanceModeSchema.optional(),
  kv_cache_dtype: KvCacheDtypeSchema.optional(),
  enforce_eager: z.boolean().optional(),
  enable_tool_calling: z.boolean().optional(),
  tool_call_parser: z.string().optional(),
  reasoning_parser: z.string().optional(),
  enable_expert_parallel: z.boolean().optional(),
  swap_space: z.number().int().positive().optional(),
  max_seq_len_to_capture: z.number().int().positive().optional(),
  max_num_seqs: z.number().int().positive().optional(),
  max_num_batched_tokens: z.number().int().positive().optional(),
  num_scheduler_steps: z.number().int().positive().optional(),
  tokenizer: z.string().optional(),
  hf_config_path: z.string().optional(),
  tensor_parallel_size: z.number().int().positive().optional(),
  speculative_config: z.string().optional(),
  language_model_only: z.boolean().optional(),
  default_chat_template_kwargs: z.string().optional(),
  chat_template: z.string().optional(),
  enable_prefix_caching: z.boolean().optional(),
  hf_overrides: z.string().optional(),
  generation_config: z.string().optional(),
  override_generation_config: z.record(z.any()).optional(),
});
export type ModelDefaults = z.infer<typeof ModelDefaultsSchema>;

// Individual model configuration
export const ModelConfigSchema = z.object({
  repo: z.string(), // HuggingFace repo ID
  task: ModelTaskSchema,
  port: z.number().int().min(1024).max(65535),
  image: z.string().optional(), // Custom vLLM image override
  defaults: ModelDefaultsSchema.optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// Stack overrides for a specific model
export const StackOverridesSchema = z.record(z.string(), ModelDefaultsSchema);
export type StackOverrides = z.infer<typeof StackOverridesSchema>;

// Stack configuration
export const StackConfigSchema = z.object({
  description: z.string().optional(),
  models: z.array(z.string()).min(1),
  overrides: StackOverridesSchema.optional(),
});
export type StackConfig = z.infer<typeof StackConfigSchema>;

// Global settings
export const SettingsSchema = z.object({
  litellm_port: z.number().int().min(1024).max(65535).default(4000),
  huggingface_cache: z.string().default('~/.cache/huggingface'),
});
export type Settings = z.infer<typeof SettingsSchema>;

// Complete config file schema
export const GnarlyConfigSchema = z.object({
  settings: SettingsSchema.optional().default({}),
  models: z.record(z.string(), ModelConfigSchema).default({}),
  stacks: z.record(z.string(), StackConfigSchema).optional().default({}),
});
export type GnarlyConfig = z.infer<typeof GnarlyConfigSchema>;

// Resolved model config (after applying stack overrides)
export type ResolvedModelConfig = ModelConfig & {
  name: string;
  gpu_memory_utilization?: number;
  max_model_len?: number | string;
  quantization?: Quantization;
  performance_mode?: PerformanceMode;
  kv_cache_dtype?: KvCacheDtype;
  enforce_eager?: boolean;
  enable_tool_calling?: boolean;
  tool_call_parser?: string;
  reasoning_parser?: string;
  enable_expert_parallel?: boolean;
  swap_space?: number;
  max_seq_len_to_capture?: number;
  max_num_seqs?: number;
  max_num_batched_tokens?: number;
  num_scheduler_steps?: number;
  tokenizer?: string;
  hf_config_path?: string;
  tensor_parallel_size?: number;
  speculative_config?: string;
  language_model_only?: boolean;
  default_chat_template_kwargs?: string;
  chat_template?: string;
  enable_prefix_caching?: boolean;
  hf_overrides?: string;
  generation_config?: string;
  override_generation_config?: Record<string, any>;
};
