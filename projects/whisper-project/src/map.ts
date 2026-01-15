import { DriveService } from "./drive";
import { CONFIG } from "./config";
import { Logger } from "./logger";

/**
 * Generates a mapping between Google Drive filenames and their IDs.
 * Saves the result to mapping.json.
 */
async function generateMapping() {
  try {
    const driveService = new DriveService();
    Logger.info("Fetching files from Google Drive...");
    
    const files = await driveService.listRemoteFiles(true);
    
    const mapping: Record<string, string> = {};
    for (const file of files) {
      mapping[file.name] = file.id;
    }

    Logger.info(`Found ${files.length} files. Writing to ${CONFIG.MAPPING_FILE}...`);
    
    await Bun.write(CONFIG.MAPPING_FILE, JSON.stringify(mapping, null, 2));
    
    Logger.info("Mapping successfully created!");
  } catch (error) {
    Logger.error("Failed to generate mapping:", error);
    process.exit(1);
  }
}

generateMapping();
