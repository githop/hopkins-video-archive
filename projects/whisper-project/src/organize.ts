import { join, basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG } from "./config";
import { DriveService } from "./drive";
import { Logger } from "./logger";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      file: { type: "string" },
    },
    strict: false,
  });

  const drive = new DriveService();

  const targetFile = values.file as string | undefined;

  const glob = new Bun.Glob("*.srt");
  const transcripts = Array.from(glob.scanSync(CONFIG.TRANSCRIPTS_DIR));

  const filesToOrganize = targetFile
    ? transcripts.filter(
        (t) => t === `${basename(targetFile, extname(targetFile))}.srt`,
      )
    : transcripts;

  if (targetFile && filesToOrganize.length === 0) {
    Logger.error(
      `Transcript for ${targetFile} not found in ${CONFIG.TRANSCRIPTS_DIR}.`,
    );
    process.exit(1);
  }

  const remoteFiles = await drive.listRemoteFiles(true);

  for (const srtName of filesToOrganize) {
    const baseName = basename(srtName, extname(srtName));

    // Find the original video in remote files
    let remoteVideo = remoteFiles.find(
      (f) => basename(f.name, extname(f.name)) === baseName,
    );

    if (!remoteVideo) {
      Logger.info(`Searching deeper for ${baseName}...`);
      remoteVideo = (await drive.findVideoAnywhere(baseName)) || undefined;
    }

    if (!remoteVideo) {
      Logger.warn(`Could not find remote video for ${baseName}. Skipping.`);
      continue;
    }

    try {
      Logger.info(`Organizing ${baseName}...`);

      // 1. Get or Create Folder
      let folderId = await drive.findFolder(baseName, CONFIG.DRIVE_FOLDER_ID);
      
      if (folderId) {
        Logger.info(`Found existing folder: ${baseName} (${folderId})`);
      } else {
        folderId = await drive.createFolder(
          baseName,
          CONFIG.DRIVE_FOLDER_ID,
        );
        Logger.info(`Created folder: ${baseName} (${folderId})`);
      }

      // 2. Move Video
      const folderContents = await drive.getFolderContents(folderId);
      const isAlreadyInFolder = folderContents.some(f => f.id === remoteVideo.id);

      if (isAlreadyInFolder) {
        Logger.info(`Video is already in folder. Skipping move.`);
      } else {
        await drive.moveFileToFolder(remoteVideo.id, folderId);
        Logger.info(`Moved video to folder.`);
      }

      // 3. Upload Artifacts
      const extensions = [".srt", ".vtt", ".json", ".txt", ".tsv"];
      for (const ext of extensions) {
        const localPath = join(CONFIG.TRANSCRIPTS_DIR, baseName + ext);
        const file = Bun.file(localPath);
        if (await file.exists()) {
          await drive.uploadFile(
            baseName + ext,
            folderId,
            file,
          );
          Logger.info(`Uploaded: ${baseName + ext}`);
        }
      }

      Logger.info(`Successfully organized ${baseName}`);
    } catch (err) {
      Logger.error(`Failed to organize ${baseName}`, err);
    }
  }

  Logger.info("Organization process finished.");
}

main().catch((err) => {
  Logger.error("Organizer failed", err);
  process.exit(1);
});
