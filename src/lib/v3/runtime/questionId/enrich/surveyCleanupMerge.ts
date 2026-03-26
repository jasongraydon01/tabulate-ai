/**
 * Survey Cleanup Merge — Deterministic consensus voting for triple-agent cleanup
 *
 * Takes the original ParsedSurveyQuestion[] and 2-3 AI cleanup outputs,
 * then merges them via majority voting with Levenshtein tie-breaking.
 *
 * Pure function — no I/O, fully testable.
 */

import type { ParsedSurveyQuestion } from '../types';
import type { SurveyCleanupOutput } from '@/schemas/surveyCleanupSchema';

// =============================================================================
// Stats
// =============================================================================

export interface CleanupMergeStats {
  totalQuestions: number;
  questionsModified: number;
  fieldChanges: {
    questionText: number;
    instructionText: number;
    answerOptions: number;
    scaleLabels: number;
    questionType: number;
    sectionHeader: number;
  };
  validOutputs: number;
  fallbackUsed: boolean;
}

// =============================================================================
// Levenshtein Distance
// =============================================================================

/**
 * Standard character-level Levenshtein edit distance.
 * O(n*m) time and O(min(n,m)) space via single-row optimization.
 */
export function charLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: m + 1 }, (_, i) => i);

  for (let j = 1; j <= n; j++) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(row[i] + 1, row[i - 1] + 1, prev + cost);
      prev = row[i];
      row[i] = val;
    }
  }
  return row[m];
}

// =============================================================================
// Voting Helpers
// =============================================================================

/**
 * Pick the majority value from a set of candidates.
 * If 2+ agree, returns the agreed value.
 * If all disagree, returns the value closest to `original` by Levenshtein.
 */
function voteString(candidates: string[], original: string): string {
  if (candidates.length === 0) return original;
  if (candidates.length === 1) return candidates[0];

  // Count occurrences
  const counts = new Map<string, number>();
  for (const c of candidates) {
    counts.set(c, (counts.get(c) || 0) + 1);
  }

  // Find majority (2+ of 3, or 2+ of 2)
  for (const [value, count] of counts) {
    if (count >= 2) return value;
  }

  // All disagree — pick closest to original
  let best = candidates[0];
  let bestDist = charLevenshtein(candidates[0], original);
  for (let i = 1; i < candidates.length; i++) {
    const dist = charLevenshtein(candidates[i], original);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidates[i];
    }
  }
  return best;
}

// =============================================================================
// Main Merge
// =============================================================================

/**
 * Merge 2-3 AI cleanup outputs against the original parsed questions.
 *
 * - Filters out null outputs (failed calls)
 * - Needs 2+ valid outputs for voting; otherwise returns original unchanged
 * - Matches questions by questionId
 * - Votes on each cleanable field
 * - Preserves immutable fields from original
 */
export function mergeCleanupOutputs(
  original: ParsedSurveyQuestion[],
  outputs: (SurveyCleanupOutput | null)[],
): { merged: ParsedSurveyQuestion[]; stats: CleanupMergeStats } {
  const stats: CleanupMergeStats = {
    totalQuestions: original.length,
    questionsModified: 0,
    fieldChanges: {
      questionText: 0,
      instructionText: 0,
      answerOptions: 0,
      scaleLabels: 0,
      questionType: 0,
      sectionHeader: 0,
    },
    validOutputs: 0,
    fallbackUsed: false,
  };

  // Filter valid outputs
  const validOutputs = outputs.filter(
    (o): o is SurveyCleanupOutput => o !== null && o !== undefined,
  );
  stats.validOutputs = validOutputs.length;

  // Need 2+ outputs for meaningful voting
  if (validOutputs.length < 2) {
    stats.fallbackUsed = true;
    return { merged: original, stats };
  }

  // Index each output by questionId for fast lookup
  const outputMaps = validOutputs.map((output) => {
    const map = new Map<string, (typeof output.questions)[number]>();
    for (const q of output.questions) {
      map.set(q.questionId, q);
    }
    return map;
  });

  const merged: ParsedSurveyQuestion[] = original.map((orig) => {
    // Collect cleaned versions for this questionId
    const cleaned = outputMaps
      .map((m) => m.get(orig.questionId))
      .filter((q): q is NonNullable<typeof q> => q !== undefined);

    // Not enough outputs have this question — keep original
    if (cleaned.length < 2) {
      return orig;
    }

    let modified = false;

    // --- Vote on string fields ---
    const questionText = voteString(
      cleaned.map((c) => c.questionText),
      orig.questionText,
    );
    if (questionText !== orig.questionText) {
      modified = true;
      stats.fieldChanges.questionText++;
    }

    const instructionText = voteString(
      cleaned.map((c) => c.instructionText),
      orig.instructionText ?? '',
    );
    const normalizedInstruction = instructionText || null;
    if ((normalizedInstruction ?? '') !== (orig.instructionText ?? '')) {
      modified = true;
      stats.fieldChanges.instructionText++;
    }

    const questionType = voteString(
      cleaned.map((c) => c.questionType),
      orig.questionType,
    );
    if (questionType !== orig.questionType) {
      modified = true;
      stats.fieldChanges.questionType++;
    }

    const sectionHeader = voteString(
      cleaned.map((c) => c.sectionHeader),
      orig.sectionHeader ?? '',
    );
    const normalizedSection = sectionHeader || null;
    if ((normalizedSection ?? '') !== (orig.sectionHeader ?? '')) {
      modified = true;
      stats.fieldChanges.sectionHeader++;
    }

    // --- Vote on answerOptions (by code) ---
    let answerOptionsModified = false;
    const mergedOptions = orig.answerOptions.map((origOpt) => {
      const codeStr = String(origOpt.code);
      const candidateTexts: string[] = [];
      for (const c of cleaned) {
        const match = c.answerOptions.find((o) => String(o.code) === codeStr);
        if (match) candidateTexts.push(match.text);
      }
      if (candidateTexts.length < 2) return origOpt;

      const votedText = voteString(candidateTexts, origOpt.text);
      if (votedText !== origOpt.text) {
        answerOptionsModified = true;
        return { ...origOpt, text: votedText };
      }
      return origOpt;
    });
    if (answerOptionsModified) {
      modified = true;
      stats.fieldChanges.answerOptions++;
    }

    // --- Vote on scaleLabels (by value) ---
    let scaleLabelsModified = false;
    const mergedScaleLabels = orig.scaleLabels
      ? orig.scaleLabels.map((origScale) => {
          const candidateLabels: string[] = [];
          for (const c of cleaned) {
            const match = c.scaleLabels.find((s) => s.value === origScale.value);
            if (match) candidateLabels.push(match.label);
          }
          if (candidateLabels.length < 2) return origScale;

          const votedLabel = voteString(candidateLabels, origScale.label);
          if (votedLabel !== origScale.label) {
            scaleLabelsModified = true;
            return { ...origScale, label: votedLabel };
          }
          return origScale;
        })
      : null;

    // Also check if AI unanimously returned empty scaleLabels when original had values
    // (indicating the original was a misextraction)
    let finalScaleLabels = mergedScaleLabels;
    if (orig.scaleLabels && orig.scaleLabels.length > 0) {
      const allReturnedEmpty = cleaned.every((c) => c.scaleLabels.length === 0);
      if (allReturnedEmpty) {
        finalScaleLabels = null;
        scaleLabelsModified = true;
      }
    }

    if (scaleLabelsModified) {
      modified = true;
      stats.fieldChanges.scaleLabels++;
    }

    if (modified) {
      stats.questionsModified++;
    }

    return {
      ...orig,
      questionText,
      instructionText: normalizedInstruction,
      answerOptions: mergedOptions,
      scaleLabels: finalScaleLabels,
      questionType: questionType as ParsedSurveyQuestion['questionType'],
      sectionHeader: normalizedSection,
    };
  });

  return { merged, stats };
}
