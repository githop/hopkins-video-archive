import { parseFilename } from '@hop-hv-rag/core';

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

console.log('Testing Metadata Parser:\n');

testFiles.forEach((file) => {
  const meta = parseFilename(file);
  console.log(`File: ${file}`);
  console.log(`  Title:      "${meta.title}"`);
  console.log(`  Year:       ${meta.year}`);
  console.log(`  RecordedAt: ${meta.recordedAt}`);
  console.log('-'.repeat(30));
});
