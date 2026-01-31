/**
 * Post-processing validation for participant/location registries.
 * Reports potential issues without modifying data.
 */

import { join } from 'node:path';
import { logger } from '@hop-hv-rag/core';

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

  logger.print('📊 Participant Registry Validation Report');
  logger.print('=========================================');
  logger.print(`Total entries: ${stats.total}`);
  logger.print(`  PERSON: ${stats.person}`);
  logger.print(`  ROLE: ${stats.role}`);
  logger.print(`  DISCARD: ${stats.discard}`);
  logger.print(`  Normalized: ${stats.normalized}`);
  logger.print('');

  if (issues.length > 0) {
    logger.print(issues.join('\n'));
  } else {
    logger.print('✅ No issues found!');
  }

  return { stats, issues };
}

async function validateLocationRegistry() {
  const registryPath = join(DATA_DIR, 'location-registry.json');
  const registry: Registry = await Bun.file(registryPath).json();

  const entries = Object.entries(registry);
  const issues: string[] = [];

  // 1. Check for unknown/indeterminate entries that weren't discarded
  const unknownPatterns = [
    /^unknown/i,
    /^indeterminate/i,
    /^unspecified/i,
    /^an? unspecified/i,
  ];
  const unknownNotDiscarded = entries.filter(
    ([key, val]) =>
      val.category !== 'DISCARD' && unknownPatterns.some((p) => p.test(key)),
  );

  if (unknownNotDiscarded.length > 0) {
    issues.push(
      `⚠️  ${unknownNotDiscarded.length} unknown/indeterminate entries not discarded:`,
    );
    unknownNotDiscarded.slice(0, 10).forEach(([key, val]) => {
      issues.push(`   - "${key}" → ${val.category}`);
    });
    if (unknownNotDiscarded.length > 10) {
      issues.push(`   ... and ${unknownNotDiscarded.length - 10} more`);
    }
  }

  // 2. Check for potential events classified as locations
  const eventPatterns = [
    /baptism/i,
    /wedding/i,
    /funeral/i,
    /birthday/i,
    /party$/i,
    /gathering$/i,
    /ceremony/i,
    /game$/i,
    /event$/i,
  ];
  const potentialEvents = entries.filter(
    ([key, val]) =>
      val.category !== 'DISCARD' && eventPatterns.some((p) => p.test(key)),
  );

  if (potentialEvents.length > 0) {
    issues.push(
      `\n⚠️  ${potentialEvents.length} potential events classified as locations:`,
    );
    potentialEvents.slice(0, 10).forEach(([key, val]) => {
      issues.push(`   - "${key}" → ${val.category} (${val.canonical})`);
    });
    if (potentialEvents.length > 10) {
      issues.push(`   ... and ${potentialEvents.length - 10} more`);
    }
  }

  // 3. Check for potential missed merges (similar canonical names)
  const byBaseName = new Map<string, Set<string>>();
  entries
    .filter(([_, val]) => val.category !== 'DISCARD')
    .forEach(([_, val]) => {
      // Extract base name (first significant word)
      const baseName = val.canonical
        .replace(/^(The|A|An)\s+/i, '')
        .split(/[\s,'-]/)[0]
        .toLowerCase();
      if (baseName.length > 3) {
        if (!byBaseName.has(baseName)) {
          byBaseName.set(baseName, new Set());
        }
        byBaseName.get(baseName)!.add(val.canonical);
      }
    });

  const potentialMerges = Array.from(byBaseName.entries())
    .filter(([_, canonicals]) => canonicals.size > 1)
    .filter(([name, _]) => name.length > 3);

  if (potentialMerges.length > 0) {
    issues.push(`\n⚠️  ${potentialMerges.length} potential merge candidates:`);
    potentialMerges.slice(0, 15).forEach(([baseName, canonicals]) => {
      issues.push(`   - ${baseName}: ${Array.from(canonicals).join(', ')}`);
    });
    if (potentialMerges.length > 15) {
      issues.push(`   ... and ${potentialMerges.length - 15} more`);
    }
  }

  // 4. Check for missing reasoning
  const noReasoning = entries.filter(
    ([_, val]) =>
      !val.reasoning ||
      val.reasoning === 'No reasoning provided' ||
      val.reasoning === 'Processed',
  );

  if (noReasoning.length > 0) {
    issues.push(`\n⚠️  ${noReasoning.length} entries without proper reasoning`);
  }

  // 5. Check for PLACE entries that should be SETTING (generic rooms)
  const genericRoomPatterns = [
    /^a room/i,
    /^a living room$/i,
    /^a kitchen$/i,
    /^a bedroom$/i,
    /^a bathroom$/i,
  ];
  const genericAsPlace = entries.filter(
    ([key, val]) =>
      val.category === 'PLACE' && genericRoomPatterns.some((p) => p.test(key)),
  );

  if (genericAsPlace.length > 0) {
    issues.push(
      `\n⚠️  ${genericAsPlace.length} generic rooms classified as PLACE:`,
    );
    genericAsPlace.slice(0, 10).forEach(([key, val]) => {
      issues.push(`   - "${key}" → ${val.canonical}`);
    });
  }

  // 6. Summary stats
  const stats = {
    total: entries.length,
    place: entries.filter(([_, v]) => v.category === 'PLACE').length,
    setting: entries.filter(([_, v]) => v.category === 'SETTING').length,
    discard: entries.filter(([_, v]) => v.category === 'DISCARD').length,
    normalized: entries.filter(([k, v]) => k !== v.canonical).length,
  };

  logger.print('\n📍 Location Registry Validation Report');
  logger.print('======================================');
  logger.print(`Total entries: ${stats.total}`);
  logger.print(`  PLACE: ${stats.place}`);
  logger.print(`  SETTING: ${stats.setting}`);
  logger.print(`  DISCARD: ${stats.discard}`);
  logger.print(`  Normalized: ${stats.normalized}`);
  logger.print('');

  if (issues.length > 0) {
    logger.print(issues.join('\n'));
  } else {
    logger.print('✅ No issues found!');
  }

  return { stats, issues };
}

async function validateActivityRegistry() {
  const registryPath = join(DATA_DIR, 'activity-registry.json');
  const file = Bun.file(registryPath);

  if (!(await file.exists())) {
    logger.print('\n📍 Activity Registry Validation Report');
    logger.print('======================================');
    logger.print('Registry file not found, skipping validation.');
    return { stats: null, issues: [] };
  }

  const registry: Registry = await file.json();

  const entries = Object.entries(registry);
  const issues: string[] = [];

  // 1. Check for generic verbs that weren't discarded
  const genericVerbs = [
    'playing',
    'talking',
    'walking',
    'sitting',
    'watching',
    'eating',
    'running',
    'doing',
    'having',
    'going',
  ];
  const genericNotDiscarded = entries.filter(
    ([key, val]) =>
      val.category !== 'DISCARD' &&
      genericVerbs.some((v) => key.toLowerCase().includes(v)),
  );

  if (genericNotDiscarded.length > 0) {
    issues.push(
      `⚠️  ${genericNotDiscarded.length} generic verbs not discarded:`,
    );
    genericNotDiscarded.slice(0, 10).forEach(([key, val]) => {
      issues.push(`   - "${key}" → ${val.category}`);
    });
    if (genericNotDiscarded.length > 10) {
      issues.push(`   ... and ${genericNotDiscarded.length - 10} more`);
    }
  }

  // 2. Check for birthday entries that should be MILESTONE
  const birthdayNotMilestone = entries.filter(
    ([key, val]) =>
      key.toLowerCase().includes('birthday') && val.category !== 'MILESTONE',
  );

  if (birthdayNotMilestone.length > 0) {
    issues.push(
      `\n⚠️  ${birthdayNotMilestone.length} birthday entries not MILESTONE:`,
    );
    birthdayNotMilestone.slice(0, 10).forEach(([key, val]) => {
      issues.push(`   - "${key}" → ${val.category}`);
    });
  }

  // 3. Check for holiday names that should be HOLIDAY
  const holidayNames = [
    'christmas',
    'easter',
    'thanksgiving',
    'halloween',
    'fourth of july',
    'new year',
  ];
  const holidayMiscategorized = entries.filter(
    ([key, val]) =>
      holidayNames.some((h) => key.toLowerCase().includes(h)) &&
      val.category !== 'HOLIDAY' &&
      val.category !== 'DISCARD',
  );

  if (holidayMiscategorized.length > 0) {
    issues.push(
      `\n⚠️  ${holidayMiscategorized.length} holidays miscategorized:`,
    );
    holidayMiscategorized.slice(0, 10).forEach(([key, val]) => {
      issues.push(`   - "${key}" → ${val.category}`);
    });
  }

  // 4. Check for potential missed merges
  const byBaseName = new Map<string, Set<string>>();
  entries
    .filter(([_, val]) => val.category !== 'DISCARD')
    .forEach(([_, val]) => {
      const baseName = val.canonical
        .replace(/^(The|A|An)\s+/i, '')
        .split(/[\s,'-]/)[0]
        .toLowerCase();
      if (baseName.length > 3) {
        if (!byBaseName.has(baseName)) {
          byBaseName.set(baseName, new Set());
        }
        byBaseName.get(baseName)!.add(val.canonical);
      }
    });

  const potentialMerges = Array.from(byBaseName.entries())
    .filter(([_, canonicals]) => canonicals.size > 1)
    .filter(([name, _]) => name.length > 3);

  if (potentialMerges.length > 0) {
    issues.push(`\n⚠️  ${potentialMerges.length} potential merge candidates:`);
    potentialMerges.slice(0, 15).forEach(([baseName, canonicals]) => {
      issues.push(`   - ${baseName}: ${Array.from(canonicals).join(', ')}`);
    });
    if (potentialMerges.length > 15) {
      issues.push(`   ... and ${potentialMerges.length - 15} more`);
    }
  }

  // 5. Check for missing reasoning
  const noReasoning = entries.filter(
    ([_, val]) =>
      !val.reasoning ||
      val.reasoning === 'No reasoning provided' ||
      val.reasoning === 'Processed',
  );

  if (noReasoning.length > 0) {
    issues.push(`\n⚠️  ${noReasoning.length} entries without proper reasoning`);
  }

  // 6. Summary stats
  const stats = {
    total: entries.length,
    sport: entries.filter(([_, v]) => v.category === 'SPORT').length,
    recreation: entries.filter(([_, v]) => v.category === 'RECREATION').length,
    holiday: entries.filter(([_, v]) => v.category === 'HOLIDAY').length,
    milestone: entries.filter(([_, v]) => v.category === 'MILESTONE').length,
    discard: entries.filter(([_, v]) => v.category === 'DISCARD').length,
    normalized: entries.filter(([k, v]) => k !== v.canonical).length,
  };

  logger.print('\n🎯 Activity Registry Validation Report');
  logger.print('======================================');
  logger.print(`Total entries: ${stats.total}`);
  logger.print(`  SPORT: ${stats.sport}`);
  logger.print(`  RECREATION: ${stats.recreation}`);
  logger.print(`  HOLIDAY: ${stats.holiday}`);
  logger.print(`  MILESTONE: ${stats.milestone}`);
  logger.print(`  DISCARD: ${stats.discard}`);
  logger.print(`  Normalized: ${stats.normalized}`);
  logger.print('');

  if (issues.length > 0) {
    logger.print(issues.join('\n'));
  } else {
    logger.print('✅ No issues found!');
  }

  return { stats, issues };
}

// Run validation
async function main() {
  await validateParticipantRegistry();
  await validateLocationRegistry();
  await validateActivityRegistry();
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Validation failed');
  process.exit(1);
});
