/**
 * AI Gate schema — Zod output schema for the AIGateAgent (Step 11)
 *
 * Defines the structured output for AI review of triaged questionid entries.
 * The agent reviews one entry at a time and proposes field-level mutations
 * to structural classifications before table generation.
 *
 * Azure structured output compliance:
 * - All fields required (no .optional())
 * - No z.any() or z.unknown()
 * - oldValue/newValue are JSON-stringified strings (heterogeneous field types)
 * - Empty array [] for confirmed entries (never undefined)
 */

import { z } from 'zod';

/**
 * Fields the AI gate is allowed to mutate.
 * These are structural classifications that affect table generation.
 * Data facts (base counts, labels, item bases) are NOT mutable here.
 */
export const AIGateMutableFieldSchema = z.enum([
  'analyticalSubtype',
  'subtypeSource',
  'subtypeConfidence',
  'surveyMatch',
  'surveyText',
  'disposition',
  'exclusionReason',
  'hiddenLink',
]);

export type AIGateMutableField = z.infer<typeof AIGateMutableFieldSchema>;

/**
 * A single field-level mutation proposed by the AI gate.
 * oldValue and newValue are JSON-stringified because the mutable fields
 * span heterogeneous types (string, number, object|null).
 */
export const AIGateMutationSchema = z.object({
  field: AIGateMutableFieldSchema,
  oldValue: z.string(),
  newValue: z.string(),
  reasoning: z.string(),
});

export type AIGateMutation = z.infer<typeof AIGateMutationSchema>;

/**
 * Result of reviewing a single triaged entry.
 */
export const AIGateEntryResultSchema = z.object({
  questionId: z.string(),
  reviewOutcome: z.enum(['confirmed', 'corrected', 'flagged_for_human']),
  confidence: z.number(),
  mutations: z.array(AIGateMutationSchema),
  reasoning: z.string(),
});

export type AIGateEntryResult = z.infer<typeof AIGateEntryResultSchema>;
