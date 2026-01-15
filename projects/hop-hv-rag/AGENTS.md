# AGENTS.md - hop-hv-rag

## Project Overview

hop-hv-rag is a RAG (Retrieval-Augmented Generation) application designed for private home video collections. It processes transcription data from WhisperX, extracts semantic scenes using vLLM, indexes them with `sqlite-vec` in a local SQLite database, and provides a semantic search interface.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Database**: SQLite (via Bun `bun:sqlite` and Drizzle ORM)
- **Vector Search**: `sqlite-vec` extension
- **AI SDK**: Vercel AI SDK with OpenAI-compatible provider (vLLM)
- **Validation**: Zod
- **ID Generation**: nanoid (for readable prefixes where applicable)

## Monorepo Structure

```
hop-hv-rag/
├── packages/
│   ├── db/                 # Drizzle schema, migrations, and Bun SQLite client
│   │   └── src/
│   │       ├── schema.ts   # Table definitions
│   │       └── index.ts    # DB client initialization
│   ├── ai/                 # AI SDK configuration and vLLM integration
│   │   └── src/
│   │       └── index.ts    # vLLM client initialization
│   ├── core/               # Shared logic: Metadata parsing, filename regex
│   │   └── src/
│   │       ├── metadata.ts # Filename parsing
│   │       └── index.ts
│   ├── ingest/             # CLI for processing transcription JSONs
│   │   └── src/
│   │       ├── init-db.ts  # Database initialization
│   │       └── summarize-scenes.ts # Scene extraction and summarization
│   └── search/             # CLI for RAG queries
│       └── src/
│           └── rag-query.ts # RAG search implementation
├── data/                   # Local storage for SQLite DB and registry files
│   ├── hv-rag.db           # SQLite database file
│   └── mapping.json        # Filename -> driveFileId map
├── AGENTS.md               # Project conventions
├── package.json            # Workspace root
└── tsconfig.json           # Global TS config
```

## Conventions

### Code Style

- **ESM only**: No CommonJS.
- **Extensioned imports**: Prefer extensioned imports (e.g., `import { foo } from './bar.ts'`).
- **Idiomatic Bun**: Use idiomatic Bun primitives (`Bun.file`, `Bun.sqlite`, `Bun.spawn`, `Bun.env`, etc.).
- **Async/Await**: Standard for all I/O and AI operations.
- **No `any`**: Strictly avoid `any`. Use `unknown` or define specific interfaces.
- **Type Safety**: NEVER use type assertions (`as Type`). Use Zod schemas for runtime validation and type inference, especially for AI outputs and external I/O. Use Drizzle's `$inferSelect` and `$inferInsert` for database record types.

### Database & Vectors

- **Drizzle ORM**: Used for ALL standard relational table interactions and schema management. Access the database via the `@hop-hv-rag/db` package.
- **Generics**: Use the generic arguments provided by Drizzle and other libraries (e.g., `db.select().from(table).all<Type>()`) instead of type assertions.
- **Integer PKs**: Use `integer PRIMARY KEY AUTOINCREMENT` for primary keys to ensure direct compatibility with `sqlite-vec`'s `rowid`.
- **Vector Search**: Use `sqlite-vec` virtual tables (`vec0`) via raw SQL templates (`sql` from `drizzle-orm`).

### Workflow

- **Checkpoint-driven**: Every significant implementation step must be verified before proceeding to the next.
- **Verification Scripts**: Each phase should have a corresponding verification script (e.g., `verify-db.ts`, `verify-ingest.ts`).
