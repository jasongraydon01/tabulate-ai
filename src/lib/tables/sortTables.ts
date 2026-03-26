/**
 * Table Sorting Utility
 *
 * Purpose: Sort tables into a logical order for the final Excel output.
 *
 * Ordering rules:
 * 1. Screener questions (S1, S2, S2a, S2b, etc.) - sorted alphanumerically
 * 2. Main questions (A1, B1, Q1, etc.) - sorted alphanumerically
 * 3. Other questions (anything that doesn't match patterns) - at the bottom
 *
 * Within each question, ordering is:
 *   prefix → number → suffix → loopIteration → non-derived before derived → tableId tiebreaker
 *
 * Usage:
 *   const sortedTables = sortTables(verifiedTables);
 */

import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';

/**
 * Question category for sorting priority
 */
type QuestionCategory = 'screener' | 'main' | 'maxdiff' | 'other';

/**
 * Parsed question identifier for sorting
 */
interface ParsedQuestion {
  category: QuestionCategory;
  prefix: string; // e.g., "S", "A", "B", "Q"
  number: number; // e.g., 1, 2, 10
  suffix: string; // e.g., "a", "b", "dk", "" (sub-question letters)
  loopIteration: number; // e.g., 1, 2, 0 (0 = not a loop variant)
  isDerived: boolean; // T2B, binned, brand-split, etc.
  derivedOrder: number; // deterministic ordering for derived table variants
  sortOrder?: number; // canonical sort position when available
  tableKindPriority: number; // overview before item/detail when heuristics are needed
  sourceQuestionId: string; // For derived: the parent questionId for sorting proximity
  tableId: string; // For secondary sorting within same question
}

/**
 * Extract a normalized questionId from a tableId string.
 *
 * Derived tables have tableIds like "s8_binned", "a23_grey_goose", "s10b_detail".
 * We extract the base question identity for sorting proximity.
 */
function extractQuestionIdFromTableId(sourceTableId: string): string {
  const rootToken = sourceTableId.split('__')[0] || sourceTableId;
  const match = rootToken.match(/^([a-z]+)(\d+)([a-z]*)(?:_([a-z0-9]+))?$/i);
  if (match) {
    const [, prefix, num, suffix, loopToken] = match;
    return `${prefix.toUpperCase()}${num}${suffix}${loopToken ? '_' + loopToken : ''}`;
  }
  return sourceTableId;
}

function parseStructuredQuestionToken(value: string): {
  prefix: string;
  number: number;
  suffix: string;
  loopIteration: number;
} | null {
  const match = value.match(/^([A-Za-z]+)(\d+)([A-Za-z]*)(?:_([A-Za-z0-9]+))?$/);
  if (!match) return null;

  const [, prefix, numStr, suffix, loopToken] = match;
  let suffixToken = suffix.toLowerCase();
  let loopIteration = 0;

  if (loopToken) {
    const loopMatch = loopToken.match(/^(.*?)(\d+)$/);
    if (loopMatch) {
      const [, loopPrefix, loopStr] = loopMatch;
      if (loopPrefix) {
        suffixToken = `${suffixToken}_${loopPrefix.toLowerCase()}`;
      }
      loopIteration = parseInt(loopStr, 10);
    } else {
      suffixToken = `${suffixToken}_${loopToken.toLowerCase()}`;
    }
  }

  return {
    prefix: prefix.toUpperCase(),
    number: parseInt(numStr, 10),
    suffix: suffixToken,
    loopIteration,
  };
}

function getTableKindPriority(tableId: string): number {
  const tableKind = (tableId.split('__')[1] || '').toLowerCase();
  if (tableKind.includes('overview')) return 0;
  if (tableKind.includes('item') || tableKind.includes('cluster')) return 2;
  return 1;
}

function getDerivedOrder(tableId: string, isDerived: boolean): number {
  if (!isDerived) return 0;
  const normalized = tableId.toLowerCase();

  const orderPatterns: Array<{ order: number; regex: RegExp }> = [
    { order: 10, regex: /_rank1$/ },
    { order: 11, regex: /_rank2$/ },
    { order: 12, regex: /_rank3$/ },
    { order: 20, regex: /_top2$/ },
    { order: 21, regex: /_top3$/ },
    { order: 30, regex: /_t2b$/ },
    { order: 31, regex: /_m3b$/ },
    { order: 32, regex: /_b2b$/ },
    { order: 33, regex: /_t3b$/ },
    { order: 34, regex: /_b3b$/ },
    { order: 40, regex: /_comp_/ },
    { order: 50, regex: /_detail_/ },
    { order: 60, regex: /_binned$/ },
  ];

  for (const pattern of orderPatterns) {
    if (pattern.regex.test(normalized)) return pattern.order;
  }
  return 99;
}

/**
 * Parse a questionId to extract sortable components.
 *
 * Examples:
 *   "S8"      -> { category: "screener", prefix: "S", number: 8, suffix: "", loopIteration: 0 }
 *   "S2b"     -> { category: "screener", prefix: "S", number: 2, suffix: "b", loopIteration: 0 }
 *   "A3"      -> { category: "main", prefix: "A", number: 3, suffix: "", loopIteration: 0 }
 *   "A3DK"    -> { category: "main", prefix: "A", number: 3, suffix: "dk", loopIteration: 0 }
 *   "A7_1"    -> { category: "main", prefix: "A", number: 7, suffix: "", loopIteration: 1 }
 *   "A13a_1"  -> { category: "main", prefix: "A", number: 13, suffix: "a", loopIteration: 1 }
 *   "A14b_2"  -> { category: "main", prefix: "A", number: 14, suffix: "b", loopIteration: 2 }
 *   "US_State" -> { category: "other", ... }
 */
function parseQuestionId(
  questionId: string,
  tableId: string,
  isDerived: boolean,
  sourceTableId: string,
  sortOrder?: number,
): ParsedQuestion {
  const isMaxDiffFamily = /^maxdiff_/i.test(tableId);
  const parsedToken =
    parseStructuredQuestionToken(questionId) ||
    parseStructuredQuestionToken(extractQuestionIdFromTableId(sourceTableId || tableId));

  if (parsedToken) {
    const category: QuestionCategory = parsedToken.prefix === 'S' ? 'screener' : 'main';
    return {
      category,
      prefix: parsedToken.prefix,
      number: parsedToken.number,
      suffix: parsedToken.suffix,
      loopIteration: parsedToken.loopIteration,
      isDerived,
      derivedOrder: getDerivedOrder(tableId, isDerived),
      sortOrder,
      tableKindPriority: getTableKindPriority(tableId),
      sourceQuestionId: sourceTableId ? extractQuestionIdFromTableId(sourceTableId) : '',
      tableId,
    };
  }

  // MaxDiff family table IDs (e.g., maxdiff_anchprobind with questionId AnchProbInd)
  if (isMaxDiffFamily && /^[A-Za-z][A-Za-z0-9]*$/.test(questionId)) {
    return {
      category: 'maxdiff',
      prefix: 'MD',
      number: 0,
      suffix: questionId.toLowerCase(),
      loopIteration: 0,
      isDerived,
      derivedOrder: getDerivedOrder(tableId, isDerived),
      sortOrder,
      tableKindPriority: getTableKindPriority(tableId),
      sourceQuestionId: sourceTableId ? extractQuestionIdFromTableId(sourceTableId) : '',
      tableId,
    };
  }

  // Fallback for truly unstructured names (US_State, Region, qCARD_SPECIALTY)
  return {
    category: 'other',
    prefix: '',
    number: Infinity,
    suffix: questionId.toLowerCase(),
    loopIteration: 0,
    isDerived,
    derivedOrder: getDerivedOrder(tableId, isDerived),
    sortOrder,
    tableKindPriority: getTableKindPriority(tableId),
    sourceQuestionId: '',
    tableId,
  };
}

/**
 * Compare two parsed questions for sorting.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
function compareParsedQuestions(a: ParsedQuestion, b: ParsedQuestion): number {
  // 0. Canonical sort order wins when available
  if (typeof a.sortOrder === 'number' || typeof b.sortOrder === 'number') {
    if (typeof a.sortOrder === 'number' && typeof b.sortOrder === 'number') {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
    } else {
      return typeof a.sortOrder === 'number' ? -1 : 1;
    }
  }

  // 1. Category priority: screener < main < other
  const categoryOrder: Record<QuestionCategory, number> = {
    screener: 0,
    main: 1,
    maxdiff: 2,
    other: 3,
  };

  const categoryDiff = categoryOrder[a.category] - categoryOrder[b.category];
  if (categoryDiff !== 0) return categoryDiff;

  // 2. Within same category, sort by prefix (A < B < C...)
  if (a.prefix !== b.prefix) {
    return a.prefix.localeCompare(b.prefix);
  }

  // 3. Same prefix, sort by question number
  if (a.number !== b.number) {
    return a.number - b.number;
  }

  // 4. Same number, sort by suffix (empty < "a" < "b" < ...)
  if (a.suffix !== b.suffix) {
    if (a.suffix === '') return -1;
    if (b.suffix === '') return 1;
    return a.suffix.localeCompare(b.suffix);
  }

  // 5. Same suffix, sort by loop iteration (0=no loop first, then 1, 2, ...)
  if (a.loopIteration !== b.loopIteration) {
    return a.loopIteration - b.loopIteration;
  }

  // 6. Non-derived before derived (base table first, then T2B/binned/etc.)
  if (a.isDerived !== b.isDerived) {
    return a.isDerived ? 1 : -1;
  }

  // 7. Deterministic derived ordering map for common families (rank/top/box/detail/etc.)
  if (a.derivedOrder !== b.derivedOrder) {
    return a.derivedOrder - b.derivedOrder;
  }

  // 8. Prefer overview tables before item/detail tables when heuristics are all that's left
  if (a.tableKindPriority !== b.tableKindPriority) {
    return a.tableKindPriority - b.tableKindPriority;
  }

  // 9. Fall back to tableId for deterministic ordering
  return a.tableId.localeCompare(b.tableId);
}

/**
 * Sort tables into logical order for Excel output.
 *
 * @param tables - Array of ExtendedTableDefinition from VerificationAgent
 * @returns Sorted array (new array, original not mutated)
 */
export function sortTables(tables: ExtendedTableDefinition[]): ExtendedTableDefinition[] {
  const parsed = tables.map((table) => ({
    table,
    parsed: parseQuestionId(
      table.questionId,
      table.tableId,
      table.isDerived,
      table.sourceTableId,
      table.sortOrder,
    ),
  }));

  parsed.sort((a, b) => compareParsedQuestions(a.parsed, b.parsed));

  return parsed.map((p) => p.table);
}

/**
 * Get sorting metadata for debugging/logging.
 */
export function getSortingMetadata(tables: ExtendedTableDefinition[]): {
  screenerCount: number;
  mainCount: number;
  otherCount: number;
  order: Array<{ questionId: string; tableId: string }>;
} {
  const sorted = sortTables(tables);
  const parsed = sorted.map((t) =>
    parseQuestionId(t.questionId, t.tableId, t.isDerived, t.sourceTableId, t.sortOrder),
  );

  return {
    screenerCount: parsed.filter((p) => p.category === 'screener').length,
    mainCount: parsed.filter((p) => p.category === 'main').length,
    otherCount: parsed.filter((p) => p.category === 'other').length,
    order: sorted.map((t) => ({ questionId: t.questionId, tableId: t.tableId })),
  };
}
