import {
  createDb,
  videos,
  transcripts,
  scenes,
  sceneToPeople,
  sceneToLocations,
  type Video,
  type Transcript,
} from '@hop-hv-rag/db';
import { getGenModel } from '@hop-hv-rag/ai';
import { ParticipantService, LocationService } from '@hop-hv-rag/core';
import { generateText, type LanguageModel } from 'ai';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { parseArgs } from 'node:util';

/**
 * Configuration & Constants
 */
const DATA_DIR = `${import.meta.dir}/../../../data`;
const DB_PATH = `${DATA_DIR}/hv-rag.db`;
const REGISTRY_PATH = `${DATA_DIR}/participant-registry.json`;
const LOCATION_REGISTRY_PATH = `${DATA_DIR}/location-registry.json`;
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
});

type RawAiOutput = z.infer<typeof SceneSchema>;

interface SceneData {
  title: string;
  summary: string;
  participants: string[];
  locations: string[];
}

interface Chunk {
  startTime: number;
  endTime: number;
  text: string;
  rawSegments: Transcript[];
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
  ) {}

  /**
   * Main entry point for processing a video
   */
  async processVideo(
    video: Video,
    options: { force?: boolean; concurrency: number },
  ) {
    console.log(`\n🎥 [${video.filename}] (ID: ${video.id})`);

    if (options.force) {
      await this.db.delete(scenes).where(eq(scenes.videoId, video.id));
    }

    const segments = await this.db
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, video.id))
      .orderBy(transcripts.startTime);

    if (segments.length === 0) {
      console.warn(`   ⚠️ No transcripts found. Skipping.`);
      return;
    }

    const chunks = this.createChunks(segments);
    console.log(
      `   🚀 Processing ${chunks.length} chunks (Concurrency: ${options.concurrency})...`,
    );

    await this.processChunksInParallel(video.id, chunks, options.concurrency);
    await this.aggregateVideoMetadata(video.id);
  }

  /**
   * Aggregates participants and locations from all scenes back to the video record.
   */
  private async aggregateVideoMetadata(videoId: number) {
    const videoScenes = await this.db
      .select({
        participants: scenes.participants,
        locations: scenes.locations,
      })
      .from(scenes)
      .where(eq(scenes.videoId, videoId));

    const allParticipants = new Set<string>();
    const allLocations = new Set<string>();

    for (const scene of videoScenes) {
      if (scene.participants) {
        const parts = JSON.parse(scene.participants) as string[];
        parts.forEach((p) => allParticipants.add(p));
      }
      if (scene.locations) {
        const locs = JSON.parse(scene.locations) as string[];
        locs.forEach((l) => allLocations.add(l));
      }
    }

    await this.db
      .update(videos)
      .set({
        participants: JSON.stringify(Array.from(allParticipants)),
        locations: JSON.stringify(Array.from(allLocations)),
      })
      .where(eq(videos.id, videoId));

    console.log(
      `   ✨ Updated video metadata: ${allParticipants.size} participants, ${allLocations.size} locations.`,
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
    videoId: number,
    chunks: Chunk[],
    limit: number,
  ) {
    const activePromises = new Set<Promise<void>>();

    for (const chunk of chunks) {
      const promise = this.summarizeChunk(videoId, chunk);
      activePromises.add(promise);

      // Remove itself from the set when done
      promise.finally(() => activePromises.delete(promise));

      if (activePromises.size >= limit) {
        await Promise.race(activePromises);
      }
    }

    await Promise.all(activePromises);
  }

  /**
   * Individual worker unit: AI request + Database save
   */
  private async summarizeChunk(videoId: number, chunk: Chunk) {
    const { startTime, endTime, text, rawSegments } = chunk;

    try {
      const { text: resultText } = await generateText({
        model: this.model,
        system: this.getSystemPrompt(),
        prompt: `Transcript for the current 3-minute segment:\n\n${text}`,
      });

      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`No JSON found in AI response: ${resultText}`);
      }

      const rawObject = JSON.parse(jsonMatch[0]);
      const object = SceneSchema.parse(rawObject);

      const data = this.normalizeAiOutput(object);

      // Normalize participants using the service
      const canonicalParticipants = this.participantService.getCanonicalNames(
        data.participants,
      );
      const canonicalLocations = this.locationService.getCanonicalNames(
        data.locations,
      );

      const [sceneResult] = await this.db
        .insert(scenes)
        .values({
          videoId,
          startTime,
          endTime,
          title: data.title,
          summary: data.summary,
          transcript: rawSegments
            .map((s) => `[${s.startTime.toFixed(0)}s] ${s.text}`)
            .join(' '),
          participants: JSON.stringify(canonicalParticipants),
          locations: JSON.stringify(canonicalLocations),
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
      }

      console.log(`   ✅ [${startTime.toFixed(0)}s] ${data.title}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ [${startTime.toFixed(0)}s] Failed: ${message}`);
    }
  }

  private normalizeAiOutput(output: RawAiOutput): SceneData {
    return {
      title: output.title || output.scene_title || 'Untitled Scene',
      summary:
        output.summary || output.narrative_summary || 'No summary available',
      participants: output.participants ?? [],
      locations: output.locations ?? [],
    };
  }

  private getSystemPrompt(): string {
    return [
      'You are an expert film archivist and family historian.',
      'Analyze the home video transcript segment and provide a high-quality archival summary.',
      '1. title: Create a short, descriptive title for this specific segment.',
      "2. summary: Write a concise paragraph (3-4 sentences) describing the action. Avoid 'The video captures...' or 'This shows...'. Start directly with the events.",
      '3. participants: List people mentioned or speaking.',
      '4. locations: List specific locations or rooms.',
      'CRITICAL: Respond ONLY with a valid JSON object using the keys above.',
    ].join('\n');
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
      model: { type: 'string', default: 'summarizer' },
      concurrency: { type: 'string', default: '4' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const participantService = new ParticipantService(REGISTRY_PATH);
  await participantService.load();

  const locationService = new LocationService(LOCATION_REGISTRY_PATH);
  await locationService.load();

  const archivist = new VideoArchivist(
    db,
    getGenModel(values.model),
    participantService,
    locationService,
  );
  const concurrency = parseInt(values.concurrency!);

  // Determine target videos
  let targetVideos: Video[] = [];
  if (values.file) {
    targetVideos = await db
      .select()
      .from(videos)
      .where(eq(videos.filename, values.file));
  } else if (values.all) {
    if (values.force) {
      targetVideos = await db.select().from(videos);
    } else {
      const processed = await db
        .select({ id: scenes.videoId })
        .from(scenes)
        .groupBy(scenes.videoId);
      const processedIds = processed.map((v) => v.id);
      targetVideos =
        processedIds.length > 0
          ? await db
              .select()
              .from(videos)
              .where(sql`id NOT IN (${processedIds.join(',')})`)
          : await db.select().from(videos);
    }
  } else {
    console.error(
      'Usage: bun ingest:summarize --file <filename> | --all [--force] [--concurrency <n>]',
    );
    process.exit(1);
  }

  console.log(
    `🎬 Archivist starting. Processing ${targetVideos.length} videos...`,
  );

  for (const video of targetVideos) {
    await archivist.processVideo(video, { force: values.force, concurrency });
  }

  console.log('\n🏁 All videos processed.');
}

main().catch(console.error);
