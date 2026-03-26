import { z } from 'zod';

export const PipelineErrorSourceSchema = z.enum(['agent', 'system']);
export type PipelineErrorSource = z.infer<typeof PipelineErrorSourceSchema>;

export const PipelineErrorSeveritySchema = z.enum(['warning', 'error', 'fatal']);
export type PipelineErrorSeverity = z.infer<typeof PipelineErrorSeveritySchema>;

export const PipelineErrorClassificationSchema = z.enum([
  'rate_limit',
  'policy',
  'transient',
  'output_validation',
  'non_retryable',
  'unknown',
]);
export type PipelineErrorClassification = z.infer<typeof PipelineErrorClassificationSchema>;

export const PipelineErrorActionTakenSchema = z.enum([
  'continued',
  'skipped_item',
  'fallback_used',
  'aborted',
  'failed_pipeline',
]);
export type PipelineErrorActionTaken = z.infer<typeof PipelineErrorActionTakenSchema>;

/**
 * Canonical persisted error record for a pipeline run.
 *
 * IMPORTANT: This schema is used for disk persistence + verification tooling.
 * Keep fields stable and prefer adding new fields (with safe defaults) over changing semantics.
 */
export const PipelineErrorRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(), // ISO timestamp

  // Run identity
  dataset: z.string(),
  pipelineId: z.string(),
  outputDirRelative: z.string(),

  // Origin
  source: PipelineErrorSourceSchema,
  agentName: z.string(), // empty string when source=system

  // Pipeline context (best-effort)
  stageNumber: z.number().int(),
  stageName: z.string(),
  itemId: z.string(), // tableId / groupName / ruleId / etc, else ''

  // Classification
  severity: PipelineErrorSeveritySchema,
  classification: PipelineErrorClassificationSchema,
  actionTaken: PipelineErrorActionTakenSchema,

  // Error details
  name: z.string(),
  message: z.string(),
  stack: z.string(),

  // Optional structured metadata (must be JSON-serializable)
  meta: z.record(z.unknown()),
});

export type PipelineErrorRecord = z.infer<typeof PipelineErrorRecordSchema>;

