import type { Scene } from '@hop-hv-rag/db/schema';

export interface HybridResult extends Scene {
  videoTitle: string;
  videoYear: number;
  videoYearStart: number | null;
  videoYearEnd: number | null;
  videoParticipants: string;
  videoLocations: string;
  videoFilename: string;
  localPath: string | null;
  canonicalParticipants?: string;
  canonicalLocations?: string;
  score?: number;
}

export interface SceneResult {
  id: number;
  title: string | null;
  videoTitle: string;
  videoYear: number | null;
  filename: string;
  hasLocalFile: boolean;
  startTime: number;
  timestampLabel: string;
  summary: string;
}
