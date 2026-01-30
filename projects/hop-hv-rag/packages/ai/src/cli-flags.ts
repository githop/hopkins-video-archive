import { z } from 'zod';
import {
  GENERATION_MODELS,
  EMBEDDING_MODELS,
  RERANKING_MODELS,
} from './models.ts';
import type { ModelConfig } from './config.ts';

const GenModelEnum = z.enum([
  ...GENERATION_MODELS.VLLM,
  ...GENERATION_MODELS.GOOGLE,
]);

const EmbedModelEnum = z.enum([
  ...EMBEDDING_MODELS.VLLM,
  ...EMBEDDING_MODELS.GOOGLE,
]);

const RerankModelEnum = z.enum([
  ...RERANKING_MODELS.VLLM,
  ...RERANKING_MODELS.GOOGLE,
]);

export const CliModelSchema = z.object({
  'gen-model': GenModelEnum.optional().describe('Generation model'),
  'embed-model': EmbedModelEnum.optional().describe('Embedding model'),
  'rerank-model': RerankModelEnum.optional().describe('Reranking model'),
});

export type CliModelArgs = z.infer<typeof CliModelSchema>;

export function parseCliToModelConfig(args: unknown): Partial<ModelConfig> {
  const parsed = CliModelSchema.parse(args);

  return {
    generation: parsed['gen-model'],
    embedding: parsed['embed-model'],
    reranking: parsed['rerank-model'],
  };
}

export const parseArgsModelOptions = {
  'gen-model': { type: 'string' as const },
  'embed-model': { type: 'string' as const },
  'rerank-model': { type: 'string' as const },
};
