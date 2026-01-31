import { logger } from '@hop-hv-rag/core';
import { runClustering } from './cluster-engine.ts';
import {
  PARTICIPANT_CLUSTERING_PROMPT,
  ParticipantClusteringSchema,
} from './prompts.ts';

const DATA_DIR = `${import.meta.dir}/../../../data`;

async function main() {
  await runClustering({
    inputPath: `${DATA_DIR}/unique-participants.json`,
    outputPath: `${DATA_DIR}/participant-registry.json`,
    dbPath: `${DATA_DIR}/hv-rag.db`,
    dbQuery:
      'SELECT participants FROM videos UNION SELECT participants FROM scenes',
    dbColumn: 'participants',
    categoryFallback: 'PERSON',
    validCategories: ['PERSON', 'ROLE', 'DISCARD'],
    schema: ParticipantClusteringSchema,
    model: 'summarizer-bulk-14b',
    systemPrompt: PARTICIPANT_CLUSTERING_PROMPT,
  });
}

main().catch((err) => {
  logger.error(err, 'Error running participant clustering');
});
