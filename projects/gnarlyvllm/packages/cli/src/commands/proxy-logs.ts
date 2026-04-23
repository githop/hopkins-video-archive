import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { loadConfig } from '@gnarlyvllm/core';

export async function proxyLogsCommand(args: string[], configPath?: string): Promise<number> {
  const [subcommand] = args;

  if (subcommand !== 'clear') {
    console.log('Usage: gnarlyvllm proxy-logs clear');
    console.log('');
    console.log('Commands:');
    console.log('  clear    Delete all proxy request logs from the SQLite database');
    return 1;
  }

  try {
    const config = await loadConfig(configPath);

    if (!config.settings.proxy_log_enabled) {
      console.log('Proxy logging is disabled in config.');
      console.log('Enable it with proxy_log_enabled = true in your gnarlyvllm.toml');
      return 0;
    }

    const dbPathRaw = config.settings.proxy_log_db_path;
    const dbPath = dbPathRaw.replace(/^~/, homedir());

    if (!(await Bun.file(dbPath).exists())) {
      console.log('No proxy log database found at:', dbPath);
      return 0;
    }

    const db = new Database(dbPath);
    const result = db.run('DELETE FROM proxy_logs');
    db.close();

    console.log(`Cleared ${result.changes} log entries.`);
    return 0;
  } catch (e: any) {
    console.error('Error:', e.message);
    return 1;
  }
}
