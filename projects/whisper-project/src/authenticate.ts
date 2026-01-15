import { google } from "googleapis";
import { createServer } from "node:http";
import { parse } from "node:url";
import { CONFIG } from "./config";
import { Logger } from "./logger";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Authentication Helper for User-based OAuth
 * Run this once to generate token.json
 */
async function authenticate() {
  let secrets;
  try {
    const content = await readFile(CONFIG.CLIENT_SECRETS_PATH, "utf-8");
    const parsed = JSON.parse(content);
    // Handle Google's wrapped format
    secrets = parsed.installed || parsed.web || parsed;
  } catch (err) {
    Logger.error(`Failed to read ${CONFIG.CLIENT_SECRETS_PATH}. Please create it first.`);
    console.log(`
Please save your Google OAuth Desktop JSON to ${CONFIG.CLIENT_SECRETS_PATH}.
    `);
    process.exit(1);
  }

  const { client_id, client_secret, redirect_uris } = secrets;
  const redirect_uri = redirect_uris?.[0] || "http://localhost:3000";
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  const scopes = ["https://www.googleapis.com/auth/drive"];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });

  console.log("\n1. Open this URL in your browser:\n", authUrl);

  const server = createServer(async (req, res) => {
    try {
      const urlParts = parse(req.url || "", true);
      const code = urlParts.query.code as string;

      if (code) {
        res.end("Authentication successful! You can close this tab and return to the terminal.");
        
        const { tokens } = await oauth2Client.getToken(code);
        await writeFile(CONFIG.TOKEN_PATH, JSON.stringify(tokens, null, 2));
        
        Logger.info(`Successfully saved tokens to ${CONFIG.TOKEN_PATH}`);
        server.close();
        process.exit(0);
      } else {
        res.end("No code found in the redirect URL.");
      }
    } catch (err) {
      Logger.error("Error during authentication", err);
      res.end("Authentication failed.");
      process.exit(1);
    }
  }).listen(3000);

  Logger.info("Waiting for authentication...");
}

authenticate().catch(console.error);
