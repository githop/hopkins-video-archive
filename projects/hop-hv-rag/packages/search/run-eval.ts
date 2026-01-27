import { FamilyArchivist } from './src/rag-query.ts';
import { getGenModel, getEmbedModel, getRerankModel } from '@hop-hv-rag/ai';

const EVAL_PROMPTS_PATH = `${import.meta.dir}/eval-prompts.json`;
const OUTPUT_PATH = `${import.meta.dir}/../../eval-results.md`;
const DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runEval() {
  const promptsFile = Bun.file(EVAL_PROMPTS_PATH);
  if (!(await promptsFile.exists())) {
    console.error(`Eval prompts not found at: ${EVAL_PROMPTS_PATH}`);
    process.exit(1);
  }

  const prompts = await promptsFile.json();
  let markdown = `# RAG Evaluation Results\n\nGenerated on: ${new Date().toLocaleString()}\n\n`;

  // Initialize the archivist once
  const archivist = new FamilyArchivist(
    getGenModel('summarizer'),
    getEmbedModel('embed-small'),
    getRerankModel('rerank'),
  );
  await archivist.init();

  for (const item of prompts) {
    console.log(`\n--- [${item.id}] Starting: ${item.prompt} ---`);

    try {
      const result = await archivist.ask(item.prompt);

      markdown += `## ${item.id}: ${item.category}\n`;
      markdown += `**Prompt:** ${item.prompt}\n\n`;
      markdown += `**Expected:** ${item.expected}\n\n`;
      markdown += `### Result:\n${result}\n\n`;
      markdown += `---\n\n`;
    } catch (error: any) {
      console.error(`Error running [${item.id}]:`, error);
      markdown += `## ${item.id}: ${item.category}\n**Error:** ${error.message}\n\n---\n\n`;
    }

    console.log(`[${item.id}] Finished.`);

    if (prompts.indexOf(item) < prompts.length - 1) {
      console.log(`Waiting ${DELAY_MS}ms for VRAM cleanup...`);
      await sleep(DELAY_MS);
    }
  }

  await Bun.write(OUTPUT_PATH, markdown);
  console.log(`\nEvaluation complete! Results saved to: ${OUTPUT_PATH}`);
}

runEval().catch(console.error);
