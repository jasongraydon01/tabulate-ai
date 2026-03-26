/**
 * WeightDetector.ts
 *
 * Detects candidate weight variables from .sav metadata.
 * Uses a name-first approach: only variables whose names match known
 * weight patterns are considered. Statistical signals then confirm
 * or reject the candidate.
 *
 * HARD GATE — name must match one of:
 *   - starts with: wt, weight, wgt, w_, rim
 *   - ends with: _wt, _weight, _wgt
 *   - contains: weight
 *   - exact match: w, W (case-insensitive single letter)
 *   (label text is NOT checked — survey questions about body weight,
 *    weight loss, etc. cause too many false positives in health/pharma data)
 *
 * Confirmation signals (scored after name gate):
 *   +0.15  no value labels (weight vars are continuous)
 *   +0.10  rClass is "numeric"
 *   +0.15  mean within 0.15 of 1.0
 *   +0.10  observedMin > 0
 *   +0.10  range plausible (min >= 0.1, max <= 5.0)
 *   -0.30  has structural suffix (r1, c1, etc. — it's a sub-variable)
 *
 * Threshold: confirmation score >= 0.20 (name gate already ensures relevance)
 */

import type { DataFileStats, WeightCandidate, WeightDetectionResult } from './types';
import { hasStructuralSuffix } from './RDataReader';

// Weight variable name patterns — HARD GATE
const WEIGHT_NAME_PREFIX = /^(wt|weight|wgt|w_|rim)/i;
const WEIGHT_NAME_SUFFIX = /[_](wt|weight|wgt)$/i;
const WEIGHT_CONTAINS = /weight/i;
const WEIGHT_EXACT = /^w$/i;

// Confirmation threshold (name gate already ensures relevance,
// so this only needs to filter out obvious non-weights)
const CONFIRM_THRESHOLD = 0.20;

/**
 * Check whether a column name (or label) matches known weight patterns.
 */
function matchesWeightName(column: string): boolean {
  if (WEIGHT_NAME_PREFIX.test(column)) return true;
  if (WEIGHT_NAME_SUFFIX.test(column)) return true;
  if (WEIGHT_CONTAINS.test(column)) return true;
  if (WEIGHT_EXACT.test(column)) return true;
  return false;
}

/**
 * Detect candidate weight variables from data file stats.
 */
export function detectWeightCandidates(stats: DataFileStats): WeightDetectionResult {
  const candidates: WeightCandidate[] = [];

  for (const col of stats.columns) {
    const meta = stats.variableMetadata[col];
    if (!meta) continue;

    // Skip text columns entirely
    if (meta.rClass === 'character' || meta.format?.startsWith('A')) continue;

    // Skip columns with no numeric data
    if (meta.observedMean === null || meta.observedMean === undefined) continue;

    // ── HARD GATE: name must match a weight pattern ──
    if (!matchesWeightName(col)) continue;

    let score = 0;
    const signals: string[] = ['name matches weight pattern'];

    // No value labels (weight vars are continuous, not categorical)
    if (!meta.valueLabels || meta.valueLabels.length === 0) {
      score += 0.15;
      signals.push('no value labels (continuous)');
    }

    // Numeric class
    if (meta.rClass === 'numeric') {
      score += 0.10;
      signals.push('numeric class');
    }

    // Mean near 1.0 (weights are typically normalized to mean=1)
    if (Math.abs(meta.observedMean - 1.0) <= 0.15) {
      score += 0.15;
      signals.push(`mean ≈ 1.0 (${meta.observedMean.toFixed(3)})`);
    }

    // All values positive
    if (meta.observedMin !== null && meta.observedMin > 0) {
      score += 0.10;
      signals.push('all values positive');
    }

    // Plausible range for weights
    if (meta.observedMin !== null && meta.observedMax !== null &&
        meta.observedMin >= 0.1 && meta.observedMax <= 5.0) {
      score += 0.10;
      signals.push(`plausible range (${meta.observedMin.toFixed(2)}-${meta.observedMax.toFixed(2)})`);
    }

    // Structural suffix penalty (sub-variables like S9r1 are not weights)
    if (hasStructuralSuffix(col)) {
      score -= 0.30;
      signals.push('structural suffix detected (penalty)');
    }

    if (score >= CONFIRM_THRESHOLD) {
      candidates.push({
        column: col,
        label: meta.label || '',
        score,
        signals,
        mean: meta.observedMean,
        sd: meta.observedSd ?? 0,
        min: meta.observedMin ?? 0,
        max: meta.observedMax ?? 0,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return {
    candidates,
    bestCandidate: candidates.length > 0 ? candidates[0] : null,
  };
}
