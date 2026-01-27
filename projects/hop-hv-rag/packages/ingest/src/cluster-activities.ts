import { z } from 'zod';
import { runClustering } from './cluster-engine.ts';

const DATA_DIR = `${import.meta.dir}/../../../data`;

const ActivityClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      activity: z.string(),
      canonical: z.string(),
      category: z.string(),
      reasoning: z.string(),
    }),
  ),
});

async function main() {
  await runClustering({
    inputPath: `${DATA_DIR}/unique-activities.json`,
    outputPath: `${DATA_DIR}/activity-registry.json`,
    dbPath: `${DATA_DIR}/hv-rag.db`,
    dbQuery:
      'SELECT activities FROM videos UNION SELECT activities FROM scenes',
    dbColumn: 'activities',
    categoryFallback: 'RECREATION',
    validCategories: ['SPORT', 'RECREATION', 'HOLIDAY', 'MILESTONE', 'DISCARD'],
    schema: ActivityClassificationSchema,
    model: 'summarizer-bulk-14b',
    systemPrompt: `You are an expert at categorizing family activities and events from home video archives.

CATEGORIES:
- SPORT: Organized athletic activities (football, tennis, wrestling, baseball, golf, skiing, basketball, soccer, track, gymnastics)
- RECREATION: Leisure activities (fishing, swimming, hiking, boating, hunting, camping, biking, playing in pool, card games, board games)
- HOLIDAY: Annual celebrations (Christmas, Easter, Thanksgiving, Halloween, Fourth of July, New Year, Valentine's Day)
- MILESTONE: Life events (birthday, baptism, wedding, graduation, funeral, anniversary, first day of school, prom, recital)
- DISCARD: Generic verbs, unclear references, non-activities

NORMALIZATION RULES:
1. Use noun forms: "fishing trip" -> "Fishing", "opening presents" -> "Opening Presents"
2. Preserve specificity when meaningful: "Football Practice" vs "Football Game" vs just "Football"
3. Merge obvious variants: "Xmas", "Christmas morning", "Christmas Eve" -> "Christmas"
4. Holiday activities stay as holiday: "Christmas dinner" -> "Christmas" (HOLIDAY, not just eating)
5. Birthday is MILESTONE, not HOLIDAY
6. Title case for all canonical names

DISCARD these:
- Generic verbs: "playing", "talking", "walking", "sitting", "watching", "eating", "running"
- Vague references: "activity", "event", "thing", "stuff", "fun"
- Non-activities: objects, locations, people names
- Camera/video references: "filming", "recording", "taping"

EXAMPLES:
Input:
went fishing
Christmas morning
Football game
playing
opening birthday presents
Greg's baptism
walking around

Output:
{
  "classifications": [
    { "activity": "went fishing", "canonical": "Fishing", "category": "RECREATION", "reasoning": "Leisure outdoor activity, normalized to noun form" },
    { "activity": "Christmas morning", "canonical": "Christmas", "category": "HOLIDAY", "reasoning": "Annual holiday celebration, normalized to base holiday name" },
    { "activity": "Football game", "canonical": "Football Game", "category": "SPORT", "reasoning": "Organized athletic event, preserved specificity of 'game'" },
    { "activity": "playing", "canonical": "playing", "category": "DISCARD", "reasoning": "Generic verb without specific activity context" },
    { "activity": "opening birthday presents", "canonical": "Birthday", "category": "MILESTONE", "reasoning": "Birthday is a life milestone event" },
    { "activity": "Greg's baptism", "canonical": "Baptism", "category": "MILESTONE", "reasoning": "Religious life milestone, normalized without person's name" },
    { "activity": "walking around", "canonical": "walking around", "category": "DISCARD", "reasoning": "Generic verb, not a meaningful activity" }
  ]
}

IMPORTANT:
- Always provide meaningful reasoning for EVERY classification
- Return valid JSON with a "classifications" array
- Each item MUST have "activity", "canonical", "category", and "reasoning" keys`,
  });
}

main().catch(console.error);
