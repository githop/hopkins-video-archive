# Ingest Pipeline (`@hop-hv-rag/ingest`)

This package contains the ingestion pipeline for `hop-hv-rag`, responsible for transforming raw video transcriptions into a semantically indexed database.

## Overview

The pipeline processes WhisperX JSON transcriptions, extracts semantic scenes using vLLM, generates hierarchical summaries (scene-level and video-level), and creates vector embeddings for semantic search.

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

### 4. Temporal Metadata Extraction

Extract year ranges from video filenames and scene content using AI. This populates the `year_start` and `year_end` columns for temporal search filtering.

```bash
bun run ingest:temporal --all
```

**Options:**

- `--all`: Process all videos without year data
- `--file <filename>`: Process a specific video file
- `--force`: Re-process videos that already have year data
- `--model <model>`: Choose AI model (default: `summarizer-bulk`)
- `--concurrency <n>`: Parallel requests (default: 16)

### 5. Entity Normalization (Participants & Locations)

Cluster raw mentions into a canonical registry and then migrate them to relational tables.

```bash
# For participants
bun run cluster-participants
bun run migrate-participants

# For locations
bun run cluster-locations
bun run migrate-locations
```

### 6. Global Video Summarization

Generate holistic "Archival Abstracts" for each video by synthesizing its scene summaries. These provide big-picture context for RAG queries.

```bash
bun run ingest:global --all
```

### 7. Vector Indexing

Generate and store embeddings for both scene summaries and global video summaries to enable semantic search at multiple granularities.

```bash
# Embed individual scenes
bun run embed --all

# Embed global video summaries
bun run embed-videos --all
```

## Resetting the Database

To completely reset the archive and start fresh from raw transcripts:

```bash
# From the project root - this deletes the database and all registries
bun run ingest:reset

# Then re-run the full workflow
bun run ingest:summarize --all
bun run ingest:temporal --all
bun run ingest:global --all
bun run ingest:cluster-participants
bun run ingest:migrate-participants
bun run ingest:cluster-locations
bun run ingest:migrate-locations
bun run ingest:cluster-activities
bun run ingest:migrate-activities
bun run ingest:embed --all
bun run ingest:embed-videos --all
```

**Warning**: The reset command deletes `data/hv-rag.db` and all `*-registry.json` files. This action cannot be undone. Always backup important data first.

## Command Reference

| Command                | Description                                                                  |
| :--------------------- | :--------------------------------------------------------------------------- |
| `init-db`              | Initializes the core SQLite tables and FTS5 search indexes.                  |
| `init-vec`             | Initializes the `sqlite-vec` virtual table for vector embeddings.            |
| `seed`                 | Imports `data/transcripts/*.json` and `data/mapping.json` into the DB.       |
| `summarize`            | Uses AI to divide transcripts into scenes with titles and summaries.         |
| `ingest:temporal`      | Extracts year ranges from filenames and scene content using AI.              |
| `cluster-participants` | AI-driven clustering of participant names into `participant-registry.json`.  |
| `migrate-participants` | Populates relational tables from the participant registry.                   |
| `cluster-locations`    | AI-driven clustering of locations into `location-registry.json`.             |
| `migrate-locations`    | Populates relational tables from the location registry.                      |
| `ingest:global`        | Generates global "Archival Abstracts" for videos from their scene summaries. |
| `embed`                | Vectorizes scene summaries using an embedding model.                         |
| `embed-videos`         | Vectorizes global video summaries for hierarchical RAG.                      |
| `backup`               | Creates a timestamped backup of the database and all registry files.         |
| `clean`                | Removes temporary files and processed artifacts (keeps source transcripts).  |
| `verify`               | Checks metadata consistency.                                                 |
| `verify-scenes`        | Validates that all videos have processed scenes.                             |

**Note**: The `ingest:reset` command is available from the project root (not this package) and performs a complete database wipe.

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
