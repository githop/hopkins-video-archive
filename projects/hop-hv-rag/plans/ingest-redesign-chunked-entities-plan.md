# Ingest Redesign: Chunked Summaries + Evidence-Grounded Entities

## Goal

Redesign ingest to decouple chunking, summarization, and entity extraction for better RAG performance and batchability on local vLLM. The new pipeline must be resumable, evidence-grounded, and produce higher-quality retrieval signals.

## Non-Goals

- No UI changes in this plan.
- No model/provider changes beyond structured prompts and batch execution.
- No retroactive data mutations without explicit approval and backup (per AGENTS.md).

## Current State (Key Constraints)

- Legacy summarize-scenes script removed in favor of chunk pipeline.
- `scenes.summary` is NOT NULL, so chunk-only records cannot be stored in `scenes` without schema changes.
- `packages/search/src/archivist.ts` reads from `scenes`, FTS, and vec tables.
- FTS/vec are keyed to `scenes` rowid.

## Proposed Design (Chunk-Centric)

Introduce a dedicated chunk layer and evidence-grounded entity mentions. Summaries and entities become independent batch stages.

### New Tables

1. **chunks**

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `video_id INTEGER NOT NULL REFERENCES videos(id)`
- `start_time REAL NOT NULL`
- `end_time REAL NOT NULL`
- `text TEXT NOT NULL` (raw chunk transcript)
- `token_count INTEGER` (optional)
- `overlap_from_chunk_id INTEGER` (nullable, for overlap lineage)
- `chunk_hash TEXT NOT NULL` (deterministic hash of segment ids/time ranges)
- `created_at TEXT DEFAULT CURRENT_TIMESTAMP`

2. **chunk_summaries** (versioned)

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `chunk_id INTEGER NOT NULL REFERENCES chunks(id)`
- `summary_type TEXT NOT NULL` (e.g., 'scene')
- `title TEXT NOT NULL`
- `summary TEXT NOT NULL`
- `model TEXT NOT NULL`
- `prompt_hash TEXT NOT NULL`
- `run_id TEXT NOT NULL` (pipeline run id)
- `created_at TEXT DEFAULT CURRENT_TIMESTAMP`

3. **entities** (unified canonical)

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `name TEXT NOT NULL UNIQUE`
- `entity_type TEXT NOT NULL` ('PERSON'|'ROLE'|'PLACE'|'SETTING'|'ACTIVITY')
- `subtype TEXT` (activity category: SPORT/RECREATION/HOLIDAY/MILESTONE)
- `normalized_key TEXT` (optional, for exact/lenient match)

4. **entity_variants**

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `entity_id INTEGER NOT NULL REFERENCES entities(id)`
- `raw_text TEXT NOT NULL UNIQUE`
- `normalized_raw TEXT` (optional)
- `source TEXT` (e.g., 'registry', 'mention')
- `confidence REAL` (optional)

5. **chunk_entity_mentions** (evidence grounded)

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `chunk_id INTEGER NOT NULL REFERENCES chunks(id)`
- `entity_type TEXT NOT NULL`
- `raw_text TEXT NOT NULL`
- `evidence_text TEXT NOT NULL`
- `start_time REAL NOT NULL`
- `end_time REAL NOT NULL`
- `confidence TEXT NOT NULL` ('high'|'medium'|'low')
- `model TEXT NOT NULL`
- `prompt_hash TEXT NOT NULL`
- `run_id TEXT NOT NULL`
- `entity_id INTEGER` (nullable, populated after canonicalization)

6. **chunk_entities** (materialized links, fast search)

- `chunk_id INTEGER NOT NULL REFERENCES chunks(id)`
- `entity_id INTEGER NOT NULL REFERENCES entities(id)`
- `mention_count INTEGER NOT NULL`
- `weight REAL` (optional, for boosting)
- PRIMARY KEY `(chunk_id, entity_id)`

7. **video_entities** (materialized links)

- `video_id INTEGER NOT NULL REFERENCES videos(id)`
- `entity_id INTEGER NOT NULL REFERENCES entities(id)`
- `mention_count INTEGER NOT NULL`
- PRIMARY KEY `(video_id, entity_id)`

### Updated FTS/Vec

- New `fts_chunks` virtual table with `chunks.text`, summary, and entity names.
- New `vec_chunks` keyed by `chunks.id` (or reuse `vec_scenes` after transition).

## Pipeline Stages (Batchable)

### Stage 0: Chunking (no LLM)

**Command**: `bun run ingest:chunk --all [--force] [--overlap 15] [--target 120] [--max 180] [--min 45]`

**Algorithm Defaults (from transcript style)**

- `targetDurationSec=120`, `maxDurationSec=180`, `minDurationSec=45`, `overlapSec=15`
- `maxWords=350`
- Boundary rules: gap >= 4s, sentence-ending punctuation, or forced split at nearest boundary when max reached.
- Deterministic `chunk_hash` based on segment ids + start/end for resume/consistency.

**Outputs**: `chunks` rows.

### Stage 1: Summarization (LLM)

**Command**: `bun run ingest:summarize-chunks --all --batch-size N --concurrency M`

**Input**: `chunks.text`
**Output**: `chunk_summaries` row (type=scene) for each chunk.

### Stage 2: Entity Extraction (LLM)

**Command**: `bun run ingest:extract-entities --all --batch-size N --concurrency M`

**LLM Output Schema** (strict)

- `mentions: [{ type, raw_text, evidence_text, start_time, end_time, confidence }]`
- Evidence must be an exact substring of chunk text.

**Validation**

- Drop mention if evidence_text not found in chunk.
- Drop mention if duration < 0 or times out of chunk range.

**Output**: `chunk_entity_mentions`.

### Stage 3: Canonicalization / Clustering (LLM)

**Command**: reuse `ingest:cluster-*`, but feed it from `chunk_entity_mentions` (unique raw_text + context snippet).

**Updates**

- Write to `entities` and `entity_variants`.
- Populate `entity_id` on mentions.

### Stage 4: Materialize Links (no LLM)

**Command**: `bun run ingest:materialize-entities`

- Populate `chunk_entities` and `video_entities` from mentions.

### Stage 5: Indexing

- `ingest:rebuild-fts-chunks` (new) over `chunks + summaries + entity names`.
- `ingest:embed-chunks` (new) embedding enriched text.

### Stage 6: Retrieval Update

- Update `packages/search/src/archivist.ts` to read from chunks + summaries + chunk_entities instead of scenes.
- Update rerank input to include summary + key transcript phrases.

## Migration Strategy

1. **Schema migration** (new tables). Use `init-db.ts` updates and a one-off `migrate-chunks.ts` if needed.
2. **Backfill**
   - Run chunking over all transcripts.
   - Run summarization and entity extraction in batches.
   - Run clustering and materialization.
3. **Cutover**
   - Switch search to new tables.
   - Rebuild FTS + re-embed.
   - Verify with `search:eval`.

## File-Level Implementation Plan

### 1) DB Schema

- `packages/db/src/schema.ts`: add new tables + export types.
- `packages/ingest/src/init-db.ts`: create tables and FTS for chunks.
- Add validation types in `packages/db/src/validation.ts`.

### 2) Chunker

- New file: `packages/ingest/src/chunk-transcripts.ts`.
- Uses transcript segments to build adaptive chunks + overlap.
- Writes `chunks` rows with deterministic `chunk_hash`.

### 3) Summarization

- New file: `packages/ingest/src/summarize-chunks.ts`.
- Reads `chunks` and writes `chunk_summaries`.
- Remove entity extraction from this stage.

### 4) Entity Extraction

- New file: `packages/ingest/src/extract-entities.ts`.
- Structured prompt; validates evidence_text; writes `chunk_entity_mentions`.

### 5) Clustering Update

- Update `packages/ingest/src/cluster-engine.ts` to accept optional context per item.
- New step to build the unique list from mentions + context.

### 6) Materialize Links

- New file: `packages/ingest/src/materialize-entities.ts`.
- Populate `chunk_entities` and `video_entities`.

### 7) Search Updates

- Update `packages/search/src/archivist.ts` to pull chunk summaries + chunk entities.
- Update Source formatting to use chunk timestamps.

### 8) Embedding + FTS

- New: `packages/ingest/src/embed-chunks.ts` (chunk embeddings).
- New: `packages/ingest/src/rebuild-fts-chunks.ts`.

## vLLM Batch Strategy

- For summarization and extraction, run batch size 50–200 with concurrency 8–32 depending on GPU.
- Use deterministic `run_id` to resume partial runs.
- Track failed chunks separately and retry in isolated batches.

## Execution Responsibilities

- You will run LLM-dependent commands (summarization, entity extraction, clustering, embedding) manually when the correct model servers are running.
- Implementation should keep these stages as explicit CLI commands so they can be invoked independently and re-run safely.

## Testing & Validation

1. `bun run typecheck` after schema + ingest changes.
2. Run `bun run search:eval` on a known query set; compare recall/precision.
3. Spot-check: 5 videos, confirm chunk boundaries, evidence grounding, and canonicalization.

## Safety Protocol (from AGENTS.md)

Before any DB mutation:

1. Identify the inconsistency or change.
2. Describe SQL/code to run.
3. Offer a backup (e.g., `cp data/hv-rag.db data/hv-rag.db.bak`).
4. Get explicit approval.

## Decision Checklist

- Confirm chunk table + mention table schema.
- Confirm chunk defaults (120s target, 180s max, 45s min, 15s overlap).
- Confirm prompt for evidence-grounded entity extraction.
- Confirm cutover plan to search.

## Execution Order Summary

1. Schema migration
2. Chunking
3. Summarization
4. Entity extraction
5. Clustering
6. Materialize links
7. Rebuild FTS + re-embed
8. Search cutover + eval
