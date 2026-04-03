import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type {
  RerankingModelV3,
  RerankingModelV3CallOptions,
} from '@ai-sdk/provider';
import {
  isGoogleModel,
  isVllmModel,
  isGoogleEmbedModel,
  isVllmEmbedModel,
  isGoogleRerankingModel,
  isVllmRerankModel,
  type EmbeddingModelName,
  type GenerationModelName,
  type RerankingModelName,
} from './models.ts';
import type { EmbeddingModel, LanguageModel, RerankingModel } from 'ai';

export * from './models.ts';
export * from './config.ts';
export * from './cli-flags.ts';

const VLLM_BASE_URL = 'http://localhost:4000/v1';
export type VllmProvider = ReturnType<typeof createOpenAICompatible>;
export type GoogleProvider = ReturnType<typeof createGoogleGenerativeAI>;
export type AIProvider = VllmProvider | GoogleProvider;

function getVllmProvider(): VllmProvider {
  return createOpenAICompatible({
    name: 'vllm',
    baseURL: VLLM_BASE_URL,
    supportsStructuredOutputs: true,
  });
}

function getGoogleProvider(): GoogleProvider {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set',
    );
  }
  return createGoogleGenerativeAI({
    apiKey,
  });
}

export function getGenModel(
  modelName: GenerationModelName = 'ingest-qwen3-30b',
): LanguageModel {
  if (isGoogleModel(modelName)) {
    return getGoogleProvider()(modelName);
  }

  if (isVllmModel(modelName)) {
    return getVllmProvider()(modelName);
  }

  throw new Error(`Unsupported generation model: ${modelName}`);
}

export function getEmbedModel(
  modelName: EmbeddingModelName = 'embed-qwen3-4b',
): EmbeddingModel {
  if (isGoogleEmbedModel(modelName)) {
    return getGoogleProvider().textEmbeddingModel(modelName);
  }

  if (isVllmEmbedModel(modelName)) {
    return getVllmProvider().textEmbeddingModel(modelName);
  }

  throw new Error(`Unsupported embedding model: ${modelName}`);
}

interface LiteLLMRerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

/**
 * Custom Reranker for LiteLLM/vLLM since the official OpenAI-compatible
 * provider often lacks the .rerankingModel() implementation.
 */
class LiteLLMReranker implements RerankingModelV3 {
  readonly specificationVersion = 'v3';
  readonly provider = 'litellm';
  readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async doRerank({ query, documents }: RerankingModelV3CallOptions) {
    const response = await fetch(`${VLLM_BASE_URL}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelId,
        query,
        documents: documents.values.map((d) =>
          typeof d === 'string' ? d : JSON.stringify(d),
        ),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `LiteLLM Rerank failed (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as LiteLLMRerankResponse;

    return {
      ranking: data.results.map((r) => ({
        index: r.index,
        relevanceScore: r.relevance_score,
      })),
      warnings: [],
    };
  }
}

export function getRerankModel(
  modelName: RerankingModelName = 'rerank-qwen3-4b',
): RerankingModel {
  if (isGoogleRerankingModel(modelName)) {
    throw new Error('Google reranking not yet implemented in provider');
  }

  if (isVllmRerankModel(modelName)) {
    return new LiteLLMReranker(modelName) as unknown as RerankingModel;
  }

  throw new Error(`Unsupported reranking model: ${modelName}`);
}
