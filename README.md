# Hopkins Video Archive

A unified semantic intelligence platform for personal video archives. This project implements an end-to-end pipeline to transform unstructured home video data into a searchable, interactive knowledge base.

## 🚀 Overview

The system is composed of three primary layers that work together to provide a seamless semantic search and interrogation experience for high-volume video data.

### 1. Processing Layer (`whisper-project`)
- **Technology:** Python, WhisperX, Bun (TS)
- **Function:** Automated extraction of audio from video files and high-accuracy transcription using WhisperX. Includes speaker diarization and alignment to ensure temporal accuracy.

### 2. Ingestion & Indexing Layer (`hop-hv-rag`)
- **Technology:** Bun, SQLite, Vector Embeddings
- **Function:** A custom RAG (Retrieval-Augmented Generation) pipeline that chunks transcripts, generates semantic embeddings, and stores them in a hybrid relational/vector database. Features entity extraction for participants and locations.

### 3. Interaction Layer (`gnarlyvllm`)
- **Technology:** React, XState, Bun, TUI
- **Function:** A low-latency, specialized Terminal User Interface (TUI) for interacting with the archive. It leverages VLLMs to provide natural language answers grounded in the video data.

## 🏗 System Architecture

```text
[ Raw Video ] -> [ whisper-project ] -> [ JSON Transcripts ]
                                               |
                                               v
[ SQLite DB ] <- [  hop-hv-rag    ] <- [ Semantic Chunking ]
      |
      +--------> [  gnarlyvllm    ] <-> [ Terminal UI ]
```

## 🛠 Tech Stack

- **Runtimes:** [Bun](https://bun.sh/), Node.js, Python 3.12
- **Languages:** TypeScript, Python
- **AI/ML:** WhisperX, VLLM, Semantic Embeddings
- **State Management:** XState
- **Storage:** SQLite
- **Tooling:** UV (Python package management), Prettier

---

*Note: This repository contains the source code and architecture for the platform. Private data artifacts (databases, transcripts, and media) are excluded for privacy.*
