/**
 * LiteLLM runtime model management
 * Hot-reload models without restarting the container
 */

import type { ResolvedModelConfig } from '../config/schema.ts';
import { getLiteLLMModels } from './config.ts';

/**
 * Add a new model to running LiteLLM instance
 */
export async function addModelToLiteLLM(
  port: number,
  model: ResolvedModelConfig,
): Promise<void> {
  const response = await fetch(`http://localhost:${port}/model/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_name: model.name,
      litellm_params: {
        model: `openai/${model.name}`,
        api_base: `http://host.containers.internal:${model.port}/v1`,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to add model to LiteLLM: ${text}`);
  }
}

/**
 * Remove a model from running LiteLLM instance
 */
export async function removeModelFromLiteLLM(
  port: number,
  modelName: string,
): Promise<void> {
  const response = await fetch(`http://localhost:${port}/model/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: modelName }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to remove model from LiteLLM: ${text}`);
  }
}

/**
 * Sync LiteLLM models to match desired state
 * Removes models that shouldn't be there, adds missing ones
 */
export async function syncLiteLLMModels(
  port: number,
  desiredModels: ResolvedModelConfig[],
): Promise<void> {
  // Get current models from LiteLLM
  const currentModelNames = await getLiteLLMModels(port);
  const desiredModelNames = desiredModels.map((m) => m.name);

  // Remove models that shouldn't be there
  for (const name of currentModelNames) {
    if (!desiredModelNames.includes(name)) {
      try {
        await removeModelFromLiteLLM(port, name);
      } catch (err) {
        // Log but continue - model might already be gone
        console.error(`Warning: Failed to remove model ${name}:`, err);
      }
    }
  }

  // Add new models
  for (const model of desiredModels) {
    if (!currentModelNames.includes(model.name)) {
      await addModelToLiteLLM(port, model);
    }
  }
}
