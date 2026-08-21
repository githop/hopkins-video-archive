import { entities, entityVariants } from '@hop-hv-rag/db';
import type { Db } from './db-types.ts';

export interface EntityMatch {
  id: number;
  name: string;
  entityType: string;
  subtype: string | null;
}

interface TermEntry {
  term: string;
  entityId: number;
  /** Precompiled whole-token pattern for this term. */
  pattern: RegExp;
}

const WORD_CHAR = /[A-Za-z0-9_]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive whole-token pattern for a term. Anchors use \b
 * only where the adjacent character is a word character, so terms that
 * themselves start/end with punctuation (e.g. nicknames like "'60s") still
 * behave sensibly.
 */
function wholeTokenPattern(term: string): RegExp {
  const escaped = escapeRegExp(term.toLowerCase());
  const first = escaped.charAt(0);
  const last = escaped.charAt(escaped.length - 1);
  const head = first && WORD_CHAR.test(first) ? '\\b' : '';
  const tail = last && WORD_CHAR.test(last) ? '\\b' : '';
  return new RegExp(`${head}${escaped}${tail}`);
}

export class EntityIndex {
  private terms: TermEntry[] = [];
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
      .map(([term, entityId]) => ({
        term,
        entityId,
        pattern: wholeTokenPattern(term),
      }))
      .sort((a, b) => b.term.length - a.term.length);

    this.loaded = true;
  }

  /**
   * Detect entities whose name/variant appears in the query as a WHOLE token
   * (word-boundary match, case-insensitive). Substring hits such as
   * 'Asa' ⊂ 'pheasant' or 'Al' ⊂ 'talk' can no longer fire. Terms shorter
   * than 2 characters are skipped entirely: a bare letter or CJK glyph as a
   * standalone token is degenerate, while two-letter names/initials
   * ('Al', 'AJ', 'RV') match precisely under word boundaries.
   */
  detect(query: string): EntityMatch[] {
    if (!this.loaded) return [];

    const lowerQuery = query.toLowerCase();
    const detectedIds = new Set<number>();

    for (const entry of this.terms) {
      if (entry.term.length < 2) {
        continue;
      }

      if (entry.pattern.test(lowerQuery)) {
        detectedIds.add(entry.entityId);
      }
    }

    return Array.from(detectedIds)
      .map((id) => this.entityById.get(id))
      .filter((entry): entry is EntityMatch => entry !== undefined);
  }
}
