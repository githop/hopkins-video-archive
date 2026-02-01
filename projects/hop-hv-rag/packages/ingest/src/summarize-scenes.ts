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
import { getGenModel } from '@hop-hv-rag/ai';
import {
  ParticipantService,
  LocationService,
  ActivityService,
  logger,
} from '@hop-hv-rag/core';
import {
  generateText,
  Output,
  NoObjectGeneratedError,
  type LanguageModel,
} from 'ai';
import { eq, inArray } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { TUI } from './tui.ts';
import { GenModelFlagOption, parseGenModelFlag } from './cli-flags.ts';
import {
  SCENE_SUMMARIZATION_PROMPT,
  SceneSummarizationSchema,
} from './prompts.ts';

/**
 * Configuration & Constants
 */
const DATA_DIR = resolve(process.cwd(), '../../data');
const DB_PATH = `${DATA_DIR}/hv-rag.db`;
const REGISTRY_PATH = `${DATA_DIR}/participant-registry.json`;
const LOCATION_REGISTRY_PATH = `${DATA_DIR}/location-registry.json`;
const ACTIVITY_REGISTRY_PATH = `${DATA_DIR}/activity-registry.json`;
const CHUNK_DURATION_SECONDS = 180;

type RawAiOutput = {
  title?: string;
  scene_title?: string;
  summary?: string;
  narrative_summary?: string;
  participants?: string[];
  locations?: string[];
  activities?: string[];
};

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

interface ChunkJob {
  video: Video;
  chunk: Chunk;
  chunkIndex: number;
  totalChunks: number;
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
 * JobPlanner: Pre-calculates all work upfront with idempotency filtering.
 * Determines which chunks need processing across all videos before execution.
 */
class JobPlanner {
  constructor(
    private db: ReturnType<typeof createDb>,
    private chunkDurationSeconds: number,
  ) {}

  async planJobs(
    videos: Video[],
    options: { force?: boolean },
  ): Promise<{
    jobs: ChunkJob[];
    videosToProcess: Video[];
    videosSkipped: Video[];
  }> {
    const jobs: ChunkJob[] = [];
    const videosToProcess: Video[] = [];
    const videosSkipped: Video[] = [];

    for (const video of videos) {
      const videoJobs = await this.planVideoJobs(video, options);

      if (videoJobs.length === 0 && !options.force) {
        videosSkipped.push(video);
      } else {
        videosToProcess.push(video);
        jobs.push(...videoJobs);
      }
    }

    return { jobs, videosToProcess, videosSkipped };
  }

  private async planVideoJobs(
    video: Video,
    options: { force?: boolean },
  ): Promise<ChunkJob[]> {
    // Handle force mode: delete existing scenes first
    if (options.force) {
      await this.deleteVideoScenes(video.id);
    }

    const segments = await this.db
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, video.id))
      .orderBy(transcripts.startTime);

    if (segments.length === 0) {
      return [];
    }

    const allChunks = this.createChunks(segments);

    // Idempotency check: filter out already-processed chunks
    const existingScenes = await this.db
      .select({ startTime: scenes.startTime })
      .from(scenes)
      .where(eq(scenes.videoId, video.id));

    const pendingChunks = allChunks.filter((chunk) => {
      const isProcessed = existingScenes.some(
        (scene) =>
          scene.startTime >= chunk.windowStart &&
          scene.startTime < chunk.windowEnd,
      );
      return !isProcessed;
    });

    return pendingChunks.map((chunk, index) => ({
      video,
      chunk,
      chunkIndex: index,
      totalChunks: allChunks.length,
    }));
  }

  private async deleteVideoScenes(videoId: number): Promise<void> {
    const scenesToDelete = await this.db
      .select({ id: scenes.id })
      .from(scenes)
      .where(eq(scenes.videoId, videoId));

    const sceneIds = scenesToDelete.map((s) => s.id);

    if (sceneIds.length > 0) {
      await this.db
        .delete(sceneToPeople)
        .where(inArray(sceneToPeople.sceneId, sceneIds));
      await this.db
        .delete(sceneToLocations)
        .where(inArray(sceneToLocations.sceneId, sceneIds));
      await this.db
        .delete(sceneToActivities)
        .where(inArray(sceneToActivities.sceneId, sceneIds));
      await this.db.delete(scenes).where(eq(scenes.videoId, videoId));
    }
  }

  private createChunks(segments: Transcript[]): Chunk[] {
    const chunks: Chunk[] = [];
    const lastSegment = segments[segments.length - 1];
    const maxTime = lastSegment.endTime;

    for (let start = 0; start < maxTime; start += this.chunkDurationSeconds) {
      const end = start + this.chunkDurationSeconds;
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
}

/**
 * VideoArchivist: Processes individual chunks into scenes.
 * With interleaved execution, each chunk is processed independently.
 */
class VideoArchivist {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: LanguageModel,
    private participantService: ParticipantService,
    private locationService: LocationService,
    private activityService: ActivityService,
  ) {}

  /**
   * Process a single chunk job (used in interleaved execution)
   */
  async processChunkJob(job: ChunkJob): Promise<string | null> {
    return this.summarizeChunk(
      job.video,
      job.chunk,
      job.chunkIndex + 1,
      job.totalChunks,
    );
  }

  /**
   * Aggregates participants, locations, and activities from all scenes back to the video record.
   * Called after all chunks for a video are complete.
   */
  async aggregateVideoMetadata(videoId: number): Promise<void> {
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
      const { output: object } = await generateText({
        model: this.model,
        system: SCENE_SUMMARIZATION_PROMPT,
        output: Output.object({
          schema: SceneSummarizationSchema,
        }),
        prompt: `Transcript for the current 3-minute segment:\n\n${text}`,
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

      // Update scene with thumbnail path after we have the scene ID
      // Path format: /{videoFolder}/{startTime}.jpg (scene-agnostic for regeneration safety)
      if (sceneResult) {
        const videoFolder = video.filename.replace(/\.[^/.]+$/, '');
        const timestampPadded = Math.floor(startTime)
          .toString()
          .padStart(5, '0');
        const thumbnailPath = `/${videoFolder}/${timestampPadded}.jpg`;

        await this.db
          .update(scenes)
          .set({ thumbnailPath })
          .where(eq(scenes.id, sceneResult.id));

        // Update the sceneResult object with the new thumbnailPath
        sceneResult.thumbnailPath = thumbnailPath;
      }

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
      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn(
          {
            startTime: startTime.toFixed(0),
            text: error.text,
            response: error.response,
          },
          'No object generated - model did not return valid JSON',
        );
        return null;
      }
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
      'gen-model': GenModelFlagOption,
      concurrency: { type: 'string', default: '16' },
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

  const maxConcurrency = parseInt(values.concurrency!);
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

  // Phase 1: Planning - Calculate all work upfront
  logger.info(
    { videoCount: targetVideos.length },
    '📋 Planning phase: Calculating chunks...',
  );

  const planner = new JobPlanner(db, CHUNK_DURATION_SECONDS);
  const { jobs, videosToProcess, videosSkipped } = await planner.planJobs(
    targetVideos,
    { force: values.force },
  );

  if (videosSkipped.length > 0) {
    for (const video of videosSkipped) {
      logger.info(
        { filename: video.filename },
        '✅ Video fully processed (skipping)',
      );
    }
  }

  if (jobs.length === 0) {
    logger.info('🏁 No work to do - all videos already processed.');
    process.exit(0);
  }

  logger.info(
    {
      totalJobs: jobs.length,
      videosToProcess: videosToProcess.length,
      videosSkipped: videosSkipped.length,
    },
    `🚀 Interleaved execution: ${jobs.length} chunks across ${videosToProcess.length} videos`,
  );

  // Stats tracking for final summary
  const stats = {
    totalVideos: videosToProcess.length,
    completedVideos: 0,
    totalChunks: jobs.length,
    completedChunks: 0,
    totalScenes: 0,
    errors: [] as Array<{ videoId: number; filename: string; error: string }>,
    warnings: [] as Array<{
      videoId: number;
      filename: string;
      message: string;
    }>,
  };

  // Per-video progress tracking
  const videoProgress = new Map<
    number,
    {
      video: Video;
      totalChunks: number;
      completedChunks: number;
      scenesCreated: number;
    }
  >();

  for (const video of videosToProcess) {
    const videoJobs = jobs.filter((j) => j.video.id === video.id);
    videoProgress.set(video.id, {
      video,
      totalChunks: videoJobs[0]?.totalChunks ?? 0,
      completedChunks: 0,
      scenesCreated: 0,
    });
  }

  // Setup TUI (if not verbose)
  const tui = isVerbose ? null : new TUI();

  if (!isVerbose) {
    logger.level = 'silent';
    tui!.start(stats.totalChunks, stats.totalVideos);
  } else {
    logger.info(
      { jobs: jobs.length, maxConcurrency },
      '🎬 Starting interleaved processing...',
    );
  }

  // Setup graceful shutdown
  let shuttingDown = false;
  process.on('SIGINT', () => {
    if (!shuttingDown) {
      shuttingDown = true;
      if (!isVerbose && tui) {
        tui.showShutdownMessage('Finishing active chunks before exit...');
        tui.addActivity(
          'info',
          '⚠️ SIGINT received - completing active work...',
        );
      } else {
        logger.info('⚠️ Finishing active chunks before shutdown...');
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
      const progress = videoProgress.get(video.id)!;
      progress.scenesCreated++;
      if (!isVerbose && tui) {
        tui.addActivity('success', `"${title}" (${video.filename})`);
        tui.updateProgress(
          stats.completedChunks,
          stats.completedVideos,
          stats.totalScenes,
        );
      }
    },
    onVideoComplete: (video, sceneCount) => {
      stats.completedVideos++;
      if (!isVerbose && tui) {
        tui.removeActiveJob(video.id);
        tui.updateProgress(
          stats.completedChunks,
          stats.completedVideos,
          stats.totalScenes,
        );
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

  // Initialize archivist
  const archivist = new VideoArchivist(
    db,
    getGenModel(parseGenModelFlag(values['gen-model'])),
    participantService,
    locationService,
    activityService,
  );

  // Phase 2: Interleaved Execution
  // Fire all jobs through a flat concurrency pool
  const activePromises = new Set<Promise<void>>();

  for (const job of jobs) {
    // Check for shutdown
    if (shuttingDown) {
      break;
    }

    // Wait if at max concurrency
    if (activePromises.size >= maxConcurrency) {
      await Promise.race(activePromises);
    }

    // Fire the job
    const progress = videoProgress.get(job.video.id)!;

    if (progress.completedChunks === 0) {
      progressCallbacks.onVideoStart(job.video, progress.totalChunks);
    }

    const promise = archivist
      .processChunkJob(job)
      .then(async (title) => {
        // Update global and per-video progress
        stats.completedChunks++;
        progress.completedChunks++;
        progressCallbacks.onChunkProgress(
          job.video,
          progress.completedChunks,
          progress.totalChunks,
          title,
        );
        if (title) {
          progressCallbacks.onSceneCreated(job.video, title);
        }

        // Check if video is complete
        if (progress.completedChunks >= progress.totalChunks) {
          // Aggregate metadata
          await archivist.aggregateVideoMetadata(job.video.id);
          progressCallbacks.onVideoComplete(job.video, progress.scenesCreated);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        progressCallbacks.onVideoError(job.video, message);
      });

    activePromises.add(promise);
    promise.finally(() => activePromises.delete(promise));
  }

  // Wait for all remaining jobs
  await Promise.all(activePromises);

  // Finalize
  if (!isVerbose && tui) {
    tui.finalize({
      totalVideos: stats.totalVideos,
      completedVideos: stats.completedVideos,
      totalChunks: stats.totalChunks,
      completedChunks: stats.completedChunks,
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
      `│ Total Chunks: ${stats.completedChunks}/${stats.totalChunks}${' '.repeat(60 - stats.completedChunks.toString().length - stats.totalChunks.toString().length)}│`,
    );
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
