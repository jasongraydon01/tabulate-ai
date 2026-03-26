/**
 * V3 Runtime — Step 10: Deterministic Triage
 *
 * Flags reportable entries that need AI review before table generation.
 * Purely deterministic — no AI calls. This is the best candidate for parity
 * tests since every rule is a simple predicate on entry fields.
 *
 * Active triage rules (flag entries with structural uncertainty):
 *   1. low-subtype-confidence — subtype != standard at conf < 0.8
 *   2. unlinked-hidden — reportable hidden variable with no hiddenLink
 *   3. dead-variable — questionBase=0, still reportable (empty table)
 *   4. no-survey-match — reportable, non-hidden, no survey text matched
 *   5. hidden-categorical-not-ranking — hidden categorical_select classified as non-standard
 *
 * Loop rules are fully owned by step 10a (loop-gate) which runs before triage.
 * Data-fact rules (zero-base-items, heavy-filter, etc.) belong in post-table QC.
 */

import type {
  QuestionIdEntry,
  SurveyMetadata,
  TriageReason,
  TriagedEntry,
} from '../types';

// =============================================================================
// Helpers
// =============================================================================

interface InferredParentInfo {
  parentQid: string;
  parentSubtype: string | null;
  parentNormalizedType: string;
}

/**
 * Lightweight parent resolution for hidden variables.
 * Checks `hiddenLink.linkedTo` first, then infers parent stem by stripping
 * `h` prefix + `_grid_N` / `_N` suffixes. Returns null if no parent found.
 */
export function findInferredParent(
  entry: QuestionIdEntry,
  allEntries: QuestionIdEntry[],
): InferredParentInfo | null {
  // 1. Explicit link
  if (entry.hiddenLink?.linkedTo) {
    const parent = allEntries.find(
      e => e.questionId === entry.hiddenLink!.linkedTo,
    );
    if (parent) {
      return {
        parentQid: parent.questionId,
        parentSubtype: parent.analyticalSubtype,
        parentNormalizedType: parent.normalizedType,
      };
    }
  }

  // 2. Infer parent stem: strip h/d prefix, then _grid_N or trailing _N
  const qid = entry.questionId;
  const stripped = /^[hd]/i.test(qid) ? qid.slice(1) : null;
  if (!stripped) return null;

  // Remove _grid_N or trailing _N suffix
  const stem = stripped.replace(/_grid_\d+$/, '').replace(/_\d+$/, '');
  if (!stem) return null;

  const parent = allEntries.find(
    e => !e.isHidden && e.questionId === stem,
  );
  if (parent) {
    return {
      parentQid: parent.questionId,
      parentSubtype: parent.analyticalSubtype,
      parentNormalizedType: parent.normalizedType,
    };
  }

  return null;
}

/**
 * Check whether first item's scaleLabels match a rank-bucket pattern
 * (e.g. "Top 1", "Top 2", "Rank 1", "Rank 2").
 */
function hasRankBucketScaleLabels(entry: QuestionIdEntry): boolean {
  const firstItem = entry.items?.[0];
  if (!firstItem?.scaleLabels || firstItem.scaleLabels.length === 0) {
    return false;
  }
  const rankBucketPattern = /^(top|rank)\s+\d+$/i;
  return firstItem.scaleLabels.every(sl => rankBucketPattern.test(sl.label));
}

// =============================================================================
// Triage Rules
// =============================================================================

/**
 * Apply all triage rules to a single reportable entry.
 * Returns an array of triggered reasons (empty = no review needed).
 *
 * @param entry - A reportable QuestionIdEntry
 * @param _metadata - Survey-level metadata (reserved for future rules)
 * @param _allEntries - Full entry list (reserved for cross-entry rules)
 */
export function triageEntry(
  entry: QuestionIdEntry,
  _metadata: SurveyMetadata | null,
  _allEntries: QuestionIdEntry[],
): TriageReason[] {
  const reasons: TriageReason[] = [];

  // Rule 1: Low subtype confidence
  // The deterministic classifier assigns confidence. Below 0.8 means the
  // signal was weak — AI should confirm the analytical subtype.
  if (
    entry.subtypeConfidence !== null &&
    entry.subtypeConfidence < 0.8 &&
    entry.analyticalSubtype !== 'standard'
  ) {
    reasons.push({
      rule: 'low-subtype-confidence',
      detail: `${entry.analyticalSubtype} at conf=${entry.subtypeConfidence} (source: ${entry.subtypeSource})`,
      severity: 'medium',
    });
  }

  // Rule 2: Reportable hidden variable with no link
  // Hidden variables that are reportable but have no linkedTo reference
  // might be standalone derived variables or might have a link the
  // deterministic system couldn't resolve.
  if (entry.isHidden && !entry.hiddenLink) {
    reasons.push({
      rule: 'unlinked-hidden',
      detail: 'Hidden, reportable, no hiddenLink resolved',
      severity: 'low',
    });
  }

  // Rule 3: Dead variable (base=0 but still reportable)
  // Zero respondents means an empty table. AI should confirm exclusion.
  if (entry.questionBase === 0) {
    reasons.push({
      rule: 'dead-variable',
      detail: `questionBase=0 out of totalN=${entry.totalN} — zero respondents`,
      severity: 'high',
    });
  }

  // Rule 4: No survey match for a non-hidden reportable variable
  // If a variable is reportable, not hidden, and has no survey match,
  // the label may be low-quality or it may be misclassified.
  if (entry.surveyMatch === 'none' && !entry.isHidden) {
    reasons.push({
      rule: 'no-survey-match',
      detail: 'Reportable, non-hidden, but surveyMatch=none — possible label gap',
      severity: 'low',
    });
  }

  // Rule 5: Hidden categorical variable classified as non-standard
  // A hidden variable with normalizedType=categorical_select stores category
  // selections, not numeric rank positions. If it's classified as ranking/scale/
  // allocation, that's almost certainly wrong — the parent may be a ranking but
  // this derived variable represents a frequency distribution over rank buckets.
  if (
    entry.isHidden &&
    entry.normalizedType === 'categorical_select' &&
    entry.analyticalSubtype != null &&
    entry.analyticalSubtype !== 'standard'
  ) {
    const parent = findInferredParent(entry, _allEntries);
    const hasRankBuckets = hasRankBucketScaleLabels(entry);
    const parentIsRanking =
      parent !== null &&
      parent.parentSubtype === 'ranking' &&
      parent.parentNormalizedType === 'numeric_range';

    if (hasRankBuckets || parentIsRanking) {
      const signals: string[] = [];
      if (hasRankBuckets) signals.push('scaleLabels match rank-bucket pattern (Top N / Rank N)');
      if (parentIsRanking) signals.push(`parent ${parent!.parentQid} is ranking/numeric_range`);

      reasons.push({
        rule: 'hidden-categorical-not-ranking',
        detail:
          `Hidden variable with normalizedType=categorical_select classified as ` +
          `${entry.analyticalSubtype}, but categorical_select stores category selections, ` +
          `not rank positions. Signals: ${signals.join('; ')}. ` +
          `This is almost certainly a frequency distribution → standard.`,
        severity: 'medium',
      });
    }
  }

  return reasons;
}

// =============================================================================
// Batch Triage
// =============================================================================

export interface TriageResult {
  /** All entries (unchanged) */
  allEntries: QuestionIdEntry[];
  /** Entries flagged for AI review */
  flagged: TriagedEntry[];
  /** Summary stats */
  stats: {
    totalEntries: number;
    reportableEntries: number;
    flaggedEntries: number;
    flaggedPct: number;
    byRule: Record<string, number>;
    bySeverity: { high: number; medium: number; low: number };
  };
}

/**
 * Run triage on a full list of entries.
 * Only reportable entries are triaged. Excluded and text_open_end pass through unchanged.
 */
export function runTriage(
  entries: QuestionIdEntry[],
  metadata: SurveyMetadata | null,
): TriageResult {
  const reportable = entries.filter(e => e.disposition === 'reportable');
  const flagged: TriagedEntry[] = [];
  const byRule: Record<string, number> = {};
  const bySeverity = { high: 0, medium: 0, low: 0 };

  for (const entry of reportable) {
    const reasons = triageEntry(entry, metadata, entries);
    if (reasons.length === 0) continue;

    for (const r of reasons) {
      byRule[r.rule] = (byRule[r.rule] || 0) + 1;
      bySeverity[r.severity]++;
    }

    flagged.push({
      questionId: entry.questionId,
      disposition: entry.disposition,
      analyticalSubtype: entry.analyticalSubtype ?? 'standard',
      subtypeConfidence: entry.subtypeConfidence ?? 0,
      questionText: entry.questionText,
      variableCount: entry.variableCount,
      triageReasons: reasons,
      entry,
    });
  }

  const flaggedPct = reportable.length > 0
    ? (flagged.length / reportable.length) * 100
    : 0;

  return {
    allEntries: entries,
    flagged,
    stats: {
      totalEntries: entries.length,
      reportableEntries: reportable.length,
      flaggedEntries: flagged.length,
      flaggedPct,
      byRule,
      bySeverity,
    },
  };
}
