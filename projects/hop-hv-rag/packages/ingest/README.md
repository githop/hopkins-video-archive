# Ingest Pipeline (`@hop-hv-rag/ingest`)

This package contains the ingestion pipeline for `hop-hv-rag`, responsible for transforming raw video transcriptions into a semantically indexed database.

## Overview

The pipeline processes WhisperX JSON transcriptions, extracts semantic scenes using vLLM, normalizes entities (participants and locations), and generates vector embeddings for semantic search.

## Recommended Workflow

To process a new set of transcripts from scratch, follow these stages in order:

### 1. Database Initialization

Prepare the SQLite database and the vector extension.

```bash
bun run init-db
bun run init-vec
```

### 2. Seeding Data

Load raw transcript files and the filename-to-ID mapping into the database.

```bash
bun run seed
```

### 3. Scene Extraction & Summarization

Process transcripts through the LLM to identify logical scene boundaries and generate summaries.

```bash
bun run summarize --all
```

### 4. Entity Normalization (Participants & Locations)

Cluster raw mentions into a canonical registry and then migrate them to relational tables.

```bash
# For participants
bun run cluster-participants
bun run migrate-participants

# For locations
bun run cluster-locations
bun run migrate-locations
```

### 5. Vector Indexing

Generate and store embeddings for scene summaries to enable semantic RAG.

```bash
bun run embed --all
```

## Command Reference

| Command                | Description                                                                 |
| :--------------------- | :-------------------------------------------------------------------------- |
| `init-db`              | Initializes the core SQLite tables and FTS5 search indexes.                 |
| `init-vec`             | Initializes the `sqlite-vec` virtual table for vector embeddings.           |
| `seed`                 | Imports `data/transcripts/*.json` and `data/mapping.json` into the DB.      |
| `summarize`            | Uses AI to divide transcripts into scenes with titles and summaries.        |
| `cluster-participants` | AI-driven clustering of participant names into `participant-registry.json`. |
| `migrate-participants` | Populates relational tables from the participant registry.                  |
| `cluster-locations`    | AI-driven clustering of locations into `location-registry.json`.            |
| `migrate-locations`    | Populates relational tables from the location registry.                     |
| `embed`                | Vectorizes scene text using an embedding model.                             |
| `verify`               | Checks metadata consistency.                                                |
| `verify-scenes`        | Validates that all videos have processed scenes.                            |

## CLI Options

Most scripts support the following arguments:

- `--all`: Process all available videos/scenes.
- `--file <filename>`: Process only the specified video file.
- `--force`: Overwrite existing data/summaries.
- `--concurrency <n>`: Number of parallel AI requests (default: 4).

## Requirements

- **Transcripts**: Raw WhisperX JSON files in `data/transcripts/`.
- **Mapping**: A `data/mapping.json` file linking filenames to cloud storage IDs.
- **AI Service**: A running vLLM or compatible OpenAI API (defaults to `http://localhost:4000/v1`).
- **SQLite**: The database is stored at `data/hv-rag.db`.
