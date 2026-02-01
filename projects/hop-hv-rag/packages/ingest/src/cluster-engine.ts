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

export interface ClusteringConfig<
  T extends z.ZodObject<{
    classifications: z.ZodArray<z.ZodObject<z.ZodRawShape>>;
  }>,
> {
  inputPath: string;
  outputPath: string;
  dbPath: string;
  dbQuery: string;
  dbColumn: string;
  systemPrompt: string;
  schema: T;
  batchSize?: number;
  concurrency?: number;
  categoryFallback: string;
  validCategories: string[];
  model?: GenerationModelName;
}

export async function runClustering<
  T extends z.ZodObject<{
    classifications: z.ZodArray<z.ZodObject<z.ZodRawShape>>;
  }>,
>(config: ClusteringConfig<T>) {
  const {
    inputPath,
    outputPath,
    dbPath,
    dbQuery,
    dbColumn,
    systemPrompt,
    schema,
    batchSize = 100,
    concurrency = 16,
    categoryFallback,
    validCategories,
    model: modelName,
  } = config;

  const db = createDb(dbPath);

  // 1. Ensure unique items file exists
  if (!(await Bun.file(inputPath).exists())) {
    logger.info({ inputPath }, 'Generating unique items from database');
    const results = db.all<Record<string, string>>(sql.raw(dbQuery));
    const all = new Set<string>();

    results.forEach((r) => {
      try {
        const parsed = JSON.parse(r[dbColumn] || '[]');
        if (Array.isArray(parsed))
          parsed.forEach((item: string) => all.add(item));
      } catch (e) {
        if (r[dbColumn]) all.add(r[dbColumn]);
      }
    });

    await Bun.write(inputPath, JSON.stringify(Array.from(all).sort(), null, 2));
  }

  // 2. Load data and existing registry
  const itemsFile = Bun.file(inputPath);
  const items = (await itemsFile.json()) as string[];
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
  logger.info({ model: modelName }, 'Using model');
  const activePromises = new Set<Promise<void>>();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const remainingInBatch = batch.filter((p) => !registry[p]);

    if (remainingInBatch.length === 0) continue;

    const promise = (async (currentBatch: string[], batchIdx: number) => {
      logger.info(
        { batchIdx: batchIdx + 1, batchSize: currentBatch.length },
        'Processing batch',
      );
      try {
        const { output: classificationsOutput } = await generateText({
          model,
          system: systemPrompt,
          prompt: `Items to classify (one per line):\n${currentBatch.join('\n')}`,
          output: Output.object({
            schema,
          }),
        });

        const classifications = classificationsOutput.classifications;

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
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) {
          logger.error(
            {
              batchIdx: batchIdx + 1,
              text: error.text,
              response: error.response,
            },
            'No object generated - model did not return valid JSON',
          );
        } else {
          logger.error(
            { batchIdx: batchIdx + 1, error },
            'Error processing batch',
          );
        }
      }
    })(remainingInBatch, i / batchSize);

    activePromises.add(promise);
    promise.finally(() => activePromises.delete(promise));

    if (activePromises.size >= concurrency) {
      await Promise.race(activePromises);
    }
  }

  await Promise.all(activePromises);

  // 4. Final summary
  const finalMissing = items.filter((p) => !registry[p]);
  if (finalMissing.length > 0) {
    logger.error(
      { missingCount: finalMissing.length },
      'Process complete but some items are missing',
    );
  } else {
    logger.info(
      { totalProcessed: items.length },
      'All items processed successfully',
    );
  }
}
