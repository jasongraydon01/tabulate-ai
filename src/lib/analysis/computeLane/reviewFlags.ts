import { shouldFlagForReview, getReviewThresholds } from '@/lib/review/ReviewConfig';
import type { ValidatedGroupType } from '@/schemas/agentOutputSchema';

import type { AnalysisBannerExtensionReviewFlags } from './types';

export function evaluateAnalysisBannerExtensionReviewFlags(
  group: ValidatedGroupType,
  options?: { draftConfidence?: number },
): AnalysisBannerExtensionReviewFlags {
  const thresholds = getReviewThresholds();
  const threshold = thresholds.crosstab;
  const reasons = new Set<string>();
  let policyFallbackDetected = false;

  if (
    typeof options?.draftConfidence === 'number'
    && options.draftConfidence < thresholds.banner
  ) {
    reasons.add(`Draft proposal confidence ${options.draftConfidence.toFixed(2)} is below the banner threshold ${thresholds.banner.toFixed(2)}.`);
  }

  for (const column of group.columns) {
    if (shouldFlagForReview(column.confidence, threshold, column.expressionType)) {
      reasons.add(`"${column.name}" needs review (${column.expressionType}, confidence ${column.confidence.toFixed(2)}).`);
    }

    if (column.adjusted.trim().startsWith('#')) {
      reasons.add(`"${column.name}" did not produce an executable expression.`);
    }

    if (/policy fallback|fallback/i.test(column.reasoning) || /fallback/i.test(column.userSummary)) {
      policyFallbackDetected = true;
      reasons.add(`"${column.name}" used a fallback path.`);
    }
  }

  const averageConfidence = group.columns.length > 0
    ? group.columns.reduce((sum, column) => sum + column.confidence, 0) / group.columns.length
    : 0;

  return {
    requiresClarification: reasons.size > 0,
    requiresReview: reasons.size > 0,
    reasons: [...reasons],
    averageConfidence,
    policyFallbackDetected,
    ...(typeof options?.draftConfidence === 'number' ? { draftConfidence: options.draftConfidence } : {}),
  };
}
