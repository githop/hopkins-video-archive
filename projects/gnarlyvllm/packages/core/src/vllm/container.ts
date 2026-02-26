/**
 * vLLM container configuration and management
 */

import { type ContainerRunOptions, getContainer } from '../podman/client.ts';
import type { ResolvedModelConfig, Settings } from '../config/schema.ts';

export const VLLM_IMAGE = 'docker.io/vllm/vllm-openai:latest';

export type VllmContainerConfig = {
  name: string;
  model: ResolvedModelConfig;
  settings: Settings;
  hfToken?: string;
  image?: string; // Custom image override
};

/**
 * Parse a numeric string with optional k/m suffix (e.g., "32k" -> 32768)
 */
function parseUnit(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;

  const match = value.toLowerCase().match(/^(\d+)([km])?$/);
  if (!match) return undefined;

  const num = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === 'k') return num * 1024;
  if (unit === 'm') return num * 1024 * 1024;
  return num;
}

/**
 * Build podman run options for a vLLM container
 */
export function buildVllmContainerOptions(
  config: VllmContainerConfig,
): ContainerRunOptions {
  const { name, model, settings, hfToken, image } = config;

  // Build environment variables
  const env: Record<string, string> = {};

  if (hfToken) {
    env['HF_TOKEN'] = hfToken;
    env['HUGGING_FACE_HUB_TOKEN'] = hfToken;
  }

  // Build vLLM command arguments
  // vLLM uses positional model argument: vllm serve <model> [options]
  // Note: The container entrypoint is already ["vllm", "serve"]
  const command: string[] = [
    model.repo,
    '--port',
    model.port.toString(),
    '--host',
    '0.0.0.0',
  ];

  // Enforce eager execution (disables torch.compile/cudagraphs)
  if (model.enforce_eager) {
    command.push('--enforce-eager');
  }

  // Task-specific configuration
  if (model.task === 'embed') {
    command.push('--runner', 'pooling', '--convert', 'embed');
  } else if (model.task === 'score') {
    command.push('--runner', 'pooling', '--convert', 'reward');
  }
  // 'generate' is the default, no flag needed

  // GPU memory utilization
  if (model.gpu_memory_utilization !== undefined) {
    command.push(
      '--gpu-memory-utilization',
      model.gpu_memory_utilization.toString(),
    );
  }

  // Max model length
  const maxModelLen = parseUnit(model.max_model_len);
  if (maxModelLen) {
    command.push('--max-model-len', maxModelLen.toString());
  }

  // Quantization method
  if (model.quantization) {
    command.push('--quantization', model.quantization);
  }

  // Trust remote code (needed for some models)
  command.push('--trust-remote-code');

  // Tool calling support
  if (model.enable_tool_calling) {
    command.push('--enable-auto-tool-choice');
  }
  if (model.tool_call_parser) {
    command.push('--tool-call-parser', model.tool_call_parser);
  }

  // HuggingFace specific config for GGUF/other formats
  if (model.tokenizer) {
    command.push('--tokenizer', model.tokenizer);
  }
  if (model.hf_config_path) {
    command.push('--hf-config-path', model.hf_config_path);
  }

  // Reasoning parser (independent of tool calling)
  if (model.reasoning_parser) {
    command.push('--reasoning-parser', model.reasoning_parser);
  }

  // Expert parallelism (required for some MoE models)
  if (model.enable_expert_parallel) {
    command.push('--enable-expert-parallel');
  }

  // Swap space (in GB)
  if (model.swap_space !== undefined) {
    command.push('--swap-space', model.swap_space.toString());
  }

  // Max sequence length to capture (usually matches max_model_len)
  if (model.max_seq_len_to_capture !== undefined) {
    command.push(
      '--max-seq-len-to-capture',
      model.max_seq_len_to_capture.toString(),
    );
  }

  // Throughput optimization flags
  if (model.max_num_seqs !== undefined) {
    command.push('--max-num-seqs', model.max_num_seqs.toString());
  }
  if (model.max_num_batched_tokens !== undefined) {
    command.push(
      '--max-num-batched-tokens',
      model.max_num_batched_tokens.toString(),
    );
  }
  if (model.num_scheduler_steps !== undefined) {
    command.push('--num-scheduler-steps', model.num_scheduler_steps.toString());
  }

  // Tensor parallelism (required for AWQ and large models)
  if (model.tensor_parallel_size !== undefined) {
    command.push(
      '--tensor-parallel-size',
      model.tensor_parallel_size.toString(),
    );
  }

  // Speculative decoding / Multi-token prediction
  if (model.speculative_config !== undefined) {
    command.push('--speculative-config', model.speculative_config);
  }

  // Language model only (skip vision encoder for multimodal models)
  if (model.language_model_only) {
    command.push('--language-model-only');
  }

  // Expand HF cache path
  const hfCache = settings.huggingface_cache.replace(/^~/, Bun.env.HOME || '');

  // Use custom image if specified on model, otherwise default
  const containerImage = image || model.image || VLLM_IMAGE;

  return {
    name,
    image: containerImage,
    ports: [{ host: model.port, container: model.port }],
    env,
    volumes: [{ host: hfCache, container: '/root/.cache/huggingface' }],
    devices: ['nvidia.com/gpu=all'],
    command,
    detach: true,
    pull: 'missing',
  };
}

/**
 * Check if vLLM API is healthy
 */
export async function checkVllmHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for vLLM API to be ready
 */
export async function waitForVllmReady(
  port: number,
  timeoutMs: number = 120000,
  pollIntervalMs: number = 2000,
  containerName?: string,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkVllmHealth(port)) {
      return true;
    }

    if (containerName) {
      const container = await getContainer(containerName);
      if (
        !container ||
        container.state === 'exited' ||
        container.state === 'stopped'
      ) {
        return false;
      }
    }

    await Bun.sleep(pollIntervalMs);
  }
  return false;
}

/**
 * Get vLLM model info from the API
 */
export async function getVllmModelInfo(
  port: number,
): Promise<{ id: string; object: string } | null> {
  try {
    const response = await fetch(`http://localhost:${port}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      data: Array<{ id: string; object: string }>;
    };
    return data.data?.[0] || null;
  } catch {
    return null;
  }
}
