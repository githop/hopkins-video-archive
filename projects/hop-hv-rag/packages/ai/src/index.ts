import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  isGoogleModel,
  isVllmModel,
  isGoogleEmbedModel,
  isVllmEmbedModel,
} from './models.ts';
import type { EmbeddingModel, LanguageModel } from 'ai';

export * from './models.ts';

const VLLM_BASE_URL = 'http://localhost:4000/v1';

export type VllmProvider = ReturnType<typeof createOpenAICompatible>;
export type GoogleProvider = ReturnType<typeof createGoogleGenerativeAI>;
export type AIProvider = VllmProvider | GoogleProvider;

function getVllmProvider(): VllmProvider {
  return createOpenAICompatible({
    name: 'vllm',
    baseURL: VLLM_BASE_URL,
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

export function getGenModel(modelName: string = 'summarizer'): LanguageModel {
  if (isGoogleModel(modelName)) {
    return getGoogleProvider()(modelName);
  }

  if (isVllmModel(modelName)) {
    return getVllmProvider()(modelName);
  }

  throw new Error(`Unsupported generation model: ${modelName}`);
}

export function getEmbedModel(modelName: string = 'embed'): EmbeddingModel {
  if (isGoogleEmbedModel(modelName)) {
    return getGoogleProvider().textEmbeddingModel(modelName);
  }

  if (isVllmEmbedModel(modelName)) {
    return getVllmProvider().textEmbeddingModel(modelName);
  }

  throw new Error(`Unsupported embedding model: ${modelName}`);
}
