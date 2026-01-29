# Citation Tracking Implementation Plan

## Overview

Implement citation tracking so the RAG system shows **actually-used sources**, not just all retrieved sources. This adds inline citations [1], [2], etc. to the LLM-generated text and tracks which sources were actually referenced.

## Design Decisions

- **Citation Format**: Numbered brackets [1], [2], [3] in answer text
- **Protocol**: NDJSON stream with usedSourceIds array in result chunk
- **Visibility**: Citations visible in answer text
- **UI Presentation**: Separate "Cited Sources" vs "Additional Context" sections

## Files to Modify

1. `packages/search/src/schemas.ts` - Add citationId to Source, update StreamChunk
2. `packages/search/src/rag-query.ts` - Core implementation (buildSources, prompts, parsing)
3. `packages/search/src/rag-query.ts` (CLI section) - Display used vs unused sources
4. `packages/ui/src/hooks/useArchivistQuery.ts` - Add usedSourceIds to state
5. `packages/ui/src/components/SourceCard.tsx` - Add isUsed prop and visual indicators
6. `packages/ui/src/components/SourceList.tsx` - Separate cited vs additional sources

---

## Phase 1: Protocol Updates

### 1.1 Update `packages/search/src/schemas.ts`

Add `citationId: z.number()` to SourceSchema after `sceneId`:

```typescript
export const SourceSchema = z.object({
  sceneId: z.number(),
  citationId: z.number(), // NEW: [1], [2], [3], etc.
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
```

Update StreamChunkSchema to add `usedSourceIds`:

```typescript
export const StreamChunkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reasoning'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('result'),
    answer: z.string(),
    sources: z.array(SourceSchema),
    usedSourceIds: z.array(z.number()), // NEW
  }),
]);
```

---

## Phase 2: Server-Side Implementation

### 2.1 Update `buildSources` method in `packages/search/src/rag-query.ts`

**Location**: Lines 127-216

Change: Add citationId assignment using `for (const [index, r] of results.entries())`:

```typescript
/**
 * Build structured Source[] from hybrid search results.
 */
private async buildSources(results: HybridResult[]): Promise<Source[]> {
  const sources: Source[] = [];

  for (const [index, r] of results.entries()) {
    // ... existing entity fetching code ...

    sources.push({
      sceneId: r.id,
      citationId: index + 1, // NEW: Assign [1], [2], [3], etc.
      sceneTitle: r.title,
      summary: r.summary,
      thumbnailUrl: r.thumbnailPath ? `${SERVER_BASE_URL}${r.thumbnailPath}` : '',
      video: {
        id: r.videoId,
        title: r.videoTitle,
        year: r.videoYear,
        yearStart: r.videoYearStart,
        yearEnd: r.videoYearEnd,
        driveId: r.videoDriveFileId,
      },
      timestamp: {
        startSeconds: r.startTime,
        endSeconds: r.endTime,
        formatted: `${Math.floor(r.startTime / 60)}:${Math.floor(r.startTime % 60).toString().padStart(2, '0')}`,
      },
      participants,
      locations: locs,
      activities: acts,
    });
  }

  return sources;
}
```

### 2.2 Update `formatContextForLLM` method

**Location**: Lines 221-247

Add SOURCE [N] header so LLM knows how to cite:

```typescript
private formatContextForLLM(sources: Source[]): string {
  if (sources.length === 0) return 'No relevant scenes found.';

  return sources
    .map((s, index) => {
      const participantNames = s.participants.map((p) => p.name).join(', ') || 'None identified';
      const locationNames = s.locations.map((l) => l.name).join(', ') || 'Unknown';
      const activityNames = s.activities.map((a) => a.name).join(', ') || 'None identified';

      return [
        `SOURCE [${index + 1}]`, // NEW
        `VIDEO: ${s.video.title}`,
        `DRIVE_ID: ${s.video.driveId}`,
        `YEAR: ${s.video.year || 'Unknown'}`,
        `TIMESTAMP: ${s.timestamp.formatted}`,
        `SCENE: ${s.sceneTitle}`,
        `PARTICIPANTS: ${participantNames}`,
        `LOCATIONS: ${locationNames}`,
        `ACTIVITIES: ${activityNames}`,
        `SUMMARY: ${s.summary}`,
        '---',
      ].join('\n');
    })
    .join('\n\n');
}
```

### 2.3 Update `getSystemPrompt` method

**Location**: Lines 252-267

Add citation instructions:

```typescript
private getSystemPrompt(context: string): string {
  return [
    'You are a professional Family Historian and Video Archivist.',
    'Analyze the provided archive fragments to answer the user question.',
    '',
    'GUIDELINES:',
    '1. Use ONLY the provided context to answer the question.',
    '2. Cite sources using [1], [2], [3] etc. when referencing information.',
    '3. You may cite multiple sources in a single sentence: "Greg plays football [1] and later swims [2]."',
    '4. Cite at the end of sentences or clauses where the information appears.',
    '5. Be descriptive but concise.',
    '',
    'CONTEXT FROM ARCHIVE:',
    context,
  ].join('\n');
}
```

### 2.4 Add citation extraction method

**New method** in `FamilyArchivist` class:

```typescript
/**
 * Extract which citation IDs were actually used in the answer text.
 */
private extractUsedCitations(answer: string, sources: Source[]): number[] {
  const citationRegex = /\[(\d+)\]/g;
  const matches = [...answer.matchAll(citationRegex)];
  const citedIds = matches.map(m => parseInt(m[1], 10));

  // Filter to only valid citation IDs (1 to sources.length)
  const validIds = citedIds.filter(id => id >= 1 && id <= sources.length);

  // Return unique, sorted citation IDs
  return [...new Set(validIds)].sort((a, b) => a - b);
}
```

### 2.5 Update `query` method

**Location**: Lines 85-121

Change: Add citation extraction and include usedSourceIds in result:

```typescript
async *query(userQuery: string): AsyncGenerator<StreamChunk> {
  // 1. Retrieve relevant scenes
  const results = await this.retrieve(userQuery);
  const sources = results ? await this.buildSources(results) : [];
  const context = this.formatContextForLLM(sources);

  if (sources.length === 0) {
    yield {
      type: 'result',
      answer: "I couldn't find any relevant scenes in the family archive for that query.",
      sources: [],
      usedSourceIds: [], // NEW
    };
    return;
  }

  // 2. Stream generation with reasoning
  const result = streamText({
    model: this.genModel,
    system: this.getSystemPrompt(context),
    prompt: userQuery,
  });

  // 3. Yield reasoning chunks and accumulate answer
  let answer = '';

  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-delta') {
      yield { type: 'reasoning', text: part.text };
    } else if (part.type === 'text-delta') {
      answer += part.text;
    }
  }

  // 4. Extract which citations were actually used
  const usedSourceIds = this.extractUsedCitations(answer, sources);

  // 5. Yield final result with answer and sources
  yield {
    type: 'result',
    answer,
    sources,  // All sources with citationIds
    usedSourceIds  // NEW: Actually cited ones
  };
}
```

---

## Phase 3: CLI Client Updates

### 3.1 Update CLI main function in `packages/search/src/rag-query.ts`

**Location**: Lines 627-673

Change: Separate used vs unused sources:

```typescript
async function main() {
  const query = Bun.argv.slice(2).join(' ');
  if (!query) {
    console.error('Usage: bun search:rag <your question>');
    process.exit(1);
  }

  const archivist = new FamilyArchivist(
    getGenModel('summarizer'),
    getEmbedModel('embed-small'),
    getRerankModel('rerank'),
  );
  await archivist.init();

  console.log('Searching the archive...\n');

  let reasoningStarted = false;
  const spinner = new Spinner('Thinking');

  for await (const chunk of archivist.query(query)) {
    if (chunk.type === 'reasoning') {
      if (!reasoningStarted) {
        spinner.start();
        reasoningStarted = true;
      }
    } else if (chunk.type === 'result') {
      if (reasoningStarted) {
        spinner.stop();
      }

      console.log('--- Response ---\n');
      console.log(chunk.answer); // Text already contains [1], [2]

      if (chunk.sources.length > 0) {
        // Group sources by used vs unused
        const usedSources = chunk.sources.filter((s) =>
          chunk.usedSourceIds.includes(s.citationId),
        );
        const unusedSources = chunk.sources.filter(
          (s) => !chunk.usedSourceIds.includes(s.citationId),
        );

        if (usedSources.length > 0) {
          console.log('\n--- Cited Sources ---\n');
          for (const s of usedSources) {
            console.log(
              `[${s.citationId}] ${s.video.title} @ ${s.timestamp.formatted}`,
            );
            console.log(`  ${s.sceneTitle}`);
            console.log(
              `  https://drive.google.com/file/d/${s.video.driveId}\n`,
            );
          }
        }

        if (unusedSources.length > 0) {
          console.log('\n--- Additional Context ---\n');
          for (const s of unusedSources) {
            console.log(
              `[${s.citationId}] ${s.video.title} @ ${s.timestamp.formatted}`,
            );
            console.log(`  ${s.sceneTitle}`);
          }
        }
      }
    }
  }
}
```

---

## Phase 4: Web UI Updates

### 4.1 Update `packages/ui/src/hooks/useArchivistQuery.ts`

Add `usedSourceIds` to state:

```typescript
interface UseArchivistQueryResult {
  phase: Phase;
  reasoning: string;
  answer: string;
  sources: Source[];
  usedSourceIds: number[]; // NEW
  error: string | null;
  search: (query: string) => Promise<void>;
  reset: () => void;
}

// In the hook:
const [usedSourceIds, setUsedSourceIds] = useState<number[]>([]);

const reset = useCallback(() => {
  setPhase('idle');
  setReasoning('');
  setAnswer('');
  setSources([]);
  setUsedSourceIds([]); // NEW
  setError(null);
}, []);

// In search function:
} else if (chunk.type === 'result') {
  setAnswer(chunk.answer);
  setSources(chunk.sources);
  setUsedSourceIds(chunk.usedSourceIds || []); // NEW
  setPhase('complete');
}

return { phase, reasoning, answer, sources, usedSourceIds, error, search, reset };
```

### 4.2 Update `packages/ui/src/components/SourceCard.tsx`

Add `isUsed` prop and citation badge:

```typescript
import type { Source } from '@hop-hv-rag/search';

interface SourceCardProps {
  source: Source;
  isUsed: boolean; // NEW
}

export const SourceCard: React.FC<SourceCardProps> = ({ source, isUsed }) => {
  const driveUrl = `https://drive.google.com/file/d/${source.video.driveId}`;

  return (
    <div className={`flex-none w-72 bg-white rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-shadow ${isUsed ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}`}>
      {/* Citation Badge - Absolute positioned */}
      <div className="absolute top-2 left-2 z-10">
        <span className="text-xs font-medium px-2 py-1 bg-blue-500 text-white rounded-full">
          [{source.citationId}]
        </span>
        {isUsed && (
          <span className="ml-1 text-xs font-medium px-2 py-1 bg-green-500 text-white rounded-full">
            Cited
          </span>
        )}
      </div>

      {/* Thumbnail */}
      <a
        href={driveUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="relative w-full pt-[75%] bg-gray-100 block"
      >
        <img
          src={source.thumbnailUrl}
          alt={source.sceneTitle || 'Scene thumbnail'}
          className="absolute inset-0 w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </a>

      <div className="p-4 flex flex-col h-full">
        {/* Header */}
        <div className="flex justify-between items-start mb-2">
          <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
            {source.timestamp.formatted}
          </span>
          <span className="text-xs text-gray-400">
            {source.video.year || 'Unknown Year'}
          </span>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-gray-900 line-clamp-2 mb-1">
          {source.sceneTitle || 'Untitled Scene'}
        </h3>

        {/* Video Title */}
        <p className="text-xs text-gray-500 mb-2 truncate">
          {source.video.title}
        </p>

        {/* Participants */}
        {source.participants.length > 0 && (
          <div className="mb-2">
            <span className="text-xs text-gray-400">People: </span>
            <span className="text-xs text-gray-600">
              {source.participants.map((p) => p.name).join(', ')}
            </span>
          </div>
        )}

        {/* Locations */}
        {source.locations.length > 0 && (
          <div className="mb-2">
            <span className="text-xs text-gray-400">Location: </span>
            <span className="text-xs text-gray-600">
              {source.locations.map((l) => l.name).join(', ')}
            </span>
          </div>
        )}

        {/* Summary */}
        <p className="text-sm text-gray-600 line-clamp-3 mb-4 flex-1">
          {source.summary}
        </p>

        {/* Watch Button */}
        <a
          href={driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center py-2 px-4 bg-gray-50 hover:bg-gray-100 text-blue-600 text-sm font-medium rounded-lg border border-gray-200 transition-colors"
        >
          Watch Scene
        </a>
      </div>
    </div>
  );
};
```

### 4.3 Update `packages/ui/src/components/SourceList.tsx`

Separate cited vs additional sources:

```typescript
import type { Source } from '@hop-hv-rag/search';
import { SourceCard } from './SourceCard';

interface SourceListProps {
  sources: Source[];
  usedSourceIds: number[]; // NEW
}

export const SourceList: React.FC<SourceListProps> = ({ sources, usedSourceIds }) => {
  if (!sources || sources.length === 0) return null;

  // Group sources by used vs unused
  const usedSources = sources.filter(s => usedSourceIds.includes(s.citationId));
  const unusedSources = sources.filter(s => !usedSourceIds.includes(s.citationId));

  return (
    <div className="space-y-6">
      {/* Cited Sources Section */}
      {usedSources.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-blue-600 mb-2">
            Cited Sources ({usedSources.length})
          </h3>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
            {usedSources.map(source => (
              <SourceCard key={source.sceneId} source={source} isUsed={true} />
            ))}
          </div>
        </div>
      )}

      {/* Additional Context Section */}
      {unusedSources.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-2">
            Additional Context ({unusedSources.length})
          </h3>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
            {unusedSources.map(source => (
              <SourceCard key={source.sceneId} source={source} isUsed={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
```

### 4.4 Update `packages/ui/src/App.tsx`

Pass usedSourceIds to SourceList:

```typescript
import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { useArchivistQuery } from './hooks/useArchivistQuery';
import { SourceList } from './components/SourceList';

function App() {
  const [input, setInput] = useState('');
  const { phase, reasoning, answer, sources, usedSourceIds, error, search } =
    useArchivistQuery(); // added usedSourceIds

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      search(input.trim());
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="p-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-semibold text-gray-800">
          Family Archive Search
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4">
        {/* ... existing idle and thinking phases ... */}

        {phase === 'complete' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-4 border border-gray-200 prose prose-slate max-w-none">
              <Streamdown>{answer}</Streamdown>
            </div>
            {/* Pass usedSourceIds to SourceList */}
            {sources.length > 0 && (
              <SourceList sources={sources} usedSourceIds={usedSourceIds} />
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="bg-red-50 text-red-700 rounded-lg p-4">
            Error: {error}
          </div>
        )}
      </main>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-gray-200 bg-white"
      >
        {/* ... existing form content ... */}
      </form>
    </div>
  );
}

export default App;
```

---

## Phase 5: Verification & Testing

### 5.1 Verify Protocol Changes

Run TypeScript type check:

```bash
cd packages/search && bun check-types
```

Expected: No errors in schemas.ts

### 5.2 Test CLI Implementation

Test with various queries:

```bash
bun search:rag "Greg playing football"
bun search:rag "Christmas at Lake Cumberland"
bun search:rag "Baptism in 1998"
```

Expected:

- Answer text contains [1], [2], [3] citations
- Cited Sources section shows used sources
- Additional Context section shows unused sources

### 5.3 Edge Cases to Test

1. **No sources used**: Query with no results
   - Expected: usedSourceIds is empty array
2. **All sources used**: Generic query that references all sources
   - Expected: All sources marked as used
3. **Multiple citations**: Answer citing same source multiple times
   - Expected: Source appears once in Cited Sources
4. **Invalid citation ID**: LLM hallucinates [6] when only 5 sources exist
   - Expected: Extracted citations filtered to valid IDs only

---

## Implementation Order

Recommended implementation order:

1. **Phase 1**: Update schemas.ts - Add citationId and usedSourceIds
2. **Phase 2.1**: Update buildSources - Assign citation IDs
3. **Phase 2.2**: Update formatContextForLLM - Add SOURCE [N] headers
4. **Phase 2.3**: Update getSystemPrompt - Add citation instructions
5. **Phase 2.4**: Add extractUsedCitations method
6. **Phase 2.5**: Update query method - Include usedSourceIds in result
7. **Phase 3**: Update CLI - Display used vs unused sources
8. **Phase 4.1**: Update useArchivistQuery hook - Add usedSourceIds state
9. **Phase 4.2**: Update SourceCard - Add isUsed prop and badges
10. **Phase 4.3**: Update SourceList - Group by used status
11. **Phase 4.4**: Update App.tsx - Pass usedSourceIds
12. **Phase 5**: Test and verify

---

## Common Issues & Solutions

### Issue: LLM doesn't cite consistently

**Solution**: The extractUsedCitations method handles this by extracting whatever citations appear, even if inconsistent formatting

### Issue: Citation IDs in UI don't match text

**Solution**: Ensure sources array maintains original order so citationId matches the index+1

### Issue: Type errors in StreamChunk

**Solution**: Update all yield statements in query() to include usedSourceIds (even empty array)

---

## Post-Implementation Ideas

Future enhancements to consider:

1. **Streaming citations**: Show sources as they're cited in the answer (real-time highlighting)
2. **Citation validation**: Verify cited sources actually contain the claimed information
3. **Click-to-jump**: Clicking a citation [1] in the text scrolls to the corresponding source card
4. **Citation statistics**: Show which sources are most/least frequently cited across queries
