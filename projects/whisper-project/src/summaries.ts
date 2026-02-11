import { Database } from "bun:sqlite";
import { join, basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG } from "./config";
import { DriveService } from "./drive";
import { Logger } from "./logger";

/**
 * Summaries to Google Docs Script
 * 
 * Fetches global_summary from the HV_RAG_DB and uploads it as a Google Doc
 * to the corresponding video folder on Google Drive.
 */
async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      file: { type: "string" },
    },
    strict: false,
  });

  const targetFile = values.file as string | undefined;
  const drive = new DriveService();

  // Connect to database
  const db = new Database(CONFIG.HV_RAG_DB, { readonly: true });

  try {
    let videos: { filename: string; global_summary: string }[] = [];

    if (targetFile) {
      Logger.info(`Processing single file: ${targetFile}`);
      videos = db.query(
        "SELECT filename, global_summary FROM videos WHERE filename = ? AND global_summary IS NOT NULL"
      ).all(targetFile) as any;
      
      if (videos.length === 0) {
        Logger.warn(`No summary found for ${targetFile} in database.`);
        return;
      }
    } else {
      Logger.info("Processing all videos with summaries...");
      videos = db.query(
        "SELECT filename, global_summary FROM videos WHERE global_summary IS NOT NULL"
      ).all() as any;
      Logger.info(`Found ${videos.length} videos with summaries.`);
    }

    for (const video of videos) {
      const baseName = basename(video.filename, extname(video.filename));
      Logger.info(`Processing summary for: ${baseName}`);

      try {
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

        // 2. Upsert Google Doc
        const docName = `Summary - ${baseName}`;
        await drive.uploadAsGoogleDoc(docName, folderId, video.global_summary);
        Logger.info(`✓ Uploaded Google Doc: ${docName}`);

      } catch (err) {
        Logger.error(`Failed to process summary for ${baseName}:`, err);
      }
    }
  } finally {
    db.close();
  }

  Logger.info("Summary upload process finished.");
}

main().catch((err) => {
  Logger.error("Summaries script failed", err);
  process.exit(1);
});
