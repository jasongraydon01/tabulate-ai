/**
 * V3 Runtime — Banner Diagnostic (Stage 21a — optional, non-blocking)
 *
 * Inspects the step-20 banner plan and determines whether the explicit
 * variable/question references in banner column expressions map to reportable
 * or excluded questionIds in the enriched question-id entries.
 *
 * This is a diagnostic-only utility — it does NOT gate the pipeline.
 * Call it after step 20 (or step 21) to audit banner coverage quality.
 *
 * Core logic ported from: scripts/v3-enrichment/21a-banner-questionid-diagnostic.ts
 */

import type { BannerPlanInputType } from '@/schemas/bannerPlanSchema';

import type {
  DiagnosticQuestionIdEntry,
  ColumnDiagnostic,
  ColumnDispositionStatus,
  QuestionMatch,
  QuestionMatchType,
  BannerDiagnosticSummary,
  BannerDiagnosticResult,
} from './types';

// =============================================================================
// Input Types
// =============================================================================

export interface BannerDiagnosticInput {
  /** Banner plan from step 20. */
  bannerPlan: BannerPlanInputType;
  /** Enriched question-id entries (all dispositions, not just reportable). */
  entries: DiagnosticQuestionIdEntry[];
}

// =============================================================================
// Question Index
// =============================================================================

interface QuestionIndex {
  questionIdByName: Map<string, DiagnosticQuestionIdEntry>;
  questionIdByVariable: Map<string, DiagnosticQuestionIdEntry>;
}

/** Build lookup indexes from question-id entries. */
function buildQuestionIndex(entries: DiagnosticQuestionIdEntry[]): QuestionIndex {
  const questionIdByName = new Map<string, DiagnosticQuestionIdEntry>();
  const questionIdByVariable = new Map<string, DiagnosticQuestionIdEntry>();

  for (const entry of entries) {
    if (!entry.questionId) continue;
    questionIdByName.set(entry.questionId.toLowerCase(), entry);

    const variables = new Set<string>([
      ...(entry.variables || []),
      ...(entry.items || [])
        .map(item => (item as { column?: string }).column || '')
        .filter(Boolean),
    ]);

    for (const variable of variables) {
      questionIdByVariable.set(variable.toLowerCase(), entry);
    }
  }

  return { questionIdByName, questionIdByVariable };
}

// =============================================================================
// Token Extraction
// =============================================================================

/**
 * Extract variable/question tokens from a banner R expression.
 *
 * Looks for identifiers adjacent to comparison operators (==, !=, >=, etc.)
 * and inside function-call parentheses. Deduplicates case-insensitively.
 */
export function extractBannerTokens(expression: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  const patterns = [
    /\b([A-Za-z][A-Za-z0-9_]*)\b(?=\s*(?:==|=|!=|>=|<=|>|<|%in%))/g,
    /(?:(?:==|=|!=|>=|<=|>|<)\s*)([A-Za-z][A-Za-z0-9_]*)\b/g,
    /\(\s*([A-Za-z][A-Za-z0-9_]*)\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of expression.matchAll(pattern)) {
      const token = match[1];
      const lower = token.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      tokens.push(token);
    }
  }

  return tokens;
}

// =============================================================================
// Token Resolution
// =============================================================================

/**
 * Attempt to derive a parent questionId from a token by stripping
 * common iteration/grid suffixes (_N, rNcN, rN, cN).
 */
function deriveQuestionIdCandidate(token: string): string | null {
  const candidates = [
    token.replace(/_\d+$/i, ''),
    token.replace(/r\d+c\d+$/i, ''),
    token.replace(/r\d+$/i, ''),
    token.replace(/c\d+$/i, ''),
  ].filter(candidate => candidate !== token);

  return candidates.length > 0 ? candidates[0] : null;
}

function normalizeDisposition(value: string | null | undefined): string {
  return value?.trim() || 'unknown';
}

/** Resolve tokens against the question index. */
function resolveQuestionMatches(
  expression: string,
  index: QuestionIndex,
): { matchedQuestions: QuestionMatch[]; unresolvedTokens: string[] } {
  const matchedQuestions: QuestionMatch[] = [];
  const unresolvedTokens: string[] = [];
  const seenMatches = new Set<string>();

  for (const token of extractBannerTokens(expression)) {
    const lowerToken = token.toLowerCase();
    const questionMatch = index.questionIdByName.get(lowerToken);
    const variableMatch = index.questionIdByVariable.get(lowerToken);
    const derivedQuestionId = deriveQuestionIdCandidate(token);
    const derivedMatch = derivedQuestionId
      ? index.questionIdByName.get(derivedQuestionId.toLowerCase())
      : undefined;

    const pushMatch = (
      entry: DiagnosticQuestionIdEntry,
      matchedAs: QuestionMatchType,
    ): void => {
      const key = `${token.toLowerCase()}::${entry.questionId.toLowerCase()}::${matchedAs}`;
      if (seenMatches.has(key)) return;
      seenMatches.add(key);
      matchedQuestions.push({
        token,
        matchedAs,
        questionId: entry.questionId,
        disposition: normalizeDisposition(entry.disposition as string | undefined),
        isHidden: Boolean(entry.isHidden),
        normalizedType: (entry.normalizedType as string) || null,
      });
    };

    if (questionMatch) {
      pushMatch(questionMatch, 'questionId');
      continue;
    }

    if (variableMatch) {
      pushMatch(variableMatch, 'variable');
      continue;
    }

    if (derivedMatch) {
      pushMatch(derivedMatch, 'derived_questionId');
      continue;
    }

    unresolvedTokens.push(token);
  }

  return { matchedQuestions, unresolvedTokens };
}

// =============================================================================
// Classification
// =============================================================================

/** Classify a column's disposition status based on its matched questions. */
export function classifyColumnStatus(
  matches: QuestionMatch[],
  unresolvedTokens: string[],
): ColumnDispositionStatus {
  if (matches.length === 0) {
    return unresolvedTokens.length > 0 ? 'unresolved_only' : 'no_explicit_reference';
  }

  const dispositions = new Set(matches.map(match => match.disposition));
  const hasReportable = dispositions.has('reportable');
  const hasExcluded = dispositions.has('excluded');
  const hasOther = Array.from(dispositions).some(
    disposition => disposition !== 'reportable' && disposition !== 'excluded',
  );

  if (hasReportable && !hasExcluded && dispositions.size === 1) {
    return 'reportable_only';
  }

  if (hasExcluded && !hasReportable && dispositions.size === 1) {
    return 'excluded_only';
  }

  if (hasOther && !hasReportable && !hasExcluded && dispositions.size === 1) {
    return 'other_only';
  }

  return 'mixed';
}

// =============================================================================
// Summarize
// =============================================================================

function summarize(columns: ColumnDiagnostic[]): BannerDiagnosticSummary {
  const uniqueReferencedQuestionIds = new Set<string>();
  const uniqueExcludedQuestionIds = new Set<string>();

  for (const column of columns) {
    for (const match of column.matchedQuestions) {
      uniqueReferencedQuestionIds.add(match.questionId);
      if (match.disposition === 'excluded') {
        uniqueExcludedQuestionIds.add(match.questionId);
      }
    }
  }

  return {
    totalColumns: columns.length,
    columnsWithExplicitRefs: columns.filter(c => c.matchedQuestions.length > 0).length,
    reportableOnlyColumns: columns.filter(c => c.status === 'reportable_only').length,
    excludedOnlyColumns: columns.filter(c => c.status === 'excluded_only').length,
    otherOnlyColumns: columns.filter(c => c.status === 'other_only').length,
    mixedColumns: columns.filter(c => c.status === 'mixed').length,
    unresolvedOnlyColumns: columns.filter(c => c.status === 'unresolved_only').length,
    noExplicitReferenceColumns: columns.filter(c => c.status === 'no_explicit_reference').length,
    uniqueReferencedQuestionIds: uniqueReferencedQuestionIds.size,
    uniqueExcludedQuestionIds: Array.from(uniqueExcludedQuestionIds).sort(),
  };
}

// =============================================================================
// Main Runner
// =============================================================================

/**
 * Run banner diagnostic (stage 21a — optional, non-blocking).
 *
 * For each column in the banner plan, extracts variable/question references
 * from the expression and classifies them against the enriched question-id
 * entries to determine coverage and disposition status.
 *
 * This is a pure, deterministic, synchronous function — no AI calls, no I/O.
 */
export function runBannerDiagnostic(input: BannerDiagnosticInput): BannerDiagnosticResult {
  const index = buildQuestionIndex(input.entries);

  const columns: ColumnDiagnostic[] = [];

  for (const group of input.bannerPlan.bannerCuts || []) {
    for (const column of group.columns || []) {
      const expression = column.original || '';
      const { matchedQuestions, unresolvedTokens } = resolveQuestionMatches(
        expression,
        index,
      );

      columns.push({
        groupName: group.groupName,
        columnName: column.name,
        original: expression,
        matchedQuestions,
        unresolvedTokens,
        status: classifyColumnStatus(matchedQuestions, unresolvedTokens),
      });
    }
  }

  return {
    columns,
    summary: summarize(columns),
  };
}
