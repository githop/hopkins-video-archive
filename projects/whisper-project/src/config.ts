import { join, dirname } from "node:path";

/**
 * Project Configuration
 */
const ROOT = dirname(import.meta.dir);

// Type-safe environment variables for Bun
declare module "bun" {
  interface Env {
    DRIVE_FOLDER_ID: string;
  }
}

const DRIVE_FOLDER_ID = import.meta.env.DRIVE_FOLDER_ID;

if (!DRIVE_FOLDER_ID) {
  throw new Error(
    "DRIVE_FOLDER_ID is not defined in environment variables. Please check your .env file.",
  );
}

export const CONFIG = {
  // --- Google Drive Settings ---
  DRIVE_FOLDER_ID,
  CREDENTIALS_PATH: join(ROOT, "credentials.json"),
  CLIENT_SECRETS_PATH: join(ROOT, "client_secrets.json"),
  TOKEN_PATH: join(ROOT, "token.json"),

  // --- WhisperX Settings ---
  WHISPER: {
    MODEL: "large-v3",
    COMPUTE_TYPE: "float16",
    BATCH_SIZE: 16,
    LANGUAGE: "en",
  },

  // --- Path Settings ---
  VIDEOS_DIR: join(ROOT, "videos"),
  TEMP_AUDIO_DIR: join(ROOT, "temp_audio"),
  TRANSCRIPTS_DIR: join(ROOT, "transcripts"),
  MAPPING_FILE: join(ROOT, "mapping.json"),

  // --- Worker Settings ---
  PYTHON_INTERPRETER: join(ROOT, ".venv/bin/python"),
  WORKER_PATH: join(ROOT, "python/worker.py"),

  // --- Operational Settings ---
  DOWNLOAD_CONCURRENCY: 10,
  GENERATE_SRT: true,
  GENERATE_VTT: true,
};
