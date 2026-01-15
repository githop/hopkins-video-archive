export const GENERATION_MODELS = {
  VLLM: ['summarizer', 'summarizer-bulk'] as const,
  GOOGLE: ['gemini-3-flash-preview'] as const,
} as const;

export const EMBEDDING_MODELS = {
  VLLM: ['embed'] as const,
  GOOGLE: [] as const,
} as const;

export type VllmGenerationModel = (typeof GENERATION_MODELS.VLLM)[number];
export type GoogleGenerationModel = (typeof GENERATION_MODELS.GOOGLE)[number];
export type GenerationModelName = VllmGenerationModel | GoogleGenerationModel;

export type VllmEmbeddingModel = (typeof EMBEDDING_MODELS.VLLM)[number];
export type GoogleEmbeddingModel = (typeof EMBEDDING_MODELS.GOOGLE)[number];
export type EmbeddingModelName = VllmEmbeddingModel | GoogleEmbeddingModel;

export type ModelName = GenerationModelName | EmbeddingModelName;

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
