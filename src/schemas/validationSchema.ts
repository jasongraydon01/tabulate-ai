/**
 * Validation Schemas
 *
 * Zod schemas for validation report serialization.
 * All properties required (Azure constraint — no undefined values).
 */

import { z } from 'zod';

// =============================================================================
// Enums & Primitives
// =============================================================================

export const DataMapFormatSchema = z.enum([
  'sav',
]);

export const ValidationSeveritySchema = z.enum(['error', 'warning', 'info']);

export const LoopDataPatternSchema = z.enum([
  'valid_wide',
  'likely_stacked',
  'expected_dropout',
  'uncertain',
]);

// =============================================================================
// Loop Detection
// =============================================================================

export const TokenSchema = z.object({
  type: z.enum(['alpha', 'numeric', 'separator']),
  value: z.string(),
});

export const LoopGroupSchema = z.object({
  skeleton: z.string(),
  iteratorPosition: z.number(),
  iterations: z.array(z.string()),
  bases: z.array(z.string()),
  variables: z.array(z.string()),
  diversity: z.number(),
});

export const LoopDetectionResultSchema = z.object({
  hasLoops: z.boolean(),
  loops: z.array(LoopGroupSchema),
  nonLoopVariables: z.array(z.string()),
});

// =============================================================================
// Data File Stats
// =============================================================================

export const DataFileStatsSchema = z.object({
  rowCount: z.number(),
  columns: z.array(z.string()),
  stackingColumns: z.array(z.string()),
});

// =============================================================================
// Fill Rate
// =============================================================================

export const LoopFillRateResultSchema = z.object({
  loopGroup: LoopGroupSchema,
  fillRates: z.record(z.string(), z.number()),
  pattern: LoopDataPatternSchema,
  explanation: z.string(),
});

// =============================================================================
// Validation Report
// =============================================================================

export const ValidationErrorSchema = z.object({
  stage: z.number(),
  stageName: z.string(),
  severity: ValidationSeveritySchema,
  message: z.string(),
  details: z.string().default(''),
});

export const ValidationWarningSchema = z.object({
  stage: z.number(),
  stageName: z.string(),
  message: z.string(),
  details: z.string().default(''),
});

export const ValidationReportSchema = z.object({
  canProceed: z.boolean(),
  format: DataMapFormatSchema,
  errors: z.array(ValidationErrorSchema),
  warnings: z.array(ValidationWarningSchema),
  loopDetection: LoopDetectionResultSchema.nullable(),
  dataFileStats: DataFileStatsSchema.nullable(),
  fillRateResults: z.array(LoopFillRateResultSchema),
  durationMs: z.number(),
});

// =============================================================================
// Types
// =============================================================================

export type DataMapFormatType = z.infer<typeof DataMapFormatSchema>;
export type ValidationErrorType = z.infer<typeof ValidationErrorSchema>;
export type ValidationWarningType = z.infer<typeof ValidationWarningSchema>;
export type ValidationReportType = z.infer<typeof ValidationReportSchema>;
export type LoopGroupType = z.infer<typeof LoopGroupSchema>;
export type LoopDetectionResultType = z.infer<typeof LoopDetectionResultSchema>;
