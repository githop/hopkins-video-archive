import { logger } from '@hop-hv-rag/core';
import {
  type GenerationModelName,
  type EmbeddingModelName,
  type RerankingModelName,
} from './models.ts';

export interface ModelConfig {
  generation: GenerationModelName;
  embedding: EmbeddingModelName;
  reranking: RerankingModelName;
}

const DEFAULT_CONFIG: ModelConfig = {
  generation: 'summarizer-9b',
  embedding: 'embed-small',
  reranking: 'rerank-small',
} as const;

export function getDefaultConfig(): ModelConfig {
  return { ...DEFAULT_CONFIG };
}

export function resolveConfig(
  overrides: Partial<ModelConfig> = {},
): ModelConfig {
  return {
    generation: overrides.generation ?? DEFAULT_CONFIG.generation,
    embedding: overrides.embedding ?? DEFAULT_CONFIG.embedding,
    reranking: overrides.reranking ?? DEFAULT_CONFIG.reranking,
  };
}

export function logModelConfig(config: ModelConfig): void {
  logger.info(
    `Using models: gen=${config.generation}, embed=${config.embedding}, rerank=${config.reranking}`,
  );
}
