import { z } from 'zod';
import { shouldFlagForReview } from '../lib/review/ReviewConfig';

// Expression type classification for human review targeting
export const ExpressionTypeSchema = z.enum([
  'direct_variable',    // S2=1, Q5=2,3 → explicit variable reference, rarely needs review
  'conceptual_filter',  // IF TEACHER, HIGH VOLUME → role/concept, always needs review
  'from_list',          // Tier 1 from list, Segment A from list → needs review
  'placeholder',        // TBD, analyst to define → always needs review
  'comparison',         // Q2r3c2>Q2r3c1 → variable vs variable, usually clear
  'total'               // All respondents, qualified respondents → never needs review
]);

export type ExpressionType = z.infer<typeof ExpressionTypeSchema>;

// Alternative mapping found during variable search
export const AlternativeSchema = z.object({
  expression: z.string().describe('Alternative R syntax expression'),
  rank: z.number().describe('Agent preference order (2 = second choice, 3 = third, etc.)'),
  userSummary: z.string().describe('Plain-language explanation for a non-technical reviewer')
});

export type AlternativeType = z.infer<typeof AlternativeSchema>;

// Individual validated column schema with human review support
// NOTE: All properties must be REQUIRED for Azure OpenAI structured output compatibility.
// Azure OpenAI requires every property to be in the JSON Schema 'required' array.
// Using .default() does NOT work - the field must be truly required (no .optional() or .default()).
export const ValidatedColumnSchema = z.object({
  name: z.string(),
  adjusted: z.string().describe('R syntax expression'),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().describe('Developer-facing: search process and decision rationale'),
  userSummary: z.string().describe('Plain-language explanation for a non-technical research manager. No R syntax or variable names.'),
  // Human review support fields - all required for Azure OpenAI compatibility
  // AI must output these for every column (empty arrays are valid values)
  alternatives: z.array(AlternativeSchema)
    .describe('Other candidate mappings found during variable search, ordered by rank (empty array if none)'),
  uncertainties: z.array(z.string())
    .describe('Specific concerns for human to verify (empty array if none)'),
  expressionType: ExpressionTypeSchema
    .describe('Classification of the original expression type')
});

export type ValidatedColumnType = z.infer<typeof ValidatedColumnSchema>;

// Individual validated group schema
export const ValidatedGroupSchema = z.object({
  groupName: z.string(),
  columns: z.array(ValidatedColumnSchema)
});

export type ValidatedGroupType = z.infer<typeof ValidatedGroupSchema>;

// Agent output schema - kept simple to avoid SDK issues
// This is the structured output the CrosstabAgent will return
export const ValidationResultSchema = z.object({
  bannerCuts: z.array(ValidatedGroupSchema)
});

export type ValidationResultType = z.infer<typeof ValidationResultSchema>;

// Schema validation utilities
export const validateResult = (data: unknown): ValidationResultType => {
  return ValidationResultSchema.parse(data);
};

export const isValidResult = (data: unknown): data is ValidationResultType => {
  return ValidationResultSchema.safeParse(data).success;
};

export const validateGroup = (data: unknown): ValidatedGroupType => {
  return ValidatedGroupSchema.parse(data);
};

// Helper functions for validation result processing
export const getValidatedGroups = (result: ValidationResultType): ValidatedGroupType[] => {
  return result.bannerCuts;
};

export const getGroupByName = (result: ValidationResultType, groupName: string): ValidatedGroupType | undefined => {
  return result.bannerCuts.find(group => group.groupName === groupName);
};

export const calculateAverageConfidence = (result: ValidationResultType): number => {
  const allColumns = result.bannerCuts.flatMap(group => group.columns);
  if (allColumns.length === 0) return 0;
  
  const totalConfidence = allColumns.reduce((sum, column) => sum + column.confidence, 0);
  return totalConfidence / allColumns.length;
};

export const getHighConfidenceColumns = (result: ValidationResultType, threshold = 0.8): ValidatedColumnType[] => {
  return result.bannerCuts
    .flatMap(group => group.columns)
    .filter(column => column.confidence >= threshold);
};

export const getLowConfidenceColumns = (result: ValidationResultType, threshold = 0.5): ValidatedColumnType[] => {
  return result.bannerCuts
    .flatMap(group => group.columns)
    .filter(column => column.confidence < threshold);
};

export const getTotalColumns = (result: ValidationResultType): number => {
  return result.bannerCuts.reduce((total, group) => total + group.columns.length, 0);
};

// Combine multiple validation results (for group-by-group processing)
export const combineValidationResults = (results: ValidatedGroupType[]): ValidationResultType => {
  return {
    bannerCuts: results
  };
};

// Create validation result from single group
export const createValidationResult = (group: ValidatedGroupType): ValidationResultType => {
  return {
    bannerCuts: [group]
  };
};

// Get columns that need human review based on confidence threshold and expression type
export const getColumnsNeedingReview = (
  result: ValidationResultType,
  confidenceThreshold = 0.75
): Array<ValidatedColumnType & { groupName: string }> => {
  const needsReview: Array<ValidatedColumnType & { groupName: string }> = [];

  for (const group of result.bannerCuts) {
    for (const col of group.columns) {
      if (shouldFlagForReview(col.confidence, confidenceThreshold, col.expressionType)) {
        needsReview.push({ ...col, groupName: group.groupName });
      }
    }
  }

  return needsReview;
};

// Check if any columns in result need human review
export const needsHumanReview = (
  result: ValidationResultType,
  confidenceThreshold = 0.75
): boolean => {
  return getColumnsNeedingReview(result, confidenceThreshold).length > 0;
};