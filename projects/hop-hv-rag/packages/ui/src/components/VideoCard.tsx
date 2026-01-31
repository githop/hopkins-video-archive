import { useState } from 'react';
import type { Source } from '@hop-hv-rag/search';
import { VideoModal } from './VideoModal';

interface VideoCardProps {
  source: Source;
  isUsed: boolean;
}

export function VideoCard({ source, isUsed }: VideoCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Only show click handler if video has local file
  const canWatch = source.video.hasLocalFile;

  return (
    <>
      <div
        onClick={() => canWatch && setIsModalOpen(true)}
        className={`
          group block rounded-lg overflow-hidden border transition-all duration-200
          ${canWatch ? 'cursor-pointer' : 'cursor-default'}
          ${
            isUsed
              ? 'border-action-primary opacity-100 shadow-md'
              : 'border-border opacity-60 hover:opacity-80'
          }
        `}
      >
        {/* Thumbnail Container */}
        <div className="relative aspect-video bg-background-surface">
          {/* Thumbnail Image */}
          <img
            src={source.thumbnailUrl}
            alt={source.sceneTitle || 'Video thumbnail'}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />

          {/* Play Button Overlay */}
          {canWatch && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
              <div
                className={`
                w-12 h-12 rounded-full flex items-center justify-center
                ${isUsed ? 'bg-action-primary' : 'bg-background-surface'}
                shadow-lg
              `}
              >
                <span
                  className={`text-xl ${isUsed ? 'text-action-fg' : 'text-text-primary'}`}
                >
                  ▶
                </span>
              </div>
            </div>
          )}

          {/* Timestamp Badge */}
          <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 text-white text-xs font-mono rounded">
            {source.timestamp.formatted}
          </div>
        </div>

        {/* Info Section */}
        <div
          className={`
          p-3 space-y-2
          ${isUsed ? 'bg-background-surface' : 'bg-background'}
        `}
        >
          {/* Title */}
          <h3
            className="text-sm font-medium text-text-primary line-clamp-1"
            title={(source.sceneTitle || source.video.title) ?? undefined}
          >
            {source.sceneTitle || source.video.title}
          </h3>

          {/* Badges Row */}
          <div className="flex items-center justify-between">
            {/* Status Badge */}
            <span
              className={`
              text-xs px-2 py-0.5 rounded font-medium
              ${
                isUsed
                  ? 'bg-action-primary text-action-fg'
                  : 'bg-background text-text-muted border border-border'
              }
            `}
            >
              {isUsed ? '✓ Used' : 'Context'}
            </span>

            {/* Watch Status */}
            <span className="text-xs text-text-muted font-mono">
              {canWatch ? source.citationId : 'Video unavailable'}
            </span>
          </div>
        </div>
      </div>

      <VideoModal
        source={source}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
