import { useState, useCallback } from 'react';
import type { Phase } from '../hooks/useArchivistQuery';

interface ReasoningBlockProps {
  reasoning: string;
  phase: Phase;
}

export function ReasoningBlock({ reasoning, phase }: ReasoningBlockProps) {
  // Start expanded during thinking, collapsed when complete
  // Key prop in parent ensures this re-initializes when phase changes
  const [isExpanded, setIsExpanded] = useState(phase !== 'complete');

  // Toggle handler
  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Parse reasoning into lines for display
  const lines = reasoning.split('\n').filter((line) => line.trim());

  return (
    <div className="bg-background-code border border-border rounded-lg overflow-hidden">
      {/* Header / Toggle */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between px-4 py-3 text-text-secondary hover:text-text-primary transition-colors border-b border-border/50"
      >
        <div className="flex items-center gap-2">
          <span className="text-action-secondary">⚙</span>
          <span className="font-mono text-xs uppercase tracking-wide">
            {phase === 'thinking' ? 'Reasoning...' : 'Reasoning Process'}
          </span>
        </div>
        <span className="text-xs transform transition-transform duration-200">
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 py-3 font-mono text-sm space-y-1">
          {lines.length > 0 ? (
            lines.map((line, index) => {
              // Check if this is a completion/success line
              const isSuccessLine =
                line.toLowerCase().includes('complete') ||
                line.toLowerCase().includes('final') ||
                line.toLowerCase().includes('generated');

              // Check if this is a candidate/analysis line
              const isCandidateLine =
                line.toLowerCase().includes('candidate') ||
                line.toLowerCase().includes('similarity');

              return (
                <div
                  key={index}
                  className={`
                    ${isSuccessLine ? 'text-action-success' : ''}
                    ${isCandidateLine ? 'text-text-secondary pl-4' : 'text-text-muted'}
                  `}
                >
                  {isCandidateLine ? '│ ' : '> '}
                  {line}
                </div>
              );
            })
          ) : (
            <div className="text-text-muted italic">Processing...</div>
          )}
        </div>
      )}
    </div>
  );
}
