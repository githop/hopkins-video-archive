#!/usr/bin/env bun
import { parseArgs } from 'node:util';

const HELP = `
gnarlyvllm - vLLM container orchestration with Gnarly Proxy

Usage:
  gnarlyvllm <command> [options]

Commands:
  serve <model>       Start a single model + Gnarly Proxy
  start <stack>       Start all models in a stack + Gnarly Proxy
  stop [name]         Stop model, stack, or all running containers
  status              Show running models and resource usage
  dashboard           Open interactive dashboard
  list                List available models and stacks
  logs <model>        Tail logs for a model container
  config check        Validate configuration file
  config init         Create example configuration file

Options:
  -h, --help          Show this help message
  -v, --version       Show version
  -c, --config        Path to config file (default: ./gnarlyvllm.toml)

Examples:
  gnarlyvllm serve qwen-7b-chat
  gnarlyvllm start home-video-rag
  gnarlyvllm stop
  gnarlyvllm status
`;

const VERSION = '0.1.0';

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      config: { type: 'string', short: 'c' },
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
  const configPath = values.config;

  switch (command) {
    case 'serve': {
      const { serveCommand } = await import('./commands/serve.ts');
      return serveCommand(args, configPath);
    }
    case 'start': {
      const { startCommand } = await import('./commands/start.ts');
      return startCommand(args, configPath);
    }
    case 'stop': {
      const { stopCommand } = await import('./commands/stop.ts');
      return stopCommand(args, configPath);
    }
    case 'status': {
      const { statusCommand } = await import('./commands/status.ts');
      return statusCommand(args, configPath);
    }
    case 'dashboard': {
      const { dashboardCommand } = await import('./commands/dashboard.tsx');
      return dashboardCommand(args, configPath);
    }
    case 'list': {
      const { listCommand } = await import('./commands/list.ts');
      return listCommand(args, configPath);
    }
    case 'logs': {
      const { logsCommand } = await import('./commands/logs.ts');
      return logsCommand(args, configPath);
    }
    case 'config': {
      const { configCommand } = await import('./commands/config.ts');
      return configCommand(args, configPath);
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
