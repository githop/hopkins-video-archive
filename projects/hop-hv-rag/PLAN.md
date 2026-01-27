# Implementation Plan: Unified Structured RAG

## Overview

Refactor the FamilyArchivist RAG system to use a single streaming architecture with structured outputs, removing tool-calling complexity while leveraging the model's reasoning capability. Both CLI and web UI will consume the same stream, differing only in how they render progress and results.

## Goals

1. **Unified streaming API**: Single `query()` method returns an async generator
2. **Structured outputs**: Separate answer text from structured source metadata
3. **Visible progress**: Stream reasoning tokens so users see the model "thinking"
4. **Client flexibility**: CLI and web render the same stream differently
5. **Simplicity**: Remove tool-calling, remove `useChat`, deterministic retrieval

## Architecture Decisions

### Streaming Protocol

Single async generator yields chunks:

```typescript
type StreamChunk =
  | { type: 'reasoning'; text: string }
  | { type: 'result'; answer: string; sources: Source[] };
```

- **Reasoning chunks**: Streamed as model thinks (0 or more)
- **Result chunk**: Emitted once at end with complete answer + sources

### No Tool Calling

- Retrieval is always performed (deterministic, not an LLM decision)
- Sources are built before LLM generation
- Model receives context in system prompt, generates answer
- Removes unpredictability of agentic tool invocation

### Reasoning Mode

- Model has `reasoning_parser: qwen3` enabled in vLLM config
- Produces `<think>` blocks before generating answer
- AI SDK's `fullStream` exposes these as `type: 'reasoning'` parts
- Provides meaningful progress without streaming partial answers

### Client Rendering

| Client  | Reasoning Display          | Result Display                   |
| ------- | -------------------------- | -------------------------------- |
| **CLI** | Spinner or "Thinking..."   | Print answer + formatted sources |
| **Web** | Stream into `<Streamdown>` | Render answer + source cards     |

## Model Stack (rag-full)

From `gnarlyvllm.toml`:

| Model       | Repo                 | Context | Notes                     |
| ----------- | -------------------- | ------- | ------------------------- |
| summarizer  | Qwen3-4B-AWQ         | 8192    | Generation with reasoning |
| embed-small | Qwen3-Embedding-0.6B | 4096    | Vector embeddings         |
| rerank      | Qwen3-Reranker-4B    | 4096    | Neural reranking          |

**Config changes needed:**

- Set `enable_tool_calling = false` (or remove the line)
- Keep `reasoning_parser = "qwen3"`

## Data Schema

### Source Schema

```typescript
// packages/search/src/schemas.ts

import { z } from 'zod';

export const SourceSchema = z.object({
  sceneId: z.number(),
  sceneTitle: z.string().nullable(),
  summary: z.string(),
  video: z.object({
    id: z.number(),
    title: z.string().nullable(),
    year: z.number().nullable(),
    driveId: z.string(),
  }),
  timestamp: z.object({
    startSeconds: z.number(),
    endSeconds: z.number(),
    formatted: z.string(), // "MM:SS"
  }),
  participants: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      type: z.enum(['PERSON', 'ROLE']),
    }),
  ),
  locations: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      type: z.enum(['PLACE', 'SETTING']),
    }),
  ),
});

export type Source = z.infer<typeof SourceSchema>;

export const StreamChunkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reasoning'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('result'),
    answer: z.string(),
    sources: z.array(SourceSchema),
  }),
]);

export type StreamChunk = z.infer<typeof StreamChunkSchema>;
```

## Implementation Tasks

### Phase 1: Schema & Types

**Task 1.1: Create schemas file**

- File: `packages/search/src/schemas.ts`
- Define `SourceSchema`, `StreamChunkSchema`
- Export types

**Task 1.2: Update package exports**

- File: `packages/search/src/index.ts`
- Export new schemas and types
- Keep existing exports that are still needed

### Phase 2: FamilyArchivist Refactor

**Task 2.1: Add `buildSources()` method**

- File: `packages/search/src/rag-query.ts`
- Extract logic from `formatContext()` to build structured `Source[]`
- Query junction tables for canonical participants/locations
- Return array of `Source` objects

```typescript
private async buildSources(results: HybridResult[]): Promise<Source[]> {
  const sources: Source[] = [];

  for (const r of results) {
    // Fetch canonical participants
    const participants = this.db
      .select({ id: people.id, name: people.name, type: people.type })
      .from(people)
      .innerJoin(sceneToPeople, sql`${sceneToPeople.personId} = ${people.id}`)
      .where(sql`${sceneToPeople.sceneId} = ${r.id}`)
      .all();

    // Fetch canonical locations
    const locations = this.db
      .select({ id: locations.id, name: locations.name, type: locations.type })
      .from(locations)
      .innerJoin(sceneToLocations, sql`${sceneToLocations.locationId} = ${locations.id}`)
      .where(sql`${sceneToLocations.sceneId} = ${r.id}`)
      .all();

    // Format timestamp
    const minutes = Math.floor(r.startTime / 60);
    const seconds = Math.floor(r.startTime % 60);
    const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    sources.push({
      sceneId: r.id,
      sceneTitle: r.title,
      summary: r.summary,
      video: {
        id: r.videoId,
        title: r.videoTitle,
        year: r.videoYear,
        driveId: r.videoDriveFileId,
      },
      timestamp: {
        startSeconds: r.startTime,
        endSeconds: r.endTime,
        formatted,
      },
      participants,
      locations,
    });
  }

  return sources;
}
```

**Task 2.2: Add `formatContextForLLM()` method**

- Convert `Source[]` to text for system prompt
- Similar to existing `formatContext()` but takes structured input

```typescript
private formatContextForLLM(sources: Source[]): string {
  if (sources.length === 0) return 'No relevant scenes found.';

  return sources.map(s => {
    const participants = s.participants.map(p => p.name).join(', ') || 'None identified';
    const locations = s.locations.map(l => l.name).join(', ') || 'Unknown';

    return [
      `VIDEO: ${s.video.title}`,
      `DRIVE_ID: ${s.video.driveId}`,
      `YEAR: ${s.video.year || 'Unknown'}`,
      `TIMESTAMP: ${s.timestamp.formatted}`,
      `SCENE: ${s.sceneTitle}`,
      `PARTICIPANTS: ${participants}`,
      `LOCATIONS: ${locations}`,
      `SUMMARY: ${s.summary}`,
      `---`,
    ].join('\n');
  }).join('\n\n');
}
```

**Task 2.3: Implement `query()` async generator**

- Main entry point for both CLI and server
- Uses `streamText` with `fullStream`
- Yields reasoning chunks, then final result

```typescript
async *query(userQuery: string): AsyncGenerator<StreamChunk> {
  // 1. Retrieve
  const results = await this.retrieve(userQuery);
  const sources = results ? await this.buildSources(results) : [];
  const context = this.formatContextForLLM(sources);

  if (sources.length === 0) {
    yield {
      type: 'result',
      answer: "I couldn't find any relevant scenes in the family archive for that query.",
      sources: [],
    };
    return;
  }

  // 2. Stream generation with reasoning
  const result = streamText({
    model: this.genModel,
    system: this.getSystemPrompt(context),
    prompt: userQuery,
  });

  // 3. Yield reasoning and accumulate answer
  let answer = '';

  for await (const part of result.fullStream) {
    if (part.type === 'reasoning') {
      yield { type: 'reasoning', text: part.textDelta };
    } else if (part.type === 'text-delta') {
      answer += part.textDelta;
    }
  }

  // 4. Yield final result
  yield { type: 'result', answer, sources };
}
```

**Task 2.4: Update system prompt**

- Modify `getSystemPrompt()` to work without inline context
- Add instructions for citation format

**Task 2.5: Remove deprecated methods**

- Remove `ask()` method (or make it a simple wrapper)
- Remove `streamAsk()` method
- Remove `synthesize()` method
- Keep `retrieve()`, `formatContext()` (may still be useful)

### Phase 3: CLI Update

**Task 3.1: Rewrite CLI entry point**

- File: `packages/search/src/rag-query.ts` (main block)
- Consume the async generator
- Show phase-based progress
- Print final result with formatted sources

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

  for await (const chunk of archivist.query(query)) {
    if (chunk.type === 'reasoning') {
      if (!reasoningStarted) {
        process.stdout.write('Thinking');
        reasoningStarted = true;
      }
      process.stdout.write('.');
    } else if (chunk.type === 'result') {
      if (reasoningStarted) {
        console.log('\n');
      }

      console.log('--- Response ---\n');
      console.log(chunk.answer);

      if (chunk.sources.length > 0) {
        console.log('\n--- Sources ---\n');
        for (const s of chunk.sources) {
          console.log(`- ${s.video.title} @ ${s.timestamp.formatted}`);
          console.log(`  https://drive.google.com/file/d/${s.video.driveId}`);
        }
      }
    }
  }
}
```

### Phase 4: Server Update

**Task 4.1: Create streaming response helper**

- File: `packages/search/src/stream-utils.ts` (new)
- Convert async generator to readable stream
- Encode chunks as newline-delimited JSON

```typescript
export function createStreamResponse(
  generator: AsyncGenerator<StreamChunk>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          const json = JSON.stringify(chunk) + '\n';
          controller.enqueue(encoder.encode(json));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

**Task 4.2: Update server endpoint**

- File: `packages/search/src/server.ts`
- Replace `/api/chat` with `/api/query`
- Accept `{ query: string }` instead of `{ messages: [...] }`
- Return streaming response

```typescript
app.post('/api/query', async (c) => {
  const { query } = await c.req.json();

  if (!query || typeof query !== 'string') {
    return c.json({ error: 'Query is required' }, 400);
  }

  const generator = archivist.query(query);
  return createStreamResponse(generator);
});
```

### Phase 5: UI Update

**Task 5.1: Create custom hook**

- File: `packages/ui/src/hooks/useArchivistQuery.ts` (new)
- Replace `useChat` with custom streaming logic
- Parse NDJSON stream
- Manage state: idle, searching, thinking, complete

```typescript
import { useState, useCallback } from 'react';
import type { Source, StreamChunk } from '@hop-hv-rag/search';

type Phase = 'idle' | 'thinking' | 'complete' | 'error';

interface UseArchivistQueryResult {
  phase: Phase;
  reasoning: string;
  answer: string;
  sources: Source[];
  error: string | null;
  search: (query: string) => Promise<void>;
  reset: () => void;
}

export function useArchivistQuery(): UseArchivistQueryResult {
  const [phase, setPhase] = useState<Phase>('idle');
  const [reasoning, setReasoning] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setReasoning('');
    setAnswer('');
    setSources([]);
    setError(null);
  }, []);

  const search = useCallback(
    async (query: string) => {
      reset();
      setPhase('thinking');

      try {
        const response = await fetch(
          'http://local.gnarlybox-ai:3200/api/query',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            const chunk: StreamChunk = JSON.parse(line);

            if (chunk.type === 'reasoning') {
              setReasoning((r) => r + chunk.text);
            } else if (chunk.type === 'result') {
              setAnswer(chunk.answer);
              setSources(chunk.sources);
              setPhase('complete');
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    },
    [reset],
  );

  return { phase, reasoning, answer, sources, error, search, reset };
}
```

**Task 5.2: Update App component**

- File: `packages/ui/src/App.tsx`
- Remove `useChat` import
- Use `useArchivistQuery` hook
- Render based on phase: thinking panel, result panel

```typescript
import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { useArchivistQuery } from './hooks/useArchivistQuery';
import { SourceList } from './components/SourceList';

function App() {
  const [input, setInput] = useState('');
  const { phase, reasoning, answer, sources, error, search, reset } = useArchivistQuery();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      search(input.trim());
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="p-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-semibold text-gray-800">
          Family Archive Search
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {phase === 'idle' && (
          <p className="text-center text-gray-500 mt-8">
            Ask a question about your family videos...
          </p>
        )}

        {phase === 'thinking' && (
          <div className="bg-gray-100 rounded-lg p-4 mb-4">
            <div className="text-sm text-gray-500 mb-2">Thinking...</div>
            <div className="prose prose-sm text-gray-600 italic">
              <Streamdown>{reasoning}</Streamdown>
            </div>
          </div>
        )}

        {phase === 'complete' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-4 border border-gray-200 prose prose-slate max-w-none">
              <Streamdown>{answer}</Streamdown>
            </div>
            {sources.length > 0 && <SourceList sources={sources} />}
          </div>
        )}

        {phase === 'error' && (
          <div className="bg-red-50 text-red-700 rounded-lg p-4">
            Error: {error}
          </div>
        )}
      </main>

      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your family videos..."
            className="flex-1 p-2 border border-gray-300 rounded-lg"
            disabled={phase === 'thinking'}
          />
          <button
            type="submit"
            disabled={phase === 'thinking'}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
          >
            Search
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
```

**Task 5.3: Create SourceList component**

- File: `packages/ui/src/components/SourceList.tsx` (new or update existing)
- Render sources with video title, timestamp, participants, locations
- Clickable links to Google Drive

**Task 5.4: Remove deprecated UI code**

- Remove `SceneGallery` component (or adapt it)
- Remove tool-related type imports
- Update any remaining references

### Phase 6: Cleanup

**Task 6.1: Remove tool-related code**

- File: `packages/search/src/tools/search-archive.ts` - DELETE or deprecate
- File: `packages/search/src/tools/index.ts` - Update exports
- Remove `SearchProvider` interface if no longer needed

**Task 6.2: Update package exports**

- File: `packages/search/src/index.ts`
- Export new schemas, types, and utilities
- Remove deprecated exports

**Task 6.3: Update vLLM config** (external)

- File: `gnarlyvllm.toml`
- Set `enable_tool_calling = false` for summarizer in rag-full stack

**Task 6.4: Update tests/eval**

- File: `packages/search/run-eval.ts`
- Update to use new `query()` method
- Collect streamed results for evaluation

## File Changes Summary

### New Files

- `packages/search/src/schemas.ts`
- `packages/search/src/stream-utils.ts`
- `packages/ui/src/hooks/useArchivistQuery.ts`
- `packages/ui/src/components/SourceList.tsx` (or update existing)

### Modified Files

- `packages/search/src/rag-query.ts` - Major refactor
- `packages/search/src/server.ts` - New endpoint
- `packages/search/src/index.ts` - Update exports
- `packages/ui/src/App.tsx` - New architecture
- `packages/search/run-eval.ts` - Adapt to new API

### Files to Remove/Deprecate

- `packages/search/src/tools/search-archive.ts`
- `packages/search/src/tools/index.ts` (update or remove)

## Testing Plan

1. **Unit test `buildSources()`**: Verify correct structure from DB
2. **Unit test `formatContextForLLM()`**: Verify text formatting
3. **Integration test `query()`**: Mock model, verify stream chunks
4. **CLI manual test**: Run queries, verify output format
5. **Web manual test**: Verify streaming UI behavior
6. **Eval suite**: Run existing eval prompts through new API

## Open Considerations

1. **Error handling in stream**: How to surface retrieval errors vs generation errors?
2. **Timeout handling**: Long-running queries on slow hardware
3. **Cancellation**: Should clients be able to abort mid-stream?
4. **Caching**: Could cache retrieval results for repeated queries
5. **Multi-turn future**: If needed later, could accumulate context across queries

## Implementation Order

1. Schema & types (foundation)
2. `buildSources()` method (can test in isolation)
3. `formatContextForLLM()` method
4. `query()` async generator
5. CLI update (verify end-to-end)
6. Stream utilities
7. Server update
8. UI hook
9. UI components
10. Cleanup deprecated code
11. Update eval suite
