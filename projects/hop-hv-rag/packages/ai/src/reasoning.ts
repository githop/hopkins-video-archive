import { generateText, streamText } from 'ai';
import { logger } from '@hop-hv-rag/core';

export type ReasoningTextResult<T> = T & {
  reasoningText?: string;
  reasoningDetails?: Array<{ type: 'reasoning'; text: string }>;
};

/**
 * Wrapper for generateText that extracts and provides type-safe reasoning content.
 * Supports both the newer reasoningText field and the legacy reasoning array format.
 */
export async function generateTextWithReasoning<
  T extends ReturnType<typeof generateText>,
>(
  options: Parameters<typeof generateText>[0],
): Promise<ReasoningTextResult<Awaited<T>>> {
  const result = (await generateText(options)) as Awaited<T>;

  // AI SDK 6.0.120+ provides reasoningText
  // Earlier versions or some providers might provide it in the reasoning array
  const reasoningText =
    (result as any).reasoningText || (result as any).reasoning?.[0]?.text;

  if (reasoningText) {
    logger.debug({ reasoning: reasoningText }, 'Model reasoning');
  }

  return {
    ...result,
    reasoningText,
    reasoningDetails: (result as any).reasoning,
  };
}

/**
 * Wrapper for streamText that provides consistent access.
 * Currently just a pass-through to maintain consistent imports.
 */
export function streamTextWithReasoning(
  options: Parameters<typeof streamText>[0],
): ReturnType<typeof streamText> {
  return streamText(options);
}

export {
  generateTextWithReasoning as generateText,
  streamTextWithReasoning as streamText,
};
