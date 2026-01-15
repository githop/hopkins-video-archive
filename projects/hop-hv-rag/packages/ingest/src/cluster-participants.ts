import { z } from 'zod';
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
    systemPrompt: `You are an expert family archivist. Your goal is to normalize participant names while preserving 100% of their unique identity.

RULES:
1. IDENTITY PRESERVATION: Never strip a specific name from a title. 
   - "Uncle Matt" -> canonical: "Uncle Matt" (NOT "Uncle")
   - "Aunt Lisa" -> canonical: "Aunt Lisa" (NOT "Aunt")
   - "Mary Pat" -> canonical: "Mary Pat" (NOT "Mary")
2. NICKNAMES: Only merge if they are common variants of the SAME person.
   - "Gregory" -> "Greg"
   - "Mommy" -> "Mom"
3. DISCARD POLICY: Only discard if it's strictly NOT a person or role (e.g., "dog", "camera", "unknown").
4. STRUCTURE: You MUST return a JSON object with a "classifications" array. Each item MUST have "participant", "canonical", "category", and "reasoning" keys.

CATEGORIES:
- PERSON: A named individual or specific family member.
- ROLE: A generic position (e.g., "The priest", "Coach").
- DISCARD: Noise or non-human entities.

EXAMPLES:
Input:
Gregory
Uncle Matt
the priest
dog

Output:
{
  "classifications": [
    { "participant": "Gregory", "canonical": "Greg", "category": "PERSON", "reasoning": "Standard nickname normalization" },
    { "participant": "Uncle Matt", "canonical": "Uncle Matt", "category": "PERSON", "reasoning": "Preserve identity by keeping the name" },
    { "participant": "the priest", "canonical": "The priest", "category": "ROLE", "reasoning": "Generic social/religious role" },
    { "participant": "dog", "canonical": "Dog", "category": "DISCARD", "reasoning": "Non-human entity" }
  ]
}`,
  });
}

main().catch(console.error);
