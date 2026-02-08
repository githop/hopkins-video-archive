# @hop-hv-rag/ingest

Data ingestion pipeline for the RAG system. Transforms WhisperX transcripts into indexed, searchable chunks with embeddings and extracted entities.

## Overview

The ingestion pipeline processes video archives through multiple stages:

1. **Chunking** - Adaptive transcript segmentation
2. **Summarization** - AI-generated titles and summaries
3. **Entity Extraction** - Evidence-grounded entity detection
4. **Entity Clustering** - AI canonicalization (automated)
5. **Materialization** - Relationship aggregation
6. **Embedding** - Multi-field vector generation
7. **Indexing** - Full-text search (FTS5)

## Pipeline Flow

```
WhisperX JSON → Seed → Chunks → Summaries → Mentions → Clustering → Materialize → Embeddings → FTS
     │              │       │          │          │          │            │           │        │
     ▼              ▼       ▼          ▼          ▼          ▼            ▼           ▼        ▼
videos table   transcripts  chunks   chunk_    chunk_    entities    chunk_    vec_     fts_
                              table   summaries  mentions   variants   entities   chunks   chunks
```

## Available Scripts

### Core Pipeline

| Script                              | Description                                   |
| ----------------------------------- | --------------------------------------------- |
| `bun run ingest:chunk`              | Adaptive chunking with configurable bounds    |
| `bun run ingest:summarize-chunks`   | Generate AI summaries with titles             |
| `bun run ingest:extract-entities`   | Extract grounded entity mentions              |
| `bun run ingest:embed-chunks`       | Create embeddings (summary + entities + text) |
| `bun run ingest:rebuild-fts-chunks` | Rebuild FTS5 full-text index                  |

### Entity Management

| Script                                | Description                                |
| ------------------------------------- | ------------------------------------------ |
| `bun run cluster-participants`        | AI clustering of people (progress TUI)     |
| `bun run cluster-locations`           | AI clustering of places (progress TUI)     |
| `bun run cluster-activities`          | AI clustering of activities (progress TUI) |
| `bun run ingest:materialize-entities` | Aggregate to chunk/video entities          |
| `bun run reset:entities`              | Clear all entity data                      |

### Data Management

| Script             | Description                      |
| ------------------ | -------------------------------- |
| `bun run seed`     | Import videos from WhisperX JSON |
| `bun run init-db`  | Initialize database schema       |
| `bun run init-vec` | Initialize sqlite-vec tables     |
| `bun run backup`   | Create database backup           |
| `bun run verify`   | Verify metadata integrity        |

### Additional Processing

| Script                    | Description                   |
| ------------------------- | ----------------------------- |
| `bun run ingest:temporal` | Extract year ranges           |
| `bun run ingest:global`   | Generate video summaries      |
| `bun run embed-videos`    | Create video-level embeddings |

## CLI Usage

All scripts support these common flags:

```bash
# Process single video
bun run ingest:chunk --file "1995-2.m4v"

# Process all videos with specific model
bun run ingest:summarize-chunks --gen-model summarizer-bulk-30b

# Force reprocessing (ignore cache)
bun run ingest:extract-entities --force

# Specify batch size
bun run ingest:embed-chunks --all --batchSize 100
```

| Flag                    | Description               |
| ----------------------- | ------------------------- |
| `--file <name>`         | Process specific video    |
| `--all`                 | Process all videos        |
| `--force`               | Reprocess even if exists  |
| `--batchSize <n>`       | Control batch size        |
| `--gen-model <model>`   | Override generation model |
| `--embed-model <model>` | Override embedding model  |

## Processing Stages

### 1. Chunking (`chunk-transcripts.ts`)

Adaptive chunking based on:

- Target duration: 120s (configurable)
- Max duration: 180s
- Min duration: 45s
- Max words: 350
- Sentence boundaries
- 4-second gap detection
- 15s overlap between chunks

Creates `chunks` table entries with hash-based deduplication.

### 2. Summarization (`summarize-chunks.ts`)

Generates versioned summaries:

- Title (descriptive, 3-7 words)
- Summary (2-3 sentences)
- Stored in `chunk_summaries` with run ID tracking
- Prompt hash for reproducibility

Uses TUI for progress display.

### 3. Entity Extraction (`extract-entities.ts`)

Extracts grounded mentions with evidence:

- **Types**: PERSON, ROLE, PLACE, SETTING, ACTIVITY
- Evidence must be present in chunk text
- Time bounds validated against chunk
- Confidence levels: high/medium/low

Stored in `chunk_entity_mentions` with:

- `raw_text` - As extracted
- `evidence_text` - Grounding snippet
- `start_time`/`end_time` - Temporal bounds
- `model`/`prompt_hash`/`run_id` - Versioning

Tracks status in `chunk_extraction_status` (pending/success/failed/empty).

### 4. Entity Clustering (`cluster-*.ts`)

Automated AI clustering (no user interaction):

1. Queries unclustered mentions from `chunk_entity_mentions`
2. Groups by entity type (PERSON/ROLE, PLACE/SETTING, ACTIVITY)
3. Batches similar raw names
4. AI determines canonical names
5. Updates tables:
   - `entities` - Canonical entries
   - `entity_variants` - Raw→canonical mapping
   - `chunk_entity_mentions.entity_id` - Link to canonical

Example: "Johnny", "John", "Jon" → canonical "John"

Progress displayed via ClusterTUI (not interactive).

### 5. Materialization (`materialize-entities.ts`)

Aggregates relationships:

- `chunk_entities` - Count mentions per chunk
- `video_entities` - Count mentions per video

Enables efficient entity-based retrieval.

### 6. Embedding (`embed-chunks.ts`)

Multi-field embeddings combining:

```
TITLE: {chunk_title}
SUMMARY: {chunk_summary}
ENTITIES: {entity1, entity2, ...}
TRANSCRIPT: {chunk_text}
```

Stored in `vec_chunks` (sqlite-vec virtual table).

### 7. FTS Index (`rebuild-fts-chunks.ts`)

Rebuilds FTS5 index on chunk text for BM25 search.

## Key Source Files

| File                          | Purpose                         |
| ----------------------------- | ------------------------------- |
| `src/chunk-transcripts.ts`    | Adaptive chunking logic         |
| `src/summarize-chunks.ts`     | AI summary generation           |
| `src/extract-entities.ts`     | Entity extraction with evidence |
| `src/cluster-*.ts`            | AI clustering (3 entity types)  |
| `src/cluster-engine.ts`       | Shared clustering logic         |
| `src/materialize-entities.ts` | Relationship aggregation        |
| `src/embed-chunks.ts`         | Vector embedding generation     |
| `src/rebuild-fts-chunks.ts`   | FTS5 index management           |
| `src/seed-metadata.ts`        | Video import from JSON          |
| `src/tui.ts`                  | Progress display for batch ops  |
| `src/cluster-tui.ts`          | Progress display for clustering |
| `src/prompts.ts`              | AI prompts and schemas          |

## Input Data

### WhisperX JSON Format

Located in `data/transcripts/{video-name}.json`:

```json
{
  "segments": [
    {
      "start": 0.031,
      "end": 23.895,
      "text": "Greg, how much are you going to take...",
      "words": [
        { "word": "Greg,", "start": 0.031, "end": 10.11, "score": 0.48 }
      ]
    }
  ]
}
```

### mapping.json

Maps filenames to Google Drive IDs in `data/mapping.json`:

```json
{
  "1995-2.m4v": "0B-xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "1998-99-15.m4v": "0B-yyyyyyyyyyyyyyyyyyyyyyyyyy"
}
```

## Testing Changes

Always test on a single file first:

```bash
# Test chunking
bun run ingest:chunk --file "1995-2.m4v"

# Verify output
sqlite3 data/hv-rag.db "SELECT * FROM chunks WHERE video_id = (SELECT id FROM videos WHERE filename = '1995-2.m4v') LIMIT 5;"
```

## Iterative Workflow

1. Make code changes
2. Test on single video with `--file`
3. Verify database output
4. Run full pipeline only after validation
