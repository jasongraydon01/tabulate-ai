/**
 * ReviewConfig — Centralized review thresholds and flagging logic
 *
 * All agents output confidence scores honestly. No agent sets `humanReviewRequired`.
 * This module provides the single source of truth for when a result gets flagged
 * for human review, making thresholds tunable via env vars and consistent across agents.
 */

export interface ReviewThresholds {
  banner: number;
  crosstab: number;
  filter: number;
  verification: number;
  loopSemantics: number;
}

const DEFAULT_THRESHOLDS: ReviewThresholds = {
  banner: 0.80,
  crosstab: 0.75,
  filter: 0.80,
  verification: 0.70,
  loopSemantics: 0.80,
};

/**
 * Read review thresholds from environment variables, falling back to defaults.
 *
 * Environment variables:
 * - REVIEW_THRESHOLD_BANNER (default 0.80)
 * - REVIEW_THRESHOLD_CROSSTAB (default 0.75)
 * - REVIEW_THRESHOLD_FILTER (default 0.80)
 * - REVIEW_THRESHOLD_VERIFICATION (default 0.70)
 * - REVIEW_THRESHOLD_LOOP_SEMANTICS (default 0.80)
 */
export function getReviewThresholds(): ReviewThresholds {
  return {
    banner: parseThreshold(process.env.REVIEW_THRESHOLD_BANNER, DEFAULT_THRESHOLDS.banner),
    crosstab: parseThreshold(process.env.REVIEW_THRESHOLD_CROSSTAB, DEFAULT_THRESHOLDS.crosstab),
    filter: parseThreshold(process.env.REVIEW_THRESHOLD_FILTER, DEFAULT_THRESHOLDS.filter),
    verification: parseThreshold(process.env.REVIEW_THRESHOLD_VERIFICATION, DEFAULT_THRESHOLDS.verification),
    loopSemantics: parseThreshold(process.env.REVIEW_THRESHOLD_LOOP_SEMANTICS, DEFAULT_THRESHOLDS.loopSemantics),
  };
}

function parseThreshold(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    console.warn(`[ReviewConfig] Invalid threshold "${value}", using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Determine whether a result should be flagged for human review.
 *
 * For CrosstabAgent columns, expressionType provides an additional signal:
 * placeholder, conceptual_filter, and from_list always need review regardless of confidence.
 *
 * @param confidence  - Agent's confidence score (0-1)
 * @param threshold   - Minimum confidence to pass without review
 * @param expressionType - CrosstabAgent-specific: type classification of the expression
 */
export function shouldFlagForReview(
  confidence: number,
  threshold: number,
  expressionType?: string,
): boolean {
  if (expressionType && ['placeholder', 'conceptual_filter', 'from_list'].includes(expressionType)) {
    return true;
  }
  return confidence < threshold;
}
