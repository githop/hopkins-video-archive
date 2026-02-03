export interface HybridResult {
  id: number;
  videoId: number;
  startTime: number;
  endTime: number;
  text: string;
  title: string | null;
  summary: string | null;
  videoTitle: string | null;
  videoYear: number | null;
  videoYearStart: number | null;
  videoYearEnd: number | null;
  videoFilename: string;
  score?: number;
}

export interface ChunkResult {
  id: number;
  title: string | null;
  videoTitle: string | null;
  videoYear: number | null;
  filename: string;
  startTime: number;
  timestampLabel: string;
  summary: string;
}
