import type { Source } from '@hop-hv-rag/search';
import { VideoCard } from './VideoCard';

interface SourceGridProps {
  sources: Source[];
  usedSourceIds: number[];
}

export function SourceGrid({ sources, usedSourceIds }: SourceGridProps) {
  if (!sources || sources.length === 0) return null;

  // Sort sources so used ones appear first
  const sortedSources = [...sources].sort((a, b) => {
    const aUsed = usedSourceIds.includes(a.citationId);
    const bUsed = usedSourceIds.includes(b.citationId);
    if (aUsed && !bUsed) return -1;
    if (!aUsed && bUsed) return 1;
    return 0;
  });

  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Retrieved Sources
        </h2>
        <span className="text-xs text-text-muted bg-background-surface px-2 py-0.5 rounded-full">
          {sources.length} found
        </span>
      </div>

      {/* 4-Column Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {sortedSources.map((source) => (
          <VideoCard
            key={source.sceneId}
            source={source}
            isUsed={usedSourceIds.includes(source.citationId)}
          />
        ))}
      </div>
    </div>
  );
}
