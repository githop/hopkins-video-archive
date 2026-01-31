import { createDb, videos, scenes, type Video } from '@hop-hv-rag/db';
import { getGenModel } from '@hop-hv-rag/ai';
import {
  generateText,
  Output,
  NoObjectGeneratedError,
  type LanguageModel,
} from 'ai';
import { eq, like, isNull } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { logger } from '@hop-hv-rag/core';
import {
  TEMPORAL_EXTRACTION_SYSTEM_PROMPT,
  getTemporalExtractionPrompt,
  TemporalExtractionSchema,
} from './prompts.ts';

const DATA_DIR = resolve(process.cwd(), '../../data');
const DB_PATH = `${DATA_DIR}/hv-rag.db`;

// Simple Semaphore implementation
class Semaphore {
  private tasks: (() => void)[] = [];
  private count: number;

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.tasks.push(resolve);
    });
  }

  release(): void {
    if (this.tasks.length > 0) {
      const next = this.tasks.shift();
      if (next) next();
    } else {
      this.count++;
    }
  }
}

async function extractTemporalMetadata(
  db: ReturnType<typeof createDb>,
  model: LanguageModel,
  video: Video,
): Promise<void> {
  // 1. Fetch all scenes for this video
  const videoScenes = db
    .select({ title: scenes.title, summary: scenes.summary })
    .from(scenes)
    .where(eq(scenes.videoId, video.id))
    .all();

  if (videoScenes.length === 0) {
    logger.info({ filename: video.filename }, 'No scenes found, skipping');
    return;
  }

  // 2. Build scene context for LLM
  const sceneContext = videoScenes
    .map((s) => `- ${s.title}: ${s.summary}`)
    .join('\n');

  // 3. Call LLM with structured output
  // We use a broader range in schema (1960) than plan (1970) just in case, or match plan.
  // Plan said 1970-2030. I used 1960 in query detection later, so I'll stick to plan 1970 or maybe 1960 to be safe.
  // Actually, I'll stick to the code I wrote in schema 1960-2030 in the Zod schema above.

  try {
    const { output: object } = await generateText({
      model,
      system: TEMPORAL_EXTRACTION_SYSTEM_PROMPT,
      output: Output.object({
        schema: TemporalExtractionSchema,
      }),
      prompt: getTemporalExtractionPrompt(video.filename, sceneContext),
    });

    // 4. Skip low confidence results
    if (object.confidence === 'low') {
      logger.info(
        {
          filename: video.filename,
          confidence: object.confidence,
          evidence: object.evidence,
        },
        'Low confidence result, skipping',
      );
      return;
    }

    // 5. Update database
    db.update(videos)
      .set({
        yearStart: object.yearStart,
        yearEnd: object.yearEnd,
      })
      .where(eq(videos.id, video.id))
      .run();

    logger.info(
      {
        filename: video.filename,
        yearStart: object.yearStart,
        yearEnd: object.yearEnd,
        confidence: object.confidence,
      },
      'Extracted temporal metadata',
    );
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) {
      logger.warn(
        {
          filename: video.filename,
          text: e.text,
          response: e.response,
        },
        'No object generated - model did not return valid JSON',
      );
      return;
    }
    logger.error(
      { filename: video.filename, error: e },
      'Error processing video',
    );
    throw e;
  }
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      model: { type: 'string', default: 'summarizer-bulk-14b' },
      concurrency: { type: 'string', default: '16' },
    },
    strict: true,
  });

  // Validate args
  if (!values.all && !values.file) {
    logger.error('Usage: bun ingest:temporal --all | --file <filename>');
    process.exit(1);
  }

  const db = createDb(DB_PATH);
  // @ts-ignore - The type for model name might be strict, assuming string is compatible or casted
  const model = getGenModel(values.model as any);

  // Get videos to process
  let videosToProcess: Video[];
  if (values.file) {
    videosToProcess = db
      .select()
      .from(videos)
      .where(like(videos.filename, `%${values.file}%`))
      .all();
  } else {
    // --all: get videos without year data (unless --force)
    videosToProcess = values.force
      ? db.select().from(videos).all()
      : db.select().from(videos).where(isNull(videos.yearStart)).all();
  }

  logger.info({ count: videosToProcess.length }, 'Processing videos');

  // Process with concurrency limit
  const semaphore = new Semaphore(parseInt(values.concurrency || '16'));
  await Promise.all(
    videosToProcess.map(async (video) => {
      await semaphore.acquire();
      try {
        await extractTemporalMetadata(db, model, video);
      } catch (error) {
        // Error already logged in extractTemporalMetadata if caught, but here we catch surrounding issues
        // console.error(`   ❌ ${video.filename}: ${error}`);
      } finally {
        semaphore.release();
      }
    }),
  );

  logger.print('\nDone!');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
