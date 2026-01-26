import React from 'react';
import { SceneCard } from './SceneCard';
import type { SceneResult } from '@hop-hv-rag/search';

interface SceneGalleryProps {
  results: SceneResult[];
}

export const SceneGallery: React.FC<SceneGalleryProps> = ({ results }) => {
  if (!results || results.length === 0) return null;

  return (
    <div className="my-4 -mx-4 px-4 overflow-x-auto pb-4">
      <div className="flex gap-4">
        {results.map((scene) => (
          <SceneCard key={scene.id} scene={scene} />
        ))}
      </div>
    </div>
  );
};
