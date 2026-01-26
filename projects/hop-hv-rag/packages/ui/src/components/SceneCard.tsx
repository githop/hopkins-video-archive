import React from 'react';
import type { SceneResult } from '@hop-hv-rag/search';

interface SceneCardProps {
  scene: SceneResult;
}

export const SceneCard: React.FC<SceneCardProps> = ({ scene }) => {
  const driveUrl = `https://drive.google.com/file/d/${scene.driveId}`;

  return (
    <div className="flex-none w-72 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4 flex flex-col h-full">
        <div className="flex justify-between items-start mb-2">
          <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
            {scene.timestampLabel}
          </span>
          <span className="text-xs text-gray-400">
            {scene.videoYear || 'Unknown Year'}
          </span>
        </div>

        <h3 className="font-semibold text-gray-900 line-clamp-2 mb-1">
          {scene.title || 'Untitled Scene'}
        </h3>

        <p className="text-xs text-gray-500 mb-3 truncate">
          {scene.videoTitle}
        </p>

        <p className="text-sm text-gray-600 line-clamp-3 mb-4 flex-1">
          {scene.summary}
        </p>

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
