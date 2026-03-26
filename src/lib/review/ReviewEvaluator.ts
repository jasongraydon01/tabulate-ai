/**
 * ReviewEvaluator — Per-agent functions that annotate results with review flags.
 *
 * These run AFTER the AI call returns, applying thresholds from ReviewConfig
 * to produce consistent review annotations. Agents never set review flags themselves.
 */

import { shouldFlagForReview } from './ReviewConfig';
import type { ValidationResultType, ValidatedColumnType } from '../../schemas/agentOutputSchema';
import type { FilterTranslationOutput } from '../../schemas/skipLogicSchema';
import type { LoopSemanticsPolicy } from '../../schemas/loopSemanticsPolicySchema';

// ---- Generic annotation type ----

export interface ReviewAnnotation {
  /** What was flagged (e.g., column name, filter questionId, group name) */
  itemId: string;
  /** Confidence score that triggered the flag */
  confidence: number;
  /** Why it was flagged (threshold, expressionType, validation failure, etc.) */
  reason: string;
}

// ---- CrosstabAgent ----

export function evaluateCrosstabReview(
  result: ValidationResultType,
  threshold: number,
): ReviewAnnotation[] {
  const annotations: ReviewAnnotation[] = [];

  for (const group of result.bannerCuts) {
    for (const col of group.columns) {
      if (shouldFlagForReview(col.confidence, threshold, col.expressionType)) {
        annotations.push({
          itemId: `${group.groupName}::${col.name}`,
          confidence: col.confidence,
          reason: flagReason(col.confidence, threshold, col.expressionType),
        });
      }
    }
  }

  return annotations;
}

// ---- FilterTranslatorAgent ----

/** @deprecated FilterTranslatorAgent is deprecated. DeterministicBaseEngine replaces AI-driven filter translation. */
export function evaluateFilterReview(
  result: FilterTranslationOutput,
  threshold: number,
): ReviewAnnotation[] {
  const annotations: ReviewAnnotation[] = [];

  for (const filter of result.filters) {
    if (shouldFlagForReview(filter.confidence, threshold)) {
      annotations.push({
        itemId: `${filter.ruleId}::${filter.questionId}`,
        confidence: filter.confidence,
        reason: flagReason(filter.confidence, threshold),
      });
    }
  }

  return annotations;
}

// ---- LoopSemanticsPolicyAgent ----

export function evaluateLoopSemanticsReview(
  policy: LoopSemanticsPolicy,
  threshold: number,
): ReviewAnnotation[] {
  const annotations: ReviewAnnotation[] = [];

  for (const group of policy.bannerGroups) {
    if (shouldFlagForReview(group.confidence, threshold)) {
      annotations.push({
        itemId: group.groupName,
        confidence: group.confidence,
        reason: flagReason(group.confidence, threshold),
      });
    }
  }

  return annotations;
}

// ---- Helpers ----

function flagReason(confidence: number, threshold: number, expressionType?: string): string {
  if (expressionType && ['placeholder', 'conceptual_filter', 'from_list'].includes(expressionType)) {
    return `Expression type '${expressionType}' always requires review`;
  }
  return `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%`;
}

/**
 * Convenience: does the crosstab column need review?
 * Drop-in replacement for reading col.humanReviewRequired.
 */
export function columnNeedsReview(
  col: ValidatedColumnType,
  threshold: number,
): boolean {
  return shouldFlagForReview(col.confidence, threshold, col.expressionType);
}
