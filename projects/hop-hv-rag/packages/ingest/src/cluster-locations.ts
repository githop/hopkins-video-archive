import { logger } from '@hop-hv-rag/core';
import { parseArgs } from 'node:util';
import { runClustering } from './cluster-engine.ts';
import {
  LOCATION_CLUSTERING_PROMPT,
  LocationClusteringSchema,
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
    inputPath: `${DATA_DIR}/unique-locations.json`,
    outputPath: `${DATA_DIR}/location-registry.json`,
    dbPath: `${DATA_DIR}/hv-rag.db`,
    dbQuery: 'SELECT locations FROM videos UNION SELECT locations FROM scenes',
    dbColumn: 'locations',
    categoryFallback: 'SETTING',
    validCategories: ['PLACE', 'SETTING', 'DISCARD'],
    schema: LocationClusteringSchema,
    model: parseGenModelFlag(values['gen-model']),
    systemPrompt: LOCATION_CLUSTERING_PROMPT,
  });
}

main().catch((err) => {
  logger.error(err, 'Error running location clustering');
});
