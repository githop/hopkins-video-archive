import { z } from 'zod';
import {
  GENERATION_MODELS,
  EMBEDDING_MODELS,
  type GenerationModelName,
  type EmbeddingModelName,
} from '@hop-hv-rag/ai';

/**
 * Ingest-specific defaults differ from the general AI package defaults.
 * - Generation: We prefer the bulk 14B model for ingest workloads
 * - Embedding: Same as AI package default (embed-qwen3-0.6b)
 */
const INGEST_DEFAULTS = {
  generation: 'ingest-qwen3.5-9b' as GenerationModelName,
  embedding: 'embed-qwen3-0.6b' as EmbeddingModelName,
} as const;

/**
 * Zod enums for validation
 */
const GenModelEnum = z.enum([
  ...GENERATION_MODELS.VLLM,
  ...GENERATION_MODELS.GOOGLE,
]);

const EmbedModelEnum = z.enum([
  ...EMBEDDING_MODELS.VLLM,
  ...EMBEDDING_MODELS.GOOGLE,
]);

/**
 * CLI flag options for node:util/parseArgs
 * Use these in your parseArgs options configuration
 */
export const GenModelFlagOption = { type: 'string' as const };
export const EmbedModelFlagOption = { type: 'string' as const };

/**
 * Zod schemas with ingest-specific defaults
 * These can be used for validation or as part of larger schemas
 */
export const GenModelFlagSchema = GenModelEnum.default(
  INGEST_DEFAULTS.generation,
);

export const EmbedModelFlagSchema = EmbedModelEnum.default(
  INGEST_DEFAULTS.embedding,
);

/**
 * Parse generation model flag with ingest default
 * @param value - The raw CLI value (possibly undefined)
 * @returns Validated generation model name
 */
export function parseGenModelFlag(value: unknown): GenerationModelName {
  return GenModelFlagSchema.parse(value);
}

/**
 * Parse embedding model flag with ingest default
 * @param value - The raw CLI value (possibly undefined)
 * @returns Validated embedding model name
 */
export function parseEmbedModelFlag(value: unknown): EmbeddingModelName {
  return EmbedModelFlagSchema.parse(value);
}

/**
 * Get the ingest-specific default generation model
 */
export function getIngestGenDefault(): GenerationModelName {
  return INGEST_DEFAULTS.generation;
}

/**
 * Get the ingest-specific default embedding model
 */
export function getIngestEmbedDefault(): EmbeddingModelName {
  return INGEST_DEFAULTS.embedding;
}
