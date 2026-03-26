/**
 * Survey Question Filter
 *
 * Deterministic filter that removes non-survey tables from TableGenerator output.
 * Compares each group's questionId against question IDs extracted from the survey
 * document via segmentSurvey(). No AI needed.
 *
 * Typical reductions: 15–74% depending on dataset, with zero false positives
 * across tested datasets.
 */

import { segmentSurvey } from './surveyChunker';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SurveyFilterAction {
  questionId: string;
  action: 'keep' | 'remove';
  matchedSurveyId: string | null;
  tableCount: number;
}

export interface SurveyFilterStats {
  groupsKept: number;
  groupsRemoved: number;
  tablesKept: number;
  tablesRemoved: number;
  removedQuestionIds: string[];
  orphanSurveyIds: string[];
}

export interface SurveyFilterResult<T> {
  filtered: T[];
  actions: SurveyFilterAction[];
  stats: SurveyFilterStats;
}

interface SurveyQuestionMatchContext {
  questionId: string;
  text?: string | null;
  rawText?: string | null;
  questionText?: string | null;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Check if a table's questionId matches any survey question ID.
 *
 * Matching rules:
 * - Exact match: questionId === surveyId
 * - Structured suffix match: questionId starts with surveyId and the suffix is
 *   one of:
 *   - delimiter-led variants: "_...", "-...", ". ..."
 *   - matrix/grid style tails: "r<digits>...", "c<digits>..."
 * - Optional multipart parent fallback: A100a can match A100, but only when
 *   survey metadata confirms that A100 contains an explicit `a.` subpart.
 * This prevents broad peer-level fallback like S2 -> S2b when S2b does not
 * exist in the survey.
 *
 * @returns The matched survey ID, or null if no match
 */
export function matchesQuestionId(
  tableQuestionId: string,
  surveyQuestionIds: string[],
  surveyQuestions?: SurveyQuestionMatchContext[],
): string | null {
  // Pass 1: exact match takes absolute priority
  for (const qid of surveyQuestionIds) {
    if (tableQuestionId === qid) return qid;
  }

  // Pass 2: prefix match — pick the longest (most specific) matching prefix
  let bestMatch: string | null = null;
  for (const qid of surveyQuestionIds) {
    if (tableQuestionId.startsWith(qid)) {
      const suffix = tableQuestionId.slice(qid.length);
      if (!isAllowedStructuredSuffix(suffix)) continue;
      if (!bestMatch || qid.length > bestMatch.length) {
        bestMatch = qid;
      }
    }
  }
  if (bestMatch) return bestMatch;

  // Pass 3: narrow child-letter -> multipart-parent fallback.
  // Example: A100a -> A100, but only when the survey's A100 text contains
  // an explicit `a.` subpart marker.
  return findMultipartParentMatch(tableQuestionId, surveyQuestions);
}

function isAllowedStructuredSuffix(suffix: string): boolean {
  if (!suffix) return false;

  // Delimiter-led forms are safe structural variants:
  // e.g., A3a_detail, Q3-r1, Q3.r1
  if (/^[_\-.]/.test(suffix)) return true;

  // Grid/matrix tails:
  // e.g., Q3r1, Q3r1c2, Q3c1, Q3r1oe
  if (/^[rRcC]\d+/.test(suffix)) return true;

  return false;
}

function findMultipartParentMatch(
  tableQuestionId: string,
  surveyQuestions?: SurveyQuestionMatchContext[],
): string | null {
  if (!surveyQuestions || surveyQuestions.length === 0) return null;

  const parsed = parseMultipartChildQuestionId(tableQuestionId);
  if (!parsed) return null;

  for (const question of surveyQuestions) {
    if (question.questionId.toLowerCase() !== parsed.parentId.toLowerCase()) continue;
    if (containsMultipartPart(question, parsed.partLetter)) {
      return question.questionId;
    }
  }

  return null;
}

function parseMultipartChildQuestionId(
  tableQuestionId: string,
): { parentId: string; partLetter: string } | null {
  const match = tableQuestionId.match(/^([A-Za-z][A-Za-z0-9_]*\d+)([a-z])$/i);
  if (!match) return null;
  return { parentId: match[1], partLetter: match[2].toLowerCase() };
}

function containsMultipartPart(
  question: SurveyQuestionMatchContext,
  partLetter: string,
): boolean {
  const partRegex = new RegExp(`(?:^|[\\r\\n])\\s*(?:\\*\\*)?${partLetter}\\.(?:\\*\\*)?\\s+`, 'im');
  const fallbackRegex = new RegExp(`(?:^|[.?!:]\\s+)(?:\\*\\*)?${partLetter}\\.(?:\\*\\*)?\\s+`, 'i');
  const candidates = [question.rawText, question.text, question.questionText]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return candidates.some(value => partRegex.test(value) || fallbackRegex.test(value));
}

/**
 * Check if a table questionId is covered by an allowlist entry.
 *
 * Supports:
 * - Exact match: "AnchProbInd" === "AnchProbInd"
 * - MaxDiff family member match: "AnchProbInd_12" matches "AnchProbInd"
 */
function matchesAllowlistQuestionId(
  tableQuestionId: string,
  allowlistSet: Set<string> | null
): string | null {
  if (!allowlistSet || allowlistSet.size === 0) return null;

  if (allowlistSet.has(tableQuestionId)) {
    return tableQuestionId;
  }

  for (const allowedQuestionId of allowlistSet) {
    const prefix = `${allowedQuestionId}_`;
    if (!tableQuestionId.startsWith(prefix)) continue;
    const suffix = tableQuestionId.slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      return allowedQuestionId;
    }
  }

  return null;
}

/**
 * Extract unique question IDs from survey markdown.
 *
 * Uses segmentSurvey() to parse the markdown into segments, then extracts
 * unique non-empty questionId values in document order.
 *
 * @param surveyMarkdown - Full survey markdown text
 * @returns Deduplicated array of question IDs in document order
 */
export function extractSurveyQuestionIds(surveyMarkdown: string): string[] {
  const segments = segmentSurvey(surveyMarkdown);
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const segment of segments) {
    if (segment.questionId && !seen.has(segment.questionId)) {
      seen.add(segment.questionId);
      ids.push(segment.questionId);
    }
  }

  return ids;
}

/**
 * Filter groups by matching their questionId against survey question IDs.
 *
 * Generic over group type — callers provide accessor functions to extract
 * the questionId and table count from each group.
 *
 * @param groups - Array of groups to filter
 * @param surveyQuestionIds - Question IDs extracted from survey
 * @param getQuestionId - Accessor to get questionId from a group
 * @param getTableCount - Accessor to get table count from a group
 * @returns Filtered groups with action log and stats
 */
export function filterTablesBySurveyQuestions<T>(
  groups: T[],
  surveyQuestionIds: string[],
  getQuestionId: (group: T) => string,
  getTableCount: (group: T) => number,
  /** Optional allowlist of question IDs to keep regardless of survey match (e.g., MaxDiff families) */
  allowlist?: string[],
): SurveyFilterResult<T> {
  const actions: SurveyFilterAction[] = [];
  const filtered: T[] = [];
  const matchedSurveyIds = new Set<string>();
  const allowlistSet = allowlist ? new Set(allowlist) : null;

  let tablesKept = 0;
  let tablesRemoved = 0;
  const removedQuestionIds: string[] = [];

  for (const group of groups) {
    const questionId = getQuestionId(group);
    const tableCount = getTableCount(group);

    // Check allowlist first (e.g., MaxDiff score families)
    if (matchesAllowlistQuestionId(questionId, allowlistSet)) {
      filtered.push(group);
      tablesKept += tableCount;
      actions.push({ questionId, action: 'keep', matchedSurveyId: `[allowlist]`, tableCount });
      continue;
    }

    const matchedId = matchesQuestionId(questionId, surveyQuestionIds);

    if (matchedId) {
      filtered.push(group);
      matchedSurveyIds.add(matchedId);
      tablesKept += tableCount;
      actions.push({ questionId, action: 'keep', matchedSurveyId: matchedId, tableCount });
    } else {
      tablesRemoved += tableCount;
      removedQuestionIds.push(questionId);
      actions.push({ questionId, action: 'remove', matchedSurveyId: null, tableCount });
    }
  }

  const orphanSurveyIds = surveyQuestionIds.filter(qid => !matchedSurveyIds.has(qid));

  return {
    filtered,
    actions,
    stats: {
      groupsKept: filtered.length,
      groupsRemoved: groups.length - filtered.length,
      tablesKept,
      tablesRemoved,
      removedQuestionIds,
      orphanSurveyIds,
    },
  };
}
