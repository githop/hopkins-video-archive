/**
 * LiteLLM configuration generation
 *
 * LiteLLM acts as a unified proxy to route requests to the appropriate
 * vLLM backend based on the model name.
 */

import type { ResolvedModelConfig, Settings } from '../config/schema.ts';
import { getContainer } from '../podman/client.ts';

export const LITELLM_IMAGE = 'ghcr.io/berriai/litellm:main-latest';

export type LiteLLMModelConfig = {
  model_name: string;
  litellm_params: {
    model: string;
    api_base: string;
    api_key?: string;
    custom_llm_provider?: string;
  };
};

export type LiteLLMConfig = {
  model_list: LiteLLMModelConfig[];
  general_settings?: {
    master_key?: string;
  };
};

/**
 * Generate LiteLLM config YAML from gnarlyvllm models
 */
export function generateLiteLLMConfig(
  models: ResolvedModelConfig[],
  _settings: Settings,
): LiteLLMConfig {
  const modelList: LiteLLMModelConfig[] = models.map((model) => {
    // Determine the litellm model prefix based on task
    let litellmModel = model.repo;
    let customProvider: string | undefined;
    let apiBase = `http://host.containers.internal:${model.port}/v1`;

    if (model.task === 'embed') {
      // LiteLLM uses openai/ prefix for OpenAI-compatible endpoints
      litellmModel = `openai/${model.repo}`;
    } else if (model.task === 'score') {
      // Reranking models - use cohere protocol but clean model ID
      customProvider = 'cohere';
      // For rerank with custom provider, LiteLLM expects the base URL without /v1
      apiBase = `http://host.containers.internal:${model.port}`;
    } else {
      // Chat/generate models
      litellmModel = `openai/${model.repo}`;
    }

    return {
      model_name: model.name,
      litellm_params: {
        model: litellmModel,
        api_base: apiBase,
        api_key: 'dummy', // vLLM doesn't require auth by default
        custom_llm_provider: customProvider,
      },
    };
  });

  return {
    model_list: modelList,
  };
}

/**
 * Convert LiteLLM config to YAML string
 * Note: LiteLLM uses YAML, not TOML, so we need a simple YAML generator
 */
export function liteLLMConfigToYaml(config: LiteLLMConfig): string {
  const lines: string[] = [];

  lines.push('model_list:');
  for (const model of config.model_list) {
    lines.push(`  - model_name: ${model.model_name}`);
    lines.push('    litellm_params:');
    lines.push(`      model: ${model.litellm_params.model}`);
    lines.push(`      api_base: ${model.litellm_params.api_base}`);
    if (model.litellm_params.api_key) {
      lines.push(`      api_key: ${model.litellm_params.api_key}`);
    }
    if (model.litellm_params.custom_llm_provider) {
      lines.push(
        `      custom_llm_provider: ${model.litellm_params.custom_llm_provider}`,
      );
    }
  }

  if (config.general_settings) {
    lines.push('');
    lines.push('general_settings:');
    if (config.general_settings.master_key) {
      lines.push(`  master_key: ${config.general_settings.master_key}`);
    }
  }

  return lines.join('\n');
}

/**
 * Check if LiteLLM API is healthy
 */
export async function checkLiteLLMHealth(port: number): Promise<boolean> {
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
 * Wait for LiteLLM to be ready
 */
export async function waitForLiteLLMReady(
  port: number,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 1000,
  containerName?: string,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkLiteLLMHealth(port)) {
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
 * Get available models from LiteLLM
 */
export async function getLiteLLMModels(port: number): Promise<string[]> {
  try {
    const response = await fetch(`http://localhost:${port}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as { data: Array<{ id: string }> };
    return data.data?.map((m) => m.id) || [];
  } catch {
    return [];
  }
}
