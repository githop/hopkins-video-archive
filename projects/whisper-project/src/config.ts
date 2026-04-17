import { join, dirname } from "node:path";

/**
 * Project Configuration
 */
const ROOT = dirname(import.meta.dir);

// Type-safe environment variables for Bun
declare module "bun" {
  interface Env {
    DRIVE_FOLDER_ID: string;
    ENABLE_DIARIZATION?: string;
    HF_TOKEN?: string;
    MIN_SPEAKERS?: string;
    MAX_SPEAKERS?: string;
    DIARIZATION_MODEL?: string;
    WHISPER_OUTPUT_FORMAT?: string;
  }
}

const DRIVE_FOLDER_ID = import.meta.env.DRIVE_FOLDER_ID;

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

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
    OUTPUT_FORMAT: import.meta.env.WHISPER_OUTPUT_FORMAT ?? "all",
  },

  DIARIZATION: {
    ENABLED: parseBool(import.meta.env.ENABLE_DIARIZATION, false),
    HF_TOKEN: import.meta.env.HF_TOKEN,
    MIN_SPEAKERS: parseIntOrUndefined(import.meta.env.MIN_SPEAKERS),
    MAX_SPEAKERS: parseIntOrUndefined(import.meta.env.MAX_SPEAKERS),
    MODEL: import.meta.env.DIARIZATION_MODEL ?? "pyannote/speaker-diarization-community-1",
  },

  // --- Path Settings ---
  VIDEOS_DIR: join(ROOT, "videos"),
  TEMP_AUDIO_DIR: join(ROOT, "temp_audio"),
  TRANSCRIPTS_DIR: join(ROOT, "transcripts"),
  MAPPING_FILE: join(ROOT, "mapping.json"),

  // --- Thumbnail Settings ---
  HV_RAG_DB: join(ROOT, "../hop-hv-rag/data/hv-rag.db"),
  THUMBNAILS_DIR: join(ROOT, "../hop-hv-rag/data/thumbnails"),
  THUMBNAIL: {
    WIDTH: 320,
    HEIGHT: 240,
    QUALITY: 2,          // FFmpeg -q:v (1-5, lower=better)
  },

  // --- Worker Settings ---
  PYTHON_INTERPRETER: join(ROOT, ".venv/bin/python"),
  WORKER_PATH: join(ROOT, "python/worker.py"),

  // --- Operational Settings ---
  DOWNLOAD_CONCURRENCY: 10,
  GENERATE_SRT: true,
  GENERATE_VTT: true,
};
