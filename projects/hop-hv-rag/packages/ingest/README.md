# Ingest Pipeline (`@hop-hv-rag/ingest`)

This package contains the chunk-centric ingestion pipeline for `hop-hv-rag`. The workflow is fully decoupled and resumable: chunking, summarization, entity extraction, clustering, and indexing are independent steps.

LLM-dependent stages are **explicit CLI commands** and are never run automatically.

## Overview

Pipeline stages:

1. **Chunking** (no LLM) - create adaptive transcript chunks.
2. **Chunk Summaries** (LLM) - generate titles and summaries per chunk.
3. **Entity Extraction** (LLM) - evidence-grounded entity mentions per chunk.
4. **Clustering / Canonicalization** (LLM) - normalize mentions into canonical entities.
5. **Materialize Links** (no LLM) - build chunk_entities and video_entities.
6. **Indexing** (no LLM + embedding model) - FTS rebuild + chunk embeddings.
7. **Optional**: Global video summaries and temporal metadata.

## Recommended Workflow

Run these steps in order when ingesting a fresh library:

### 1. Initialize database + vectors

```bash
bun run init-db
bun run init-vec
```

### 2. Seed videos + transcripts

```bash
bun run seed
```

### 3. Chunk transcripts (no LLM)

```bash
bun run ingest:chunk --all
```

Defaults:

- targetDurationSec=120, maxDurationSec=180, minDurationSec=45
- overlapSec=15, maxWords=350, gapSec=4

### 4. Summarize chunks (LLM)

Interleaved global queue with TUI for max throughput. Use `--verbose` to disable the TUI.

```bash
bun run ingest:summarize-chunks --all --concurrency 16
```

### 5. Extract entities (LLM)

```bash
bun run ingest:extract-entities --all --batch-size 50 --concurrency 8
```

### 6. Cluster and canonicalize entities (LLM)

These commands write canonical entities + variants and update `chunk_entity_mentions.entity_id`.

```bash
bun run cluster-participants
bun run cluster-locations
bun run cluster-activities
```

### 7. Materialize entity links (no LLM)

```bash
bun run ingest:materialize-entities
```

### 8. Rebuild FTS for chunks (no LLM)

```bash
bun run ingest:rebuild-fts-chunks
```

### 9. Embed chunks (embedding model)

```bash
bun run ingest:embed-chunks --all --summary-type scene
```

### 10. Optional: Global summaries (LLM)

```bash
bun run ingest:global --all
```

### 11. Optional: Temporal metadata (LLM)

```bash
bun run ingest:temporal --all
```

### 12. Optional: Embed global video summaries

```bash
bun run embed-videos --all
```

## Resumability

Most LLM stages track `run_id` and `prompt_hash` for safe retries. If you want consistent resumability, pass a stable `--run-id` or reuse the same prompt hash (defaults to prompt hash when run-id is omitted).

## Resetting the Database

To wipe the DB and start fresh (from this package directory):

```bash
bun run clean
```

This deletes `data/hv-rag.db` and registry artifacts (if present). `mapping.json` is preserved.

## Command Reference

| Command                       | Description                                      |
| :---------------------------- | :----------------------------------------------- |
| `init-db`                     | Create core tables + FTS indexes.                |
| `init-vec`                    | Create vector tables (vec0).                     |
| `seed`                        | Load transcripts and metadata into the DB.       |
| `ingest:chunk`                | Build adaptive transcript chunks.                |
| `ingest:summarize-chunks`     | LLM chunk summaries (interleaved + TUI).         |
| `ingest:extract-entities`     | LLM evidence-grounded mentions.                  |
| `cluster-participants`        | Canonicalize PERSON/ROLE entities.               |
| `cluster-locations`           | Canonicalize PLACE/SETTING entities.             |
| `cluster-activities`          | Canonicalize ACTIVITY entities.                  |
| `ingest:materialize-entities` | Build chunk_entities and video_entities.         |
| `ingest:rebuild-fts-chunks`   | Rebuild FTS over chunks + summaries + entities.  |
| `ingest:embed-chunks`         | Embed chunk text for vector search.              |
| `ingest:global`               | LLM global video summaries from chunk summaries. |
| `ingest:temporal`             | LLM temporal extraction from chunk summaries.    |
| `embed-videos`                | Embed global video summaries.                    |
| `backup`                      | Create a timestamped backup of DB + registries.  |
| `clean`                       | Delete the DB and registry artifacts.            |
| `verify`                      | Validate metadata consistency.                   |

## Common CLI Options

- `--all` or `--file <filename>`: Select videos to process.
- `--force`: Re-process and overwrite existing rows.
- `--concurrency <n>`: Parallel LLM requests (default varies by command).
- `--batch-size <n>`: Batch size for LLM calls (where supported).
- `--run-id <id>`: Deterministic run identifier for resumability.
- `--summary-type <type>`: Summary flavor (default: `scene`).

## Requirements

- **Transcripts**: `data/transcripts/*.json` (WhisperX output).
- **Mapping**: `data/mapping.json` for filename-to-ID mapping.
- **AI Service**: vLLM / OpenAI-compatible API running locally.
- **SQLite**: Database at `data/hv-rag.db`.
