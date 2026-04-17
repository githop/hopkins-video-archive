export const GENERATION_MODELS = {
  VLLM: [
    'chat-qwen3-4b',
    'ingest-qwen3-4b',
    'ingest-qwen3.5-9b',
    'ingest-qwen3-14b',
    'ingest-qwen3.5-27b',
    'ingest-qwen3-30b',
    'chat-qwen3.5-4b',
    'chat-qwen3-8b',
    'chat-qwen3.5-9b',
    'ingest-glm4.7-flash',
    'chat-gemma4-e2b',
    'chat-gemma4-e4b',
    'ingest-gemma4-31b',
  ] as const,
  GOOGLE: ['gemini-3-flash-preview'] as const,
} as const;

export const EMBEDDING_MODELS = {
  VLLM: ['embed-qwen3-4b', 'embed-qwen3-0.6b'] as const,
  GOOGLE: [] as const,
} as const;

export const RERANKING_MODELS = {
  VLLM: ['rerank-qwen3-4b', 'rerank-qwen3-0.6b'] as const,
  GOOGLE: [] as const,
} as const;

export type VllmGenerationModel = (typeof GENERATION_MODELS.VLLM)[number];
export type GoogleGenerationModel = (typeof GENERATION_MODELS.GOOGLE)[number];
export type GenerationModelName = VllmGenerationModel | GoogleGenerationModel;

export type VllmEmbeddingModel = (typeof EMBEDDING_MODELS.VLLM)[number];
export type GoogleEmbeddingModel = (typeof EMBEDDING_MODELS.GOOGLE)[number];
export type EmbeddingModelName = VllmEmbeddingModel | GoogleEmbeddingModel;

export type VllmRerankingModel = (typeof RERANKING_MODELS.VLLM)[number];
export type GoogleRerankingModel = (typeof RERANKING_MODELS.GOOGLE)[number];
export type RerankingModelName = VllmRerankingModel | GoogleRerankingModel;

export type ModelName =
  | GenerationModelName
  | EmbeddingModelName
  | RerankingModelName;

export function isGoogleModel(model: string): model is GoogleGenerationModel {
  return (GENERATION_MODELS.GOOGLE as readonly string[]).includes(model);
}

export function isVllmModel(model: string): model is VllmGenerationModel {
  return (GENERATION_MODELS.VLLM as readonly string[]).includes(model);
}

export function isGoogleEmbedModel(
  model: string,
): model is GoogleEmbeddingModel {
  return (EMBEDDING_MODELS.GOOGLE as readonly string[]).includes(model);
}

export function isVllmEmbedModel(model: string): model is VllmEmbeddingModel {
  return (EMBEDDING_MODELS.VLLM as readonly string[]).includes(model);
}

export function isGoogleRerankingModel(
  model: string,
): model is GoogleRerankingModel {
  return (RERANKING_MODELS.GOOGLE as readonly string[]).includes(model);
}

export function isVllmRerankModel(model: string): model is VllmRerankingModel {
  return (RERANKING_MODELS.VLLM as readonly string[]).includes(model);
}
