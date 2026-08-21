export interface ArchivistConfig {
  keywordBoost?: number;
  entityBoost?: number;
  temporalBoost?: number;
  temporalPenalty?: number;
  filenameBoost?: number;
  rrfK?: number;
  /**
   * FTS OR-fallback threshold (HANDOFF fix 3): when the implicit-AND MATCH
   * returns fewer rows than this, the MATCH expression is rebuilt as an OR
   * of non-stopword tokens. Set to 0 to disable the fallback.
   */
  ftsOrFallbackMinResults?: number;
}

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
