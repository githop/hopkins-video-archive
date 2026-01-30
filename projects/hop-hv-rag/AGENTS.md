# AGENTS.md - hop-hv-rag

This document defines the architecture, domains, and conventions of the `hop-hv-rag` project. It serves as a manual for AI agents to autonomously investigate, test, and improve the system.

## 1. Project Domains

### Ingestion Domain

The ingestion pipeline transforms raw transcription data into indexed, semantic scenes.

- **Iterative Workflow**: Tools are designed to run either on a single video (surgical iteration) or in batch.
- **Process**: Includes scene extraction, summarization, embedding, and entity canonicalization.
- **Testing**: When improving logic (e.g., prompt refinement), iterate on small batches or single files using the `--file` flag to verify impact before full-scale processing.

### Retrieval Domain

The retrieval pipeline handles user queries and generates cited responses.

- **Search Strategy**: A hybrid approach using Vector Search (`sqlite-vec`), Full-Text Search (`FTS5`), and Reciprocal Rank Fusion (RRF), followed by neural reranking.
- **RAG Synthesis**: Uses detected entities and temporal context to generate streaming, cited answers.

## 2. Agent Agency & Investigation

Agents are encouraged to leverage the environment to test assumptions and investigate failures:

- **Database Inspection**: Query `data/hv-rag.db` directly to analyze relations, check indexing status, or verify data consistency.
- **Asset Access**: Inspect raw assets, including WhisperX transcripts, thumbnails, and entity registries. These serve as the ground truth for debugging RAG results.
- **Prototyping**: Write and execute inline Bun/TypeScript scripts to test logic, verify regex, or perform ad-hoc analysis (e.g., checking entity distribution).

### Mutation & Transparency Protocol

Curiosity is encouraged, but data integrity is paramount. Before performing any mutation to the database or registry assets:

1.  **Identify**: Clearly state the inconsistency or error you've discovered.
2.  **Describe**: Explain the intended transformation and show the code/SQL that will perform it.
3.  **Back Up**: Proactively suggest or perform a backup of the asset (e.g., `cp data/registry.json data/registry.json.bak`).
4.  **Permission**: Obtain explicit user approval before executing any mutation.

## 3. Conventions

### Code Style

- **ESM only**: Use extensioned imports (e.g., `import { foo } from './bar.ts'`).
- **Idiomatic Bun**: Prefer Bun primitives (`Bun.file`, `Bun.sqlite`, `Bun.spawn`, `Bun.env`, etc.).
- **Async/Await**: Standard for all I/O and AI operations.
- **Type Safety**: Strictly avoid `any`. Use Zod for runtime validation and Drizzle `$infer` for DB types for sql queries. NEVER use type assertions (`as Type`).
- **Generics**: Use the generic arguments provided by Drizzle and other libraries (e.g., `db.select().from(table).all<Type>()`) instead of type assertions.
- **Entry Points**: Use `if (import.meta.main)` for CLI scripts.

### Database & Vectors

- **Drizzle ORM**: Used for relational table interactions and schema management.
- **Raw SQL**: Use `sql` templates for `sqlite-vec` (vector distance) and `FTS5` (BM25 scoring) operations.
- **Integer PKs**: Use `integer PRIMARY KEY AUTOINCREMENT` for compatibility with `sqlite-vec`'s `rowid`.
- **Junction Tables**: Use explicit junction tables for entity relationships (people, locations, activities).

## 4. Improvement Guidelines

1.  **Iterate Surgically**: When modifying ingestion logic, test on a single video first.
2.  **Don't Guess, Test**: Use the DB and file system to verify assumptions before proposing code changes.
3.  **Verify with Eval**: Use the project's evaluation scripts (`search:eval`) to ensure improvements don't introduce regressions.

## 5. CLI Model Configuration

The RAG application supports flexible model selection via CLI arguments (no environment variables).

### Model Selection Options

All search and server commands accept these options:

- `--gen-model <model>`: Generation/summarization model
- `--embed-model <model>`: Embedding model
- `--rerank-model <model>`: Reranking model

### Available Models

**Generation Models:**

- `summarizer` (default): Qwen3-4B-AWQ
- `summarizer-8b`: Qwen3-8B-AWQ (better reasoning, slower)
- `summarizer-bulk`: Qwen3-4B-AWQ (batch optimized)
- `summarizer-bulk-14b`: Qwen3-14B-AWQ (highest quality)

**Embedding Models:**

- `embed-small` (default): Qwen3-Embedding-0.6B
- `embed`: Qwen3-Embedding-4B

**Reranking Models:**

- `rerank` (default): Qwen3-Reranker-4B
- `rerank-small`: Qwen3-Reranker-0.6B (faster, slightly lower quality)

### Usage Examples

```bash
# Use 8B model for better reasoning
bun run search:rag --gen-model=summarizer-8b "What is the oldest video?"

# Use smaller reranker for faster processing
bun run search:rag --rerank-model=rerank-small "Find clips with Greg"

# Combine options
bun run search:rag --gen-model=summarizer-8b --rerank-model=rerank-small "complex query"

# Server with custom models
bun run ui:server --gen-model=summarizer-8b --rerank-model=rerank-small --port=3200

# Evaluation with specific models
bun run search:eval --gen-model=summarizer-8b --rerank-model=rerank-small
```

**Note:** The application logs the selected models on startup for verification.
