/**
 * Post-processing validation for participant/location registries.
 * Reports potential issues without modifying data.
 */

import { join } from 'node:path';

const DATA_DIR = join(import.meta.dir, '../../../data');

interface RegistryEntry {
  canonical: string;
  category: string;
  reasoning: string;
}

type Registry = Record<string, RegistryEntry>;

async function validateParticipantRegistry() {
  const registryPath = join(DATA_DIR, 'participant-registry.json');
  const registry: Registry = await Bun.file(registryPath).json();

  const entries = Object.entries(registry);
  const issues: string[] = [];

  // 1. Check for generic entries that weren't discarded
  const genericPrefixes = [
    'A ',
    'An ',
    'Another ',
    'Some ',
    'The ',
    'Unidentified',
  ];
  const genericNotDiscarded = entries.filter(
    ([key, val]) =>
      val.category !== 'DISCARD' &&
      genericPrefixes.some((p) => key.startsWith(p)),
  );

  if (genericNotDiscarded.length > 0) {
    issues.push(
      `⚠️  ${genericNotDiscarded.length} generic entries not discarded:`,
    );
    genericNotDiscarded.slice(0, 10).forEach(([key, val]) => {
      issues.push(`   - "${key}" → ${val.category}`);
    });
    if (genericNotDiscarded.length > 10) {
      issues.push(`   ... and ${genericNotDiscarded.length - 10} more`);
    }
  }

  // 2. Check for potential missed merges (same first name, different canonical)
  const byFirstName = new Map<string, Set<string>>();
  entries
    .filter(([_, val]) => val.category === 'PERSON')
    .forEach(([_, val]) => {
      const firstName = val.canonical.split(' ')[0].toLowerCase();
      if (!byFirstName.has(firstName)) {
        byFirstName.set(firstName, new Set());
      }
      byFirstName.get(firstName)!.add(val.canonical);
    });

  const potentialMerges = Array.from(byFirstName.entries())
    .filter(([_, canonicals]) => canonicals.size > 1)
    .filter(([name, _]) => name.length > 2); // Skip short names like "Al"

  if (potentialMerges.length > 0) {
    issues.push(`\n⚠️  ${potentialMerges.length} potential merge candidates:`);
    potentialMerges.slice(0, 10).forEach(([firstName, canonicals]) => {
      issues.push(`   - ${firstName}: ${Array.from(canonicals).join(', ')}`);
    });
  }

  // 3. Check for missing reasoning
  const noReasoning = entries.filter(
    ([_, val]) =>
      !val.reasoning ||
      val.reasoning === 'No reasoning provided' ||
      val.reasoning === 'Processed',
  );

  if (noReasoning.length > 0) {
    issues.push(`\n⚠️  ${noReasoning.length} entries without proper reasoning`);
  }

  // 4. Summary stats
  const stats = {
    total: entries.length,
    person: entries.filter(([_, v]) => v.category === 'PERSON').length,
    role: entries.filter(([_, v]) => v.category === 'ROLE').length,
    discard: entries.filter(([_, v]) => v.category === 'DISCARD').length,
    normalized: entries.filter(([k, v]) => k !== v.canonical).length,
  };

  console.log('📊 Participant Registry Validation Report');
  console.log('=========================================');
  console.log(`Total entries: ${stats.total}`);
  console.log(`  PERSON: ${stats.person}`);
  console.log(`  ROLE: ${stats.role}`);
  console.log(`  DISCARD: ${stats.discard}`);
  console.log(`  Normalized: ${stats.normalized}`);
  console.log('');

  if (issues.length > 0) {
    console.log(issues.join('\n'));
  } else {
    console.log('✅ No issues found!');
  }

  return { stats, issues };
}

// Run validation
validateParticipantRegistry().catch(console.error);
