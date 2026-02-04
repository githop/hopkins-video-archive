/**
 * Validation schemas for database entities
 *
 * These schemas provide runtime validation for database query results.
 * They are manually defined to match the Drizzle schema structure
 * with strict enum validation for type fields.
 *
 * This provides:
 * - Runtime validation of database query results
 * - Type safety matching the database schema
 * - Centralized validation helpers
 */

import { z } from 'zod';

// ============================================================================
// ENTITIES (Unified)
// ============================================================================

export const EntityTypeSchema = z.enum([
  'PERSON',
  'ROLE',
  'PLACE',
  'SETTING',
  'ACTIVITY',
]);

export const ActivitySubtypeSchema = z.enum([
  'SPORT',
  'RECREATION',
  'HOLIDAY',
  'MILESTONE',
]);

export const EntitySchema = z.object({
  id: z.number(),
  name: z.string(),
  entityType: EntityTypeSchema,
  subtype: ActivitySubtypeSchema.nullable().optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

export function validateEntity(data: unknown): Entity {
  return EntitySchema.parse(data);
}

export function validateEntities(data: unknown[]): Entity[] {
  return data.map(validateEntity);
}
