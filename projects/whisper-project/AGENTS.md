# Agent Guidelines: whisper-project

This project is a hybrid TypeScript/Python system designed to orchestrate the transcription of Google Drive videos using WhisperX. It is organized into a stateless, three-stage pipeline.

## 🛠 Commands

### Stage 1: Downloader
- **Batch Download:** `bun run download` (Downloads all missing MKVs from Drive)
- **Single Download:** `bun run download --id=<fileId>`
- **Logic:** Compares remote Drive files to local `videos/` folder. Downloads in parallel (concurrency 10).

### Stage 2: Transcriber
- **Batch Process:** `bun run transcribe` (Processes all videos without existing SRTs)
- **Single Process:** `bun run transcribe --file=<filename>`
- **Logic:** 
  1. Extracts 16kHz WAV to `temp_audio/`.
  2. Transcribes via Python WhisperX worker.
  3. Generates `.srt`, `.vtt`, `.json`, and `.txt` in `transcripts/`.
  4. Deletes temporary audio.

### Stage 3: Organizer
- **Batch Organize:** `bun run organize` (Restructures Drive folders)
- **Single Organize:** `bun run organize --file=<filename>`
- **Logic:** 
  1. Creates a folder on Drive named after the video.
  2. Moves the MKV into that folder.
  3. Uploads all transcript artifacts into the same folder.

### Other Commands
- **Install Dependencies:** `bun install`
- **Type Check:** `bun x tsc --noEmit`
- **Lint Python:** `uv run ruff check .`
- **Format Python:** `uv run ruff format .`

---

## 💻 Code Style Guidelines

### TypeScript (src/*.ts)
- **Runtime:** Built for **Bun**. Use `Bun.spawn`, `Bun.write`, and `Bun.file`.
- **Modules:** Strict **ESM**. Use `node:` prefix for built-ins.
- **Statelessness:** No database. Use the filesystem and Drive metadata as the source of truth.
- **Naming:** `PascalCase` for classes, `camelCase` for functions/variables.
- **Error Handling:** Centralized `Logger`. Wrap main operations in `try/catch`.
- **Path Management:** Always use `node:path`'s `join`. Reference paths defined in `src/config.ts`.

### Python (python/*.py)
- **Environment:** Managed by `uv`. 
- **Protocol:** Communicates via JSON over `stdin/stdout`.
- **Logging:** All logs must go to `sys.stderr` via the `log()` helper to avoid breaking the JSON bridge.
- **Cleanup:** Explicitly clear CUDA cache and trigger GC after each file.

---

## 🏗 Architecture & State

- **`videos/`**: Local cache of video files.
- **`temp_audio/`**: Temporary storage for extracted WAVs (automatically cleaned up).
- **`transcripts/`**: Local storage for generated artifacts.
- **`src/config.ts`**: Central path and concurrency configuration.
- **`src/formatters.ts`**: Utilities for converting WhisperX JSON to SRT/VTT.
- **`src/worker-bridge.ts`**: Manages the persistent Python subprocess.

---

## 🤖 AI / Agent Context
- **VRAM Safety:** Always process transcriptions sequentially (`concurrency 1`) to avoid GPU Out-of-Memory.
- **Drive Consistency:** When uploading, verify the folder structure on Drive to prevent duplicate folders.
- **Zero Dependencies:** Favor native Bun APIs or simple internal utilities (like the `throttle` in `src/utils.ts`) over adding new NPM packages.
