import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createDb } from '@hop-hv-rag/db';
import {
  ParticipantService,
  LocationService,
  ActivityService,
  logger,
} from '@hop-hv-rag/core';
import { FamilyArchivist } from './src/archivist';
import {
  getGenModel,
  getEmbedModel,
  getRerankModel,
  resolveConfig,
  logModelConfig,
  parseArgsModelOptions,
  parseCliToModelConfig,
} from '@hop-hv-rag/ai';

const EVAL_PROMPTS_PATH = `${import.meta.dir}/eval-prompts.json`;
const OUTPUT_PATH = `${import.meta.dir}/../../eval-results.md`;
const DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse CLI arguments for model selection
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: parseArgsModelOptions,
  strict: false,
});

/**
 * Consume the query async generator and extract the final answer.
 */
async function collectQueryResult(
  archivist: FamilyArchivist,
  prompt: string,
): Promise<string> {
  let answer = '';
  for await (const chunk of archivist.query(prompt)) {
    if (chunk.type === 'result') {
      answer = chunk.answer;
    }
  }
  return answer;
}

async function runEval() {
  const promptsFile = Bun.file(EVAL_PROMPTS_PATH);
  if (!(await promptsFile.exists())) {
    logger.error(`Eval prompts not found at: ${EVAL_PROMPTS_PATH}`);
    process.exit(1);
  }

  const prompts = await promptsFile.json();
  let markdown = `# RAG Evaluation Results\n\nGenerated on: ${new Date().toLocaleString()}\n\n`;

  // Resolve model configuration (Zod validates CLI args)
  const modelConfig = resolveConfig(parseCliToModelConfig(values));
  logModelConfig(modelConfig);

  // Set up services
  const DATA_DIR = join(import.meta.dir, '../../data');
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

  // Initialize the archivist once
  const archivist = new FamilyArchivist(
    getGenModel(modelConfig.generation),
    getEmbedModel(modelConfig.embedding),
    getRerankModel(modelConfig.reranking),
    db,
    participantService,
    locationService,
    activityService,
  );
  await archivist.init();

  for (const item of prompts) {
    logger.print(`\n--- [${item.id}] Starting: ${item.prompt} ---`);

    try {
      const result = await collectQueryResult(archivist, item.prompt);

      markdown += `## ${item.id}: ${item.category}\n`;
      markdown += `**Prompt:** ${item.prompt}\n\n`;
      markdown += `**Expected:** ${item.expected}\n\n`;
      markdown += `### Result:\n${result}\n\n`;
      markdown += `---\n\n`;
    } catch (error: unknown) {
      logger.error({ error }, `Error running [${item.id}]`);
      const message = error instanceof Error ? error.message : 'Unknown error';
      markdown += `## ${item.id}: ${item.category}\n**Error:** ${message}\n\n---\n\n`;
    }

    logger.print(`[${item.id}] Finished.`);

    if (prompts.indexOf(item) < prompts.length - 1) {
      logger.print(`Waiting ${DELAY_MS}ms for VRAM cleanup...`);
      await sleep(DELAY_MS);
    }
  }

  await Bun.write(OUTPUT_PATH, markdown);
  logger.print(`\nEvaluation complete! Results saved to: ${OUTPUT_PATH}`);
}

runEval().catch((err) => {
  logger.error(err, 'Unhandled error in runEval');
});
