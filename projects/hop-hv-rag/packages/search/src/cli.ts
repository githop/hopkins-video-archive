import { join } from 'node:path';
import { createDb } from '@hop-hv-rag/db';
import {
  ParticipantService,
  LocationService,
  ActivityService,
  logger,
} from '@hop-hv-rag/core';
import { getGenModel, getEmbedModel, getRerankModel } from '@hop-hv-rag/ai';
import { FamilyArchivist } from './archivist.ts';
import { Spinner } from './spinner.ts';

/**
 * CLI Entry Point for running RAG queries from the command line.
 */
async function main() {
  const query = Bun.argv.slice(2).join(' ');
  if (!query) {
    logger.error('Usage: bun search:rag <your question>');
    process.exit(1);
  }

  // Set up services for CLI usage
  const DATA_DIR = join(import.meta.dir, '../../../data');
  const db = createDb(join(DATA_DIR, 'hv-rag.db'));
  const participantService = new ParticipantService(
    join(DATA_DIR, 'participant-registry.json'),
  );
  const locationService = new LocationService(
    join(DATA_DIR, 'location-registry.json'),
  );
  const activityService = new ActivityService(
    join(DATA_DIR, 'activity-registry.json'),
  );

  const archivist = new FamilyArchivist(
    getGenModel('summarizer'),
    getEmbedModel('embed-small'),
    getRerankModel('rerank'),
    db,
    participantService,
    locationService,
    activityService,
  );
  await archivist.init();

  logger.info('Searching the archive...');

  let reasoningStarted = false;
  const spinner = new Spinner('Thinking');

  for await (const chunk of archivist.query(query)) {
    if (chunk.type === 'reasoning') {
      if (!reasoningStarted) {
        spinner.start();
        reasoningStarted = true;
      }
    } else if (chunk.type === 'result') {
      if (reasoningStarted) {
        spinner.stop();
      }

      console.log('--- Response ---\n');
      console.log(chunk.answer);

      if (chunk.sources.length > 0) {
        // Group sources by used vs unused
        const usedSources = chunk.sources.filter((s) =>
          chunk.usedSourceIds.includes(s.citationId),
        );
        const unusedSources = chunk.sources.filter(
          (s) => !chunk.usedSourceIds.includes(s.citationId),
        );

        if (usedSources.length > 0) {
          console.log('\n--- Cited Sources ---\n');
          for (const s of usedSources) {
            console.log(
              `[${s.citationId}] ${s.video.title} @ ${s.timestamp.formatted}`,
            );
            console.log(`  ${s.sceneTitle}`);
            console.log(
              `  https://drive.google.com/file/d/${s.video.driveId}\n`,
            );
          }
        }

        if (unusedSources.length > 0) {
          console.log('\n--- Additional Context ---\n');
          for (const s of unusedSources) {
            console.log(
              `[${s.citationId}] ${s.video.title} @ ${s.timestamp.formatted}`,
            );
            console.log(`  ${s.sceneTitle}`);
          }
        }
      }
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(err, 'Unexpected error in CLI');
    process.exit(1);
  });
}
