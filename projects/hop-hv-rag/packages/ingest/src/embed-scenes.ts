import { createDb, videos, scenes, type Scene } from '@hop-hv-rag/db';
import { getEmbedModel } from '@hop-hv-rag/ai';
import { embedMany, type EmbeddingModel } from 'ai';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { parseArgs } from 'node:util';

/**
 * Configuration
 */
const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

/**
 * SceneEmbedder: Orchestrates the vectorization of narrative scene summaries.
 */
class SceneEmbedder {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: EmbeddingModel,
  ) {}

  /**
   * Processes a list of scenes in batches to generate and save embeddings.
   */
  async embedScenes(scenesList: Scene[], batchSize: number) {
    console.log(
      `📡 Starting embedding for ${scenesList.length} scenes (Batch Size: ${batchSize})...`,
    );

    for (let i = 0; i < scenesList.length; i += batchSize) {
      const batch = scenesList.slice(i, i + batchSize);
      await this.processBatch(batch, i / batchSize + 1);
    }
  }

  private async processBatch(batch: Scene[], batchNumber: number) {
    console.log(`   📦 Batch ${batchNumber} (${batch.length} scenes)...`);

    const textValues = batch.map((s) => `${s.title}: ${s.summary}`);

    try {
      const { embeddings } = await embedMany({
        model: this.model,
        values: textValues,
      });

      // Prepare raw SQL for bulk-ish insertion if needed,
      // but for sqlite-vec we typically do individual rowid inserts.
      for (let j = 0; j < batch.length; j++) {
        const scene = batch[j];
        const embedding = embeddings[j];

        await this.db.run(
          sql.raw(`
          INSERT OR REPLACE INTO vec_scenes(rowid, scene_embedding)
          VALUES (${scene.id}, '${JSON.stringify(embedding)}')
        `),
        );
      }

      console.log(`   ✅ Batch ${batchNumber} saved.`);
    } catch (error: any) {
      console.error(`   ❌ Batch ${batchNumber} failed: ${error.message}`);
    }
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
      model: { type: 'string', default: 'embed' },
      batchSize: { type: 'string', default: '50' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const embedder = new SceneEmbedder(db, getEmbedModel(values.model));
  const batchSize = parseInt(values.batchSize!);

  let targetScenes: Scene[] = [];

  if (values.file) {
    const video = (
      await db.select().from(videos).where(eq(videos.filename, values.file))
    )[0];
    if (!video) {
      console.error(`❌ Video not found: ${values.file}`);
      process.exit(1);
    }
    targetScenes = await db
      .select()
      .from(scenes)
      .where(eq(scenes.videoId, video.id));
  } else if (values.all) {
    if (values.force) {
      targetScenes = await db.select().from(scenes);
    } else {
      // Find scenes missing from vec_scenes
      const existingRes = await db.all<{ rowid: number }>(
        sql.raw(`SELECT rowid FROM vec_scenes`),
      );
      const existingIds = new Set(existingRes.map((r) => r.rowid));

      const allScenes = await db.select().from(scenes);
      targetScenes = allScenes.filter((s) => !existingIds.has(s.id));
    }
  } else {
    console.error(
      'Usage: bun ingest:embed --file <filename> | --all [--force] [--batchSize <n>]',
    );
    process.exit(1);
  }

  if (targetScenes.length === 0) {
    console.log('✨ All scenes are already vectorized.');
    return;
  }

  await embedder.embedScenes(targetScenes, batchSize);
  console.log('\n🏁 Embedding complete.');
}

main().catch(console.error);
