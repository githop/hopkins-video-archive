import { z } from 'zod';
import { logger } from '@hop-hv-rag/core';
import { runClustering } from './cluster-engine.ts';

const DATA_DIR = `${import.meta.dir}/../../../data`;

const ParticipantClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      participant: z.string(),
      canonical: z.string(),
      category: z.string(),
      reasoning: z.string(),
    }),
  ),
});

async function main() {
  await runClustering({
    inputPath: `${DATA_DIR}/unique-participants.json`,
    outputPath: `${DATA_DIR}/participant-registry.json`,
    dbPath: `${DATA_DIR}/hv-rag.db`,
    dbQuery:
      'SELECT participants FROM videos UNION SELECT participants FROM scenes',
    dbColumn: 'participants',
    categoryFallback: 'PERSON',
    validCategories: ['PERSON', 'ROLE', 'DISCARD'],
    schema: ParticipantClassificationSchema,
    model: 'summarizer-bulk-14b',
    systemPrompt: `You are an expert family archivist for the Hopkins family video archive. Your goal is to normalize participant names while preserving their unique identity.

HOPKINS FAMILY NAME MAPPINGS (use these canonical forms):
- Gregory, Greg, Greggie, Greggy -> "Greg"
- Jeffrey, Jeff -> "Geoff"  
- Daniel, Dan, Danny -> "Danny"
- Daddy, Dad -> "Dad"
- Mommy, Mom, Mama -> "Mom"
- Grandma, Grandmother, Nana -> "Grandma"
- Grandpa, Grandfather, Papa -> "Grandpa"

RULES:
1. IDENTITY PRESERVATION: Never strip a specific name from a title.
   - "Uncle Matt" -> canonical: "Uncle Matt" (NOT "Uncle")
   - "Aunt Lisa" -> canonical: "Aunt Lisa" (NOT "Aunt")
   - "Mary Pat" -> canonical: "Mary Pat" (NOT "Mary")
   
2. NICKNAME NORMALIZATION: Merge common variants to canonical forms above.
   - "Gregory Hopkins" -> "Greg Hopkins"
   - "Jeffrey Thomas" -> "Geoff Thomas"
   
3. DISCARD POLICY - Mark as DISCARD:
   - Non-human entities: "dog", "camera", "cat"
   - Generic placeholders: "A person", "Another child", "Someone", "A man", "A woman"
   - Unidentified references: "Unidentified person", "Unknown", "A third person"
   - Groups without names: "The crowd", "Audience", "Group of people"
   - Objects or noise: "Camera operator", "The camera"

4. REASONING REQUIRED: You MUST provide meaningful reasoning for EVERY classification. Never output "No reasoning provided".

5. STRUCTURE: Return a JSON object with a "classifications" array. Each item MUST have "participant", "canonical", "category", and "reasoning" keys.

CATEGORIES:
- PERSON: A named individual or specific family member with an identifiable name.
- ROLE: A generic position that could be filled by anyone (e.g., "The priest", "Coach", "Announcer").
- DISCARD: Non-persons, generic placeholders, unidentified people, or noise.

EXAMPLES:
Input:
Gregory
A person
Uncle Matt
the priest
Another child
dog

Output:
{
  "classifications": [
    { "participant": "Gregory", "canonical": "Greg", "category": "PERSON", "reasoning": "Hopkins family nickname normalization: Gregory -> Greg" },
    { "participant": "A person", "canonical": "A person", "category": "DISCARD", "reasoning": "Generic unidentified placeholder, not a specific individual" },
    { "participant": "Uncle Matt", "canonical": "Uncle Matt", "category": "PERSON", "reasoning": "Family member with specific name, preserve full identity" },
    { "participant": "the priest", "canonical": "The Priest", "category": "ROLE", "reasoning": "Generic religious role, not a named individual" },
    { "participant": "Another child", "canonical": "Another child", "category": "DISCARD", "reasoning": "Generic placeholder for unidentified person" },
    { "participant": "dog", "canonical": "dog", "category": "DISCARD", "reasoning": "Non-human entity" }
  ]
}`,
  });
}

main().catch((err) => {
  logger.error(err, 'Error running participant clustering');
});
