import type { Scene } from '@hop-hv-rag/db/schema';

export interface HybridResult extends Scene {
  videoTitle: string;
  videoYear: number;
  videoYearStart: number | null;
  videoYearEnd: number | null;
  videoParticipants: string;
  videoLocations: string;
  videoDriveFileId: string;
  canonicalParticipants?: string;
  canonicalLocations?: string;
  score?: number;
}

export interface SceneResult {
  id: number;
  title: string | null;
  videoTitle: string;
  videoYear: number | null;
  driveId: string;
  startTime: number;
  timestampLabel: string;
  summary: string;
}
