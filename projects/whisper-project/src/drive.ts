import { google, drive_v3 } from "googleapis";
import { join } from "node:path";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { CONFIG } from "./config";
import { Logger } from "./logger";

export interface DriveFile {
  id: string;
  name: string;
  size: number;
}

/**
 * Google Drive Integration
 */
export class DriveService {
  private drive: drive_v3.Drive;

  constructor() {
    let auth;

    if (existsSync(CONFIG.TOKEN_PATH) && existsSync(CONFIG.CLIENT_SECRETS_PATH)) {
      // Use User-based OAuth
      Logger.info("Using User-based OAuth authentication");
      const content = readFileSync(CONFIG.CLIENT_SECRETS_PATH, "utf-8");
      const parsed = JSON.parse(content);
      const secrets = parsed.installed || parsed.web || parsed;
      const tokens = JSON.parse(readFileSync(CONFIG.TOKEN_PATH, "utf-8"));
      
      const oauth2Client = new google.auth.OAuth2(
        secrets.client_id,
        secrets.client_secret,
        secrets.redirect_uris?.[0] || "http://localhost:3000"
      );
      
      oauth2Client.setCredentials(tokens);
      auth = oauth2Client;
    } else {
      // Fallback to Service Account
      Logger.info("Using Service Account authentication");
      auth = new google.auth.GoogleAuth({
        keyFile: CONFIG.CREDENTIALS_PATH,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
    }

    this.drive = google.drive({ version: "v3", auth });
  }

  /**
   * Helper to check if a file is a video
   */
  private isVideoFile(file: drive_v3.Schema$File): boolean {
    const isVideo =
      file.mimeType?.startsWith("video/") ||
      file.name?.match(/\.(mp4|m4v|mkv|avi|mov|flv|wmv)$/i) ||
      file.mimeType === "application/octet-stream";
    return !!(isVideo && file.id && file.name);
  }

  /**
   * List all files in the target folder
   */
  async listRemoteFiles(recursive: boolean = false): Promise<DriveFile[]> {
    Logger.info(`Scanning Google Drive folder: ${CONFIG.DRIVE_FOLDER_ID}${recursive ? " (recursively)" : ""}`);

    const allFiles: DriveFile[] = [];

    const scan = async (folderId: string) => {
      let pageToken: string | undefined;
      const subFolderPromises: Promise<void>[] = [];

      do {
        const res = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: "nextPageToken, files(id, name, size, mimeType)",
          pageToken,
        });

        if (res.data.files) {
          for (const file of res.data.files) {
            if (file.mimeType === "application/vnd.google-apps.folder") {
              if (recursive) {
                subFolderPromises.push(scan(file.id!));
              }
            } else if (this.isVideoFile(file)) {
              allFiles.push({
                id: file.id!,
                name: file.name!,
                size: parseInt(file.size || "0"),
              });
            }
          }
        }
        pageToken = res.data.nextPageToken as string | undefined;
      } while (pageToken);

      if (subFolderPromises.length > 0) {
        await Promise.all(subFolderPromises);
      }
    };

    try {
      await scan(CONFIG.DRIVE_FOLDER_ID);
      Logger.info(`Found ${allFiles.length} videos.`);
      return allFiles;
    } catch (err) {
      Logger.error("Failed to list files from Google Drive", err);
      throw err;
    }
  }

  /**
   * Find a video file anywhere within the root folder or its subfolders.
   * This is used for resuming organization if a file was already moved.
   */
  async findVideoAnywhere(baseName: string): Promise<DriveFile | null> {
    try {
      // Search for files with the same name (without extension)
      // Note: Drive 'name' search is exact or starts-with. We search for files matching the name.
      const res = await this.drive.files.list({
        q: `name contains '${baseName.replace(/'/g, "\\'")}' and trashed = false`,
        fields: "files(id, name, size, mimeType, parents)",
      });

      if (!res.data.files) return null;

      for (const file of res.data.files) {
        if (!this.isVideoFile(file)) continue;

        // Check if the file's name (minus extension) matches the baseName exactly
        const fileName = file.name!;
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
        if (nameWithoutExt !== baseName) continue;

        // Check if it's in our root or a subfolder of our root
        const parents = file.parents || [];
        if (parents.includes(CONFIG.DRIVE_FOLDER_ID)) {
          return {
            id: file.id!,
            name: file.name!,
            size: parseInt(file.size || "0"),
          };
        }

        // Check if the parent is a subfolder of our root
        for (const parentId of parents) {
          const parent = await this.drive.files.get({
            fileId: parentId,
            fields: "parents",
          });
          if (parent.data.parents?.includes(CONFIG.DRIVE_FOLDER_ID)) {
            return {
              id: file.id!,
              name: file.name!,
              size: parseInt(file.size || "0"),
            };
          }
        }
      }

      return null;
    } catch (err) {
      Logger.error(`Failed to find video ${baseName} anywhere`, err);
      throw err;
    }
  }

  /**
   * Download a file from Drive
   */
  async downloadFile(fileId: string, destPath: string, onProgress?: (downloaded: number) => void): Promise<void> {
    try {
      const res = await this.drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" }
      );
      
      const writer = Bun.file(destPath).writer();
      const stream = Readable.toWeb(res.data as Readable);

      let downloaded = 0;
      for await (const chunk of stream) {
        writer.write(chunk);
        downloaded += chunk.byteLength;
        onProgress?.(downloaded);
      }

      await writer.end();
    } catch (err) {
      Logger.error(`Failed to download file ${fileId}`, err);
      throw err;
    }
  }

  /**
   * Find a folder by name in a parent folder
   */
  async findFolder(name: string, parentId: string): Promise<string | null> {
    try {
      const res = await this.drive.files.list({
        q: `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id)",
      });
      return res.data.files?.[0]?.id || null;
    } catch (err) {
      Logger.error(`Failed to find folder ${name}`, err);
      throw err;
    }
  }

  /**
   * Create a folder in Drive
   */
  async createFolder(name: string, parentId: string): Promise<string> {
    try {
      const res = await this.drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
        },
        fields: "id",
      });
      return res.data.id!;
    } catch (err) {
      Logger.error(`Failed to create folder ${name}`, err);
      throw err;
    }
  }

  /**
   * Move a file to a new folder
   */
  async moveFileToFolder(fileId: string, newParentId: string): Promise<void> {
    try {
      // Get current parents
      const file = await this.drive.files.get({
        fileId,
        fields: "parents",
      });
      const previousParents = (file.data.parents || []).join(",");

      await this.drive.files.update({
        fileId,
        addParents: newParentId,
        removeParents: previousParents,
        fields: "id, parents",
      });
    } catch (err) {
      Logger.error(`Failed to move file ${fileId} to folder ${newParentId}`, err);
      throw err;
    }
  }

  /**
   * Find a file by name in a parent folder
   */
  async findFile(name: string, parentId: string): Promise<string | null> {
    try {
      const res = await this.drive.files.list({
        q: `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed = false`,
        fields: "files(id)",
      });
      return res.data.files?.[0]?.id || null;
    } catch (err) {
      Logger.error(`Failed to find file ${name}`, err);
      throw err;
    }
  }

  /**
   * Upload a file to a folder
   */
  async uploadFile(name: string, parentId: string, content: string | Buffer | Blob): Promise<void> {
    try {
      const existingId = await this.findFile(name, parentId);
      
      let body: Readable;
      if (content instanceof Blob) {
        body = Readable.fromWeb(content.stream() as any);
      } else {
        const buffer = content instanceof Buffer ? content : Buffer.from(content);
        body = Readable.from(buffer);
      }

      const media = {
        mimeType: name.endsWith(".json") ? "application/json" : "text/plain",
        body,
      };

      if (existingId) {
        await this.drive.files.update({
          fileId: existingId,
          media,
        });
      } else {
        await this.drive.files.create({
          requestBody: {
            name,
            parents: [parentId],
          },
          media,
        });
      }
    } catch (err) {
      Logger.error(`Failed to upload file ${name} to folder ${parentId}`, err);
      throw err;
    }
  }

  /**
   * Get all files in a specific folder
   */
  async getFolderContents(folderId: string): Promise<drive_v3.Schema$File[]> {
    try {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "files(id, name)",
      });
      return res.data.files || [];
    } catch (err) {
      Logger.error(`Failed to get contents for folder ${folderId}`, err);
      throw err;
    }
  }
}
