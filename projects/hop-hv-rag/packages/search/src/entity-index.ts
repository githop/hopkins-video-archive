import { entities, entityVariants } from '@hop-hv-rag/db';
import type { Db } from './types.ts';

export interface EntityMatch {
  id: number;
  name: string;
  entityType: string;
  subtype: string | null;
}

export class EntityIndex {
  private terms: Array<{ term: string; entityId: number }> = [];
  private entityById = new Map<number, EntityMatch>();
  private loaded = false;

  async load(db: Db) {
    const entityRows = db
      .select({
        id: entities.id,
        name: entities.name,
        entityType: entities.entityType,
        subtype: entities.subtype,
      })
      .from(entities)
      .all();

    const variantRows = db
      .select({
        entityId: entityVariants.entityId,
        rawText: entityVariants.rawText,
      })
      .from(entityVariants)
      .all();

    const termMap = new Map<string, number>();

    for (const row of entityRows) {
      this.entityById.set(row.id, row);
      termMap.set(row.name, row.id);
    }

    for (const row of variantRows) {
      termMap.set(row.rawText, row.entityId);
    }

    this.terms = Array.from(termMap.entries())
      .map(([term, entityId]) => ({ term, entityId }))
      .sort((a, b) => b.term.length - a.term.length);

    this.loaded = true;
  }

  detect(query: string): EntityMatch[] {
    if (!this.loaded) return [];

    const lowerQuery = query.toLowerCase();
    const detectedIds = new Set<number>();
    const shortAllowList = new Set(['al', 'jo', 'ty']);

    for (const entry of this.terms) {
      if (
        entry.term.length < 3 &&
        !shortAllowList.has(entry.term.toLowerCase())
      ) {
        continue;
      }

      if (lowerQuery.includes(entry.term.toLowerCase())) {
        detectedIds.add(entry.entityId);
      }
    }

    return Array.from(detectedIds)
      .map((id) => this.entityById.get(id))
      .filter((entry): entry is EntityMatch => entry !== undefined);
  }
}
