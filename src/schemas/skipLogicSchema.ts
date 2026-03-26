import { z } from 'zod';

/**
 * @deprecated Skip logic schemas are deprecated. DeterministicBaseEngine replaces AI-driven skip logic.
 * Retained for backward compatibility — existing pipeline code and tests still reference these types.
 *
 * Skip Logic Schemas
 *
 * Purpose: Define input/output structures for the SkipLogicAgent and FilterTranslatorAgent
 * that handle skip/show logic with a two-step extraction approach.
 *
 * Flow:
 * 1. SkipLogicAgent reads survey once → extracts all skip/show rules
 * 2. FilterTranslatorAgent translates rules to R expressions using datamap
 * 3. FilterApplicator (deterministic) attaches filters to tables
 */

// =============================================================================
// SkipLogicAgent Output Schemas
// =============================================================================

/**
 * A single skip/show rule extracted from the survey.
 * One question can have multiple rules (e.g., table-level skip AND row-level show).
 */
export const SkipRuleSchema = z.object({
  /** Unique identifier for this rule (e.g., "rule_1", "rule_q5_show") */
  ruleId: z.string(),

  /** Original text from survey that establishes this rule (verbatim or close to it) */
  surveyText: z.string(),

  /** Question IDs this rule applies to (e.g., ["Q5", "Q6", "Q7"]) */
  appliesTo: z.array(z.string()),

  /** Human-readable rewrite of the rule in plain language */
  plainTextRule: z.string(),

  /** Whether this rule applies at the table level, row level, column level, or both table and row level */
  ruleType: z.enum(['table-level', 'row-level', 'column-level', 'multi-level']),

  /** Description of what the condition checks (e.g., "respondent must be aware of Brand X") */
  conditionDescription: z.string(),

  /** Translation context: coding tables, hidden variable references, or survey-specific context
   * that helps FilterTranslatorAgent resolve this rule to actual data variables.
   * Must always be present (use empty string "" if no additional context needed). */
  translationContext: z.string(),
});

export type SkipRule = z.infer<typeof SkipRuleSchema>;

/**
 * Output from SkipLogicAgent (1 AI call).
 * Contains all extracted rules and questions with no rules.
 */
export const SkipLogicExtractionOutputSchema = z.object({
  /** All skip/show rules extracted from the survey */
  rules: z.array(SkipRuleSchema),
});

export type SkipLogicExtractionOutput = z.infer<typeof SkipLogicExtractionOutputSchema>;

// =============================================================================
// FilterTranslatorAgent Output Schemas
// =============================================================================

/**
 * An alternative R expression for a filter (like CrosstabAgent alternatives).
 */
export const FilterAlternativeSchema = z.object({
  /** Alternative R expression */
  expression: z.string(),

  /** Agent's preference order (2 = second choice, 3 = third, etc.) */
  rank: z.number(),

  /** Plain-language explanation for a non-technical reviewer */
  userSummary: z.string(),
});

export type FilterAlternative = z.infer<typeof FilterAlternativeSchema>;

/**
 * Definition for splitting a table into multiple tables based on row-level logic.
 */
export const SplitDefinitionSchema = z.object({
  /** Variables that belong in this split table */
  rowVariables: z.array(z.string()),

  /** R filter expression for this split */
  filterExpression: z.string(),

  /** Human-readable base text for this split */
  baseText: z.string(),

  /** Label suffix for the split table (e.g., "Toyota", "Honda") */
  splitLabel: z.string(),
});

export type SplitDefinition = z.infer<typeof SplitDefinitionSchema>;

/**
 * Definition for splitting a table into multiple tables based on column-level logic.
 * Each group represents a set of columns (variables) that share a visibility condition.
 * An empty filterExpression means "always shown" (no additional filter needed).
 */
export const ColumnSplitDefinitionSchema = z.object({
  /** Variables (columns) that belong in this split table */
  columnVariables: z.array(z.string()),

  /** R filter expression for this column group ("" = always shown) */
  filterExpression: z.string(),

  /** Human-readable base text for this column group */
  baseText: z.string(),

  /** Label suffix for the split table (e.g., "2nd Line", "3rd+ Line") */
  splitLabel: z.string(),
});

export type ColumnSplitDefinition = z.infer<typeof ColumnSplitDefinitionSchema>;

/**
 * A translated filter for a specific question, referencing a SkipLogicAgent rule.
 */
export const TableFilterSchema = z.object({
  /** References SkipLogicAgent rule */
  ruleId: z.string(),

  /** Question this filter applies to */
  questionId: z.string(),

  /** Action: filter the whole table, split into per-row tables, or split by column groups */
  action: z.enum(['filter', 'split', 'column-split']),

  /** R expression (empty string if split) */
  filterExpression: z.string(),

  /** Human-readable base text (empty string if split) */
  baseText: z.string(),

  /** Split definitions (empty array if filter or column-split) */
  splits: z.array(SplitDefinitionSchema),

  /** Column split definitions (empty array if filter or split) */
  columnSplits: z.array(ColumnSplitDefinitionSchema),

  /** Alternative R expressions with confidence/reasoning (like CrosstabAgent) */
  alternatives: z.array(FilterAlternativeSchema),

  /** Confidence in the chosen translation (0.0-1.0) */
  confidence: z.number().min(0).max(1),

  /** Why this translation was chosen */
  reasoning: z.string(),
});

export type TableFilter = z.infer<typeof TableFilterSchema>;

/**
 * Output from FilterTranslatorAgent (1 AI call).
 * Contains all translated filters.
 */
export const FilterTranslationOutputSchema = z.object({
  /** Translated filters for each question affected by skip logic */
  filters: z.array(TableFilterSchema),
});

export type FilterTranslationOutput = z.infer<typeof FilterTranslationOutputSchema>;

// =============================================================================
// FilterApplicator Result (deterministic, not agent output)
// =============================================================================

export interface FilterApplicatorResult {
  /** Tables with filters applied */
  tables: import('./verificationAgentSchema').ExtendedTableDefinition[];
  /** Summary of what happened */
  summary: {
    totalInputTables: number;
    totalOutputTables: number;
    passCount: number;
    filterCount: number;
    splitCount: number;
    columnSplitCount: number;
    reviewRequiredCount: number;
  };
}

// =============================================================================
// Combined Result Type (for SkipLogicAgent + FilterTranslatorAgent)
// =============================================================================

export interface SkipLogicResult {
  /** Extracted rules */
  extraction: SkipLogicExtractionOutput;
  /** Processing metadata */
  metadata: {
    rulesExtracted: number;
    durationMs: number;
  };
}

export interface FilterTranslationResult {
  /** Translated filters */
  translation: FilterTranslationOutput;
  /** Processing metadata */
  metadata: {
    filtersTranslated: number;
    highConfidenceCount: number;
    reviewRequiredCount: number;
    durationMs: number;
  };
}
