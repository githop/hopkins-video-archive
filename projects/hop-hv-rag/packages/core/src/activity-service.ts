import { join } from 'node:path';

export type ActivityCategory =
  | 'SPORT'
  | 'RECREATION'
  | 'HOLIDAY'
  | 'MILESTONE'
  | 'DISCARD';

export interface ActivityRegistryEntry {
  canonical: string;
  category: ActivityCategory;
  reasoning?: string;
}

export class ActivityService {
  private registry: Record<string, ActivityRegistryEntry> = {};

  constructor(private registryPath?: string) {
    if (!this.registryPath) {
      this.registryPath = join(process.cwd(), 'data/activity-registry.json');
    }
  }

  /**
   * Loads the activity registry from the JSON file.
   */
  async load() {
    const file = Bun.file(this.registryPath!);
    if (await file.exists()) {
      this.registry = await file.json();
    } else {
      console.warn(`Activity registry not found at ${this.registryPath}`);
    }
  }

  /**
   * Resolves a raw activity string to its canonical entity.
   */
  resolve(rawName: string): ActivityRegistryEntry {
    const entry = this.registry[rawName];
    if (entry) {
      return entry;
    }

    // Fallback if the name is not in the registry
    return {
      canonical: rawName,
      category: 'RECREATION',
      reasoning: 'Automatic fallback (not in registry)',
    };
  }

  /**
   * Converts a list of raw names into a unique list of canonical names,
   * filtering out items marked as DISCARD.
   */
  getCanonicalNames(rawNames: string[]): string[] {
    const canonicals = new Set<string>();
    for (const name of rawNames) {
      const resolved = this.resolve(name);
      if (resolved.category !== 'DISCARD') {
        canonicals.add(resolved.canonical);
      }
    }
    return Array.from(canonicals);
  }

  /**
   * Returns all known unique canonical names in the registry.
   */
  getAllCanonicalNames(): string[] {
    const all = new Set<string>();
    for (const entry of Object.values(this.registry)) {
      if (entry.category !== 'DISCARD') {
        all.add(entry.canonical);
      }
    }
    return Array.from(all).sort();
  }

  /**
   * Detects known activities in a query string.
   * Returns a list of canonical names.
   */
  detectActivities(query: string): string[] {
    const lowercaseQuery = query.toLowerCase();
    const allNames = this.getAllCanonicalNames();

    // Sort by length descending to match longest entities first
    const sortedNames = allNames.sort((a, b) => b.length - a.length);
    const detected = new Set<string>();

    for (const name of sortedNames) {
      // Ignore very short names to reduce noise
      if (name.length < 4) {
        continue;
      }

      if (lowercaseQuery.includes(name.toLowerCase())) {
        detected.add(name);
      }
    }

    return Array.from(detected);
  }
}
