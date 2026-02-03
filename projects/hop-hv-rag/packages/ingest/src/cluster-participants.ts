import { logger } from '@hop-hv-rag/core';
import { parseArgs } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import {
  createDb,
  entities,
  entityVariants,
  chunkEntityMentions,
} from '@hop-hv-rag/db';
import { runClustering } from './cluster-engine.ts';
import {
  PARTICIPANT_CLUSTERING_PROMPT,
  ParticipantClusteringSchema,
} from './prompts.ts';
import { GenModelFlagOption, parseGenModelFlag } from './cli-flags.ts';

const DATA_DIR = `${import.meta.dir}/../../../data`;
const DB_PATH = `${DATA_DIR}/hv-rag.db`;

const BatchSizeFlagOption = { type: 'string' as const };
const ConcurrencyFlagOption = { type: 'string' as const };

function parseBatchSizeFlag(value: unknown): number {
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) || parsed < 1 ? 100 : parsed;
}

function parseConcurrencyFlag(value: unknown): number {
  const parsed = parseInt(String(value), 10);
  return isNaN(parsed) || parsed < 1 ? 16 : parsed;
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      'gen-model': GenModelFlagOption,
      'batch-size': BatchSizeFlagOption,
      concurrency: ConcurrencyFlagOption,
      verbose: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const registry = await runClustering({
    dbPath: DB_PATH,
    dbQuery: `
      SELECT
        raw_text AS value,
        GROUP_CONCAT(SUBSTR(evidence_text, 1, 120), ' | ') AS context
      FROM chunk_entity_mentions
      WHERE entity_type IN ('PERSON', 'ROLE')
        AND entity_id IS NULL
      GROUP BY raw_text
    `,
    dbValueColumn: 'value',
    dbContextColumn: 'context',
    categoryFallback: 'PERSON',
    validCategories: ['PERSON', 'ROLE', 'DISCARD'],
    schema: ParticipantClusteringSchema,
    model: parseGenModelFlag(values['gen-model']),
    systemPrompt: PARTICIPANT_CLUSTERING_PROMPT,
    batchSize: parseBatchSizeFlag(values['batch-size']),
    concurrency: parseConcurrencyFlag(values['concurrency']),
    verbose: Boolean(values.verbose),
    tuiHeader: 'Participant Clustering',
  });

  const db = createDb(DB_PATH);

  const normalizeKey = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  let applied = 0;

  for (const [rawText, entry] of Object.entries(registry)) {
    if (entry.category === 'DISCARD') continue;
    const canonical = entry.canonical.trim();
    if (!canonical) continue;

    const [entity] = await db
      .insert(entities)
      .values({
        name: canonical,
        entityType: entry.category,
        subtype: null,
        normalizedKey: normalizeKey(canonical),
      })
      .onConflictDoUpdate({
        target: entities.name,
        set: {
          entityType: entry.category,
          subtype: null,
          normalizedKey: normalizeKey(canonical),
        },
      })
      .returning();

    const normalizedRaw = normalizeKey(rawText);

    await db
      .insert(entityVariants)
      .values({
        entityId: entity.id,
        rawText,
        normalizedRaw,
        source: 'mention',
      })
      .onConflictDoUpdate({
        target: entityVariants.rawText,
        set: {
          entityId: entity.id,
          normalizedRaw,
          source: 'mention',
        },
      });

    await db
      .update(chunkEntityMentions)
      .set({ entityId: entity.id })
      .where(
        and(
          eq(chunkEntityMentions.rawText, rawText),
          inArray(chunkEntityMentions.entityType, ['PERSON', 'ROLE']),
        ),
      );

    applied++;
  }

  logger.info({ applied }, 'Applied participant canonicalization');
}

main().catch((err) => {
  logger.error(err, 'Error running participant clustering');
});
