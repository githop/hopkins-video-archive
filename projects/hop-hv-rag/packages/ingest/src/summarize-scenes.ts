import {
  createDb,
  videos,
  transcripts,
  scenes,
  sceneToPeople,
  sceneToLocations,
  sceneToActivities,
  type Video,
  type Transcript,
} from '@hop-hv-rag/db';
import { getGenModel, type GenerationModelName } from '@hop-hv-rag/ai';
import {
  ParticipantService,
  LocationService,
  ActivityService,
  logger,
} from '@hop-hv-rag/core';
import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { eq, sql, inArray } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { TUI } from './tui.ts';

/**
 * Configuration & Constants
 */
const DATA_DIR = resolve(process.cwd(), '../../data');
const DB_PATH = `${DATA_DIR}/hv-rag.db`;
const REGISTRY_PATH = `${DATA_DIR}/participant-registry.json`;
const LOCATION_REGISTRY_PATH = `${DATA_DIR}/location-registry.json`;
const ACTIVITY_REGISTRY_PATH = `${DATA_DIR}/activity-registry.json`;
const CHUNK_DURATION_SECONDS = 180;

/**
 * Schema for AI Scene Extraction
 */
const SceneSchema = z.object({
  title: z.string().optional(),
  scene_title: z.string().optional(),
  summary: z.string().optional(),
  narrative_summary: z.string().optional(),
  participants: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  activities: z.array(z.string()).default([]),
});

type RawAiOutput = z.infer<typeof SceneSchema>;

interface SceneData {
  title: string;
  summary: string;
  participants: string[];
  locations: string[];
  activities: string[];
}

interface Chunk {
  windowStart: number;
  windowEnd: number;
  startTime: number;
  endTime: number;
  text: string;
  rawSegments: Transcript[];
}

interface ProgressCallbacks {
  onVideoStart: (video: Video, totalChunks: number) => void;
  onChunkProgress: (
    video: Video,
    chunkNum: number,
    totalChunks: number,
    title: string | null,
  ) => void;
  onSceneCreated: (video: Video, title: string) => void;
  onVideoComplete: (video: Video, sceneCount: number) => void;
  onVideoError: (video: Video, error: string) => void;
  onVideoWarning: (video: Video, message: string) => void;
}

/**
 * VideoArchivist: Handles the heavy lifting of transforming raw transcripts
 * into semantic, summarized scenes.
 */
class VideoArchivist {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: LanguageModel,
    private participantService: ParticipantService,
    private locationService: LocationService,
    private activityService: ActivityService,
    private progressCallbacks?: ProgressCallbacks,
  ) {}

  /**
   * Main entry point for processing a video
   */
  async processVideo(
    video: Video,
    options: { force?: boolean; concurrency: number },
  ): Promise<{ scenesCreated: number; error?: string; warning?: string }> {
    logger.info(
      { videoId: video.id, filename: video.filename },
      '🎥 Processing video',
    );

    if (options.force) {
      // Find all scene IDs for this video to clean up junction tables
      const scenesToDelete = await this.db
        .select({ id: scenes.id })
        .from(scenes)
        .where(eq(scenes.videoId, video.id));

      const sceneIds = scenesToDelete.map((s) => s.id);

      if (sceneIds.length > 0) {
        // Delete from junction tables first
        await this.db
          .delete(sceneToPeople)
          .where(inArray(sceneToPeople.sceneId, sceneIds));
        await this.db
          .delete(sceneToLocations)
          .where(inArray(sceneToLocations.sceneId, sceneIds));
        await this.db
          .delete(sceneToActivities)
          .where(inArray(sceneToActivities.sceneId, sceneIds));

        // Finally delete the scenes
        await this.db.delete(scenes).where(eq(scenes.videoId, video.id));
      }
    }

    const segments = await this.db
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, video.id))
      .orderBy(transcripts.startTime);

    if (segments.length === 0) {
      const warning = 'No transcripts found. Skipping.';
      if (this.progressCallbacks) {
        this.progressCallbacks.onVideoWarning(video, warning);
      } else {
        logger.warn({ videoId: video.id }, `⚠️ ${warning}`);
      }
      return { scenesCreated: 0, warning };
    }

    const allChunks = this.createChunks(segments);

    // Idempotency check: Filter out chunks that have already been processed
    const existingScenes = await this.db
      .select({ startTime: scenes.startTime })
      .from(scenes)
      .where(eq(scenes.videoId, video.id));

    const chunks = allChunks.filter((chunk) => {
      // Check if any existing scene falls within this chunk's window
      const isProcessed = existingScenes.some(
        (scene) =>
          scene.startTime >= chunk.windowStart &&
          scene.startTime < chunk.windowEnd,
      );
      return !isProcessed;
    });

    if (chunks.length === 0) {
      const warning = 'Video fully processed';
      if (this.progressCallbacks) {
        this.progressCallbacks.onVideoComplete(video, allChunks.length);
      } else {
        logger.info(
          { videoId: video.id, chunks: allChunks.length },
          '✅ Video fully processed',
        );
      }
      return { scenesCreated: 0, warning };
    }

    if (chunks.length < allChunks.length) {
      logger.info(
        {
          videoId: video.id,
          chunksToProcess: chunks.length,
          skipped: allChunks.length - chunks.length,
        },
        `ℹ️ Processing ${chunks.length} missing chunks (${allChunks.length - chunks.length} skipped)...`,
      );
    } else {
      logger.info(
        {
          videoId: video.id,
          chunks: chunks.length,
          concurrency: options.concurrency,
        },
        `🚀 Processing ${chunks.length} chunks (Concurrency: ${options.concurrency})...`,
      );
    }

    if (this.progressCallbacks) {
      this.progressCallbacks.onVideoStart(video, chunks.length);
    }

    const scenesCreated = await this.processChunksInParallel(
      video,
      chunks,
      options.concurrency,
    );
    await this.aggregateVideoMetadata(video.id);

    return { scenesCreated };
  }

  /**
   * Aggregates participants, locations, and activities from all scenes back to the video record.
   */
  private async aggregateVideoMetadata(videoId: number) {
    const videoScenes = await this.db
      .select({
        participants: scenes.participants,
        locations: scenes.locations,
        activities: scenes.activities,
      })
      .from(scenes)
      .where(eq(scenes.videoId, videoId));

    const allParticipants = new Set<string>();
    const allLocations = new Set<string>();
    const allActivities = new Set<string>();

    for (const scene of videoScenes) {
      if (scene.participants) {
        const parts = JSON.parse(scene.participants) as string[];
        parts.forEach((p) => allParticipants.add(p));
      }
      if (scene.locations) {
        const locs = JSON.parse(scene.locations) as string[];
        locs.forEach((l) => allLocations.add(l));
      }
      if (scene.activities) {
        const acts = JSON.parse(scene.activities) as string[];
        acts.forEach((a) => allActivities.add(a));
      }
    }

    await this.db
      .update(videos)
      .set({
        participants: JSON.stringify(Array.from(allParticipants)),
        locations: JSON.stringify(Array.from(allLocations)),
        activities: JSON.stringify(Array.from(allActivities)),
      })
      .where(eq(videos.id, videoId));

    logger.info(
      {
        videoId,
        participants: allParticipants.size,
        locations: allLocations.size,
        activities: allActivities.size,
      },
      '✨ Updated video metadata',
    );
  }

  /**
   * Logic for dividing the transcript into fixed-time chunks
   */
  private createChunks(segments: Transcript[]): Chunk[] {
    const chunks: Chunk[] = [];
    const lastSegment = segments[segments.length - 1];
    const maxTime = lastSegment.endTime;

    for (let start = 0; start < maxTime; start += CHUNK_DURATION_SECONDS) {
      const end = start + CHUNK_DURATION_SECONDS;
      const chunkSegments = segments.filter(
        (s) => s.startTime >= start && s.startTime < end,
      );

      if (chunkSegments.length > 0) {
        chunks.push({
          windowStart: start,
          windowEnd: end,
          startTime: chunkSegments[0].startTime,
          endTime: chunkSegments[chunkSegments.length - 1].endTime,
          text: chunkSegments
            .map((s) => `[${s.startTime.toFixed(2)}s] ${s.text}`)
            .join('\n'),
          rawSegments: chunkSegments,
        });
      }
    }
    return chunks;
  }

  /**
   * Orchestrates parallel execution of AI requests
   */
  private async processChunksInParallel(
    video: Video,
    chunks: Chunk[],
    limit: number,
  ): Promise<number> {
    const activePromises = new Set<Promise<string | null>>();
    let completedCount = 0;
    const totalChunks = chunks.length;

    for (const [index, chunk] of chunks.entries()) {
      const chunkNum = index + 1;
      const promise = this.summarizeChunk(video, chunk, chunkNum, totalChunks);
      activePromises.add(promise);

      promise
        .then((title) => {
          if (this.progressCallbacks) {
            this.progressCallbacks.onChunkProgress(
              video,
              chunkNum,
              totalChunks,
              title,
            );
            if (title) {
              this.progressCallbacks.onSceneCreated(video, title);
            }
          }
          completedCount++;
        })
        .finally(() => activePromises.delete(promise));

      if (activePromises.size >= limit) {
        await Promise.race(activePromises);
      }
    }

    await Promise.all(activePromises);
    return completedCount;
  }

  /**
   * Retry helper with exponential backoff
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * Individual worker unit: AI request + Database save
   */
  private async summarizeChunk(
    video: Video,
    chunk: Chunk,
    chunkNum: number,
    totalChunks: number,
  ): Promise<string | null> {
    const { startTime, endTime, text, rawSegments } = chunk;

    try {
      const object = await this.withRetry(async () => {
        const { text: resultText } = await generateText({
          model: this.model,
          system: this.getSystemPrompt(),
          prompt: `Transcript for the current 3-minute segment:\n\n${text}`,
        });

        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error(
            `No JSON found in AI response: ${resultText.slice(0, 200)}`,
          );
        }

        const rawObject = JSON.parse(jsonMatch[0]);
        return SceneSchema.parse(rawObject);
      });

      const data = this.normalizeAiOutput(object);

      // Normalize entities using the services
      const canonicalParticipants = this.participantService.getCanonicalNames(
        data.participants,
      );
      const canonicalLocations = this.locationService.getCanonicalNames(
        data.locations,
      );
      const canonicalActivities = this.activityService.getCanonicalNames(
        data.activities,
      );

      const [sceneResult] = await this.db
        .insert(scenes)
        .values({
          videoId: video.id,
          videoFilename: video.filename,
          startTime,
          endTime,
          title: data.title,
          summary: data.summary,
          transcript: rawSegments
            .map((s) => `[${s.startTime.toFixed(0)}s] ${s.text}`)
            .join(' '),
          participants: JSON.stringify(canonicalParticipants),
          locations: JSON.stringify(canonicalLocations),
          activities: JSON.stringify(canonicalActivities),
        })
        .returning();

      // Sync to junction tables
      if (sceneResult) {
        if (canonicalParticipants.length > 0) {
          for (const canon of canonicalParticipants) {
            const person = await this.db.query.people.findFirst({
              where: (people, { eq }) => eq(people.name, canon),
            });

            if (person) {
              await this.db
                .insert(sceneToPeople)
                .values({
                  sceneId: sceneResult.id,
                  personId: person.id,
                })
                .onConflictDoNothing();
            }
          }
        }

        if (canonicalLocations.length > 0) {
          for (const canon of canonicalLocations) {
            const loc = await this.db.query.locations.findFirst({
              where: (locations, { eq }) => eq(locations.name, canon),
            });

            if (loc) {
              await this.db
                .insert(sceneToLocations)
                .values({
                  sceneId: sceneResult.id,
                  locationId: loc.id,
                })
                .onConflictDoNothing();
            }
          }
        }

        if (canonicalActivities.length > 0) {
          for (const canon of canonicalActivities) {
            const activity = await this.db.query.activities.findFirst({
              where: (activities, { eq }) => eq(activities.name, canon),
            });

            if (activity) {
              await this.db
                .insert(sceneToActivities)
                .values({
                  sceneId: sceneResult.id,
                  activityId: activity.id,
                })
                .onConflictDoNothing();
            }
          }
        }
      }

      logger.info(
        {
          startTime: startTime.toFixed(0),
          title: data.title,
          chunkNum,
          totalChunks,
        },
        '✅ Scene created',
      );

      return data.title;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { startTime: startTime.toFixed(0), error: message },
        '❌ Failed after 3 retries',
      );
      return null;
    }
  }

  private normalizeAiOutput(output: RawAiOutput): SceneData {
    return {
      title: output.title || output.scene_title || 'Untitled Scene',
      summary:
        output.summary || output.narrative_summary || 'No summary available',
      participants: output.participants ?? [],
      locations: output.locations ?? [],
      activities: output.activities ?? [],
    };
  }

  private getSystemPrompt(): string {
    return `You are an expert film archivist cataloging the Hopkins family video archive.
Analyze the home video transcript segment and provide a high-quality archival summary.

OUTPUT FORMAT (JSON object with these keys):
1. title: Short, descriptive title for this segment (5-10 words)
2. summary: Concise paragraph (3-4 sentences) describing the action. Start directly with events - avoid "The video captures..." or "This shows..."
3. participants: Array of people mentioned, speaking, or visible
4. locations: Array of specific places, rooms, or settings
5. activities: Array of activities, events, or occasions depicted

HOPKINS FAMILY NAME MAPPINGS (use these canonical forms):
- Gregory, Greggie, Greggy → "Greg"
- Jeffrey, Jeff → "Geoff"  
- Daniel, Dan → "Danny"
- Daddy, Dad, Father → "Dad"
- Mommy, Mom, Mama, Mother → "Mom"
- Grandma, Grandmother, Nana → "Grandma"
- Grandpa, Grandfather, Papa → "Grandpa"
- Keep specific names with titles: "Uncle Matt", "Aunt Lisa", "Aunt Teresa"

PARTICIPANT EXTRACTION RULES:
- Use actual names when spoken or identifiable: "Greg", "Mom", "Uncle Matt"
- Use specific roles with names when possible: "Coach Johnson", "Father Mike"
- For unidentified speakers, use descriptive roles: "Narrator", "Announcer", "Coach"
- NEVER use generic placeholders: "A person", "Someone", "A man", "A woman", "Another child"
- If you cannot identify someone, omit them rather than using a generic label

LOCATION EXTRACTION RULES:
- Use specific place names: "Lake Cumberland", "Yellowstone", "76 Falls"
- Use clear room/setting names: "Kitchen", "Living Room", "Backyard", "Church"
- For family homes use: "Grandma's House", "Aunt Teresa's House", "Home"
- NEVER use: "Unknown", "Unknown location", "Unspecified", "A room"
- If location is unclear, omit it rather than guessing

ACTIVITY EXTRACTION RULES:
- Sports: "Football", "Tennis", "Wrestling", "Baseball", "Golf", "Skiing", "Basketball", "Soccer"
- Recreation: "Fishing", "Swimming", "Hiking", "Boating", "Hunting", "Camping", "Biking"
- Holidays: "Christmas", "Easter", "Thanksgiving", "Halloween", "Fourth of July"
- Milestones: "Birthday", "Baptism", "Wedding", "Graduation", "Funeral", "Anniversary"
- Use noun forms: "Fishing" not "went fishing", "Christmas" not "Christmas morning"
- Be specific when context is clear: "Football Practice" vs just "Football"
- NEVER use generic verbs: "playing", "talking", "walking", "sitting", "watching"
- If no clear activity/event is depicted, return empty array

CRITICAL: Respond ONLY with a valid JSON object. No additional text.`;
  }
}

/**
 * CLI Entry Point
 */
async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      model: { type: 'string', default: 'summarizer-bulk-14b' },
      concurrency: { type: 'string', default: '6' },
      'video-concurrency': { type: 'string', default: '2' },
      verbose: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const participantService = new ParticipantService(REGISTRY_PATH);
  const locationService = new LocationService(LOCATION_REGISTRY_PATH);
  const activityService = new ActivityService(ACTIVITY_REGISTRY_PATH);

  await Promise.all([
    participantService.load(),
    locationService.load(),
    activityService.load(),
  ]);

  const concurrency = parseInt(values.concurrency!);
  const videoConcurrency = parseInt(values['video-concurrency']!);
  const isVerbose = values.verbose!;

  // Determine target videos
  let targetVideos: Video[] = [];
  if (values.file) {
    targetVideos = await db
      .select()
      .from(videos)
      .where(eq(videos.filename, values.file));
  } else if (values.all) {
    targetVideos = await db.select().from(videos);
  } else {
    logger.error(
      'Usage: bun ingest:summarize --file <filename> | --all [--force] [--concurrency <n>] [--verbose]',
    );
    process.exit(1);
  }

  // Calculate durations for LPT scheduling
  if (targetVideos.length > 0) {
    const videoIds = targetVideos.map((v) => v.id);
    const durations = await db
      .select({
        videoId: transcripts.videoId,
        maxTime: sql<number>`MAX(${transcripts.endTime})`,
      })
      .from(transcripts)
      .where(inArray(transcripts.videoId, videoIds))
      .groupBy(transcripts.videoId);

    const durationMap = new Map(durations.map((d) => [d.videoId, d.maxTime]));

    // Sort longest first
    targetVideos.sort((a, b) => {
      const durA = durationMap.get(a.id) ?? 0;
      const durB = durationMap.get(b.id) ?? 0;
      return durB - durA;
    });
  }

  // Stats tracking for final summary
  const stats = {
    totalVideos: targetVideos.length,
    completedVideos: 0,
    totalScenes: 0,
    errors: [] as Array<{ videoId: number; filename: string; error: string }>,
    warnings: [] as Array<{
      videoId: number;
      filename: string;
      message: string;
    }>,
  };

  // Setup TUI (if not verbose)
  const tui = isVerbose ? null : new TUI();

  if (!isVerbose) {
    tui!.start(targetVideos.length);
  } else {
    logger.info(
      { videoCount: targetVideos.length, videoConcurrency },
      '🎬 Archivist starting. Processing videos with LPT scheduling...',
    );
  }

  // Setup graceful shutdown
  let shuttingDown = false;
  process.on('SIGINT', () => {
    if (!shuttingDown) {
      shuttingDown = true;
      if (!isVerbose && tui) {
        tui.addActivity(
          'info',
          '⚠️ Finishing active videos before shutdown...',
        );
      } else {
        logger.info('⚠️ Finishing active videos before shutdown...');
      }
    }
  });

  // Progress callbacks
  const progressCallbacks: ProgressCallbacks = {
    onVideoStart: (video, totalChunks) => {
      if (!isVerbose && tui) {
        tui.setActiveJob({
          videoId: video.id,
          filename: video.filename,
          chunkNum: 0,
          totalChunks,
          currentTitle: null,
        });
      }
    },
    onChunkProgress: (video, chunkNum, totalChunks, title) => {
      if (!isVerbose && tui) {
        tui.setActiveJob({
          videoId: video.id,
          filename: video.filename,
          chunkNum,
          totalChunks,
          currentTitle: title,
        });
      }
    },
    onSceneCreated: (video, title) => {
      stats.totalScenes++;
      if (!isVerbose && tui) {
        tui.addActivity('success', `"${title}" (${video.filename})`);
        tui.updateProgress(stats.completedVideos, stats.totalScenes);
      }
    },
    onVideoComplete: (video, sceneCount) => {
      stats.completedVideos++;
      if (!isVerbose && tui) {
        tui.removeActiveJob(video.id);
        tui.updateProgress(stats.completedVideos, stats.totalScenes);
      } else {
        logger.info(
          { videoId: video.id, filename: video.filename, scenes: sceneCount },
          '✅ Video complete',
        );
      }
    },
    onVideoError: (video, error) => {
      stats.errors.push({ videoId: video.id, filename: video.filename, error });
      if (!isVerbose && tui) {
        tui.showError(`${video.filename}: ${error}`, 10000);
        tui.removeActiveJob(video.id);
      } else {
        logger.error({ videoId: video.id, error }, '❌ Video error');
      }
    },
    onVideoWarning: (video, message) => {
      stats.warnings.push({
        videoId: video.id,
        filename: video.filename,
        message,
      });
      if (isVerbose) {
        logger.warn({ videoId: video.id }, `⚠️ ${message}`);
      }
    },
  };

  const archivist = new VideoArchivist(
    db,
    getGenModel(values.model as GenerationModelName),
    participantService,
    locationService,
    activityService,
    isVerbose ? undefined : progressCallbacks,
  );

  // Process videos with concurrency control
  const activePromises = new Set<Promise<void>>();
  const pendingVideos = [...targetVideos];

  while (pendingVideos.length > 0 || activePromises.size > 0) {
    // Check if shutting down
    if (shuttingDown && activePromises.size > 0) {
      // Wait for active videos to complete
      await Promise.all(activePromises);
      break;
    }

    // Start new videos if we have capacity
    while (
      !shuttingDown &&
      pendingVideos.length > 0 &&
      activePromises.size < videoConcurrency
    ) {
      const video = pendingVideos.shift()!;

      const promise = archivist
        .processVideo(video, {
          force: values.force,
          concurrency,
        })
        .then((result) => {
          if (result.warning) {
            progressCallbacks.onVideoWarning(video, result.warning);
          }
          if (result.error) {
            progressCallbacks.onVideoError(video, result.error);
          } else {
            progressCallbacks.onVideoComplete(video, result.scenesCreated);
          }
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          progressCallbacks.onVideoError(video, message);
        });

      activePromises.add(promise);
      promise.finally(() => activePromises.delete(promise));
    }

    // Wait for at least one to complete if we're at capacity
    if (
      activePromises.size >= videoConcurrency ||
      (shuttingDown && activePromises.size > 0)
    ) {
      await Promise.race(activePromises);
    }
  }

  // Finalize
  if (!isVerbose && tui) {
    tui.finalize({
      totalVideos: stats.totalVideos,
      completedVideos: stats.completedVideos,
      totalScenes: stats.totalScenes,
      errors: stats.errors,
      warnings: stats.warnings,
    });
  } else {
    logger.info('🏁 All videos processed.');

    // Print summary table in verbose mode
    console.log(`\n┌${'─'.repeat(78)}┐`);
    console.log(`│ 🏁 COMPLETE${' '.repeat(66)}│`);
    console.log(`├${'─'.repeat(78)}┤`);
    console.log(
      `│ Total Videos: ${stats.completedVideos}/${stats.totalVideos}${' '.repeat(60 - stats.completedVideos.toString().length - stats.totalVideos.toString().length)}│`,
    );
    console.log(
      `│ Total Scenes: ${stats.totalScenes}${' '.repeat(62 - stats.totalScenes.toString().length)}│`,
    );

    if (stats.errors.length > 0) {
      console.log(
        `│ Errors: ${stats.errors.length}${' '.repeat(68 - stats.errors.length.toString().length)}│`,
      );
      console.log(`├${'─'.repeat(78)}┤`);
      console.log(`│ ERROR DETAILS:${' '.repeat(63)}│`);
      for (const err of stats.errors.slice(0, 5)) {
        const line = `  • ${err.filename}: ${err.error}`;
        console.log(`│${line.slice(0, 78).padEnd(78)}│`);
      }
      if (stats.errors.length > 5) {
        console.log(
          `│  ... and ${stats.errors.length - 5} more${' '.repeat(64 - (stats.errors.length - 5).toString().length)}│`,
        );
      }
    }

    console.log(`└${'─'.repeat(78)}┘`);
  }
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Fatal error in main');
  process.exit(1);
});
