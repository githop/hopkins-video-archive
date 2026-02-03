import { getGenModel, type GenerationModelName } from '@hop-hv-rag/ai';
import { generateText, Output, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import { createDb } from '@hop-hv-rag/db';
import { sql } from 'drizzle-orm';
import { logger } from '@hop-hv-rag/core';
import { ClusterTUI } from './cluster-tui.ts';

interface ClassificationEntry {
  canonical: string;
  category: string;
  reasoning: string;
}

interface ItemWithContext {
  value: string;
  context?: string;
}

interface BatchJob {
  batch: string[];
  batchIndex: number;
  totalBatches: number;
}

class BatchProcessingError extends Error {
  readonly errorType: 'ai-parse' | 'api';

  constructor(message: string, errorType: 'ai-parse' | 'api') {
    super(message);
    this.errorType = errorType;
  }
}

export interface ClusteringConfig<
  T extends z.ZodObject<{
    classifications: z.ZodArray<z.ZodObject<z.ZodRawShape>>;
  }>,
> {
  dbPath: string;
  dbQuery: string;
  dbColumn?: string;
  dbValueColumn?: string;
  dbContextColumn?: string;
  systemPrompt: string;
  schema: T;
  batchSize: number;
  concurrency: number;
  timeout?: number;
  maxRetries?: number;
  categoryFallback: string;
  validCategories: string[];
  model?: GenerationModelName;
  verbose?: boolean;
  tuiHeader?: string;
}

export async function runClustering<
  T extends z.ZodObject<{
    classifications: z.ZodArray<z.ZodObject<z.ZodRawShape>>;
  }>,
>(config: ClusteringConfig<T>): Promise<Record<string, ClassificationEntry>> {
  const {
    dbPath,
    dbQuery,
    dbColumn,
    dbValueColumn,
    dbContextColumn,
    systemPrompt,
    schema,
    batchSize,
    concurrency,
    timeout = 180000,
    maxRetries = 3,
    categoryFallback,
    validCategories,
    model: modelName,
    verbose = false,
    tuiHeader,
  } = config;

  const db = createDb(dbPath);
  const isVerbose = Boolean(verbose);

  function mergeContext(existing: string | undefined, next: string): string {
    if (!existing) return next;
    if (existing.includes(next)) return existing;
    const merged = `${existing} | ${next}`;
    return merged.length > 320 ? existing : merged;
  }

  function normalizeContext(
    value: string | null | undefined,
  ): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  function buildItemsFromDb(): {
    items: string[];
    contextByItem: Map<string, string>;
  } {
    const results = db.all<Record<string, string | null>>(sql.raw(dbQuery));
    const contextByItem = new Map<string, string>();

    if (dbValueColumn) {
      const values = new Set<string>();
      results.forEach((row) => {
        const rawValue = row[dbValueColumn];
        if (!rawValue) return;
        const value = rawValue.trim();
        if (!value) return;
        values.add(value);

        if (dbContextColumn) {
          const contextValue = normalizeContext(row[dbContextColumn]);
          if (contextValue) {
            const existing = contextByItem.get(value);
            contextByItem.set(value, mergeContext(existing, contextValue));
          }
        }
      });

      return { items: Array.from(values).sort(), contextByItem };
    }

    if (!dbColumn) {
      return { items: [], contextByItem };
    }

    const all = new Set<string>();
    results.forEach((row) => {
      const raw = row[dbColumn] ?? '';
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            if (typeof item === 'string' && item.trim()) {
              all.add(item.trim());
            }
          });
        }
      } catch {
        if (raw.trim()) all.add(raw.trim());
      }
    });

    return { items: Array.from(all).sort(), contextByItem };
  }

  function planBatchJobs(items: string[]): {
    jobs: BatchJob[];
    skippedBatches: number;
    pendingItems: number;
  } {
    const jobs: BatchJob[] = [];
    const skippedBatches = 0;
    const pendingItems = items.length;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      jobs.push({ batch, batchIndex: jobs.length, totalBatches: 0 });
    }

    const totalBatches = jobs.length;
    for (const job of jobs) {
      job.totalBatches = totalBatches;
    }

    return { jobs, skippedBatches, pendingItems };
  }

  const { items, contextByItem } = buildItemsFromDb();
  logger.info({ count: items.length }, 'Loaded unique items');

  if (items.length === 0) {
    logger.info('No items available for clustering.');
    return {};
  }

  const registry: Record<string, ClassificationEntry> = {};

  logger.info(
    { itemCount: items.length },
    'Planning phase: calculating batches',
  );
  const { jobs, skippedBatches, pendingItems } = planBatchJobs(items);

  if (skippedBatches > 0) {
    logger.info({ skippedBatches }, 'Skipping already processed batches');
  }

  if (jobs.length === 0) {
    logger.info('No work to do - all batches already processed.');
    return registry;
  }

  const model = getGenModel(modelName);
  logger.info(
    { model: modelName, batchSize, concurrency },
    'Starting clustering',
  );

  const stats = {
    totalBatches: jobs.length,
    completedBatches: 0,
    totalItems: pendingItems,
    processedItems: 0,
    errors: [] as Array<{ batchNum: number; error: string }>,
    warnings: [] as Array<{ batchNum: number; message: string }>,
    failedBatches: [] as Array<{
      batchNum: number;
      totalBatches: number;
      errorType: 'ai-parse' | 'api' | 'unknown';
      errorMessage: string;
    }>,
  };

  const tui = isVerbose ? null : new ClusterTUI();

  if (!isVerbose) {
    logger.level = 'silent';
    await tui!.start(
      stats.totalBatches,
      stats.totalItems,
      concurrency,
      tuiHeader,
    );
  } else {
    logger.info(
      { totalBatches: stats.totalBatches, concurrency },
      'Starting interleaved processing',
    );
  }

  process.on('SIGINT', () => {
    if (!isVerbose && tui) {
      tui.stop();
    }
    console.log('\n\nInterrupted - exiting immediately');
    process.exit(1);
  });

  async function processBatchJob(job: BatchJob): Promise<number> {
    const batchStartTime = Date.now();
    const batchWithContext: ItemWithContext[] = job.batch.map((item) => ({
      value: item,
      context: contextByItem.get(item),
    }));
    const batchLines = batchWithContext.map((entry) =>
      entry.context ? `${entry.value} || ${entry.context}` : entry.value,
    );
    const itemPreview =
      job.batch.slice(0, 3).join(', ') +
      (job.batch.length > 3 ? ` (+${job.batch.length - 3} more)` : '');

    if (isVerbose) {
      logger.info(
        {
          batchIdx: job.batchIndex + 1,
          totalBatches: job.totalBatches,
          itemCount: job.batch.length,
          items: itemPreview,
        },
        'Starting batch',
      );
    }

    try {
      const { output: classificationsOutput } = await generateText({
        model,
        system: systemPrompt,
        prompt: `Items to classify (one per line):\n${batchLines.join('\n')}`,
        output: Output.object({
          schema,
        }),
        timeout,
        maxRetries,
      });

      const classifications = classificationsOutput.classifications;

      job.batch.forEach((original, idx) => {
        const result =
          classifications.find((c: Record<string, unknown>) =>
            Object.values(c).includes(original),
          ) || classifications[idx];

        if (result) {
          const rawCategory = String(result.category).toUpperCase().trim();
          registry[original] = {
            canonical: String(result.canonical),
            category: validCategories.includes(rawCategory)
              ? rawCategory
              : categoryFallback,
            reasoning: String(result.reasoning),
          };
        } else {
          registry[original] = {
            canonical: original,
            category: categoryFallback,
            reasoning: 'Fallback (not in AI output)',
          };
        }
      });

      if (isVerbose) {
        const batchDuration = (Date.now() - batchStartTime) / 1000;
        logger.info(
          {
            batchIdx: job.batchIndex + 1,
            itemCount: job.batch.length,
            durationSec: batchDuration.toFixed(1),
            classificationsReturned: classifications.length,
          },
          'Batch completed',
        );
      }

      return job.batch.length;
    } catch (error) {
      const batchDuration = (Date.now() - batchStartTime) / 1000;

      if (NoObjectGeneratedError.isInstance(error)) {
        logger.warn(
          {
            batchIdx: job.batchIndex + 1,
            itemCount: job.batch.length,
            items: job.batch,
            durationSec: batchDuration.toFixed(1),
            text: error.text,
            response: error.response,
          },
          'No object generated - model did not return valid JSON',
        );
        throw new BatchProcessingError(
          'AI failed to generate valid classifications',
          'ai-parse',
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          batchIdx: job.batchIndex + 1,
          itemCount: job.batch.length,
          items: job.batch,
          durationSec: batchDuration.toFixed(1),
          error: message,
        },
        'Error processing batch',
      );
      throw new BatchProcessingError(message, 'api');
    }
  }

  const activePromises = new Set<Promise<unknown>>();
  const startTime = Date.now();

  for (const job of jobs) {
    if (activePromises.size >= concurrency) {
      await Promise.race(activePromises);
    }

    const batchStartTime = Date.now();
    let batchError: string | null = null;
    let batchErrorType: 'ai-parse' | 'api' | 'unknown' = 'unknown';
    let itemCount = 0;

    const promise = processBatchJob(job)
      .then((count) => {
        itemCount = count;
        stats.processedItems += count;
        if (!isVerbose && tui) {
          tui.updateProgress(stats.completedBatches, stats.processedItems);
        }
        return { count, error: null, errorType: null };
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const errorType =
          error instanceof BatchProcessingError ? error.errorType : 'unknown';
        batchError = message;
        batchErrorType =
          errorType === 'ai-parse'
            ? 'ai-parse'
            : errorType === 'api'
              ? 'api'
              : 'unknown';

        stats.errors.push({ batchNum: job.batchIndex + 1, error: message });
        stats.failedBatches.push({
          batchNum: job.batchIndex + 1,
          totalBatches: job.totalBatches,
          errorType: batchErrorType,
          errorMessage: message,
        });

        if (!isVerbose && tui) {
          tui.showError(`Batch ${job.batchIndex + 1}: ${message}`, 10000);
        } else {
          logger.error(
            { batchIdx: job.batchIndex + 1, error: message },
            'Batch error',
          );
        }
        return { count: 0, error: message, errorType: batchErrorType };
      })
      .finally(() => {
        stats.completedBatches++;
        if (!isVerbose && tui) {
          tui.recordBatchComplete({
            batchNum: job.batchIndex + 1,
            totalBatches: job.totalBatches,
            title: batchError ? null : `${itemCount} items`,
            durationMs: Date.now() - batchStartTime,
            timestamp: Date.now(),
            hadError: batchError !== null,
            errorType: batchErrorType,
            errorMessage: batchError ?? undefined,
          });
          tui.setInFlightCount(activePromises.size);
          tui.updateProgress(stats.completedBatches, stats.processedItems);
        }
      });

    activePromises.add(promise);

    if (!isVerbose && tui) {
      tui.setInFlightCount(activePromises.size);
    }

    promise.finally(() => {
      activePromises.delete(promise);
      if (!isVerbose && tui) {
        tui.setInFlightCount(activePromises.size);
      }
    });
  }

  await Promise.all(activePromises);

  if (!isVerbose && tui) {
    tui.finalize({
      totalBatches: stats.totalBatches,
      completedBatches: stats.completedBatches,
      totalItems: stats.totalItems,
      processedItems: stats.processedItems,
      errors: stats.errors,
      warnings: stats.warnings,
      failedBatches: stats.failedBatches,
    });
  } else {
    logger.info('All batches processed.');
  }

  const totalTime = (Date.now() - startTime) / 1000;
  const finalMissing = items.filter((p) => !registry[p]);
  const successCount = items.length - finalMissing.length;
  const successRate = Math.round((successCount / items.length) * 100);

  if (finalMissing.length > 0) {
    if (isVerbose) {
      logger.error(
        {
          missingCount: finalMissing.length,
          successCount,
          totalItems: items.length,
          successRate: `${successRate}%`,
          missingItems: finalMissing.slice(0, 20),
        },
        'Process complete but some items are missing',
      );
    }
  } else if (isVerbose) {
    logger.info(
      {
        totalProcessed: items.length,
        totalTimeSec: Math.round(totalTime),
        avgTimePerItem: (totalTime / items.length).toFixed(2),
      },
      'All items processed successfully',
    );
  }

  return registry;
}
