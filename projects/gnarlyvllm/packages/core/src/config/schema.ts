import { z } from 'zod';

// Model task types supported by vLLM
export const ModelTaskSchema = z.enum(['generate', 'embed', 'score']);
export type ModelTask = z.infer<typeof ModelTaskSchema>;

// Quantization methods supported by vLLM
export const QuantizationSchema = z.enum([
  'awq',
  'awq_marlin',
  'gptq',
  'fp8',
  'bitsandbytes',
  'gguf',
]);
export type Quantization = z.infer<typeof QuantizationSchema>;

// Model defaults (can be overridden in stacks)
export const ModelDefaultsSchema = z.object({
  gpu_memory_utilization: z.number().min(0).max(1).optional(),
  max_model_len: z.union([z.number().int().positive(), z.string()]).optional(),
  quantization: QuantizationSchema.optional(),
  enforce_eager: z.boolean().optional(),
  enable_tool_calling: z.boolean().optional(),
  reasoning_parser: z.string().optional(),
  max_num_seqs: z.number().int().positive().optional(),
  max_num_batched_tokens: z.number().int().positive().optional(),
  num_scheduler_steps: z.number().int().positive().optional(),
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
  enforce_eager?: boolean;
  enable_tool_calling?: boolean;
  reasoning_parser?: string;
  max_num_seqs?: number;
  max_num_batched_tokens?: number;
  num_scheduler_steps?: number;
};
