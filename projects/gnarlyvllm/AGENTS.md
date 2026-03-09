# AGENTS.md - gnarlyvllm

## Project Overview

gnarlyvllm is a CLI tool for managing vLLM containers via Podman, providing an
OpenAI-compatible API endpoint through a custom Bun-based proxy (Gnarly Proxy). It replaces Ollama for local LLM
serving with support for embeddings, reranking, and chat models.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Config**: TOML (gnarlyvllm.toml)
- **Secrets**: .env file
- **Containers**: Podman (not Docker)
- **UI**: OpenTUI with React reconciler (for CLI output rendering, not interactive)
- **Validation**: Zod schemas

## Monorepo Structure

```
gnarlyvllm/
├── packages/
│   ├── core/                     # Shared business logic
│   │   └── src/
│   │       ├── config/           # TOML loading and Zod schemas
│   │       │   ├── schema.ts     # Type definitions
│   │       │   ├── loader.ts     # Config loading and validation
│   │       │   └── index.ts
│   │       ├── podman/           # Container lifecycle management
│   │       │   ├── client.ts     # Podman CLI wrapper
│   │       │   └── index.ts
│   │       ├── vllm/             # vLLM container configuration
│   │       │   ├── container.ts  # Container options builder
│   │       │   └── index.ts
│   │       ├── proxy/            # Gnarly Proxy management
│   │       │   ├── server.ts     # Hono-based proxy server script
│   │       │   ├── container.ts  # Container options builder
│   │       │   └── index.ts
│   │       └── index.ts          # Re-exports all modules
│   │
│   └── cli/                      # CLI application
│       └── src/
│           ├── main.tsx          # Entry point + parseArgs
│           └── commands/
│               ├── serve.ts      # gnarlyvllm serve <model>
│               ├── start.ts      # gnarlyvllm start <stack>
│               ├── stop.ts       # gnarlyvllm stop [name]
│               ├── status.ts     # gnarlyvllm status
│               ├── logs.ts       # gnarlyvllm logs <model>
│               └── config.ts     # gnarlyvllm config check/init
│
├── gnarlyvllm.example.toml       # Example config file
├── .env.example                  # Environment variable template
├── tsconfig.base.json            # Shared TypeScript config
└── package.json                  # Workspace root
```

## Conventions

### Code Style

- ESM only, no CommonJS
- Prefer extensioned imports (e.g., `import { foo } from './bar.ts'`)
- Use idiomatic Bun primitives where possible (Bun.spawn, Bun.file, Bun.env, etc.)
- Use async/await
- Error handling: throw typed errors, catch at command level

### File Naming

- kebab-case for files: `gpu-detection.ts`
- PascalCase for React components: `StatusTable.tsx`
- Index files re-export public API

### Commands

- Each command is a separate file in `packages/cli/src/commands/`
- Commands receive parsed args and config path, return exit code
- Use console.log for output (OpenTUI integration planned for future)

### Testing

- Tests live alongside source: `foo.ts` -> `foo.test.ts`
- Use `bun test`

### Config

- TOML for user config (`gnarlyvllm.toml`)
- `.env` for secrets (`HF_TOKEN`)
- Zod schemas in `packages/core/src/config/schema.ts`

## Running Locally

```bash
bun install
bun run dev
# or directly:
bun run packages/cli/src/main.tsx <command>
```

## Common Tasks

### Add a new CLI command

1. Create `packages/cli/src/commands/<name>.ts`
2. Export an async function that takes `(args: string[], configPath?: string): Promise<number>`
3. Register in `packages/cli/src/main.tsx` switch statement

### Add a new vLLM flag or config option

Adding a new setting that gets passed down to the vLLM container requires updating a few places to ensure it flows from the user's TOML file down to the Podman execution.

1. **Schema Definition**: Update `ModelDefaultsSchema` and the `ResolvedModelConfig` type in `packages/core/src/config/schema.ts`.
2. **Config Resolution**: Update the `resolveModelConfig` function in `packages/core/src/config/loader.ts` to explicitly map the new field from `model.defaults`, apply stack overrides if they exist, and return it in the resolved object.
3. **Container Arguments**: Update the `buildVllmContainerOptions` function in `packages/core/src/vllm/container.ts` to map the property from the resolved config into a command-line argument for the container.
4. **Documentation**: Add an example of the new flag to `gnarlyvllm.example.toml`.
5. Types auto-propagate via Zod inference once the schema is updated.

### Working with Podman

- Always use `podman` not `docker` in commands
- GPU passthrough: `--device nvidia.com/gpu=all`
- Container names: `gnarlyvllm-<model-name>`
- Use `host.containers.internal` to reference host from containers

### Debugging vLLM Containers

To inspect available flags or verify versions within the vLLM container, use the following patterns. Note that vLLM requires a GPU to be present even for `--help` or `--version` in many versions.

```bash
# Check version (requires GPU in some versions)
podman run --rm --device nvidia.com/gpu=all docker.io/vllm/vllm-openai:latest --version

# List all available serve flags (requires GPU)
podman run --rm --device nvidia.com/gpu=all docker.io/vllm/vllm-openai:latest serve --help=all

# Check for specific task/feature support
podman run --rm --device nvidia.com/gpu=all docker.io/vllm/vllm-openai:latest serve --help=all | grep -E "task|score|reward"
```

## CLI Commands

```bash
gnarlyvllm serve <model>           # Start single model + Gnarly Proxy
gnarlyvllm start <stack>           # Start stack + Gnarly Proxy
gnarlyvllm stop [model|stack]      # Stop specific or all
gnarlyvllm status                  # Show running state
gnarlyvllm logs <model>            # Tail logs
gnarlyvllm config check            # Validate config
gnarlyvllm config init             # Generate example config
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    gnarlyvllm CLI                               │
│                 (Bun + TypeScript)                              │
├─────────────────────────────────────────────────────────────────┤
│                 Gnarly Proxy @ :4000                            │
│           Unified OpenAI-compatible endpoint                    │
├─────────────┬─────────────┬─────────────────────────────────────┤
│  vLLM Chat  │ vLLM Embed  │  vLLM Rerank                        │
│   :8000     │   :8001     │   :8002                             │
└─────────────┴─────────────┴─────────────────────────────────────┘
                              │
                    NVIDIA GPU (Podman --device)
```

## Config Example

```toml
[settings]
litellm_port = 4000
huggingface_cache = "~/.cache/huggingface"

[models.qwen-7b-chat]
repo = "Qwen/Qwen2.5-7B-Instruct-AWQ"
task = "generate"
port = 8000

[models.qwen-7b-chat.defaults]
gpu_memory_utilization = 0.5
max_model_len = 32768

[stacks.my-stack]
description = "My custom stack"
models = ["qwen-7b-chat"]

[stacks.my-stack.overrides.qwen-7b-chat]
gpu_memory_utilization = 0.4  # Override when running in stack
```
