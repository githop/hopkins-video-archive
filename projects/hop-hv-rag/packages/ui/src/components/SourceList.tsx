import type { Source } from '@hop-hv-rag/search';
import { SourceCard } from './SourceCard';

interface SourceListProps {
  sources: Source[];
  usedSourceIds: number[];
}

export const SourceList: React.FC<SourceListProps> = ({
  sources,
  usedSourceIds,
}) => {
  if (!sources || sources.length === 0) return null;

  // Group sources by used vs unused
  const usedSources = sources.filter((s) =>
    usedSourceIds.includes(s.citationId),
  );
  const unusedSources = sources.filter(
    (s) => !usedSourceIds.includes(s.citationId),
  );

  return (
    <div className="space-y-6">
      {/* Cited Sources Section */}
      {usedSources.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-blue-600 mb-2">
            Cited Sources ({usedSources.length})
          </h3>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
            {usedSources.map((source) => (
              <SourceCard key={source.chunkId} source={source} isUsed={true} />
            ))}
          </div>
        </div>
      )}

      {/* Additional Context Section */}
      {unusedSources.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-2">
            Additional Context ({unusedSources.length})
          </h3>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
            {unusedSources.map((source) => (
              <SourceCard key={source.chunkId} source={source} isUsed={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
