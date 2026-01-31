import { z } from 'zod';
import {
  PersonSchema,
  LocationSchema,
  ActivitySchema,
  type Person,
  type Location,
  type Activity,
} from '@hop-hv-rag/db/validation';

// Re-export schemas for backward compatibility
// Person is called Participant in the search domain
export { PersonSchema as ParticipantSchema, LocationSchema, ActivitySchema };
export type { Person as Participant, Location, Activity };

/**
 * Schema for a source (scene) returned from the archive search
 */
export const SourceSchema = z.object({
  sceneId: z.number(),
  citationId: z.number(), // [1], [2], [3], etc.
  sceneTitle: z.string().nullable(),
  summary: z.string(),
  thumbnailUrl: z.string(),
  video: z.object({
    id: z.number(),
    title: z.string().nullable(),
    year: z.number().nullable(),
    yearStart: z.number().nullable().optional(),
    yearEnd: z.number().nullable().optional(),
    filename: z.string(), // Video filename for local streaming
    videoUrl: z.string(), // URL with timestamp: /videos/filename.m4v#t=95
    hasLocalFile: z.boolean(), // Whether local video file exists
  }),
  timestamp: z.object({
    startSeconds: z.number(),
    endSeconds: z.number(),
    formatted: z.string(), // "MM:SS"
  }),
  participants: z.array(PersonSchema),
  locations: z.array(LocationSchema),
  activities: z.array(ActivitySchema),
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
