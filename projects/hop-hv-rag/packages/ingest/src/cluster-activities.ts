import { logger } from '@hop-hv-rag/core';
import { runClustering } from './cluster-engine.ts';
import {
  ACTIVITY_CLUSTERING_PROMPT,
  ActivityClusteringSchema,
} from './prompts.ts';

const DATA_DIR = `${import.meta.dir}/../../../data`;

async function main() {
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
    model: 'summarizer-bulk-14b',
    systemPrompt: ACTIVITY_CLUSTERING_PROMPT,
  });
}

main().catch((err) => {
  logger.error(err, 'Error running activity clustering');
});
