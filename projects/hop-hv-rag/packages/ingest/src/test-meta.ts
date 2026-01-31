import { parseFilename, logger } from '@hop-hv-rag/core';

const testFiles = [
  '1986-1987-2.json',
  '2000-11Piano recital.json',
  'AlaskaScratch2.json',
  '1996-97-98-3.json',
  '2005-2006-13.json',
  '1987-1988-3.json',
  '1993-1994-1.json',
  '2003-2Tbdbitl.json',
  '1999SanFrancisco.json',
];

logger.print('Testing Metadata Parser:\n');

testFiles.forEach((file) => {
  const meta = parseFilename(file);
  logger.print(`File: ${file}`);
  logger.print(`  Title:      "${meta.title}"`);
  logger.print(`  Year:       ${meta.year}`);
  logger.print(`  RecordedAt: ${meta.recordedAt}`);
  logger.print('-'.repeat(30));
});
