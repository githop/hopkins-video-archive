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
// PEOPLE (Participants)
// ============================================================================

/**
 * Zod schema for people table with strict type enum validation
 */
export const PersonSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['PERSON', 'ROLE']),
});

export type Person = z.infer<typeof PersonSchema>;

/**
 * Validate a person object (single)
 * @throws ZodError if validation fails
 */
export function validatePerson(data: unknown): Person {
  return PersonSchema.parse(data);
}

/**
 * Validate multiple person objects
 * @throws ZodError if any validation fails
 */
export function validatePeople(data: unknown[]): Person[] {
  return data.map(validatePerson);
}

// ============================================================================
// LOCATIONS
// ============================================================================

/**
 * Zod schema for locations table with strict type enum validation
 */
export const LocationSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['PLACE', 'SETTING', 'DISCARD']),
});

export type Location = z.infer<typeof LocationSchema>;

/**
 * Validate a location object (single)
 */
export function validateLocation(data: unknown): Location {
  return LocationSchema.parse(data);
}

/**
 * Validate multiple location objects
 */
export function validateLocations(data: unknown[]): Location[] {
  return data.map(validateLocation);
}

// ============================================================================
// ACTIVITIES
// ============================================================================

/**
 * Zod schema for activities table with strict type enum validation
 */
export const ActivitySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.enum(['SPORT', 'RECREATION', 'HOLIDAY', 'MILESTONE', 'DISCARD']),
});

export type Activity = z.infer<typeof ActivitySchema>;

/**
 * Validate an activity object (single)
 */
export function validateActivity(data: unknown): Activity {
  return ActivitySchema.parse(data);
}

/**
 * Validate multiple activity objects
 */
export function validateActivities(data: unknown[]): Activity[] {
  return data.map(validateActivity);
}

// ============================================================================
// BATCH VALIDATION HELPERS
// ============================================================================

/**
 * Validate database query results for a scene
 * Returns validated participants, locations, and activities
 */
export function validateSceneEntities(params: {
  participants: unknown[];
  locations: unknown[];
  activities: unknown[];
}): {
  participants: Person[];
  locations: Location[];
  activities: Activity[];
} {
  return {
    participants: validatePeople(params.participants),
    locations: validateLocations(params.locations),
    activities: validateActivities(params.activities),
  };
}
