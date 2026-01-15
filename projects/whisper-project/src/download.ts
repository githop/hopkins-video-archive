import { join } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG } from "./config";
import { DriveService } from "./drive";
import { Logger } from "./logger";
import { throttle, ensureDir } from "./utils";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      id: { type: "string" },
    },
    strict: false,
  });

  const drive = new DriveService();
  await ensureDir(CONFIG.VIDEOS_DIR);

  const remoteFiles = await drive.listRemoteFiles(true);
  
  const targetId = values.id as string | undefined;

  const filesToDownload = targetId 
    ? remoteFiles.filter(f => f.id === targetId)
    : remoteFiles;

  if (targetId && filesToDownload.length === 0) {
    Logger.error(`File with ID ${targetId} not found in remote folder.`);
    process.exit(1);
  }

  const downloads = [];

  for (const file of filesToDownload) {
    const destPath = join(CONFIG.VIDEOS_DIR, file.name);
    const localFile = Bun.file(destPath);
    
    let shouldDownload = true;
    if (await localFile.exists()) {
      if (localFile.size === file.size) {
        Logger.info(`Skipping ${file.name} (already exists with correct size)`);
        shouldDownload = false;
      } else {
        Logger.warn(`Size mismatch for ${file.name}: local ${localFile.size} vs remote ${file.size}. Re-downloading.`);
      }
    }

    if (shouldDownload) {
      downloads.push(file);
    }
  }

  Logger.info(`Starting download of ${downloads.length} files...`);

  await throttle(downloads, CONFIG.DOWNLOAD_CONCURRENCY, async (file) => {
    const destPath = join(CONFIG.VIDEOS_DIR, file.name);
    Logger.info(`Downloading: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    await drive.downloadFile(file.id, destPath, (downloadedBytes) => {
      Logger.progress(downloadedBytes, file.size, file.name);
    });
    
    // Verify file size after download
    const downloadedFile = Bun.file(destPath);
    if (downloadedFile.size !== file.size) {
      throw new Error(`Size mismatch for ${file.name}: expected ${file.size} bytes, got ${downloadedFile.size} bytes`);
    }
    
    Logger.info(`Completed: ${file.name}`);
  });

  Logger.info("All downloads finished.");
}

main().catch(err => {
  Logger.error("Downloader failed", err);
  process.exit(1);
});
