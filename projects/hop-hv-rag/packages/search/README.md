# @hop-hv-rag/search

RAG (Retrieval-Augmented Generation) search package. Provides the query pipeline and HTTP API for answering questions about video content.

## Overview

The search package implements a multi-stage retrieval pipeline:

1. **Entity Detection** - Matches query against known entities
2. **Vector Search** - Semantic similarity via sqlite-vec
3. **BM25 Search** - Full-text search via FTS5
4. **RRF Fusion** - Reciprocal Rank Fusion combines results
5. **Neural Reranking** - Reranks candidates by relevance
6. **Boosting** - Keyword, entity, and temporal boosts
7. **Streaming Generation** - Real-time answer with citations

## API

### Server

Start the Hono server:

```bash
bun run server
# or from root:
bun run ui:server
```

Options:

```bash
bun src/server.ts --port 3200 --data ./data --ui ./packages/ui/dist
```

| Option             | Description                | Default                     |
| ------------------ | -------------------------- | --------------------------- |
| `--port`, `-p`     | HTTP port                  | 3200                        |
| `--data`, `-d`     | Data directory             | `./data`                    |
| `--ui`, `-u`       | UI build directory         | `./packages/ui/dist`        |
| `--videoDir`       | Video files directory      | `../whisper-project/videos` |
| `--transcriptsDir` | Transcript files directory | sibling of videoDir         |

### Endpoints

- `POST /api/query` - Submit RAG query (returns NDJSON stream)
- `GET /videos/:filename` - Stream video with range request support
- `GET /transcripts/:filename` - Serve transcript files (WebVTT for UI)
- `GET /thumbnails/*` - Serve video thumbnails

### CLI

Run queries from command line:

```bash
bun run rag "What did John say about the project?"
# or from root:
bun run search:rag "What did John say about the project?"
```

## Architecture

### FamilyArchivist

Main RAG orchestrator (`src/archivist.ts`):

```typescript
class FamilyArchivist {
  async *query(userQuery: string): AsyncGenerator<StreamChunk>;
  async retrieve(query: string): Promise<HybridResult[]>;
  private async hybridSearch(query, entityIds): Promise<HybridResult[]>;
  private fuse(vectorResults, ftsResults): HybridResult[];
}
```

### Retrieval Pipeline

```
User Query
    │
    ▼
Entity Detection (EntityIndex)
    │
    ├──► Vector Search (sqlite-vec) ──┐
    │                                   │
    └──► BM25 Search (FTS5) ──────────┤
                                      ▼
                              RRF Fusion (k=60)
                                      │
                                      ▼
                              Neural Reranking
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                        Keyword Boost   Entity Boost
                              │               │
                              └──► Temporal Boost
                                      │
                                      ▼
                              Top 5 Results
                                      │
                                      ▼
                              Source Assembly
                                      │
                                      ▼
                              LLM Generation (streaming)
                                      │
                                      ▼
                              Cited Answer
```

### Hybrid Search Details

**Vector Search** (top 40):

- Cosine distance on multi-field embeddings
- Embeddings include: title, summary, entities, transcript

**BM25 Search** (top 40):

- FTS5 with phrase support
- Handles filename patterns (e.g., "1996-97-1.m4v")
- Preserves prefix operators (\*)

**RRF Fusion**:

```javascript
score = Σ(1 / (k + rank + 1)); // k = 60
```

**Neural Reranking**:

- Reranks fused results
- Documents: chunk title + summary + transcript snippet

**Boosting**:

- **Keyword**: 1.3x for exact term matches (proper nouns, quoted phrases)
- **Entity**: 1.5x if chunk contains detected entities
- **Temporal**: 1.5x if query year in video range, 0.5x if >4 years off

### Streaming Response

NDJSON format:

```ndjson
{"type": "reasoning", "text": "Searching for mentions..."}
{"type": "reasoning", "text": "Found 5 relevant chunks"}
{"type": "result", "answer": "Greg mentioned... [1]", "sources": [...], "usedSourceIds": [1]}
```

Reasoning extracted from model's reasoning-delta tokens.

### Source Structure

```typescript
interface Source {
  chunkId: number;
  citationId: number; // [1], [2], etc.
  chunkTitle: string | null;
  summary: string;
  video: {
    id: number;
    title: string | null;
    year: number | null;
    filename: string;
  };
  timestamp: {
    startSeconds: number;
    endSeconds: number;
    formatted: string; // "2:34"
  };
  participants: Entity[];
  locations: Entity[];
  activities: Entity[];
  globalSummary: string | null;
}
```

Global video summaries prepended to context when available.

## Key Files

| File                  | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `src/server.ts`       | Hono HTTP server with static file serving         |
| `src/archivist.ts`    | Core RAG orchestration (FamilyArchivist)          |
| `src/schemas.ts`      | Zod schemas for API types                         |
| `src/types.ts`        | TypeScript interfaces (HybridResult, ChunkResult) |
| `src/stream-utils.ts` | NDJSON streaming utilities                        |
| `src/cli.ts`          | Command-line query interface                      |

## Model Configuration

Uses `@hop-hv-rag/ai` for model resolution:

```bash
# Override via CLI
bun run rag "query" --generationModel gemini-2.0-flash
```

| Type       | Flag                | Default            |
| ---------- | ------------------- | ------------------ |
| Generation | `--generationModel` | Configured default |
| Embedding  | `--embeddingModel`  | Configured default |
| Reranking  | `--rerankingModel`  | Configured default |

## Evaluation

Run evaluation suite:

```bash
bun run run-eval.ts
# or from root:
bun run search:eval
```

Evaluates:

- Entity detection
- Keyword matching
- Semantic search
- Temporal queries

Results written to `eval-results.md`.

## Dependencies

- `@hop-hv-rag/ai` - Model providers
- `@hop-hv-rag/core` - Logging
- `@hop-hv-rag/db` - Database access
- `ai` - AI SDK for streaming and reranking
- `drizzle-orm` - Database ORM
- `hono` - Web framework
- `zod` - Schema validation
