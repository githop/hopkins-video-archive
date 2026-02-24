import { videos } from '@hop-hv-rag/db';
import type { Db } from './types.ts';

export interface FilenameMatch {
  filename: string;
  videoId: number;
  basename: string;
}

export class FilenameIndex {
  private filenames: FilenameMatch[] = [];
  private loaded = false;

  async load(db: Db) {
    const rows = db
      .select({ id: videos.id, filename: videos.filename })
      .from(videos)
      .all();

    this.filenames = rows
      .map((row) => ({
        filename: row.filename,
        videoId: row.id,
        basename: row.filename.replace(/\.[^/.]+$/, ''),
      }))
      .sort((a, b) => b.filename.length - a.filename.length);

    this.loaded = true;
  }

  detect(query: string): FilenameMatch[] {
    if (!this.loaded) return [];

    const lowerQuery = query.toLowerCase();
    const matches: FilenameMatch[] = [];
    const matchedRanges: Array<{ start: number; end: number }> = [];

    for (const entry of this.filenames) {
      const fullPattern = new RegExp(
        `\\b${this.escapeRegex(entry.filename)}\\b`,
        'i',
      );
      const fullMatch = lowerQuery.match(fullPattern);

      if (fullMatch) {
        const start = fullMatch.index!;
        const end = start + fullMatch[0].length;

        const overlaps = matchedRanges.some(
          (r) => start < r.end && end > r.start,
        );

        if (!overlaps) {
          matches.push(entry);
          matchedRanges.push({ start, end });
          continue;
        }
      }

      const basePattern = new RegExp(
        `\\b${this.escapeRegex(entry.basename)}\\b`,
        'i',
      );
      const baseMatch = lowerQuery.match(basePattern);

      if (baseMatch) {
        const start = baseMatch.index!;
        const end = start + baseMatch[0].length;

        const overlaps = matchedRanges.some(
          (r) => start < r.end && end > r.start,
        );

        if (!overlaps) {
          matches.push(entry);
          matchedRanges.push({ start, end });
        }
      }
    }

    return matches;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
