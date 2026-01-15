import { join, basename, extname } from "node:path";
import { CONFIG } from "./config";
import { Logger } from "./logger";

/**
 * FFmpeg utility for audio extraction
 */
export const FFMPEG = {
  /**
   * Extract audio from a video file and return the path to the extracted wav file.
   * Does NOT delete the original video file.
   */
  extractAudio: async (videoPath: string, outputPath: string): Promise<string> => {
    Logger.info(`Extracting audio from ${videoPath} -> ${outputPath}`);

    const proc = Bun.spawn([
      "ffmpeg",
      "-i", videoPath,
      "-vn",               // No video
      "-acodec", "pcm_s16le", // Standard WAV codec
      "-ar", "16000",      // 16kHz (Whisper optimal)
      "-ac", "1",          // Mono
      "-y",                // Overwrite
      outputPath
    ], {
      stdout: "inherit",
      stderr: "pipe", // FFmpeg logs to stderr
    });

    // Stream stderr in real-time for progress visibility
    const stderrReader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    
    (async () => {
      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          // FFmpeg progress lines use \r, so we write directly
          process.stderr.write(text);
        }
      } catch {
        // Process ended, ignore read errors
      }
    })();

    const exitCode = await proc.exited;

    if (exitCode === 0) {
      Logger.info(`Extraction successful: ${outputPath}`);
      return outputPath;
    } else {
      throw new Error(`FFmpeg failed with code ${exitCode}`);
    }
  }
};
