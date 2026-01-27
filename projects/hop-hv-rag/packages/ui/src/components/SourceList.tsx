import type { Source } from '@hop-hv-rag/search';
import { SourceCard } from './SourceCard';

interface SourceListProps {
  sources: Source[];
}

export const SourceList: React.FC<SourceListProps> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-600">Sources</h3>
      <div className="overflow-x-auto pb-4 -mx-4 px-4">
        <div className="flex gap-4">
          {sources.map((source) => (
            <SourceCard key={source.sceneId} source={source} />
          ))}
        </div>
      </div>
    </div>
  );
};
