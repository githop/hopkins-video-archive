import { join } from 'node:path';

export interface ParticipantRegistryEntry {
  canonical: string;
  category: 'PERSON' | 'ROLE' | 'DISCARD';
  reasoning?: string;
}

export class ParticipantService {
  private registry: Record<string, ParticipantRegistryEntry> = {};

  constructor(private registryPath?: string) {
    if (!this.registryPath) {
      // Default to the project root data directory
      // This assumes the script is running from somewhere that can resolve this path
      this.registryPath = join(process.cwd(), 'data/participant-registry.json');
    }
  }

  /**
   * Loads the participant registry from the JSON file.
   */
  async load() {
    const file = Bun.file(this.registryPath!);
    if (await file.exists()) {
      this.registry = await file.json();
    } else {
      console.warn(`Participant registry not found at ${this.registryPath}`);
    }
  }

  /**
   * Resolves a raw participant string to its canonical entity.
   */
  resolve(rawName: string): ParticipantRegistryEntry {
    const entry = this.registry[rawName];
    if (entry) {
      return entry;
    }

    // Fallback if the name is not in the registry
    return {
      canonical: rawName,
      category: 'PERSON',
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
   * Detects known participants in a query string.
   * Returns a list of canonical names.
   */
  detectParticipants(query: string): string[] {
    const lowercaseQuery = query.toLowerCase();
    const allNames = this.getAllCanonicalNames();

    // Sort by length descending to match longest entities first (e.g., "Uncle Matt" before "Matt")
    const sortedNames = allNames.sort((a, b) => b.length - a.length);
    const detected = new Set<string>();

    for (const name of sortedNames) {
      // Ignore very short names to reduce noise
      if (name.length < 3 && !['Al', 'Jo', 'Ty'].includes(name)) {
        continue;
      }

      if (lowercaseQuery.includes(name.toLowerCase())) {
        detected.add(name);
      }
    }

    return Array.from(detected);
  }
}
