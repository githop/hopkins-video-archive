import { logger } from '@hop-hv-rag/core';
import { parseArgs } from 'node:util';
import { runClustering } from './cluster-engine.ts';
import {
  ACTIVITY_CLUSTERING_PROMPT,
  ActivityClusteringSchema,
} from './prompts.ts';
import { GenModelFlagOption, parseGenModelFlag } from './cli-flags.ts';

const DATA_DIR = `${import.meta.dir}/../../../data`;

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      'gen-model': GenModelFlagOption,
    },
    strict: true,
  });

  await runClustering({
    inputPath: `${DATA_DIR}/unique-activities.json`,
    outputPath: `${DATA_DIR}/activity-registry.json`,
    dbPath: `${DATA_DIR}/hv-rag.db`,
    dbQuery:
      'SELECT activities FROM videos UNION SELECT activities FROM scenes',
    dbColumn: 'activities',
    categoryFallback: 'RECREATION',
    validCategories: ['SPORT', 'RECREATION', 'HOLIDAY', 'MILESTONE', 'DISCARD'],
    schema: ActivityClusteringSchema,
    model: parseGenModelFlag(values['gen-model']),
    systemPrompt: ACTIVITY_CLUSTERING_PROMPT,
  });
}

main().catch((err) => {
  logger.error(err, 'Error running activity clustering');
});
