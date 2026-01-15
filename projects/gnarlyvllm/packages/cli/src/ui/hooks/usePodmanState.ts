import { useState, useEffect, useCallback } from 'react';
import { listContainers, type ContainerInfo } from '@gnarlyvllm/core';

export function usePodmanState() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listContainers(true);
    if (result.success) {
      setContainers(result.data || []);
      setError(null);
    } else {
      setError(result.error || 'Failed to list containers');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    // Spawn podman events to listen for changes
    const proc = Bun.spawn(['podman', 'events', '--format', 'json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const streamEvents = async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              try {
                const event = JSON.parse(line);
                // We refresh on any container or image event that might affect our status
                if (event.Type === 'container' || event.Type === 'image') {
                  refresh();
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (e) {
        // Stream closed or error
      }
    };

    streamEvents();

    return () => {
      proc.kill();
    };
  }, [refresh]);

  return { containers, loading, error, refresh };
}
