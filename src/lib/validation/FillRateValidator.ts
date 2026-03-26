/**
 * FillRateValidator.ts
 *
 * Validates fill rates for detected loop groups.
 * Determines if loop data is valid wide format, stacked, or has expected dropout.
 *
 * Pure logic - takes fill rates as input (R reading is separate).
 */

import type { LoopGroup, LoopFillRateResult, LoopDataPattern } from './types';
import { tokenize } from './LoopDetector';

/**
 * Classify the fill rate pattern for a loop group.
 *
 * @param loopGroup - The detected loop group
 * @param fillRates - Fill rates per column: { 'A1_1': 0.95, 'A1_2': 0.82, ... }
 */
export function classifyLoopFillRates(
  loopGroup: LoopGroup,
  fillRates: Record<string, number>
): LoopFillRateResult {
  // Group fill rates by iteration
  const iterationRates: Record<string, number[]> = {};

  for (const varName of loopGroup.variables) {
    const rate = fillRates[varName];
    if (rate === undefined) continue;

    // Robust iteration assignment: use LoopDetector tokenization + iteratorPosition
    const tokens = tokenize(varName);
    const tokenAtIter = tokens[loopGroup.iteratorPosition];
    const iter = tokenAtIter?.type === 'numeric' ? tokenAtIter.value : null;
    if (!iter) continue;
    if (!loopGroup.iterations.includes(iter)) continue;

    if (!iterationRates[iter]) iterationRates[iter] = [];
    iterationRates[iter].push(rate);
  }

  // Calculate average fill rate per iteration
  const avgRates: Record<string, number> = {};
  for (const [iter, rates] of Object.entries(iterationRates)) {
    avgRates[iter] = rates.reduce((sum, r) => sum + r, 0) / rates.length;
  }

  // Classify the pattern
  const { pattern, explanation } = classifyPattern(loopGroup, avgRates);

  return {
    loopGroup,
    fillRates: avgRates,
    pattern,
    explanation,
  };
}

/**
 * Classify the fill rate pattern from iteration average rates.
 */
function classifyPattern(
  loopGroup: LoopGroup,
  avgRates: Record<string, number>
): { pattern: LoopDataPattern; explanation: string } {
  const sortedIters = [...loopGroup.iterations].sort(
    (a, b) => parseInt(a) - parseInt(b)
  );

  const rates = sortedIters.map((iter) => avgRates[iter] ?? 0);

  if (rates.length < 2) {
    return {
      pattern: 'uncertain',
      explanation: 'Not enough iterations to classify pattern',
    };
  }

  const firstRate = rates[0];
  const otherRates = rates.slice(1);
  const avgOtherRate =
    otherRates.reduce((sum, r) => sum + r, 0) / otherRates.length;

  // Pattern: likely_stacked
  // Strong signal only when we have 3+ iterations AND a high-diversity loop group.
  //
  // Rationale: With only 2 iterations, "iter 1 filled, iter 2 empty" is ambiguous:
  // it can be truly stacked-long input OR simply unused/placeholder later iterations
  // in wide data. We avoid false positives by classifying that as 'uncertain'.
  if (rates.length >= 3 && loopGroup.diversity >= 3 && firstRate > 0.1 && avgOtherRate < 0.01) {
    return {
      pattern: 'likely_stacked',
      explanation: `Iteration 1 has ${(firstRate * 100).toFixed(0)}% fill rate, others avg ${(avgOtherRate * 100).toFixed(1)}% — data appears stacked (not wide)`,
    };
  }

  // Ambiguous 2-iteration "one filled, one empty" case
  if (rates.length === 2 && firstRate > 0.1 && avgOtherRate < 0.01) {
    return {
      pattern: 'uncertain',
      explanation: `Iteration 1 has ${(firstRate * 100).toFixed(0)}% fill rate, iteration 2 ~0% — ambiguous (could be unused later iteration or already-stacked input); treating as uncertain`,
    };
  }

  // Pattern: fixed_grid
  // A fixed stimulus grid where every respondent answers every iteration.
  // Unlike true loops (where iterations represent different entities per respondent),
  // fixed grids repeat the same question across a fixed set of stimuli (e.g., 30 messages).
  // Stacking these would inflate bases and collapse distinct per-stimulus tables into one.
  //
  // Rule 1: All fill rates >= 95% AND >= 8 iterations (many high-fill iterations = grid, not loop)
  // Rule 2: Diversity/iteration ratio < 0.5 AND all fill rates >= 95% (few questions spread
  //         across many iterations = grid pattern, e.g., 3 questions x 30 iterations)
  const allRatesHigh = rates.every((r) => r >= 0.95);
  const iterationCount = rates.length;
  const diversityIterRatio = loopGroup.diversity / iterationCount;

  if (allRatesHigh && (iterationCount >= 8 || diversityIterRatio < 0.5)) {
    const ruleTriggered = iterationCount >= 8
      ? `${iterationCount} iterations all >=95% fill`
      : `diversity/iteration ratio ${diversityIterRatio.toFixed(2)} < 0.5 with all >=95% fill`;
    return {
      pattern: 'fixed_grid',
      explanation: `Fixed grid detected (${ruleTriggered}): ${iterationCount} iterations of ${loopGroup.diversity} questions — not stacking`,
    };
  }

  // Pattern: valid_wide
  // All iterations have similar fill rates (within 30% of each other)
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  if (minRate > 0.1 && maxRate - minRate < 0.3) {
    return {
      pattern: 'valid_wide',
      explanation: `All iterations have similar fill rates (${(minRate * 100).toFixed(0)}%-${(maxRate * 100).toFixed(0)}%) — valid wide format`,
    };
  }

  // Pattern: expected_dropout
  // Rates decrease monotonically (common when loops have optional iterations)
  let isDecreasing = true;
  for (let i = 1; i < rates.length; i++) {
    if (rates[i] > rates[i - 1] + 0.05) {
      // Allow small increases (5%) due to noise
      isDecreasing = false;
      break;
    }
  }

  if (isDecreasing && firstRate > 0.1 && avgOtherRate > 0.01) {
    return {
      pattern: 'expected_dropout',
      explanation: `Fill rates decrease across iterations (${rates.map((r) => `${(r * 100).toFixed(0)}%`).join(' → ')}) — expected dropout pattern`,
    };
  }

  return {
    pattern: 'uncertain',
    explanation: `Fill rates: ${rates.map((r) => `${(r * 100).toFixed(0)}%`).join(', ')} — pattern unclear`,
  };
}
