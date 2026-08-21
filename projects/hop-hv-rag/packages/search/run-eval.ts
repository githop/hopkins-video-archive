import { logger } from '@hop-hv-rag/core';

const EVAL_PROMPTS_PATH = `${import.meta.dir}/eval-prompts.json`;
const DELAY_MS = 2000;
const CONCURRENCY_LIMIT = 3;

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3200/api/query';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function collectQueryResult(prompt: string): Promise<string> {
  const response = await fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: prompt }),
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
  }
  if (!response.body) throw new Error('No response body received');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalAnswer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);
      
      if (chunk.type === 'result') {
        finalAnswer = chunk.answer;
      }
    }
  }

  return finalAnswer;
}

/**
 * Helper function to run an async operation over an array with a concurrency limit.
 */
async function asyncMapConcurrent<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await mapper(items[index]);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  
  return results;
}

async function runEval() {
  const promptsFile = Bun.file(EVAL_PROMPTS_PATH);
  if (!(await promptsFile.exists())) {
    logger.error(`Eval prompts not found at: ${EVAL_PROMPTS_PATH}`);
    process.exit(1);
  }

  const prompts = await promptsFile.json();

  logger.print(`Evaluating against server at: ${SERVER_URL}`);
  logger.print(`Running with concurrency limit: ${CONCURRENCY_LIMIT}`);

  const processPrompt = async (item: any) => {
    logger.print(`--- [${item.id}] Starting: ${item.prompt} ---`);
    
    try {
      const result = await collectQueryResult(item.prompt);
      
      logger.print(`[${item.id}] Finished successfully.`);
      logger.print(`[${item.id}] Result:\n${result}\n`);
    } catch (error: unknown) {
      logger.error({ error }, `Error running [${item.id}]`);
    }

    // Still add a short delay to ensure VRAM or API rate limits aren't severely hammered
    await sleep(DELAY_MS); 
  };

  // Run the batch
  await asyncMapConcurrent(prompts, CONCURRENCY_LIMIT, processPrompt);

  logger.print(`\nEvaluation complete!`);
}

runEval().catch((err) => {
  logger.error(err, 'Unhandled error in runEval');
});
