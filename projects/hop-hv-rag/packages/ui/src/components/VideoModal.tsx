import { useEffect, useRef } from 'react';
import type { Source } from '@hop-hv-rag/search';

interface VideoModalProps {
  source: Source | null;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoModal({ source, isOpen, onClose }: VideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isOpen && videoRef.current && source) {
      // Ensure video starts at correct time when modal opens
      videoRef.current.currentTime = source.timestamp.startSeconds;
      videoRef.current.play().catch(() => {
        // Auto-play might be blocked, user can click play
      });
    }
  }, [isOpen, source]);

  if (!isOpen || !source) return null;

  const { video, timestamp, chunkTitle } = source;

  // Compute transcript URL from video filename
  const baseFilename = video.filename.replace(/\.[^/.]+$/, '');
  const transcriptUrl = `/transcripts/${baseFilename}.vtt`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl mx-4 bg-black rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 bg-gray-900">
          <div>
            <h3 className="text-white font-medium">
              {chunkTitle || video.title}
            </h3>
            <p className="text-gray-400 text-sm">
              Starting at {timestamp.formatted}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Video Player */}
        <div className="relative aspect-video">
          <video
            ref={videoRef}
            src={video.videoUrl}
            controls
            className="w-full h-full"
            playsInline
            crossOrigin="anonymous"
          >
            <track
              kind="subtitles"
              src={transcriptUrl}
              srcLang="en"
              label="English"
              default
            />
          </video>
        </div>

        {/* Scene Info */}
        <div className="p-4 bg-gray-900 text-gray-300 text-sm">
          <p>{source.summary}</p>
        </div>
      </div>
    </div>
  );
}
