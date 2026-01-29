import { z } from 'zod';

/**
 * Schema for a participant in a scene
 */
export const ParticipantSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['PERSON', 'ROLE']),
});

export type Participant = z.infer<typeof ParticipantSchema>;

/**
 * Schema for a location in a scene
 */
export const LocationSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['PLACE', 'SETTING', 'DISCARD']),
});

export type Location = z.infer<typeof LocationSchema>;

/**
 * Schema for an activity in a scene
 */
export const ActivitySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['SPORT', 'RECREATION', 'HOLIDAY', 'MILESTONE', 'DISCARD']),
});

export type Activity = z.infer<typeof ActivitySchema>;

/**
 * Schema for a source (scene) returned from the archive search
 */
export const SourceSchema = z.object({
  sceneId: z.number(),
  sceneTitle: z.string().nullable(),
  summary: z.string(),
  thumbnailUrl: z.string(),
  video: z.object({
    id: z.number(),
    title: z.string().nullable(),
    year: z.number().nullable(),
    yearStart: z.number().nullable().optional(),
    yearEnd: z.number().nullable().optional(),
    driveId: z.string(),
  }),
  timestamp: z.object({
    startSeconds: z.number(),
    endSeconds: z.number(),
    formatted: z.string(), // "MM:SS"
  }),
  participants: z.array(ParticipantSchema),
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
