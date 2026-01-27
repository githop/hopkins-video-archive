import type { StreamChunk } from './schemas.ts';

/**
 * Convert an async generator of StreamChunks to a ReadableStream.
 * Encodes chunks as newline-delimited JSON (NDJSON).
 */
export function createStreamResponse(
  generator: AsyncGenerator<StreamChunk>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          const json = JSON.stringify(chunk) + '\n';
          controller.enqueue(encoder.encode(json));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
