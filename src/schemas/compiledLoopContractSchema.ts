/**
 * Compiled Loop Contract Schema
 *
 * A deterministic, validated artifact derived from the LoopSemanticsPolicyAgent output.
 * Contains pre-computed helper column names, transformed cut expressions, and
 * per-group frame routing — so downstream consumers (R, Q, WinCross) read from
 * a single contract instead of re-deriving from the raw agent policy.
 *
 * Produced by compileLoopContract() after the agent runs.
 * Pure derivation — no AI, no I/O.
 */

import { z } from 'zod';

// =============================================================================
// Classification Source — how this group was classified
// =============================================================================

export const ClassificationSourceSchema = z.enum([
  /** No loop variables referenced in any cut — trivially respondent-anchored */
  'deterministic_no_loop_vars',
  /** Agent classified as entity-anchored (validated by compiler) */
  'agent_entity',
  /** Agent classified as respondent-anchored */
  'agent_respondent',
  /** Agent said entity, but duplicate transforms forced respondent fallback */
  'fallback_duplicate_transform',
  /** Agent said entity, but source variables missing from known columns */
  'fallback_missing_sources',
  /** Agent said entity, but target frame doesn't exist */
  'fallback_missing_frame',
  /** Agent said entity, but no frames match the iteration count */
  'fallback_no_compatible_frames',
  /** Agent failed entirely — all groups defaulted to respondent */
  'fallback_agent_failure',
]);

export type ClassificationSource = z.infer<typeof ClassificationSourceSchema>;

// =============================================================================
// Per-Cut Compiled Expression
// =============================================================================

export const CompiledCutSchema = z.object({
  /** Cut name (e.g., "Male", "18-34") */
  cutName: z.string(),

  /** Original R expression from the crosstab plan */
  originalExpression: z.string(),

  /** Transformed R expression with alias column substituted.
   *  Same as originalExpression for respondent-anchored groups. */
  compiledExpression: z.string(),

  /** Whether alias transformation was applied */
  wasTransformed: z.boolean(),
});

export type CompiledCut = z.infer<typeof CompiledCutSchema>;

// =============================================================================
// Per-Group Compiled Entry
// =============================================================================

export const CompiledGroupEntrySchema = z.object({
  /** Name matching the banner group from crosstab plan */
  groupName: z.string(),

  /** Final classification after all validation gates */
  anchorType: z.enum(['respondent', 'entity']),

  /** Whether entity-anchored cuts partition the base (no overlap) */
  shouldPartition: z.boolean(),

  /** Comparison mode for within-group stat testing on loop tables */
  comparisonMode: z.enum(['suppress', 'complement']),

  /** @deprecated Use targetFrames. Kept for backward compatibility with persisted contracts. */
  targetFrame: z.string(),

  /** All compatible stacked frames for entity-anchored groups. Empty for respondent.
   *  Populated deterministically by the compiler based on iteration count compatibility. */
  targetFrames: z.array(z.string()).default([]),

  /** Portable helper column name (HT_ prefix, SPSS-safe).
   *  Empty string for respondent-anchored groups. */
  helperColumnName: z.string(),

  /** case_when branches for creating the helper column on the stacked frame.
   *  Each entry maps one loop iteration to its source variable.
   *  Empty array for respondent-anchored groups. */
  helperBranches: z.array(z.object({
    iteration: z.string(),
    sourceVariable: z.string(),
  })),

  /** Per-cut compiled expressions for this group */
  compiledCuts: z.array(CompiledCutSchema),

  /** How this classification was determined */
  classificationSource: ClassificationSourceSchema,

  /** Confidence in classification (0-1). 1.0 for deterministic classifications. */
  confidence: z.number(),

  /** Evidence / audit trail for the classification */
  evidence: z.array(z.string()),
});

export type CompiledGroupEntry = z.infer<typeof CompiledGroupEntrySchema>;

// =============================================================================
// Top-Level Compiled Contract
// =============================================================================

export const CompiledLoopContractSchema = z.object({
  /** Schema version for forward compatibility */
  contractVersion: z.string(),

  /** ISO timestamp of when this contract was compiled */
  compiledAt: z.string(),

  /** Per-group compiled entries */
  groups: z.array(CompiledGroupEntrySchema),

  /** Available stacked frames from loop mappings */
  availableFrames: z.array(z.string()),

  /** Warnings accumulated during compilation */
  warnings: z.array(z.string()),

  /** Whether any fallback was applied (from agent failure or validation) */
  hasFallbacks: z.boolean(),

  /** Original agent policy version (for provenance) */
  sourcePolicyVersion: z.string(),

  /** Whether the source policy was itself a fallback (agent failed) */
  sourcePolicyWasFallback: z.boolean(),
});

export type CompiledLoopContract = z.infer<typeof CompiledLoopContractSchema>;
