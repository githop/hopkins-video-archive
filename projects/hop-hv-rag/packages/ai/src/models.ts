export const GENERATION_MODELS = {
  VLLM: [
    'summarizer',
    'summarizer-bulk',
    'summarizer-bulk-14b',
    'summarizer-bulk-30b',
    'summarizer-8b',
    'summarizer-bulk-glm-flash',
  ] as const,
  GOOGLE: ['gemini-3-flash-preview'] as const,
} as const;

export const EMBEDDING_MODELS = {
  VLLM: ['embed', 'embed-small'] as const,
  GOOGLE: [] as const,
} as const;

export const RERANKING_MODELS = {
  VLLM: ['rerank', 'rerank-small'] as const,
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
