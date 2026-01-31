import { z } from 'zod';
import { logger } from '@hop-hv-rag/core';
import { runClustering } from './cluster-engine.ts';

const DATA_DIR = `${import.meta.dir}/../../../data`;

const LocationClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      location: z.string(),
      canonical: z.string(),
      category: z.string(),
      reasoning: z.string(),
    }),
  ),
});

async function main() {
  await runClustering({
    inputPath: `${DATA_DIR}/unique-locations.json`,
    outputPath: `${DATA_DIR}/location-registry.json`,
    dbPath: `${DATA_DIR}/hv-rag.db`,
    dbQuery: 'SELECT locations FROM videos UNION SELECT locations FROM scenes',
    dbColumn: 'locations',
    categoryFallback: 'SETTING',
    validCategories: ['PLACE', 'SETTING', 'DISCARD'],
    schema: LocationClassificationSchema,
    model: 'summarizer-bulk-14b',
    systemPrompt: `You are an expert family archivist for the Hopkins family video archive. Your goal is to normalize location names while preserving their geographic or contextual identity.

HOPKINS FAMILY LOCATION MAPPINGS (use these canonical forms):
- Lake Cumberland, Lake Cumberland Kentucky, Cumberland Lake -> "Lake Cumberland"
- Grandma's house, Grandmother's house, Grandma's home -> "Grandma's House"
- Grandpa's house, Grandfather's house, Grandpa's home -> "Grandpa's House"
- Mom and Dad's house, Parents' house, The house -> "Home"
- Aunt Teresa's, Aunt Teresa's house, Aunt Teresa's home -> "Aunt Teresa's House"
- Uncle's house, Uncle's home -> Keep the specific name (e.g., "Uncle Matt's House")

RULES:
1. IDENTITY PRESERVATION: Keep specific names of places and landmarks.
   - "Lake Cumberland" -> canonical: "Lake Cumberland"
   - "Yellowstone National Park" -> canonical: "Yellowstone"
   - "76 Falls" -> canonical: "76 Falls"
   - "11th hole at the challenge" -> canonical: "11th Hole - The Challenge"

2. SETTING NORMALIZATION: Merge generic settings to clean title case forms.
   - "in the kitchen" -> "Kitchen"
   - "living room area" -> "Living Room"
   - "A hospital room" -> "Hospital Room"
   - "on the boat" -> "Boat"

3. DISCARD POLICY - Mark as DISCARD:
   - Unknown/indeterminate: "Unknown", "Unknown location", "Indeterminate", "Unknown room"
   - Non-locations: "Mind", "The journey", "Between the lines"
   - Events/activities (not places): "Abigail's baptism", "Thanksgiving gathering", "Battleship game"
   - Objects: "Easter basket", "Pen", "Teddy", "Coke"
   - Numbers without context: "70", "81", "2-4"
   - Generic unidentifiable: "An unspecified location", "Front of the group"

4. REASONING REQUIRED: You MUST provide meaningful reasoning for EVERY classification. Never output "No reasoning provided" or just "Processed".

5. STRUCTURE: Return a JSON object with a "classifications" array. Each item MUST have "location", "canonical", "category", and "reasoning" keys.

CATEGORIES:
- PLACE: A specific named geographic location, business, landmark, or someone's home (e.g., "Lake Cumberland", "Aunt Teresa's House", "Alaska").
- SETTING: A generic room, environment, or type of space that could be anywhere (e.g., "Kitchen", "Backyard", "Hospital Room", "Boat").
- DISCARD: Non-locations, unknown/indeterminate entries, events, objects, or noise.

EXAMPLES:
Input:
in the living room
Lake Cumberland, Kentucky
on the boat
Unknown location
Abigail's baptism
Grandma's house

Output:
{
  "classifications": [
    { "location": "in the living room", "canonical": "Living Room", "category": "SETTING", "reasoning": "Generic home setting, normalize to title case" },
    { "location": "Lake Cumberland, Kentucky", "canonical": "Lake Cumberland", "category": "PLACE", "reasoning": "Hopkins family location mapping: normalize to 'Lake Cumberland'" },
    { "location": "on the boat", "canonical": "Boat", "category": "SETTING", "reasoning": "Generic vehicle/environment, normalize to core noun" },
    { "location": "Unknown location", "canonical": "Unknown location", "category": "DISCARD", "reasoning": "Indeterminate/unknown entry provides no location information" },
    { "location": "Abigail's baptism", "canonical": "Abigail's baptism", "category": "DISCARD", "reasoning": "This is an event, not a location" },
    { "location": "Grandma's house", "canonical": "Grandma's House", "category": "PLACE", "reasoning": "Hopkins family location: specific family home" }
  ]
}`,
  });
}

main().catch((err) => {
  logger.error(err, 'Error running location clustering');
});
