# @hop-hv-rag/ui

React frontend for the RAG search interface. Provides a conversational UI for querying video archives with streaming responses.

## Overview

The UI package provides:

- **Search interface** - Natural language query input
- **Streaming responses** - Real-time reasoning and answer display
- **Source citations** - Clickable video sources with thumbnails
- **Video playback** - Integrated player with subtitle support
- **Responsive design** - Works on desktop and mobile

## Development

### Quick Start

```bash
# Install dependencies
bun install

# Start dev server (Vite, port 5173)
bun run dev

# Build for production
bun run build
```

### Available Scripts

| Script            | Description                               |
| ----------------- | ----------------------------------------- |
| `bun run dev`     | Start Vite dev server                     |
| `bun run build`   | Build for production (outputs to `dist/`) |
| `bun run preview` | Preview production build                  |
| `bun run lint`    | Run ESLint                                |

## Architecture

### Components

| Component        | Purpose                       |
| ---------------- | ----------------------------- |
| `Header`         | Application header            |
| `SearchBar`      | Query input with suggestions  |
| `ReasoningBlock` | Collapsible reasoning display |
| `AnswerSection`  | Markdown-rendered answer      |
| `SourceGrid`     | Grid of video source cards    |
| `VideoCard`      | Individual thumbnail card     |
| `VideoModal`     | Video player with subtitles   |
| `SourceCard`     | Detailed source citation      |
| `Markdown`       | Custom markdown renderer      |

### Hooks

| Hook                | Purpose                       |
| ------------------- | ----------------------------- |
| `useArchivistQuery` | Manages streaming query state |

### Data Flow

```
User Input
    │
    ▼
SearchBar
    │
    ▼
useArchivistQuery.search(query)
    │
    ▼
POST /api/query
    │
    ▼
NDJSON Stream (via Reader API)
    │
    ├──► reasoning chunks → ReasoningBlock
    │
    └──► result chunk → AnswerSection + SourceGrid
```

## API Integration

### Query Endpoint

```http
POST /api/query
Content-Type: application/json

{"query": "What did John say?"}
```

Returns NDJSON stream:

```ndjson
{"type": "reasoning", "text": "Searching..."}
{"type": "result", "answer": "...", "sources": [...], "usedSourceIds": [1]}
```

### Media Assets

- **Videos**: `GET /videos/{filename}` (range requests supported)
- **Transcripts**: `GET /transcripts/{filename}` (WebVTT for subtitles)
- **Thumbnails**: `GET /thumbnails/{video-name}/{timestamp}.jpg`

### URL Construction

Client-side utilities in `src/utils/mediaUrls.ts`:

```typescript
thumbnailUrl(filename, startSeconds); // /thumbnails/{name}/{padded}.jpg
videoUrl(filename, startSeconds); // /videos/{filename}#t={seconds}
transcriptUrl(filename); // /transcripts/{name}.vtt
```

## Streaming Architecture

The UI handles streaming via the Streams API:

```typescript
const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    const chunk: StreamChunk = JSON.parse(line);
    // Update state based on chunk type
  }
}
```

### State Management

`useArchivistQuery` maintains:

- `phase`: 'idle' | 'thinking' | 'complete' | 'error'
- `reasoning`: Accumulated reasoning text
- `answer`: Final answer text
- `sources`: Array of Source objects
- `usedSourceIds`: Citations actually referenced

## Technology Stack

- **Framework**: React 19
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 4
- **Streaming**: Native Streams API
- **Markdown**: `streamdown` for streaming markdown

## Production Build

The production build is served by the search server:

```bash
# From project root
bun run ui:build    # Creates packages/ui/dist/
bun run ui:server   # Serves dist/ on port 3200
```

Or combined:

```bash
bun run start
```

## Development Proxy

Vite dev server proxies API requests:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:3200',
    '/videos': 'http://localhost:3200',
    '/transcripts': 'http://localhost:3200',
    '/thumbnails': 'http://localhost:3200',
  }
}
```

Ensure the search server is running on port 3200.

## File Structure

```
src/
├── components/
│   ├── Header.tsx
│   ├── SearchBar.tsx
│   ├── ReasoningBlock.tsx
│   ├── AnswerSection.tsx
│   ├── SourceGrid.tsx
│   ├── VideoCard.tsx
│   ├── VideoModal.tsx
│   ├── SourceCard.tsx
│   └── Markdown.tsx
├── hooks/
│   └── useArchivistQuery.ts
├── utils/
│   └── mediaUrls.ts
├── App.tsx
├── main.tsx
└── index.css
```
