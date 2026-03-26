import { z } from 'zod';

/**
 * TableAgent Schemas
 * Purpose: Define input/output structures for the TableAgent that decides how to display
 * survey data as crosstabs.
 *
 * Key distinction:
 * - normalizedType: Data structure from DataMapProcessor (e.g., "numeric_range", "categorical_select")
 * - tableType: Display format for crosstab output (ONLY "frequency" or "mean_rows")
 *
 * The agent maps data structures to display formats based on survey semantics.
 *
 * IMPORTANT: There are only TWO valid table types:
 * - "frequency": For categorical data (counts/percentages per value)
 * - "mean_rows": For numeric data (mean/median/sd per item)
 *
 * All question patterns (rankings, grids, multi-selects) are handled using these two types
 * with appropriate row structures and filterValues.
 */

// =============================================================================
// Table Type Catalog (STRICT - only 2 types allowed)
// =============================================================================

/**
 * Available table types the agent can output.
 * CRITICAL: Only these two types are valid. The R script generator will reject any other values.
 *
 * - frequency: For categorical variables. Each row represents one answer value.
 *              filterValue must be the value code (e.g., "1", "2", "3") - NEVER empty.
 *
 * - mean_rows: For numeric variables. Each row represents one variable/item.
 *              filterValue must be empty string "".
 *
 * Rankings, grids, and multi-selects are all handled as "frequency" tables with appropriate
 * row structures and filterValues.
 */
export const TableTypeSchema = z.enum([
  'frequency',      // Categorical data - count/percent per value (filterValue = value code, never empty)
  'mean_rows',      // Numeric data - mean/median/sd per item (filterValue = "" always)
]);

export type TableType = z.infer<typeof TableTypeSchema>;

/**
 * Available statistics for table calculations
 */
export const StatTypeSchema = z.enum([
  'count',    // Raw count
  'percent',  // Percentage of base
  'mean',     // Arithmetic mean
  'median',   // Median value
  'sd',       // Standard deviation
]);

export type StatType = z.infer<typeof StatTypeSchema>;

// =============================================================================
// Input Schemas
// =============================================================================

/**
 * Scale label mapping (e.g., 1="Very satisfied", 2="Satisfied", etc.)
 */
export const ScaleLabelSchema = z.object({
  value: z.union([z.number(), z.string()]),
  label: z.string(),
});

export type ScaleLabel = z.infer<typeof ScaleLabelSchema>;

/**
 * Single item in a question group (one variable from the datamap)
 */
export const TableAgentInputItemSchema = z.object({
  column: z.string(),           // Variable name: "S8r1", "A1r1"
  label: z.string(),            // From description: "Treating/Managing patients"
  context: z.string().optional(), // Parent context with identifiers: "A3ar1: Product A - ..."
  normalizedType: z.string(),   // "numeric_range", "categorical_select", "binary_flag", etc.
  valueType: z.string(),        // Raw value type: "Values: 0-100", "Values: 1-2"

  // Optional type-specific metadata
  rangeMin: z.number().optional(),
  rangeMax: z.number().optional(),
  allowedValues: z.array(z.union([z.number(), z.string()])).optional(),
  scaleLabels: z.array(ScaleLabelSchema).optional(),
});

export type TableAgentInputItem = z.infer<typeof TableAgentInputItemSchema>;

/**
 * Grouped input for a single question (what agent receives per call)
 * Questions are grouped by parent before being sent to the agent.
 */
export const TableAgentInputSchema = z.object({
  questionId: z.string(),       // Parent question ID: "S8", "A1"
  questionText: z.string(),     // Question text from description (parent) or context (sub)

  // All variables for this question
  items: z.array(TableAgentInputItemSchema).min(1),

  // Optional survey markdown context (for enhanced reasoning)
  surveyContext: z.string().optional(),
});

export type TableAgentInput = z.infer<typeof TableAgentInputSchema>;

// =============================================================================
// Output Schemas
// NOTE: All properties must be REQUIRED for Azure OpenAI structured output compatibility
// Azure OpenAI does not support optional properties in JSON Schema
// Use empty strings/arrays or sentinel values instead of optional
// =============================================================================

/**
 * Single row in a table definition
 */
export const TableRowSchema = z.object({
  variable: z.string(),         // SPSS variable name: "S8r1", "A1r1"
  label: z.string(),            // Display label: "Treating/Managing patients"

  // For frequency tables: the value code to filter on (e.g., "1", "2", "3") - REQUIRED, never empty
  // For mean_rows tables: must be empty string ""
  // Use comma-separated for merged values (e.g., "4,5" for T2B)
  filterValue: z.string(),
});

export type TableRow = z.infer<typeof TableRowSchema>;

/**
 * @deprecated Hints are no longer used as of Part 4 refactor.
 * TableGenerator now produces deterministic output without hints.
 * VerificationAgent handles T2B/B2B/NETs using survey document context.
 */
export const TableHintSchema = z.enum([
  'ranking',   // Ranking question - downstream may add combined rank tables
  'scale-5',   // 5-point Likert scale - downstream may add T2B, B2B, Middle
  'scale-7',   // 7-point Likert scale - downstream may add T3B, B3B, etc.
]);

export type TableHint = z.infer<typeof TableHintSchema>;

/**
 * Structural metadata about a table
 * Added in Part 4 refactor to provide structural information about table generation
 */
export const TableMetaSchema = z.object({
  /** Number of unique variables/columns in the table */
  itemCount: z.number(),
  /** Number of rows in the table */
  rowCount: z.number(),
  /** Value range for numeric tables [min, max] */
  valueRange: z.tuple([z.number(), z.number()]).optional(),
  /** Count of unique values for categorical tables */
  uniqueValues: z.number().optional(),
  /** Grid dimensions if detected from variable naming pattern */
  gridDimensions: z.object({
    rows: z.number(),
    cols: z.number(),
  }).optional(),
  /** Actual distribution stats from data (for mean_rows tables) */
  distribution: z.object({
    n: z.number(),
    min: z.number(),
    max: z.number(),
    mean: z.number(),
    median: z.number(),
    q1: z.number(),
    q3: z.number(),
  }).optional(),
});

export type TableMeta = z.infer<typeof TableMetaSchema>;

/**
 * Single table definition (one question may produce multiple tables)
 * Note: stats are NOT included - they are inferred deterministically from tableType downstream
 *
 * As of Part 4 refactor:
 * - hints field is deprecated (kept for backward compatibility, should be empty array)
 * - meta field added for structural metadata
 */
export const TableDefinitionSchema = z.object({
  tableId: z.string(),          // Unique ID: "s8", "a1_indication_a"
  questionText: z.string(),     // Question text (used as table title)
  tableType: TableTypeSchema,   // ONLY "frequency" or "mean_rows" - nothing else

  // Rows in the table
  rows: z.array(TableRowSchema),

  // @deprecated - hints are no longer used, kept for backward compatibility
  // Always pass empty array [] for new tables
  hints: z.array(TableHintSchema).optional().default([]),

  // Structural metadata (added in Part 4 refactor)
  meta: TableMetaSchema.optional(),
});

export type TableDefinition = z.infer<typeof TableDefinitionSchema>;

/**
 * Complete output for a question group
 */
export const TableAgentOutputSchema = z.object({
  questionId: z.string(),       // Parent question ID (matches input)
  questionText: z.string(),     // For reference

  // One or more tables for this question
  tables: z.array(TableDefinitionSchema).min(1),

  // Agent confidence in this interpretation (0.0-1.0)
  confidence: z.number().min(0).max(1),

  // Brief explanation of decisions made
  reasoning: z.string(),
});

export type TableAgentOutput = z.infer<typeof TableAgentOutputSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate TableAgent input
 */
export const validateTableAgentInput = (data: unknown): TableAgentInput => {
  return TableAgentInputSchema.parse(data);
};

export const isValidTableAgentInput = (data: unknown): data is TableAgentInput => {
  return TableAgentInputSchema.safeParse(data).success;
};

/**
 * Validate TableAgent output
 */
export const validateTableAgentOutput = (data: unknown): TableAgentOutput => {
  return TableAgentOutputSchema.parse(data);
};

export const isValidTableAgentOutput = (data: unknown): data is TableAgentOutput => {
  return TableAgentOutputSchema.safeParse(data).success;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get all unique variables referenced in table definitions
 */
export const getTableVariables = (output: TableAgentOutput): string[] => {
  const variables = new Set<string>();
  for (const table of output.tables) {
    for (const row of table.rows) {
      variables.add(row.variable);
    }
  }
  return Array.from(variables);
};

/**
 * Get all table IDs from output
 */
export const getTableIds = (output: TableAgentOutput): string[] => {
  return output.tables.map(t => t.tableId);
};

/**
 * Check if output contains specific table type
 */
export const hasTableType = (output: TableAgentOutput, type: TableType): boolean => {
  return output.tables.some(t => t.tableType === type);
};

/**
 * Filter tables by type
 */
export const getTablesByType = (output: TableAgentOutput, type: TableType): TableDefinition[] => {
  return output.tables.filter(t => t.tableType === type);
};

/**
 * Calculate average confidence across multiple outputs
 */
export const calculateAverageConfidence = (outputs: TableAgentOutput[]): number => {
  if (outputs.length === 0) return 0;
  const sum = outputs.reduce((acc, o) => acc + o.confidence, 0);
  return sum / outputs.length;
};

/**
 * Combine multiple outputs into a single array of table definitions
 */
export const combineTableDefinitions = (outputs: TableAgentOutput[]): TableDefinition[] => {
  return outputs.flatMap(o => o.tables);
};
