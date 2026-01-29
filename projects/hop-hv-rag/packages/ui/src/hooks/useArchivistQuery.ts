import { useState, useCallback } from 'react';
import type { Source, StreamChunk } from '@hop-hv-rag/search';

type Phase = 'idle' | 'thinking' | 'complete' | 'error';

interface UseArchivistQueryResult {
  phase: Phase;
  reasoning: string;
  answer: string;
  sources: Source[];
  usedSourceIds: number[];
  error: string | null;
  search: (query: string) => Promise<void>;
  reset: () => void;
}

export function useArchivistQuery(): UseArchivistQueryResult {
  const [phase, setPhase] = useState<Phase>('idle');
  const [reasoning, setReasoning] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [usedSourceIds, setUsedSourceIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setReasoning('');
    setAnswer('');
    setSources([]);
    setUsedSourceIds([]);
    setError(null);
  }, []);

  const search = useCallback(
    async (query: string) => {
      reset();
      setPhase('thinking');

      try {
        const response = await fetch(
          'http://local.gnarlybox-ai:3200/api/query',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            const chunk: StreamChunk = JSON.parse(line);

            if (chunk.type === 'reasoning') {
              setReasoning((r) => r + chunk.text);
            } else if (chunk.type === 'result') {
              setAnswer(chunk.answer);
              setSources(chunk.sources);
              setUsedSourceIds(chunk.usedSourceIds || []);
              setPhase('complete');
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setPhase('error');
      }
    },
    [reset],
  );

  return {
    phase,
    reasoning,
    answer,
    sources,
    usedSourceIds,
    error,
    search,
    reset,
  };
}
