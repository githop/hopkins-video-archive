import { tool } from 'ai';
import { z } from 'zod';
import type { HybridResult } from '../types.ts';

export interface SearchProvider {
  retrieve: (query: string) => Promise<HybridResult[] | null>;
  formatContext: (results: HybridResult[]) => Promise<string>;
}

export const createSearchArchiveTool = (provider: SearchProvider) =>
  tool({
    description:
      'Search the family video archive for specific people, locations, events, or time periods.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('The search query to find relevant video scenes.'),
    }),
    execute: async ({ query }) => {
      const results = await provider.retrieve(query);
      if (!results || results.length === 0) {
        return {
          message: 'No relevant scenes found for this query.',
          results: [],
        };
      }

      const context = await provider.formatContext(results);

      return {
        context,
        results: results.map((r) => {
          const minutes = Math.floor(r.startTime / 60);
          const seconds = Math.floor(r.startTime % 60);
          const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          return {
            id: r.id,
            title: r.title,
            videoTitle: r.videoTitle,
            videoYear: r.videoYear,
            driveId: r.videoDriveFileId,
            startTime: r.startTime,
            timestampLabel: timeStr,
            summary: r.summary,
          };
        }),
      };
    },
  });
