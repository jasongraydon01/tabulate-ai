/**
 * Loop Gate schema — Zod output schema for the LoopGateAgent (Step 10a)
 *
 * Constrained version of the AI gate schema — the loop gate is ONLY
 * allowed to mutate the `loop` field. All other structural classifications
 * (subtype, disposition, hiddenLink, etc.) are handled by the main AI gate
 * in step 11 after loop resolution is complete.
 *
 * Azure structured output compliance:
 * - All fields required (no .optional())
 * - No z.any() or z.unknown()
 * - oldValue/newValue are JSON-stringified strings
 * - Empty array [] for confirmed entries (never undefined)
 */

import { z } from 'zod';

/**
 * The only field the loop gate is allowed to mutate.
 * Enforces architectural separation at schema level — the loop gate
 * cannot touch subtype, disposition, or any other structural field.
 */
export const LoopGateMutableFieldSchema = z.enum(['loop']);

export type LoopGateMutableField = z.infer<typeof LoopGateMutableFieldSchema>;

/**
 * A single field-level mutation proposed by the loop gate.
 * Only `loop` is valid. newValue is always the JSON string "null" when clearing.
 */
export const LoopGateMutationSchema = z.object({
  field: LoopGateMutableFieldSchema,
  oldValue: z.string(),
  newValue: z.string(),
  reasoning: z.string(),
});

export type LoopGateMutation = z.infer<typeof LoopGateMutationSchema>;

/**
 * Result of reviewing a single loop family representative.
 *
 * reviewOutcome values:
 * - 'confirmed': Loop is genuine — no changes, propagate to siblings unchanged
 * - 'cleared': Loop is a false positive — set loop=null on representative + all siblings
 * - 'flagged_for_human': Too ambiguous to decide — pass through with loop intact
 */
export const LoopGateEntryResultSchema = z.object({
  questionId: z.string(),
  reviewOutcome: z.enum(['confirmed', 'cleared', 'flagged_for_human']),
  confidence: z.number(),
  mutations: z.array(LoopGateMutationSchema),
  reasoning: z.string(),
});

export type LoopGateEntryResult = z.infer<typeof LoopGateEntryResultSchema>;
