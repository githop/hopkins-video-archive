# Hopkins Video Archive RAG (`hop-hv-rag`) 🎥 🔍

![Hopkins Video Archive RAG Demo](./hop-hv-rag.png)

`hop-hv-rag` is a specialized Retrieval-Augmented Generation (RAG) system designed for the Hopkins family video archive. It transforms raw video transcriptions (WhisperX output) into a searchable, semantically-indexed archive, allowing for natural language queries about family history.

## System Overview

The project is structured as a monorepo consisting of several specialized packages:

- 📥 **`@hop-hv-rag/ingest`**: The processing pipeline that extracts semantic scenes, normalizes entities (people and locations), and generates vector embeddings.
- 🔎 **`@hop-hv-rag/search`**: The query engine that performs hybrid search (Vector + FTS5) and synthesizes answers using LLMs.
- 🗄️ **`@hop-hv-rag/db`**: Database schema and Drizzle ORM configuration for SQLite (with `sqlite-vec`).
- 🤖 **`@hop-hv-rag/ai`**: Shared AI utilities and model abstractions (vLLM/LiteLLM).
- 🛠️ **`@hop-hv-rag/core`**: Common business logic and entity normalization services.

## Key Features

- **Hybrid Search**: Combines semantic vector search (`sqlite-vec`) with traditional keyword search (FTS5) and Reciprocal Rank Fusion (RRF) for highly relevant results.
- **Entity Normalization**: AI-driven clustering and normalization of participant names and locations mentioned in transcripts.
- **Semantic Scene Extraction**: Automatically identifies logical scene boundaries within long videos and generates concise summaries.
- **RAG Synthesis**: Answers questions by synthesizing information across multiple videos, providing precise citations with Google Drive links and timestamps.
- **TUI-Ready**: Designed to work seamlessly with TUI interfaces (built with **openTUI**, the same library used by `opencode`).

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime
- SQLite with FTS5 support
- `sqlite-vec` extension
- A running [GnarlyvLLM](https://github.com/hopkins-video-archive/gnarlyvllm) instance (or compatible OpenAI-like API)

### Installation

```bash
git clone <repository-url>
cd projects/hop-hv-rag
bun install
```

## Ingestion Workflow

To populate the archive, run the following commands in order:

```bash
# Initialize DB and Vector tables
bun run ingest:init-db
bun run ingest:init-vec

# Seed raw metadata and transcriptions
bun run ingest:seed

# Extract and summarize scenes
bun run ingest:summarize --all

# Normalize participants and locations
bun run ingest:cluster-participants
bun run ingest:migrate-participants
bun run ingest:cluster-locations
bun run ingest:migrate-locations

# Generate global video summaries
bun run ingest:global --all

# Generate embeddings for semantic search
bun run ingest:embed --all
bun run ingest:embed-videos --all
```

## Querying the Archive

Use the `search:rag` command to ask questions in natural language:

```bash
bun run search:rag "When was the last time we visited grandma in Florida?"
```

The "Family Archivist" will consult the archive, find relevant scenes, and provide a synthesized answer with citations.

## Evaluation

Run the evaluation suite to test the quality of RAG responses:

```bash
bun run search:eval
```

## License

MIT
