/**
 * Subtype Gate schema — Zod output schema for the SubtypeGateAgent (Step 13c)
 *
 * Constrained gate that reviews the analyticalSubtype of questions flagged
 * during enrichment triage (step 10). Only the `analyticalSubtype` field
 * may be mutated — enforced at schema level.
 *
 * Unlike the loop gate's free-string newValue, newValue here uses a Zod enum
 * to restrict corrections to valid analytical subtypes at schema level.
 *
 * Azure structured output compliance:
 * - All fields required (no .optional())
 * - No z.any() or z.unknown()
 * - Empty array [] for confirmed entries (never undefined)
 */

import { z } from 'zod';

/**
 * The only field the subtype gate is allowed to mutate.
 * Enforces architectural separation at schema level — the subtype gate
 * cannot touch loop, disposition, or any other structural field.
 */
export const SubtypeGateMutableFieldSchema = z.enum(['analyticalSubtype']);

export type SubtypeGateMutableField = z.infer<typeof SubtypeGateMutableFieldSchema>;

/**
 * Valid analytical subtypes — schema-enforced enum for newValue.
 */
export const AnalyticalSubtypeValueSchema = z.enum([
  'standard',
  'ranking',
  'scale',
  'allocation',
  'maxdiff_exercise',
]);

export type AnalyticalSubtypeValue = z.infer<typeof AnalyticalSubtypeValueSchema>;

/**
 * A single field-level mutation proposed by the subtype gate.
 * Only `analyticalSubtype` is valid. newValue must be a valid subtype.
 */
export const SubtypeGateMutationSchema = z.object({
  field: SubtypeGateMutableFieldSchema,
  oldValue: z.string(),
  newValue: AnalyticalSubtypeValueSchema,
  reasoning: z.string(),
});

export type SubtypeGateMutation = z.infer<typeof SubtypeGateMutationSchema>;

/**
 * Result of reviewing a single question's analytical subtype.
 *
 * reviewOutcome values:
 * - 'confirmed': Subtype is correct — no changes needed
 * - 'corrected': Subtype was wrong — mutation applied
 * - 'flagged_for_human': Too ambiguous to decide — pass through unchanged
 */
export const SubtypeGateEntryResultSchema = z.object({
  questionId: z.string(),
  reviewOutcome: z.enum(['confirmed', 'corrected', 'flagged_for_human']),
  confidence: z.number(),
  mutations: z.array(SubtypeGateMutationSchema),
  reasoning: z.string(),
});

export type SubtypeGateEntryResult = z.infer<typeof SubtypeGateEntryResultSchema>;
