import { useState } from 'react';

interface ReasoningBlockProps {
  reasoning: string;
}

export function ReasoningBlock({ reasoning }: ReasoningBlockProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Parse reasoning into lines for display
  const lines = reasoning.split('\n').filter((line) => line.trim());

  return (
    <div className="bg-background-code border border-border rounded-lg overflow-hidden">
      {/* Header / Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-text-secondary hover:text-text-primary transition-colors border-b border-border/50"
      >
        <div className="flex items-center gap-2">
          <span className="text-action-secondary">⚙</span>
          <span className="font-mono text-xs uppercase tracking-wide">
            Reasoning Process
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
