import { join, basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG } from "./config";
import { FFMPEG } from "./ffmpeg";
import { WorkerBridge } from "./worker-bridge";
import { Logger } from "./logger";
import { ensureDir } from "./utils";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      file: { type: "string" },
    },
    strict: false,
  });

  await ensureDir(CONFIG.TEMP_AUDIO_DIR);
  await ensureDir(CONFIG.TRANSCRIPTS_DIR);

  const worker = new WorkerBridge();
  
  const targetFile = values.file as string | undefined;

  const glob = new Bun.Glob("*.{mp4,m4v,mkv,avi,mov,flv,wmv}");
  const videos = Array.from(glob.scanSync(CONFIG.VIDEOS_DIR));

  const videosToProcess = targetFile
    ? videos.filter(v => v === targetFile)
    : videos;

  if (targetFile && videosToProcess.length === 0) {
    Logger.error(`File ${targetFile} not found in ${CONFIG.VIDEOS_DIR}.`);
    process.exit(1);
  }

  Logger.info(`Found ${videosToProcess.length} videos to check.`);

  for (const videoName of videosToProcess) {
    const videoPath = join(CONFIG.VIDEOS_DIR, videoName);
    const baseName = basename(videoName, extname(videoName));
    const srtPath = join(CONFIG.TRANSCRIPTS_DIR, `${baseName}.srt`);

    if (await Bun.file(srtPath).exists()) {
      if (!targetFile) {
        Logger.info(`Skipping ${videoName} (already has SRT)`);
        continue;
      }
    }

    try {
      Logger.info(`Processing ${videoName}...`);
      
      // 1. Extract Audio
      const audioPath = join(CONFIG.TEMP_AUDIO_DIR, `${baseName}.wav`);
      await FFMPEG.extractAudio(videoPath, audioPath);

      // 2. Transcribe
      const result = await worker.transcribe(videoName, audioPath);

      if (result && result.status === "completed") {
        Logger.info(`Successfully processed ${videoName}`);
      } else {
        Logger.error(`Transcription failed for ${videoName}: ${result?.message || "Unknown error"}`);
      }

      // 3. Cleanup Audio
      await Bun.file(audioPath).delete().catch(() => {});
    } catch (err) {
      Logger.error(`Failed to process ${videoName}`, err);
    }
  }

  worker.stop();
  Logger.info("Transcription process finished.");
}

main().catch(err => {
  Logger.error("Transcriber failed", err);
  process.exit(1);
});
