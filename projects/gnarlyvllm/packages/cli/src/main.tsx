#!/usr/bin/env bun
import { parseArgs } from 'node:util';

const HELP = `
gnarlyvllm - vLLM inference with Gnarly Proxy

Usage:
  gnarlyvllm <command> [options]

Commands:
  proxy-logs clear    Clear all proxy request logs

Options:
  -h, --help          Show this help message
  -v, --version       Show version

Examples:
  gnarlyvllm proxy-logs clear
`;

const VERSION = '0.1.0';

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
  });

  if (values.version) {
    console.log(`gnarlyvllm v${VERSION}`);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return 0;
  }

  const [command, ...args] = positionals;

  switch (command) {
    case 'proxy-logs': {
      const { proxyLogsCommand } = await import('./commands/proxy-logs.ts');
      return proxyLogsCommand(args);
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
