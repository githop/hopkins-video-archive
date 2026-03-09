# @hop-hv-rag/ai

The AI services layer for the Hopkins Video Archive RAG system.

## Features

- **vLLM Integration**: Optimized for vLLM 0.16+ with reasoning support.
- **AI SDK 6**: Built on top of Vercel AI SDK 6.
- **Type-Safe Reasoning**: Automatic extraction and logging of reasoning content from compatible models (e.g., DeepSeek R1).
- **Hybrid Search**: Unified access to embedding, generation, and reranking models.

## Usage

### Generating Text with Reasoning

Use the exported `generateText` wrapper to automatically handle reasoning extraction:

```typescript
import { generateText } from '@hop-hv-rag/ai';

const { text, reasoningText } = await generateText({
  model: getGenModel('summarizer-9b'),
  prompt: '...',
});

if (reasoningText) {
  console.log('Model thought:', reasoningText);
}
```

### Streaming Text

Streaming also supports reasoning deltas via `streamText`:

```typescript
import { streamText } from '@hop-hv-rag/ai';

const result = streamText({
  model: getGenModel('summarizer-9b'),
  prompt: '...',
});

for await (const part of result.fullStream) {
  if (part.type === 'reasoning-delta') {
    // Handle reasoning
  }
}
```

## Configuration

Ensure your vLLM/LiteLLM instance is configured with `reasoning_parser = "deepseek_r1"` if using models that support reasoning.
