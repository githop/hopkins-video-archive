/**
 * LLM Prompts and Schemas for the Ingest Package
 *
 * This file centralizes all prompts and Zod schemas used for AI interactions in the ingestion pipeline.
 * Keeping prompts and their corresponding schemas together ensures they stay synchronized.
 */

import { z } from 'zod';

// ============================================================================
// Scene Summarization Prompts
// ============================================================================

/**
 * Schema for scene extraction structured output.
 * Used with SCENE_SUMMARIZATION_PROMPT in summarize-scenes.ts
 */
export const SceneSummarizationSchema = z.object({
  title: z.string().optional(),
  scene_title: z.string().optional(),
  summary: z.string().optional(),
  narrative_summary: z.string().optional(),
  participants: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  activities: z.array(z.string()).default([]),
});
/**
 * System prompt for scene extraction and summarization from transcript segments.
 * Used in summarize-scenes.ts
 */
export const SCENE_SUMMARIZATION_PROMPT = `You are an expert film archivist cataloging the Hopkins family video archive.
Analyze the home video transcript segment and provide a high-quality archival summary.

HOPKINS FAMILY NAME MAPPINGS (use these canonical forms):
- Gregory, Greggie, Greggy → "Greg"
- Jeffrey, Jeff → "Geoff"
- Daniel, Dan → "Danny"
- Daddy, Dad, Father → "Dad"
- Mommy, Mom, Mama, Mother → "Mom"
- Grandma, Grandmother, Nana → "Grandma"
- Grandpa, Grandfather, Papa → "Grandpa"
- Keep specific names with titles: "Uncle Matt", "Aunt Lisa", "Aunt Teresa"

RULES:
1. TITLE CREATION: Create a short, descriptive title (5-10 words) that captures the main event.
   - "Christmas morning at Grandma's house" → "Christmas Morning at Grandma's House"
   - "Greg and Danny playing football in the backyard" → "Greg and Danny Playing Football"
   - "Family fishing trip to Lake Cumberland" → "Fishing Trip to Lake Cumberland"

2. SUMMARY WRITING: Write a concise narrative paragraph (3-4 sentences) containing SPECIFIC FACTS and EVENTS.
   - Report the CONTENT of conversations as facts rather than meta-descriptions.
   - Include specific details: numbers, names, outcomes, and results.
   - Start directly with events - avoid "The video captures..." or "This shows..."
   - [0.00s] Greg: How old are you now? [2.50s] Danny: I'm turning eight next week! → "Danny mentions he is turning eight years old next week."
   - [10.00s] Mom: We caught 12 fish today! [15.00s] Dad: That's a new record! → "The family caught 12 fish during their trip, which Dad notes is a new record."

3. PARTICIPANT EXTRACTION: Extract people mentioned, speaking, or visible using actual names.
   - "Hey Greg, come over here!" → participants: ["Greg"]
   - "Grandma made cookies for us" → participants: ["Grandma"]
   - "Coach Johnson said good game" → participants: ["Coach Johnson"]
   - NEVER use generic placeholders: "A person", "Someone", "A man", "A woman", "Another child"
   - If you cannot identify someone, omit them rather than using a generic label

4. LOCATION EXTRACTION: Extract specific places, rooms, or settings mentioned.
   - "We're at Lake Cumberland this weekend" → locations: ["Lake Cumberland"]
   - "Grandma's house has a big backyard" → locations: ["Grandma's House"]
   - "Meet me in the kitchen" → locations: ["Kitchen"]
   - NEVER use: "Unknown", "Unknown location", "Unspecified", "A room"
   - If location is unclear, omit it rather than guessing

5. ACTIVITY EXTRACTION: Extract activities, events, or occasions using noun forms.
   - "We're going fishing tomorrow" → activities: ["Fishing"]
   - "It's Christmas morning!" → activities: ["Christmas"]
   - "Greg is having his birthday party" → activities: ["Birthday"]
   - Use noun forms: "Fishing" not "went fishing", "Christmas" not "Christmas morning"
   - Be specific when context is clear: "Football Practice" vs just "Football"
   - NEVER use generic verbs: "playing", "talking", "walking", "sitting", "watching"
   - If no clear activity/event is depicted, return empty array []

STRUCTURE: Return a JSON object with exactly these keys: "title", "summary", "participants", "locations", "activities".

EXAMPLE:
Transcript:
[0.00s] Mom: Everyone come to the kitchen, we're ready to sing!
[3.50s] Greg: Is it time for cake?
[5.00s] Danny: Happy birthday Greg!
[8.00s] Uncle Matt: Make a wish before you blow out the candles.
[12.00s] Grandma: We're at Grandma's house for the party.

Output:
{
  "title": "Greg's Birthday Party at Grandma's",
  "summary": "The family gathers in Grandma's kitchen to celebrate Greg's birthday. Mom calls everyone together to sing while Greg prepares to blow out the candles on his cake. Uncle Matt encourages Greg to make a wish before blowing out the candles.",
  "participants": ["Greg", "Mom", "Danny", "Uncle Matt", "Grandma"],
  "locations": ["Grandma's House", "Kitchen"],
  "activities": ["Birthday", "Singing"]
}`;

// ============================================================================
// Global Summary Prompts
// ============================================================================

/**
 * System prompt for generating global archival abstracts from scene summaries.
 * Used in summarize-global.ts
 */
export const GLOBAL_SUMMARY_PROMPT = `You are an expert film archivist cataloging the Hopkins family video archive.
Your task is to write a "Global Archival Abstract" for a home video, based ONLY on the provided chronological log of its scenes.

GOAL:
Synthesize a 2-3 paragraph narrative summary that captures the "big picture" of the tape.

GUIDELINES:
1. Focus on the Overarching Narrative: specific events, locations, and the flow of time.
2. Identify Key People: Mention who is central to the tape (e.g., "The video primarily follows Greg and his cousins...").
3. Highlight Significance: What makes this tape memorable? (e.g., "Captures a rare family reunion" or "Documents a historic blizzard").
4. Style: Formal but warm archival tone. Use complete sentences.
5. Content Only: Do not include meta-text like "Here is the summary" or markdown formatting. Just the paragraphs.
6. GROUNDING: Do not hallucinate details not present in the SCENE LOG.`;

// ============================================================================
// Temporal Extraction Prompts
// ============================================================================

/**
 * Schema for temporal metadata extraction structured output.
 * Used with TEMPORAL_EXTRACTION_SYSTEM_PROMPT in extract-temporal.ts
 */
export const TemporalExtractionSchema = z.object({
  yearStart: z.number().int().min(1960).max(2030),
  yearEnd: z.number().int().min(1960).max(2030),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string(),
});

/**
 * System prompt for temporal metadata extraction.
 * Used in extract-temporal.ts
 */
export const TEMPORAL_EXTRACTION_SYSTEM_PROMPT = `You are an expert film archivist for the Hopkins family video archive specializing in chronological analysis.
Your task is to determine the recording year(s) for home videos by analyzing both explicit date mentions in scene content and filename patterns.

RULES:
1. YEAR RANGE: yearStart and yearEnd define the recording period. For single-year videos, set both to the same value.
   - Filename "1984-1985 Ski Trip.mp4" with scenes mentioning both years → yearStart: 1984, yearEnd: 1985
   - Filename "1984-1985 Ski Trip.mp4" but scenes only mention 1984 → yearStart: 1984, yearEnd: 1984

2. EVIDENCE HIERARCHY (in order of reliability):
   - PRIMARY: Explicit year mentions in scene content with full dates (e.g., "February 27, 1988", "Christmas 1993", "July 1st, 1986")
   - SECONDARY: Year patterns in filename with supporting scene context (e.g., filename "1987-1988" + scenes showing winter coat then summer clothes)
   - TERTIARY: Age references that can be cross-referenced with known birth years or milestone events

3. CONFIDENCE LEVELS:
   - "high": Multiple explicit year/date mentions in scene content with clear corroboration
   - "medium": Year inferred from filename pattern with supporting contextual evidence from scenes
   - "low": Pure guess based on filename alone with no corroborating scene content

4. EVIDENCE FIELD: Write a clear, factual sentence citing specific evidence. Reference scene numbers/positions and exact quotes when possible.

EXAMPLES:

Example 1 - HIGH CONFIDENCE (Explicit dates spanning years):
FILENAME: 1987-1988-1.m4v
SCENES:
- [00:00] Karen's Second Birthday Party on New Year's Eve 1987
- [06:01] Karen's Birthday and Teeter-Totter Ride at Madeira Park on February 27, 1988
- [24:02] Easter Duck and Candy Conversation on April 3rd, 1988

OUTPUT:
{
  "yearStart": 1987,
  "yearEnd": 1988,
  "confidence": "high",
  "evidence": "Scene 1 explicitly states 'New Year's Eve 1987', Scene 2 states 'February 27, 1988', and Scene 3 states 'April 3rd, 1988', confirming the video spans from late 1987 into 1988"
}

Example 2 - MEDIUM CONFIDENCE (Filename pattern + contextual support):
FILENAME: 1996-97-4.m4v
SCENES:
- [00:00] Christmas morning opening presents by the tree
- [08:30] Kids building snowmen in the backyard
- [15:45] First day back at school in January
- [22:10] Easter egg hunt at Grandma's house

OUTPUT:
{
  "yearStart": 1996,
  "yearEnd": 1997,
  "confidence": "medium",
  "evidence": "Filename pattern '1996-97' suggests spanning years, supported by scenes showing Christmas 1996, winter activities, return to school in January, and Easter celebration which likely falls in 1997"
}

Example 3 - HIGH CONFIDENCE (Single explicit year):
FILENAME: 1999-2.m4v
SCENES:
- [00:00] Trip to California - visiting Yosemite and Lake Tahoe
- [12:30] Family dinner discussing the new millennium
- [25:15] Kids playing on the beach in San Diego

OUTPUT:
{
  "yearStart": 1999,
  "yearEnd": 1999,
  "confidence": "high",
  "evidence": "Multiple scenes reference preparation for the new millennium and year 2000, placing this video in 1999. No content suggests crossing into 2000."
}

Example 4 - LOW CONFIDENCE (Filename only, no scene support):
FILENAME: 1985_cont.m4v
SCENES:
- [00:00] Family gathering with cousins playing games
- [05:22] Opening presents and birthday celebration
- [18:45] Outdoor barbecue and swimming

OUTPUT:
{
  "yearStart": 1985,
  "yearEnd": 1985,
  "confidence": "low",
  "evidence": "Filename '1985_cont' suggests 1985, but no scenes explicitly mention years, dates, or age references that can corroborate this determination"
}

CONSTRAINTS:
- Valid year range: 1960-2030
- yearEnd must be >= yearStart
- If scene content contradicts filename, prioritize scene content and note the discrepancy in evidence
- When uncertain between "high" and "medium", prefer "medium" to avoid false precision

OUTPUT: Return a JSON object with exactly these keys: yearStart, yearEnd, confidence, evidence`;

/**
 * Generates the user prompt for temporal metadata extraction.
 * Used in extract-temporal.ts
 */
export function getTemporalExtractionPrompt(
  filename: string,
  sceneContext: string,
): string {
  return `FILENAME: ${filename}

SCENES:
${sceneContext}

Analyze the filename and scene content to determine the recording year(s). Follow the system rules for evidence hierarchy and confidence levels.`;
}

// ============================================================================
// Entity Clustering Prompts
// ============================================================================

/**
 * Schema for participant clustering structured output.
 * Used with PARTICIPANT_CLUSTERING_PROMPT in cluster-participants.ts
 */
export const ParticipantClusteringSchema = z.object({
  classifications: z.array(
    z.object({
      participant: z.string(),
      canonical: z.string(),
      category: z.string(),
      reasoning: z.string(),
    }),
  ),
});

/**
 * System prompt for participant clustering and canonicalization.
 * Used in cluster-participants.ts
 */
export const PARTICIPANT_CLUSTERING_PROMPT = `You are an expert family archivist for the Hopkins family video archive. Your goal is to normalize participant names while preserving their unique identity.

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
}`;

/**
 * Schema for location clustering structured output.
 * Used with LOCATION_CLUSTERING_PROMPT in cluster-locations.ts
 */
export const LocationClusteringSchema = z.object({
  classifications: z.array(
    z.object({
      location: z.string(),
      canonical: z.string(),
      category: z.string(),
      reasoning: z.string(),
    }),
  ),
});
/**
 * System prompt for location clustering and canonicalization.
 * Used in cluster-locations.ts
 */
export const LOCATION_CLUSTERING_PROMPT = `You are an expert family archivist for the Hopkins family video archive. Your goal is to normalize location names while preserving their geographic or contextual identity.

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
}`;

/**
 * Schema for activity clustering structured output.
 * Used with ACTIVITY_CLUSTERING_PROMPT in cluster-activities.ts
 */
export const ActivityClusteringSchema = z.object({
  classifications: z.array(
    z.object({
      activity: z.string(),
      canonical: z.string(),
      category: z.string(),
      reasoning: z.string(),
    }),
  ),
});

/**
 * System prompt for activity clustering and canonicalization.
 * Used in cluster-activities.ts
 */
export const ACTIVITY_CLUSTERING_PROMPT = `You are an expert at categorizing family activities and events from home video archives.

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
- Each item MUST have "activity", "canonical", "category", and "reasoning" keys`;
