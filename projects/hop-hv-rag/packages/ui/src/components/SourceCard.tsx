import type { Source } from '@hop-hv-rag/search';

interface SourceCardProps {
  source: Source;
}

export const SourceCard: React.FC<SourceCardProps> = ({ source }) => {
  const driveUrl = `https://drive.google.com/file/d/${source.video.driveId}`;

  return (
    <div className="flex-none w-72 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4 flex flex-col h-full">
        {/* Header */}
        <div className="flex justify-between items-start mb-2">
          <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
            {source.timestamp.formatted}
          </span>
          <span className="text-xs text-gray-400">
            {source.video.year || 'Unknown Year'}
          </span>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-gray-900 line-clamp-2 mb-1">
          {source.sceneTitle || 'Untitled Scene'}
        </h3>

        {/* Video Title */}
        <p className="text-xs text-gray-500 mb-2 truncate">
          {source.video.title}
        </p>

        {/* Participants */}
        {source.participants.length > 0 && (
          <div className="mb-2">
            <span className="text-xs text-gray-400">People: </span>
            <span className="text-xs text-gray-600">
              {source.participants.map((p) => p.name).join(', ')}
            </span>
          </div>
        )}

        {/* Locations */}
        {source.locations.length > 0 && (
          <div className="mb-2">
            <span className="text-xs text-gray-400">Location: </span>
            <span className="text-xs text-gray-600">
              {source.locations.map((l) => l.name).join(', ')}
            </span>
          </div>
        )}

        {/* Summary */}
        <p className="text-sm text-gray-600 line-clamp-3 mb-4 flex-1">
          {source.summary}
        </p>

        {/* Watch Button */}
        <a
          href={driveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center py-2 px-4 bg-gray-50 hover:bg-gray-100 text-blue-600 text-sm font-medium rounded-lg border border-gray-200 transition-colors"
        >
          Watch Scene
        </a>
      </div>
    </div>
  );
};
