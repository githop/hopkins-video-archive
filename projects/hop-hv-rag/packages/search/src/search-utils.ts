/**
 * Pure search-layer helpers shared by production retrieval and eval scripts.
 *
 * Extracted verbatim from FamilyArchivist (behavior-preserving refactor) so
 * eval/diagnosis scripts import the real implementations instead of keeping
 * drift-prone hand-copies. See scripts/HANDOFF-search-fixes.md.
 */
import type { FilenameMatch } from './filename-index.ts';

/**
 * Extract key terms from query for keyword boosting.
 *
 * Quality gate (HANDOFF fix 2):
 * - Quoted phrases always qualify.
 * - Capitalized runs qualify when they look like proper nouns: multi-token
 *   runs anywhere ('KH Talk'), or single capitalized names in mid-sentence
 *   position ('tell me about Karen').
 * - Sentence-initial single capitals ('What', 'Show', 'Who') no longer
 *   qualify — they matched nearly every chunk and made keywordBoost a no-op
 *   that inflated competitors.
 *
 * keyTerms feed ONLY keywordBoost; FTS is built from the raw query.
 */
export function extractKeyTerms(query: string): string[] {
  const terms: string[] = [];

  // Match quoted phrases like "KH Talk"
  const quoted = query.match(/"([^"]+)"/g);
  if (quoted) {
    terms.push(...quoted.map((q) => q.replace(/"/g, '')));
  }

  // Match capitalized sequences (potential proper nouns) like "KH Talk"
  const caps = query.match(/[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*/g);
  if (caps) {
    let searchFrom = 0;
    for (const term of caps) {
      const index = query.indexOf(term, searchFrom);
      if (index < 0) continue;
      searchFrom = index + term.length;

      const multiToken = /\s/.test(term.trim());
      if (multiToken || (!isSentenceStartIndex(query, index) && term.length > 2)) {
        terms.push(term);
      }
    }
  }

  return [...new Set(terms)];
}

/**
 * True when `index` sits at the start of a sentence-ish segment: either the
 * beginning of the query or right after a terminator (. ! ? ;), ignoring
 * leading whitespace and opening quotes/brackets.
 */
function isSentenceStartIndex(query: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0) {
    const ch = query.charAt(i);
    if (/\s/.test(ch) || '"\'([{‘“'.includes(ch)) {
      i--;
      continue;
    }
    return '.!?;'.includes(ch);
  }
  return true;
}

/**
 * Construct a robust FTS5 query from user input.
 * - Detects filename-like patterns (e.g. 1996-97-1.m4v) and treats them as exact phrases
 * - Preserves prefix operators (*) for partial matching
 * - Preserves quoted phrases for exact matching
 * - BM25 scoring naturally down-weights common terms, so no stopword filtering needed
 */
export function constructFtsQuery(
  query: string,
  filenameMatches: FilenameMatch[] = [],
): string {
  const yearFilenameMatch = query.match(/\b\d{4}-[\w-.]+\b/g);
  let processedQuery = query;

  if (yearFilenameMatch) {
    yearFilenameMatch.forEach((filename) => {
      // Create a phrase version: "1996 97 1 m4v"
      const phrase = `"${filename.replace(/[^\w]/g, ' ')}"`;
      processedQuery = processedQuery.replace(filename, phrase);
    });
  }

  const filenameClauses = filenameMatches.map((match) => {
    // Use basename for FTS to match video_filename field
    return `video_filename:"${match.basename}"`;
  });

  // Clean up special chars that FTS5 dislikes, but preserve:
  // - alphanumeric characters
  // - spaces
  // - quotes (for phrase queries)
  // - asterisk (for prefix queries like "swim*")
  let cleanedQuery = processedQuery.replace(/[^\w\s"*]/g, ' ').trim();

  // Combine with filename clauses
  if (filenameClauses.length > 0) {
    cleanedQuery = `${cleanedQuery} OR ${filenameClauses.join(' OR ')}`;
  }

  return cleanedQuery;
}

/**
 * Stopwords excluded from the FTS OR-fallback (compact standard English
 * list: articles, pronouns, prepositions, auxiliaries, wh-words).
 */
const FTS_FALLBACK_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
  'of', 'as', 'at', 'by', 'for', 'with', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'can', 'will', 'just', 'should', 'now', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'am', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
  'doing', 'would', 'could', 'ought', 'i', 'me', 'my', 'mine', 'you', 'your',
  'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'us',
  'our', 'ours', 'they', 'them', 'their', 'theirs', 'what', 'which', 'who',
  'whom', 'this', 'that', 'these', 'those', 'until', 'because', 's', 't',
]);

/**
 * Build the FTS5 OR-fallback expression for HANDOFF fix 3: an OR over the
 * non-stopword tokens of the cleaned query, plus the video_filename clauses.
 * Used when the implicit-AND MATCH returns too few rows (conversational
 * queries currently produce ZERO AND matches, degenerating hybrid search to
 * vector-only).
 */
export function constructFtsOrFallbackQuery(
  query: string,
  filenameMatches: FilenameMatch[] = [],
): string {
  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !FTS_FALLBACK_STOPWORDS.has(w));

  const tokenClauses = [...new Set(words)];
  const filenameClauses = filenameMatches.map(
    (match) => `video_filename:"${match.basename}"`,
  );

  return [...tokenClauses, ...filenameClauses].join(' OR ');
}

/**
 * Reciprocal Rank Fusion over ranked result lists (production uses two:
 * vector top-40 and FTS top-40). Returns ALL fused entries sorted by
 * descending RRF score; callers apply their own truncation.
 */
export function fuseRrf<T extends { id: number }>(
  lists: ReadonlyArray<ReadonlyArray<T>>,
  k: number,
): Array<{ item: T; score: number }> {
  const scores = new Map<number, number>();
  const resultMap = new Map<number, T>();

  lists.forEach((list) => {
    list.forEach((item, index) => {
      const currentScore = scores.get(item.id) || 0;
      scores.set(item.id, currentScore + 1 / (k + index + 1));
      resultMap.set(item.id, item);
    });
  });

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .flatMap(([id, score]) => {
      const item = resultMap.get(id);
      return item === undefined ? [] : [{ item, score }];
    });
}

/**
 * Truncate a raw transcript for reranker input: whitespace-normalized, then
 * head 240 chars + tail 90 chars when longer than the 360-char cap.
 */
export function extractTranscriptSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 360) return normalized;
  const head = normalized.slice(0, 240).trim();
  const tail = normalized.slice(-90).trim();
  return `${head} ... ${tail}`;
}

/**
 * Format a document for the reranker: labeled CHUNK/SUMMARY/TRANSCRIPT lines.
 */
export function formatRerankDocument(doc: {
  title?: string | null;
  summary?: string | null;
  transcriptSnippet: string;
}): string {
  return `CHUNK: ${doc.title || 'Untitled'}\nSUMMARY: ${doc.summary || ''}\nTRANSCRIPT: ${doc.transcriptSnippet}`;
}
