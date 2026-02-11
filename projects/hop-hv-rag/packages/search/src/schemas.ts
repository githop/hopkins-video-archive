import { z } from 'zod';
import { EntitySchema, type Entity } from '@hop-hv-rag/db/validation';

export { EntitySchema };
export type { Entity };

/**
 * Schema for a source chunk returned from the archive search
 */
export const SourceSchema = z.object({
  chunkId: z.number(),
  citationId: z.number(), // [1], [2], [3], etc.
  chunkTitle: z.string().nullable(),
  summary: z.string(),
  video: z.object({
    id: z.number(),
    title: z.string().nullable(),
    year: z.number().nullable(),
    yearStart: z.number().nullable().optional(),
    yearEnd: z.number().nullable().optional(),
    filename: z.string(), // Video filename — client derives media URLs from this
  }),
  timestamp: z.object({
    startSeconds: z.number(),
    endSeconds: z.number(),
    formatted: z.string(), // "HH:MM:SS"
  }),
  participants: z.array(EntitySchema),
  locations: z.array(EntitySchema),
  activities: z.array(EntitySchema),
  globalSummary: z.string().nullable().optional(),
});

export type Source = z.infer<typeof SourceSchema>;

/**
 * Stream chunk types for the unified streaming API
 */
export const StreamChunkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reasoning'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('result'),
    answer: z.string(),
    sources: z.array(SourceSchema),
    usedSourceIds: z.array(z.number()),
  }),
]);

export type StreamChunk = z.infer<typeof StreamChunkSchema>;

/**
 * Reasoning chunk (model is thinking)
 */
export type ReasoningChunk = Extract<StreamChunk, { type: 'reasoning' }>;

/**
 * Result chunk (final answer with sources)
 */
export type ResultChunk = Extract<StreamChunk, { type: 'result' }>;
