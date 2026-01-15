# Hopkins Video Archive

A unified semantic intelligence platform for personal video archives. This project implements an end-to-end pipeline to transform unstructured home video data into a searchable, interactive knowledge base.

## 🚀 Overview

The system is composed of three primary layers that work together to provide a seamless semantic search and interrogation experience for high-volume video data.

### 1. Data Processing (`projects/whisper-project`)
- **Technology:** Python, WhisperX, Bun (TS)
- **Function:** Handles the automated extraction of audio from video files and generates high-fidelity transcripts using WhisperX. It ensures temporal alignment of the text to the video for precise retrieval.

### 2. Inference Infrastructure (`projects/gnarlyvllm`)
- **Technology:** Docker, vLLM, LiteLLM, XState, React, openTUI
- **Function:** A specialized Terminal User Interface (TUI) application built with **openTUI** (the same terminal library used by opencode) that orchestrates containerized **vLLM** instances. It uses State Machines to manage the lifecycle of GPU-accelerated containers and provides an OpenAI-compatible API via a **LiteLLM** proxy, supporting:
  - **Generation:** Qwen 3 (4B Thinking / 4B AWQ)
  - **Embeddings:** Qwen 3 (4B Embedding)

### 3. Intelligence Layer (`projects/hop-hv-rag`)
- **Technology:** Bun, SQLite, Vector Search
- **Function:** The "brain" of the archive. It consumes transcripts from the processing layer, generates semantic embeddings via the inference layer, and indexes them into a hybrid SQLite database. It features:
  - Custom ingestion pipeline for retrieval.
  - Entity extraction for participants and locations.
  - Interactive Search/Eval RAG tools.

## 🏗 System Architecture

```text
[ Raw Video ]
      |
      v
[ whisper-project ] (Audio Extraction & Alignment)
      |
      v
[ JSON Transcripts ]
      |
      +------> [ hop-hv-rag ] (Ingestion & RAG)
                   |          ^
                   |          | (OpenAI-compatible API)
                   v          |
             [ gnarlyvllm ] (vLLM Containers)
```

## 🛠 Tech Stack

- **Runtimes:** [Bun](https://bun.sh/), Python 3.12
- **AI/ML:** WhisperX, vLLM, LiteLLM
- **Models:** Qwen 3 (Thinking, AWQ, Embedding)
- **Storage:** SQLite (Hybrid Relational + Vector)
- **Orchestration:** Docker
- **UI & State:** openTUI, React, XState (Container Lifecycle)


