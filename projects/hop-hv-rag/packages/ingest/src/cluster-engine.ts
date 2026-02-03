import { getGenModel, type GenerationModelName } from '@hop-hv-rag/ai';
import { generateText, Output, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import { createDb } from '@hop-hv-rag/db';
import { sql } from 'drizzle-orm';
import { logger } from '@hop-hv-rag/core';

interface ClassificationEntry {
  canonical: string;
  category: string;
  reasoning: string;
}

interface ItemWithContext {
  value: string;
  context?: string;
}

export interface ClusteringConfig<
  T extends z.ZodObject<{
    classifications: z.ZodArray<z.ZodObject<z.ZodRawShape>>;
  }>,
> {
  inputPath: string;
  outputPath: string;
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
}

export async function runClustering<
  T extends z.ZodObject<{
    classifications: z.ZodArray<z.ZodObject<z.ZodRawShape>>;
  }>,
>(config: ClusteringConfig<T>): Promise<Record<string, ClassificationEntry>> {
  const {
    inputPath,
    outputPath,
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
  } = config;

  const db = createDb(dbPath);

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

  // 1. Ensure unique items file exists
  if (!(await Bun.file(inputPath).exists())) {
    logger.info({ inputPath }, 'Generating unique items from database');
    const { items } = buildItemsFromDb();
    await Bun.write(inputPath, JSON.stringify(items, null, 2));
  }

  // 2. Load data and existing registry
  const itemsFile = Bun.file(inputPath);
  const items = (await itemsFile.json()) as string[];
  const { contextByItem } = buildItemsFromDb();
  logger.info({ count: items.length }, 'Loaded unique items');

  let registry: Record<string, ClassificationEntry> = {};
  const registryFile = Bun.file(outputPath);
  if (await registryFile.exists()) {
    try {
      registry = await registryFile.json();
      logger.info(
        { existingCount: Object.keys(registry).length },
        'Resuming from existing entries',
      );
    } catch (e) {
      logger.warn('Could not parse existing registry, starting fresh');
    }
  }

  // 3. Process batches with concurrency
  const model = getGenModel(modelName);
  logger.info(
    { model: modelName, batchSize, concurrency },
    'Starting clustering',
  );
  const activePromises = new Set<Promise<void>>();
  const totalBatches = Math.ceil(items.length / batchSize);
  let completedBatches = 0;
  let processedCount = Object.keys(registry).length;
  const startTime = Date.now();

  // Calculate already completed batches for resume logging
  let skipCount = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const remainingInBatch = batch.filter((p) => !registry[p]);
    if (remainingInBatch.length === 0) skipCount++;
  }
  if (skipCount > 0) {
    logger.info(
      { skipCount, totalBatches },
      'Skipping already processed batches',
    );
  }

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const remainingInBatch = batch.filter((p) => !registry[p]);
    const batchIdx = Math.floor(i / batchSize);

    if (remainingInBatch.length === 0) {
      logger.debug(
        { batchIdx: batchIdx + 1 },
        'Batch already complete, skipping',
      );
      completedBatches++;
      continue;
    }

    // Log progress every 10% or every 5 batches
    if (
      completedBatches > 0 &&
      (completedBatches % Math.max(1, Math.floor(totalBatches / 10)) === 0 ||
        completedBatches % 5 === 0)
    ) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completedBatches / elapsed;
      const remaining = (totalBatches - completedBatches) / rate;
      logger.info(
        {
          completedBatches,
          totalBatches,
          processedItems: processedCount,
          totalItems: items.length,
          percent: Math.round((completedBatches / totalBatches) * 100),
          elapsedSec: Math.round(elapsed),
          etaSec: Math.round(remaining),
        },
        'Progress update',
      );
    }

    const promise = (async (
      currentBatch: string[],
      currentBatchIdx: number,
    ) => {
      const batchStartTime = Date.now();
      const batchWithContext: ItemWithContext[] = currentBatch.map((item) => ({
        value: item,
        context: contextByItem.get(item),
      }));
      const batchLines = batchWithContext.map((entry) =>
        entry.context ? `${entry.value} || ${entry.context}` : entry.value,
      );
      const itemPreview =
        currentBatch.slice(0, 3).join(', ') +
        (currentBatch.length > 3 ? ` (+${currentBatch.length - 3} more)` : '');
      logger.info(
        {
          batchIdx: currentBatchIdx + 1,
          totalBatches,
          itemCount: currentBatch.length,
          items: itemPreview,
        },
        'Starting batch',
      );

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
        const batchEndTime = Date.now();
        const batchDuration = (batchEndTime - batchStartTime) / 1000;

        currentBatch.forEach((original, idx) => {
          // Find the classification that matches this item.
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

        await Bun.write(outputPath, JSON.stringify(registry, null, 2));
        processedCount += currentBatch.length;

        logger.info(
          {
            batchIdx: currentBatchIdx + 1,
            itemCount: currentBatch.length,
            durationSec: batchDuration.toFixed(1),
            classificationsReturned: classifications.length,
          },
          'Batch completed',
        );
      } catch (error) {
        const batchEndTime = Date.now();
        const batchDuration = (batchEndTime - batchStartTime) / 1000;

        if (NoObjectGeneratedError.isInstance(error)) {
          logger.error(
            {
              batchIdx: currentBatchIdx + 1,
              itemCount: currentBatch.length,
              items: currentBatch,
              durationSec: batchDuration.toFixed(1),
              text: error.text,
              response: error.response,
            },
            'No object generated - model did not return valid JSON',
          );
        } else {
          logger.error(
            {
              batchIdx: currentBatchIdx + 1,
              itemCount: currentBatch.length,
              items: currentBatch,
              durationSec: batchDuration.toFixed(1),
              error: error instanceof Error ? error.message : String(error),
              errorType: error?.constructor?.name,
            },
            'Error processing batch',
          );
        }
      }
    })(remainingInBatch, batchIdx);

    activePromises.add(promise);
    promise.finally(() => {
      activePromises.delete(promise);
      completedBatches++;
    });

    if (activePromises.size >= concurrency) {
      logger.debug(
        { active: activePromises.size, concurrency },
        'Waiting for concurrency slot',
      );
      await Promise.race(activePromises);
    }
  }

  logger.info(
    { activeBatches: activePromises.size },
    'Waiting for remaining batches to complete',
  );
  const totalTime = (Date.now() - startTime) / 1000;
  logger.info(
    {
      totalTimeSec: Math.round(totalTime),
      completedBatches,
      totalBatches,
      totalProcessed: Object.keys(registry).length,
      targetItems: items.length,
    },
    'All batches completed',
  );

  // 4. Final summary
  const finalMissing = items.filter((p) => !registry[p]);
  const successCount = items.length - finalMissing.length;
  const successRate = Math.round((successCount / items.length) * 100);

  if (finalMissing.length > 0) {
    logger.error(
      {
        missingCount: finalMissing.length,
        successCount,
        totalItems: items.length,
        successRate: `${successRate}%`,
        missingItems: finalMissing.slice(0, 20), // Show first 20 missing
      },
      'Process complete but some items are missing',
    );
  } else {
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
