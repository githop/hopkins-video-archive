import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { embedMany, type EmbeddingModel } from 'ai';
import { logger } from '@hop-hv-rag/core';
import { getEmbedModel } from '@hop-hv-rag/ai';
import {
  createDb,
  videos,
  chunks,
  chunkSummaries,
  chunkEntities,
  entities,
  type Chunk,
} from '@hop-hv-rag/db';
import { EmbedModelFlagOption, parseEmbedModelFlag } from './cli-flags.ts';

const DATA_DIR = join(import.meta.dir, '../../../data');
const DB_PATH = join(DATA_DIR, 'hv-rag.db');

interface SummaryRow {
  chunkId: number;
  title: string;
  summary: string;
}

class ChunkEmbedder {
  constructor(
    private db: ReturnType<typeof createDb>,
    private model: EmbeddingModel,
  ) {}

  async embedChunks(
    chunkRows: Chunk[],
    summaryType: string,
    batchSize: number,
  ) {
    if (chunkRows.length === 0) {
      logger.info('All chunks are already vectorized');
      return;
    }

    const chunkIds = chunkRows.map((row) => row.id);

    const summaries = await this.db
      .select({
        chunkId: chunkSummaries.chunkId,
        title: chunkSummaries.title,
        summary: chunkSummaries.summary,
      })
      .from(chunkSummaries)
      .where(
        and(
          eq(chunkSummaries.summaryType, summaryType),
          inArray(chunkSummaries.chunkId, chunkIds),
        ),
      )
      .orderBy(desc(chunkSummaries.id));

    const summaryMap = new Map<number, SummaryRow>();
    for (const row of summaries) {
      if (!summaryMap.has(row.chunkId)) {
        summaryMap.set(row.chunkId, row);
      }
    }

    const entityRows = await this.db
      .select({ chunkId: chunkEntities.chunkId, name: entities.name })
      .from(chunkEntities)
      .innerJoin(entities, eq(chunkEntities.entityId, entities.id))
      .where(inArray(chunkEntities.chunkId, chunkIds));

    const entityMap = new Map<number, string[]>();
    for (const row of entityRows) {
      const list = entityMap.get(row.chunkId) ?? [];
      list.push(row.name);
      entityMap.set(row.chunkId, list);
    }

    logger.info(
      { chunkCount: chunkRows.length, batchSize },
      'Starting embedding for chunks',
    );

    for (let i = 0; i < chunkRows.length; i += batchSize) {
      const batch = chunkRows.slice(i, i + batchSize);
      await this.processBatch(batch, summaryMap, entityMap, i / batchSize + 1);
    }
  }

  private buildEmbeddingText(
    chunk: Chunk,
    summary: SummaryRow | undefined,
    entitiesList: string[] | undefined,
  ): string {
    const parts: string[] = [];

    if (summary?.title) {
      parts.push(`TITLE: ${summary.title}`);
    }
    if (summary?.summary) {
      parts.push(`SUMMARY: ${summary.summary}`);
    }
    if (entitiesList && entitiesList.length > 0) {
      parts.push(`ENTITIES: ${entitiesList.join(', ')}`);
    }

    parts.push(`TRANSCRIPT: ${chunk.text}`);

    return parts.join('\n');
  }

  private async processBatch(
    batch: Chunk[],
    summaryMap: Map<number, SummaryRow>,
    entityMap: Map<number, string[]>,
    batchNumber: number,
  ) {
    logger.info(
      { batchNumber, chunkCount: batch.length },
      'Processing embedding batch',
    );

    const textValues = batch.map((chunk) =>
      this.buildEmbeddingText(
        chunk,
        summaryMap.get(chunk.id),
        entityMap.get(chunk.id),
      ),
    );

    try {
      const { embeddings } = await embedMany({
        model: this.model,
        values: textValues,
      });

      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        const embedding = embeddings[i];

        await this.db.run(
          sql.raw(`
            INSERT OR REPLACE INTO vec_chunks(rowid, chunk_embedding)
            VALUES (${chunk.id}, '${JSON.stringify(embedding)}')
          `),
        );
      }

      logger.info({ batchNumber }, 'Embedding batch saved');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ batchNumber, error: message }, 'Embedding batch failed');
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: 'string' },
      all: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'summary-type': { type: 'string', default: 'scene' },
      'embed-model': EmbedModelFlagOption,
      batchSize: { type: 'string', default: '50' },
    },
    strict: true,
  });

  const db = createDb(DB_PATH);
  const embedder = new ChunkEmbedder(
    db,
    getEmbedModel(parseEmbedModelFlag(values['embed-model'])),
  );
  const batchSize = parseInt(String(values.batchSize), 10);
  const summaryType = String(values['summary-type']);

  let targetChunks: Chunk[] = [];

  if (values.file) {
    const video = (
      await db.select().from(videos).where(eq(videos.filename, values.file))
    )[0];
    if (!video) {
      logger.error({ file: values.file }, 'Video not found');
      process.exit(1);
    }

    targetChunks = await db
      .select()
      .from(chunks)
      .where(eq(chunks.videoId, video.id));
  } else if (values.all) {
    if (values.force) {
      targetChunks = await db.select().from(chunks);
    } else {
      const existingRes = await db.all<{ rowid: number }>(
        sql.raw(`SELECT rowid FROM vec_chunks`),
      );
      const existingIds = new Set(existingRes.map((row) => row.rowid));
      const allChunks = await db.select().from(chunks);
      targetChunks = allChunks.filter((chunk) => !existingIds.has(chunk.id));
    }
  } else {
    logger.error(
      'Usage: bun run ingest:embed-chunks --file <filename> | --all [--force] [--summary-type scene] [--batchSize <n>]',
    );
    process.exit(1);
  }

  await embedder.embedChunks(targetChunks, summaryType, batchSize);
  logger.info('Embedding complete');
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    logger.error({ err }, 'Embedding failed');
    process.exit(1);
  });
}
