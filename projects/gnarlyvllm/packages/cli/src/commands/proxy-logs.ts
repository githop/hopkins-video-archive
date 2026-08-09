import { Database } from 'bun:sqlite';

const DB_PATH = '/var/lib/gnarlyvllm/proxy-logs/proxy-logs.db';

export async function proxyLogsCommand(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (subcommand !== 'clear') {
    console.log('Usage: gnarlyvllm proxy-logs clear');
    console.log('');
    console.log('Commands:');
    console.log('  clear    Delete all proxy request logs from the SQLite database');
    return 1;
  }

  try {
    if (!(await Bun.file(DB_PATH).exists())) {
      console.log('No proxy log database found at:', DB_PATH);
      return 0;
    }

    const db = new Database(DB_PATH);
    const result = db.run('DELETE FROM proxy_logs');
    db.close();

    console.log(`Cleared ${result.changes} log entries.`);
    return 0;
  } catch (e: any) {
    console.error('Error:', e.message);
    return 1;
  }
}
