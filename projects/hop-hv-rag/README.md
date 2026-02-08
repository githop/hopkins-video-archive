# hop-hv-rag

A RAG (Retrieval-Augmented Generation) system for searching and exploring video transcripts. This system ingests video metadata and WhisperX transcripts to provide semantic search with AI-powered responses.

## Architecture

The project is organized as a monorepo with the following packages:

| Package              | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `@hop-hv-rag/core`   | Shared utilities (logging, metadata parsing)                         |
| `@hop-hv-rag/db`     | Database schema, Drizzle ORM, and sqlite-vec integration             |
| `@hop-hv-rag/ai`     | AI model configuration for Google Gemini and vLLM                    |
| `@hop-hv-rag/ingest` | Data ingestion pipeline (chunking, summarization, entity extraction) |
| `@hop-hv-rag/search` | Retrieval pipeline and RAG API (Hono server)                         |
| `@hop-hv-rag/ui`     | React frontend for the search interface                              |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime

### Installation

```bash
bun install
```

### Database Setup

```bash
# Initialize database and vector tables
bun run ingest:init-db
bun run ingest:init-vec

# Seed with video metadata from WhisperX JSON transcripts
bun run ingest:seed
```

### Data Processing Pipeline

Process raw transcripts into searchable chunks:

```bash
# 1. Chunk transcripts (adaptive chunking based on duration/gaps)
bun run ingest:chunk

# 2. Summarize chunks (generates titles and summaries)
bun run ingest:summarize-chunks

# 3. Extract entities (people, locations, activities with evidence)
bun run ingest:extract-entities

# 4. Cluster entities (AI groups similar names - automated)
bun run ingest:cluster-participants
bun run ingest:cluster-locations
bun run ingest:cluster-activities

# 5. Materialize entity relationships
bun run ingest:materialize-entities

# 6. Generate embeddings (combines summary + entities + transcript)
bun run ingest:embed-chunks

# 7. Rebuild FTS5 index
bun run ingest:rebuild-fts-chunks
```

### Running the Application

```bash
# Build UI and start server
bun run start

# Or separately:
bun run ui:build
bun run ui:server
```

The server starts on port 3200 by default.

## Available Scripts

### Ingestion

| Script                                | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `bun run ingest:chunk`                | Adaptive chunking of WhisperX transcripts      |
| `bun run ingest:summarize-chunks`     | AI summarization with title generation         |
| `bun run ingest:extract-entities`     | Entity extraction with evidence grounding      |
| `bun run ingest:cluster-participants` | AI clustering of people (progress display)     |
| `bun run ingest:cluster-locations`    | AI clustering of locations (progress display)  |
| `bun run ingest:cluster-activities`   | AI clustering of activities (progress display) |
| `bun run ingest:materialize-entities` | Aggregate entity links to chunk/video level    |
| `bun run ingest:embed-chunks`         | Generate vector embeddings (multi-field)       |
| `bun run ingest:rebuild-fts-chunks`   | Rebuild full-text search index                 |
| `bun run ingest:temporal`             | Extract temporal metadata (year ranges)        |
| `bun run ingest:global`               | Generate global video summaries                |
| `bun run ingest:reset`                | Reset entire database (destructive)            |
| `bun run ingest:reset-entities`       | Reset only entity data                         |

### Search & RAG

| Script                | Description             |
| --------------------- | ----------------------- |
| `bun run search:rag`  | CLI RAG query interface |
| `bun run search:eval` | Run evaluation suite    |
| `bun run ui:server`   | Start Hono API server   |

### Development

| Script              | Description                 |
| ------------------- | --------------------------- |
| `bun run typecheck` | Run TypeScript type checker |
| `bun run format`    | Format code with Prettier   |
| `bun run ui:build`  | Build React frontend        |

## Data Directory Structure

```
data/
├── hv-rag.db                  # Main SQLite database
├── mapping.json               # Video filename → Google Drive ID mapping
├── thumbnails/                # Video frame thumbnails (subdirs by video)
│   └── {video-name}/
│       └── {timestamp}.jpg
├── transcripts/               # WhisperX JSON transcript files
│   └── {video-name}.json
└── backups/                   # Database backups
```

### Input Format: WhisperX JSON

Transcripts are WhisperX output files with word-level timestamps:

```json
{
  "segments": [
    {
      "start": 0.031,
      "end": 23.895,
      "text": "Greg, how much are you going to take...",
      "words": [
        { "word": "Greg,", "start": 0.031, "end": 10.11, "score": 0.48 },
        { "word": "how", "start": 10.13, "end": 10.27, "score": 0.68 }
      ]
    }
  ]
}
```

### mapping.json

Maps video filenames to Google Drive IDs:

```json
{
  "1995-2.m4v": "0B-xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "1998-99-15.m4v": "0B-yyyyyyyyyyyyyyyyyyyyyyyyyy"
}
```

## Database Schema

Key tables:

- **videos** - Video metadata (title, year, global summary)
- **transcripts** - Raw WhisperX segment data
- **chunks** - Semantic transcript chunks with adaptive boundaries
- **chunk_summaries** - AI-generated titles and summaries (versioned)
- **entities** - Canonical entities (people, places, activities)
- **entity_variants** - Raw text variants linked to canonical entities
- **chunk_entity_mentions** - Evidence-grounded entity mentions
- **chunk_entities** - Materialized chunk-entity relationships with counts
- **video_entities** - Materialized video-entity relationships
- **chunk_extraction_status** - Tracks entity extraction state per chunk
- **vec_chunks** - sqlite-vec virtual table for vector embeddings
- **fts_chunks** - FTS5 virtual table for full-text search

## Search Architecture

The RAG system uses a multi-stage retrieval pipeline:

1. **Entity Detection** - Scans query for known entities
2. **Vector Search** - Semantic similarity via sqlite-vec (top 40)
3. **BM25 Search** - Full-text search via FTS5 (top 40)
4. **RRF Fusion** - Reciprocal Rank Fusion combines results
5. **Neural Reranking** - Reranks top candidates by relevance
6. **Keyword Boost** - Boosts exact term matches
7. **Entity Boost** - Boosts chunks containing detected entities
8. **Temporal Boost** - Adjusts scores based on year in query

## Package Documentation

- [packages/ingest](./packages/ingest) - Ingestion pipeline
- [packages/search](./packages/search) - RAG search API
- [packages/ui](./packages/ui) - React frontend

## Technology Stack

- **Runtime**: [Bun](https://bun.sh)
- **Database**: SQLite with [Drizzle ORM](https://orm.drizzle.team/) and [sqlite-vec](https://github.com/asg017/sqlite-vec)
- **AI**: vLLM via [AI SDK](https://sdk.vercel.ai/)
- **API**: [Hono](https://hono.dev) web framework
- **Frontend**: React 19, Vite, Tailwind CSS 4

## Evaluation

Run the evaluation suite to verify RAG quality:

```bash
bun run search:eval
```

Results are written to `eval-results.md`.

## License

MIT
