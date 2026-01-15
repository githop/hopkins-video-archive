import { type Subprocess } from "bun";
import { join, dirname } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { CONFIG } from "./config";
import { Logger } from "./logger";

/**
 * Manages the persistent Python WhisperX worker
 */
export class WorkerBridge {
  private worker: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private currentResolve: ((value: any) => void) | null = null;
  private currentReject: ((reason?: any) => void) | null = null;

  constructor() {}

  /**
   * Start the Python worker process
   */
  async start() {
    Logger.info("Starting Python WhisperX worker...");

    // Find all nvidia/*/lib directories to add to LD_LIBRARY_PATH
    // This is required for PyTorch 2.6+ to find cuDNN and other CUDA libraries
    // when installed via pip/uv in a virtual environment.
    const nvidiaBase = join(dirname(dirname(CONFIG.PYTHON_INTERPRETER)), "lib/python3.12/site-packages/nvidia");
    let ldLibraryPath = process.env.LD_LIBRARY_PATH || "";

    try {
      const nvidiaDirs = readdirSync(nvidiaBase);
      const libPaths = nvidiaDirs
        .map(dir => join(nvidiaBase, dir, "lib"))
        .filter(path => {
          try {
            return statSync(path).isDirectory();
          } catch {
            return false;
          }
        });
      
      if (libPaths.length > 0) {
        ldLibraryPath = [...libPaths, ldLibraryPath].filter(Boolean).join(":");
      }
    } catch (err) {
      Logger.warn("Could not auto-detect NVIDIA library paths for LD_LIBRARY_PATH");
    }

    this.worker = Bun.spawn([CONFIG.PYTHON_INTERPRETER, CONFIG.WORKER_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        LD_LIBRARY_PATH: ldLibraryPath,
      }
    });

    this.readStdout();
    this.readStderr();

    // Wait a bit for the worker to load the model
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  private async readStdout() {
    if (!this.worker?.stdout) return;

    const reader = this.worker.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const json = JSON.parse(trimmed);
            if (this.currentResolve) {
              this.currentResolve(json);
              this.currentResolve = null;
              this.currentReject = null;
            }
          } catch (err) {
            Logger.info(`Worker Output: ${trimmed}`);
          }
        }
      }
    } catch (err) {
      Logger.error("Error reading worker stdout", err);
    }
  }

  private async readStderr() {
    if (!this.worker?.stderr) return;

    const reader = this.worker.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("LOG:")) {
            Logger.info(`Worker ${trimmed}`);
          } else {
            Logger.warn(`Worker Error Output: ${trimmed}`);
          }
        }
      }
    } catch (err) {
      Logger.error("Error reading worker stderr", err);
    }
  }

  /**
   * Send a transcription request to the worker
   */
  async transcribe(id: string, audioPath: string): Promise<any> {
    if (!this.worker || this.worker.killed) {
      await this.start();
    }

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;

      const payload = JSON.stringify({
        id,
        audio_path: audioPath,
        output_dir: CONFIG.TRANSCRIPTS_DIR,
        batch_size: CONFIG.WHISPER.BATCH_SIZE,
        compute_type: CONFIG.WHISPER.COMPUTE_TYPE,
      });

      this.worker?.stdin.write(payload + "\n");
      this.worker?.stdin.flush();
    });
  }

  stop() {
    this.worker?.kill();
    this.worker = null;
  }
}
