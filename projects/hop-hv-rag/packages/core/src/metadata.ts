export interface ParsedMetadata {
  title: string;
  year: number | null;
  recordedAt: string | null;
}

/**
 * Simple parser that just drops the extension.
 * We rely on the LLM "Smart Pass" later to extract real metadata (dates, titles)
 * from the transcript content, as filenames are often unreliable.
 */
export function parseFilename(filename: string): ParsedMetadata {
  const title = filename.replace(/\.[^/.]+$/, '');

  return {
    year: null,
    recordedAt: null,
    title,
  };
}
