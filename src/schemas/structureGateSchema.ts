/**
 * Structure Gate schema — Zod output schema for the StructureGateAgent (Step 13c₂)
 *
 * Constrained gate that reviews the structural interpretation of questions
 * in the table plan: grid decompositions, scale classification modes, and
 * base policies. Runs AFTER the subtype gate (13c₁) with the subtype locked in.
 *
 * Supports six correction types via discriminated correctionType enum:
 * - suppress_grid_dimension: Remove grid_row_detail OR grid_col_detail tables
 * - invalidate_conceptual_grid: Reclassify to standard multi-item → re-derive
 * - adjust_scale_classification: Change scale mode → re-derive
 * - adjust_base_policy: Patch basePolicy on existing tables
 * - invalidate_binary_split: Remove selected/unselected dual-view → re-derive with affirmative only
 * - invalidate_stimuli_sets: Remove per-set table segmentation → re-derive without sets
 *
 * Azure structured output compliance:
 * - All fields required (no .optional())
 * - No z.any() or z.unknown()
 * - Empty array [] for confirmed entries (never undefined)
 */

import { z } from 'zod';

/**
 * The six structural correction types the structure gate can apply.
 */
export const StructureGateCorrectionTypeSchema = z.enum([
  'suppress_grid_dimension',
  'invalidate_conceptual_grid',
  'adjust_scale_classification',
  'adjust_base_policy',
  'invalidate_binary_split',
  'invalidate_stimuli_sets',
]);

export type StructureGateCorrectionType = z.infer<typeof StructureGateCorrectionTypeSchema>;

/**
 * A single structural correction proposed by the structure gate.
 *
 * newValue is validated post-AI per correctionType:
 * - suppress_grid_dimension: "grid_row_detail" | "grid_col_detail"
 * - invalidate_conceptual_grid: "standard" (always)
 * - adjust_scale_classification: "odd_substantive" | "even_bipolar" | "treat_as_standard" | "nps"
 * - adjust_base_policy: "question_base_shared" | "item_base" | "cluster_base"
 * - invalidate_binary_split: "standard" (always — re-plan with affirmative only)
 * - invalidate_stimuli_sets: "standard" (always — re-plan without set segmentation)
 */
export const StructureGateCorrectionSchema = z.object({
  correctionType: StructureGateCorrectionTypeSchema,
  newValue: z.string(),
  oldValue: z.string(),
  reasoning: z.string(),
});

export type StructureGateCorrection = z.infer<typeof StructureGateCorrectionSchema>;

/**
 * Result of reviewing a single question's structural interpretation.
 *
 * reviewOutcome values:
 * - 'confirmed': Structural interpretation is correct — no changes needed
 * - 'corrected': Structural interpretation was wrong — correction(s) applied
 * - 'flagged_for_human': Too ambiguous to decide — pass through unchanged
 */
export const StructureGateEntryResultSchema = z.object({
  questionId: z.string(),
  reviewOutcome: z.enum(['confirmed', 'corrected', 'flagged_for_human']),
  confidence: z.number(),
  corrections: z.array(StructureGateCorrectionSchema),
  reasoning: z.string(),
});

export type StructureGateEntryResult = z.infer<typeof StructureGateEntryResultSchema>;

// =============================================================================
// Post-AI validation
// =============================================================================

/** Valid newValue values per correction type */
const VALID_NEW_VALUES: Record<StructureGateCorrectionType, string[]> = {
  suppress_grid_dimension: ['grid_row_detail', 'grid_col_detail'],
  invalidate_conceptual_grid: ['standard'],
  adjust_scale_classification: ['odd_substantive', 'even_bipolar', 'treat_as_standard', 'nps'],
  adjust_base_policy: ['question_base_shared', 'item_base', 'cluster_base'],
  invalidate_binary_split: ['standard'],
  invalidate_stimuli_sets: ['standard'],
};

/**
 * Validate a single correction's newValue against the valid set for its type.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateStructureGateCorrection(
  correction: StructureGateCorrection,
): { valid: true } | { valid: false; reason: string } {
  const validValues = VALID_NEW_VALUES[correction.correctionType];
  if (!validValues) {
    return { valid: false, reason: `Unknown correctionType: ${correction.correctionType}` };
  }

  if (!validValues.includes(correction.newValue)) {
    return {
      valid: false,
      reason: `Invalid newValue "${correction.newValue}" for ${correction.correctionType}. Valid: ${validValues.join(', ')}`,
    };
  }

  return { valid: true };
}
