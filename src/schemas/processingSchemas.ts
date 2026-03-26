/**
 * Processing Schemas - Types for Data Map Processing
 * 
 * Defines types used by DataMapProcessor and DataMapValidator
 * Ensures compatibility with existing schemas while adding processing-specific types
 */

import { z } from 'zod';

// ===== RAW PROCESSING TYPES =====

export const RawDataMapVariableSchema = z.object({
  level: z.enum(['parent', 'sub']),
  column: z.string(),
  description: z.string(),
  valueType: z.string(),
  answerOptions: z.string(),
  parentQuestion: z.string(),
  context: z.string().optional()
});

export const ProcessedDataMapVariableSchema = RawDataMapVariableSchema.extend({
  context: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

// ===== VERBOSE OUTPUT SCHEMA =====

export const VerboseDataMapSchema = z.object({
  level: z.enum(['parent', 'sub']),
  column: z.string(),
  description: z.string(),
  valueType: z.string(),
  answerOptions: z.string(),
  parentQuestion: z.string(),
  context: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  // Optional normalized typing metadata (MVP enhancements)
  
  /** Classified variable type based on parsing heuristics */
  normalizedType: z
    .enum([
      'numeric_range',        // Numeric input with min/max bounds (e.g., age 0-99)
      'percentage_per_option', // Each option 0-100%, often with row sum = 100%
      'ordinal_scale',        // Ordered categories (e.g., 1-5 Likert scale)
      'matrix_single_choice', // Grid with single selection per row
      'binary_flag',          // 0/1 checkbox (Unchecked/Checked)
      'categorical_select',   // Single choice from list
      'text_open',           // Free text response
      'admin',               // Administrative/metadata field
      'weight',              // Weight variable (excluded from tables)
    ])
    .optional(),
  
  /** Minimum value for numeric ranges (e.g., 0 for "Values: 0-100") */
  rangeMin: z.number().optional(),
  
  /** Maximum value for numeric ranges (e.g., 100 for "Values: 0-100") */
  rangeMax: z.number().optional(),
  
  /** Step increment for ranges (e.g., 1 for integers, 0.1 for decimals) */
  rangeStep: z.number().optional(),
  
  /** Discrete allowed values for categorical/scale variables (e.g., [1,2,3,4,5]) */
  allowedValues: z.array(z.union([z.number(), z.string()])).optional(),
  
  /** Labels for scale points (e.g., [{value: 1, label: "Not at all likely"}]) */
  scaleLabels: z
    .array(
      z.object({
        value: z.union([z.number(), z.string()]),
        label: z.string(),
      })
    )
    .optional(),
  
  /** Whether row values should sum to 100 (for percentage distributions) */
  rowSumConstraint: z.boolean().optional(),
  
  /** Variable this question depends on (e.g., S12 depends on S11) */
  dependentOn: z.string().optional(),
  
  /** Rule for dependency (e.g., "upperBoundEquals(S11)" for S12) */
  dependentRule: z.string().optional(),
});

// ===== AGENT OUTPUT SCHEMA =====

export const AgentDataMapSchema = z.object({
  Column: z.string(),
  Description: z.string(),
  Answer_Options: z.string(),
  ParentQuestion: z.string().optional(),
  Context: z.string().optional()
});

// ===== PROCESSING RESULT SCHEMA =====

export const ProcessingResultSchema = z.object({
  success: z.boolean(),
  verbose: z.array(VerboseDataMapSchema),
  agent: z.array(AgentDataMapSchema),
  validationPassed: z.boolean(),
  confidence: z.number().min(0).max(1),
  errors: z.array(z.string()),
  warnings: z.array(z.string())
});

// ===== VALIDATION SCHEMAS =====

export const ConfidenceFactorsSchema = z.object({
  structuralIntegrity: z.number().min(0).max(40),
  contentCompleteness: z.number().min(0).max(30),
  relationshipClarity: z.number().min(0).max(30)
});

export const SPSSValidationResultSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  columnMatches: z.object({
    inBoth: z.number(),
    onlyInDataMap: z.number(),
    onlyInSPSS: z.number()
  }),
  missingColumns: z.array(z.string()).optional(),
  extraColumns: z.array(z.string()).optional()
});

export const SPSSInfoSchema = z.object({
  variables: z.array(z.string()),
  metadata: z.object({
    totalVariables: z.number(),
    fileName: z.string()
  })
});

// ===== TYPE EXPORTS =====

export type RawDataMapVariableType = z.infer<typeof RawDataMapVariableSchema>;
export type ProcessedDataMapVariableType = z.infer<typeof ProcessedDataMapVariableSchema>;
export type VerboseDataMapType = z.infer<typeof VerboseDataMapSchema>;
export type AgentDataMapType = z.infer<typeof AgentDataMapSchema>;
export type ProcessingResultType = z.infer<typeof ProcessingResultSchema>;
export type ConfidenceFactorsType = z.infer<typeof ConfidenceFactorsSchema>;
export type SPSSValidationResultType = z.infer<typeof SPSSValidationResultSchema>;
export type SPSSInfoType = z.infer<typeof SPSSInfoSchema>;

// ===== VALIDATION HELPERS =====

export const validateProcessingResult = (data: unknown): ProcessingResultType => {
  return ProcessingResultSchema.parse(data);
};

export const validateAgentDataMap = (data: unknown): AgentDataMapType[] => {
  return z.array(AgentDataMapSchema).parse(data);
};

export const validateVerboseDataMap = (data: unknown): VerboseDataMapType[] => {
  return z.array(VerboseDataMapSchema).parse(data);
};

// ===== CONSTANTS =====

export const PROCESSING_CONSTANTS = {
  CONFIDENCE_THRESHOLD: 0.75,
  SPSS_MATCH_THRESHOLD: 0.8,
  MAX_PARENT_QUESTION_LENGTH: 3,
  CONFIDENCE_WEIGHTS: {
    structuralIntegrity: 40,
    contentCompleteness: 30,
    relationshipClarity: 30
  }
} as const;

export const CONFIDENCE_LEVELS = {
  EXCELLENT: { min: 0.9, label: 'Excellent Parse' },
  GOOD: { min: 0.75, label: 'Good Confidence' },
  MEDIUM: { min: 0.6, label: 'Medium Confidence' },
  LOW: { min: 0.4, label: 'Low Confidence' },
  FAILED: { min: 0, label: 'Failed Parse' }
} as const;