# Implementation Plan: Fix Filename Detection in Search

## Problem Statement

The current filename detection in `packages/search/src/archivist.ts` uses a regex that only matches filenames starting with 4 digits:

```typescript
const filenameMatch = query.match(/\b\d{4}-[\w-.]+\b/g);
```

This fails to detect:

- `KarenMontage.m4v` (no leading digits)
- `osu.m4v` (short lowercase name)
- `tommypolevault.m4v` (long lowercase name)
- Any filename without the `YYYY-` prefix pattern

When users ask about specific videos (e.g., "What happened in KarenMontage.m4v?"), the system:

1. Fails to recognize `KarenMontage.m4v` as a filename
2. Extracts "Karen" as an entity instead
3. Retrieves irrelevant results from other videos containing "Karen"
4. Only 2/5 results are from the actual requested video

## Why Database-Driven Detection?

**With only 184 filenames, a database-driven approach is superior to regex:**

| Approach            | Pros                                                                                          | Cons                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Regex**           | Fast                                                                                          | Brittle, false positives (e.g., "osu.m4v" matching "osulongerword"), misses edge cases |
| **Database-driven** | 100% accurate (only matches real files), handles any format, proven pattern via `EntityIndex` | Needs initialization (~5KB memory for 184 filenames)                                   |
| **Hybrid**          | Best of both                                                                                  | More complex                                                                           |

**Key insight:** Since all valid filenames are in the database, we should use them as the ground truth—just like `EntityIndex` does for entities. This guarantees:

- Zero false positives
- Handles all formats (CamelCase, lowercase, spaces, etc.)
- Easy maintenance (new videos automatically detected)

## Solution Overview

Implement a `FilenameIndex` class that mirrors `EntityIndex`:

1. **FilenameIndex**: Load all 184 filenames at init, detect matches in queries
2. **Video-Level Boosting**: When a filename is detected, boost chunks from that video significantly
3. **FTS Enhancement**: Include detected filenames in full-text search query
4. **Integration**: Hook into existing `hybridSearch()` pipeline

## Implementation Details

### Phase 1: Create FilenameIndex Class

**Location**: `packages/search/src/archivist.ts`

Add a new class following the `EntityIndex` pattern:

```typescript
interface FilenameMatch {
  filename: string;
  videoId: number;
  basename: string;
}

class FilenameIndex {
  private filenames: FilenameMatch[] = [];
  private loaded = false;

  async load(db: Db) {
    const rows = db
      .select({ id: videos.id, filename: videos.filename })
      .from(videos)
      .all();

    this.filenames = rows
      .map((row) => ({
        filename: row.filename,
        videoId: row.id,
        basename: row.filename.replace(/\.[^/.]+$/, ''), // Remove extension
      }))
      // Sort by length (longest first) to prioritize specific matches
      // e.g., "KarenMontage" should match before "Karen"
      .sort((a, b) => b.filename.length - a.filename.length);

    this.loaded = true;
  }

  detect(query: string): FilenameMatch[] {
    if (!this.loaded) return [];

    const lowerQuery = query.toLowerCase();
    const matches: FilenameMatch[] = [];
    const matchedRanges: Array<{ start: number; end: number }> = [];

    for (const entry of this.filenames) {
      // Check for full filename match with word boundaries
      const fullPattern = new RegExp(
        `\\b${this.escapeRegex(entry.filename)}\\b`,
        'i',
      );
      const fullMatch = lowerQuery.match(fullPattern);

      if (fullMatch) {
        const start = fullMatch.index!;
        const end = start + fullMatch[0].length;

        // Check if this range overlaps with an already matched range
        const overlaps = matchedRanges.some(
          (r) => start < r.end && end > r.start,
        );

        if (!overlaps) {
          matches.push(entry);
          matchedRanges.push({ start, end });
          continue;
        }
      }

      // Check for basename match (without extension)
      const basePattern = new RegExp(
        `\\b${this.escapeRegex(entry.basename)}\\b`,
        'i',
      );
      const baseMatch = lowerQuery.match(basePattern);

      if (baseMatch) {
        const start = baseMatch.index!;
        const end = start + baseMatch[0].length;

        // Check for overlaps
        const overlaps = matchedRanges.some(
          (r) => start < r.end && end > r.start,
        );

        if (!overlaps) {
          matches.push(entry);
          matchedRanges.push({ start, end });
        }
      }
    }

    return matches;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
```

### Phase 2: Integrate FilenameIndex into FamilyArchivist

**Location**: `packages/search/src/archivist.ts` - Update FamilyArchivist class

```typescript
export class FamilyArchivist {
  constructor(
    private genModel: LanguageModel,
    private embedModel: EmbeddingModel,
    private rerankModel: RerankingModel,
    private db: Db,
    private config: ArchivistConfig = {},
  ) {
    this.config = {
      keywordBoost: 1.3,
      entityBoost: 1.5,
      temporalBoost: 1.5,
      temporalPenalty: 0.5,
      filenameBoost: 5.0,
      rrfK: 60,
      ...config,
    };
  }

  private entityIndex = new EntityIndex();
  private filenameIndex = new FilenameIndex(); // NEW

  async init() {
    await this.entityIndex.load(this.db);
    await this.filenameIndex.load(this.db); // NEW
  }

  // ... rest of class
}
```

### Phase 3: Update Hybrid Search with Filename Detection

**Location**: `packages/search/src/archivist.ts` - `hybridSearch()` method

```typescript
private async hybridSearch(
  query: string,
  entityIds: number[],
): Promise<HybridResult[]> {
  // 1. Detect filenames in query (NEW)
  const filenameMatches = this.filenameIndex.detect(query);
  const targetVideoIds = filenameMatches.map((m) => m.videoId);

  if (filenameMatches.length > 0) {
    logger.debug(
      { filenames: filenameMatches.map((m) => m.filename), videoIds: targetVideoIds },
      'Detected video filenames in query'
    );
  }

  // 2. Vector Search (existing)
  const { embedding } = await embed({
    model: this.embedModel,
    value: query,
  });
  const queryVecJson = JSON.stringify(embedding);

  const vectorSql = `
    SELECT
      c.id,
      c.video_id as videoId,
      c.start_time as startTime,
      c.end_time as endTime,
      c.text as text,
      cs.title as title,
      cs.summary as summary,
      v.title as videoTitle,
      v.year as videoYear,
      v.year_start as videoYearStart,
      v.year_end as videoYearEnd,
      v.filename as videoFilename
    FROM (
      SELECT rowid, vec_distance_cosine(chunk_embedding, '${queryVecJson}') as distance
      FROM vec_chunks
      ORDER BY distance ASC
      LIMIT 40
    ) m
    JOIN chunks c ON c.id = m.rowid
    LEFT JOIN chunk_summaries cs ON cs.id = (
      SELECT cs2.id
      FROM chunk_summaries cs2
      WHERE cs2.chunk_id = c.id AND cs2.summary_type = 'scene'
      ORDER BY cs2.id DESC
      LIMIT 1
    )
    JOIN videos v ON v.id = c.video_id
  `;

  const vectorResults = this.db.all<HybridResult>(sql.raw(vectorSql));

  // 3. FTS5 Keyword Search with filename clauses (MODIFIED)
  const ftsQuery = this.constructFtsQuery(query, filenameMatches);
  const ftsResults = this.db.all<HybridResult>(
    sql.raw(`
      SELECT
        c.id,
        c.video_id as videoId,
        c.start_time as startTime,
        c.end_time as endTime,
        c.text as text,
        cs.title as title,
        cs.summary as summary,
        v.title as videoTitle,
        v.year as videoYear,
        v.year_start as videoYearStart,
        v.year_end as videoYearEnd,
        v.filename as videoFilename
      FROM fts_chunks f
      JOIN chunks c ON c.id = f.rowid
      LEFT JOIN chunk_summaries cs ON cs.id = (
        SELECT cs2.id
        FROM chunk_summaries cs2
        WHERE cs2.chunk_id = c.id AND cs2.summary_type = 'scene'
        ORDER BY cs2.id DESC
        LIMIT 1
      )
      JOIN videos v ON v.id = c.video_id
      WHERE fts_chunks MATCH '${ftsQuery.replace(/'/g, "''")}'
      ORDER BY bm25(fts_chunks)
      LIMIT 40
    `),
  );

  // 4. RRF Fusion (existing)
  const fused = this.fuse(vectorResults, ftsResults);

  // 5. Neural Re-ranking (existing)
  logger.info({ candidateCount: fused.length }, 'Re-ranking candidates');
  const { ranking } = await rerank({
    model: this.rerankModel,
    query,
    documents: fused.map((r) => {
      const snippet = this.extractTranscriptSnippet(r.text);
      return `CHUNK: ${r.title || 'Untitled'}\nSUMMARY: ${r.summary || ''}\nTRANSCRIPT: ${snippet}`;
    }),
  });

  // Apply reranked scores
  ranking.forEach((r) => {
    fused[r.originalIndex].score = r.score;
  });

  // 6. Post-rerank boosting

  // NEW: Filename-based video boost (highest priority)
  if (targetVideoIds.length > 0) {
    const FILENAME_BOOST = this.config.filenameBoost!;
    for (const result of fused) {
      if (targetVideoIds.includes(result.videoId)) {
        result.score = (result.score || 0) * FILENAME_BOOST;
        logger.debug(
          { videoId: result.videoId, chunkId: result.id, boost: FILENAME_BOOST },
          'Applied filename video boost'
        );
      }
    }
  }

  // Existing: Keyword boost
  const keyTerms = this.extractKeyTerms(query);
  if (keyTerms.length > 0) {
    const KEYWORD_BOOST = this.config.keywordBoost!;
    for (const result of fused) {
      const content = `${result.title || ''} ${result.summary || ''} ${result.text}`;
      if (this.contentContainsKeyTerms(content, keyTerms)) {
        result.score = (result.score || 0) * KEYWORD_BOOST;
      }
    }
  }

  // Existing: Entity boost
  if (entityIds.length > 0) {
    const ENTITY_BOOST = this.config.entityBoost!;
    for (const result of fused) {
      const matchedEntities = this.db
        .select({ entityId: chunkEntities.entityId })
        .from(chunkEntities)
        .where(
          and(
            eq(chunkEntities.chunkId, result.id),
            inArray(chunkEntities.entityId, entityIds),
          ),
        )
        .all();

      if (matchedEntities.length > 0) {
        result.score = (result.score || 0) * ENTITY_BOOST;
      }
    }
  }

  // Existing: Temporal boost
  const queryYear = this.detectYearInQuery(query);
  if (queryYear) {
    logger.info({ year: queryYear }, 'Detected year in query');
    const TEMPORAL_BOOST = this.config.temporalBoost!;
    const TEMPORAL_PENALTY = this.config.temporalPenalty!;

    for (const result of fused) {
      const { videoYearStart, videoYearEnd } = result;
      if (videoYearStart && videoYearEnd) {
        if (queryYear >= videoYearStart && queryYear <= videoYearEnd) {
          result.score = (result.score || 0) * TEMPORAL_BOOST;
        } else {
          const distance = Math.min(
            Math.abs(queryYear - videoYearStart),
            Math.abs(queryYear - videoYearEnd),
          );
          if (distance > 4) {
            result.score = (result.score || 0) * TEMPORAL_PENALTY;
          }
        }
      }
    }
  }

  return fused.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
}
```

### Phase 4: Update FTS Query Construction

**Location**: `packages/search/src/archivist.ts` - `constructFtsQuery()` method

```typescript
private constructFtsQuery(query: string, filenameMatches: FilenameMatch[] = []): string {
  // Existing: Handle year-prefixed filenames for phrase matching
  const yearFilenameMatch = query.match(/\b\d{4}-[\w-.]+\b/g);
  let processedQuery = query;

  if (yearFilenameMatch) {
    yearFilenameMatch.forEach((filename) => {
      // Create a phrase version: "1996 97 1 m4v"
      const phrase = `"${filename.replace(/[^\w]/g, ' ')}"`;
      processedQuery = processedQuery.replace(filename, phrase);
    });
  }

  // NEW: Add filename clauses for FTS video_filename field
  const filenameClauses = filenameMatches.map((match) => {
    // Use basename for FTS to match video_filename field
    return `video_filename:"${match.basename}"`;
  });

  // Clean up special chars
  let cleanedQuery = processedQuery.replace(/[^\w\s"*]/g, ' ').trim();

  // Combine with filename clauses
  if (filenameClauses.length > 0) {
    cleanedQuery = `${cleanedQuery} OR ${filenameClauses.join(' OR ')}`;
  }

  return cleanedQuery;
}
```

### Phase 5: Add Configuration Interface

**Location**: `packages/search/src/archivist.ts` (top of file or separate types file)

```typescript
interface ArchivistConfig {
  keywordBoost?: number; // default: 1.3
  entityBoost?: number; // default: 1.5
  temporalBoost?: number; // default: 1.5
  temporalPenalty?: number; // default: 0.5
  filenameBoost?: number; // default: 5.0 (high to override entity boost)
  rrfK?: number; // default: 60
}
```

## Testing Strategy

### Integration Tests

Add to `packages/search/eval-prompts.json`:

```json
{
  "id": "EVAL-011",
  "category": "Filename Detection - CamelCase",
  "prompt": "What happened in KarenMontage.m4v?",
  "expected": "Should return 80%+ results from KarenMontage.m4v, not other videos with Karen"
},
{
  "id": "EVAL-012",
  "category": "Filename Detection - Year Only",
  "prompt": "Tell me about 2003.m4v",
  "expected": "Should prioritize results from 2003.m4v file"
},
{
  "id": "EVAL-013",
  "category": "Filename Detection - Basename Only",
  "prompt": "What is in osu?",
  "expected": "Should detect osu.m4v from basename match"
},
{
  "id": "EVAL-014",
  "category": "Filename vs Entity Disambiguation",
  "prompt": "What does Karen say in KarenMontage.m4v?",
  "expected": "Should filter to KarenMontage.m4v and find Karen's dialogue within it"
},
{
  "id": "EVAL-015",
  "category": "Filename Detection - Long Names",
  "prompt": "Show me tommypolevault.m4v",
  "expected": "Should detect tommypolevault.m4v"
}
```

### Manual Testing Commands

```bash
# Test 1: CamelCase filename (the original issue)
bun run search:rag -- "What happened in KarenMontage.m4v?"

# Test 2: Year-only filename
bun run search:rag -- "Show me 2003.m4v"

# Test 3: Basename only (no extension)
bun run search:rag -- "What is in osu?"

# Test 4: Long lowercase name
bun run search:rag -- "Tell me about tommypolevault.m4v"

# Test 5: Multiple filenames
bun run search:rag -- "Compare 1996-1.m4v and 2003.m4v"

# Test 6: Filename with entity (disambiguation)
bun run search:rag -- "What does Greg say in 1987-1988-1.m4v?"

# Test 7: No filename (baseline - should work as before)
bun run search:rag -- "What did Karen do?"

# Test 8: False positive test
bun run search:rag -- "osulongerword should not trigger osu.m4v"
```

## Expected Outcomes

After implementation:

1. **Query**: "What happened in KarenMontage.m4v?"
   - **Before**: 2/5 results from KarenMontage.m4v, 3 from other videos with "Karen"
   - **After**: 5/5 results from KarenMontage.m4v (or at least 4/5)

2. **Query**: "What does Greg say in 2003.m4v?"
   - **Before**: Entity detection finds Greg across many videos
   - **After**: First filters to 2003.m4v via filename detection, then finds Greg within it

3. **Query**: "Show me osu"
   - **Before**: Not recognized (lowercase, no pattern match)
   - **After**: Detects osu.m4v from basename match

4. **Query**: "osulongerword test"
   - **Before**: Might incorrectly match osu.m4v with loose regex
   - **After**: No match (word boundaries prevent false positive)

## Files to Modify

1. `packages/search/src/archivist.ts` - Add FilenameIndex class, integrate into FamilyArchivist
2. `packages/search/eval-prompts.json` - Add 5 new test cases
3. `packages/search/README.md` - Document filename detection feature

## Rollback Plan

If issues arise:

1. **Immediate**: Set `filenameBoost` to 1.0 (neutral) in config
2. **Short-term**: Skip filename detection by commenting out `filenameIndex.detect()` call
3. **Full**: Git revert the implementation commit

## Success Metrics

- [ ] EVAL-011: 80%+ results from KarenMontage.m4v
- [ ] EVAL-012: 80%+ results from 2003.m4v
- [ ] EVAL-013: Detects osu.m4v from "osu" query
- [ ] EVAL-014: Correct disambiguation of entity vs filename
- [ ] EVAL-015: Detects tommypolevault.m4v
- [ ] No regression on EVAL-001 through EVAL-010
- [ ] All unit tests pass
- [ ] Query latency increase < 10% (184 filename lookups are trivial)

## Implementation Notes

1. **Memory**: 184 filenames × ~30 chars = ~5KB memory (negligible)
2. **Performance**: O(n) scan of filenames where n=184 (fast)
3. **Initialization**: Loads once at startup via `init()` alongside EntityIndex
4. **Sorting**: Longest-first sorting prevents "Karen" matching before "KarenMontage"
5. **Word Boundaries**: `\b` in regex prevents substring false positives
6. **Overlap Detection**: Prevents double-counting when full filename and basename both match

## Key Design Decisions

1. **Database-driven over regex**: Guarantees 100% accuracy, zero false positives
2. **5.0x filename boost**: High enough to override entity-based retrieval when specific video requested
3. **Basename matching**: Allows "Show me 2003" to match "2003.m4v"
4. **Longest-first sorting**: More specific matches take priority
5. **Word boundaries**: Prevents "osu" matching inside "osulongerword"
