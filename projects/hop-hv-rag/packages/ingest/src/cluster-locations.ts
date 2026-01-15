import { z } from 'zod';
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
    systemPrompt: `You are an expert family archivist. Your goal is to normalize location names while preserving their geographic or contextual identity.

RULES:
1. IDENTITY PRESERVATION: Keep specific names of places.
   - "Lake Cumberland" -> canonical: "Lake Cumberland"
   - "Yellowstone National Park" -> canonical: "Yellowstone"
   - "11th hole" -> canonical: "11th hole"
2. GENERALIZATION: Merge generic settings if they refer to the same type of space.
   - "in the kitchen" -> "Kitchen"
   - "living room area" -> "Living Room"
   - "A hospital room" -> "Hospital Room"
3. DISCARD POLICY: Only discard if it's strictly NOT a location or setting (e.g., "unknown", "camera", "random noise").
4. STRUCTURE: You MUST return a JSON object with a "classifications" array. Each item MUST have "location", "canonical", "category", and "reasoning" keys.

CATEGORIES:
- PLACE: A specific named geographic location, business, or landmark.
- SETTING: A generic room, environment, or type of space (e.g., "Park", "Kitchen", "Car").
- DISCARD: Noise or non-location entities.

EXAMPLES:
Input:
in the living room
76 Falls
on the boat
Yellowstone
unknown

Output:
{
  "classifications": [
    { "location": "in the living room", "canonical": "Living Room", "category": "SETTING", "reasoning": "Standardize generic home settings to title case" },
    { "location": "76 Falls", "canonical": "76 Falls", "category": "PLACE", "reasoning": "Preserve specific named geographic locations" },
    { "location": "on the boat", "canonical": "Boat", "category": "SETTING", "reasoning": "Generic environment, normalize to core noun" },
    { "location": "Yellowstone", "canonical": "Yellowstone", "category": "PLACE", "reasoning": "Recognized national park/landmark" },
    { "location": "unknown", "canonical": "Unknown", "category": "DISCARD", "reasoning": "Non-descriptive noise" }
  ]
}`,
  });
}

main().catch(console.error);
