import { useState } from 'react';
import type { Source } from '@hop-hv-rag/search';
import { VideoModal } from './VideoModal';

interface SourceCardProps {
  source: Source;
  isUsed: boolean;
}

export const SourceCard: React.FC<SourceCardProps> = ({ source, isUsed }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const canWatch = source.video.hasLocalFile;

  return (
    <>
      <div
        className={`flex-none w-72 bg-white rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-shadow ${isUsed ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}`}
      >
        {/* Citation Badge - Absolute positioned */}
        <div className="absolute top-2 left-2 z-10">
          <span className="text-xs font-medium px-2 py-1 bg-blue-500 text-white rounded-full">
            [{source.citationId}]
          </span>
          {isUsed && (
            <span className="ml-1 text-xs font-medium px-2 py-1 bg-green-500 text-white rounded-full">
              Cited
            </span>
          )}
        </div>

        {/* Thumbnail - 4:3 aspect ratio */}
        <div
          onClick={() => canWatch && setIsModalOpen(true)}
          className={`relative w-full pt-[75%] bg-gray-100 block ${canWatch ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <img
            src={source.thumbnailUrl}
            alt={source.sceneTitle || 'Scene thumbnail'}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

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
          {canWatch ? (
            <button
              onClick={() => setIsModalOpen(true)}
              className="block w-full text-center py-2 px-4 bg-gray-50 hover:bg-gray-100 text-blue-600 text-sm font-medium rounded-lg border border-gray-200 transition-colors"
            >
              Watch Scene
            </button>
          ) : (
            <span className="block w-full text-center py-2 px-4 bg-gray-50 text-gray-400 text-sm font-medium rounded-lg border border-gray-200">
              Video unavailable
            </span>
          )}
        </div>
      </div>

      <VideoModal
        source={source}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};
