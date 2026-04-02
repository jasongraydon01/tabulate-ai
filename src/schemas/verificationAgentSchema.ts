import { z } from 'zod';
import { TableTypeSchema, TableDefinitionSchema, TableRowSchema } from './tableAgentSchema';
import type {
  ComputeRowAggregationModeV1,
  ComputeRowContextV1,
  ComputeRowUniverseModeV1,
  ComputeTableContextV1,
} from '@/lib/v3/runtime/compute/contract';
import type {
  ResolvedBaseMode,
  ResolvedBaseTextTemplate,
} from '@/lib/v3/runtime/canonical/types';

/**
 * VerificationAgent Schemas
 *
 * Purpose: Define input/output structures for the VerificationAgent that enhances
 * TableAgent output using the actual survey document.
 *
 * Key capabilities:
 * - Fix labels: Replace "Value 1" with actual survey answer text
 * - Split tables: Separate by treatment when appropriate
 * - Add NET rows: Roll-up rows for grouped answer options
 * - Create derived tables: T2B/B2B for satisfaction/agreement scales
 * - Flag exclusions: Mark low-value tables for reference sheet
 *
 * Design principle: Agent outputs the DESIRED END STATE, not discrete actions.
 */

// =============================================================================
// Extended Row Schema (adds NET and indentation support)
// =============================================================================

/**
 * Extended table row with NET and indentation support.
 *
 * NOTE: Azure OpenAI structured output requires all properties to be defined.
 * We use empty strings/arrays and false for "not applicable" instead of undefined.
 */
export const ExtendedTableRowSchema = z.object({
  /** SPSS variable name - NEVER change this */
  variable: z.string(),

  /** Display label - CAN be updated with survey text */
  label: z.string(),

  /** Filter value(s) - can be comma-separated for T2B (e.g., "4,5") */
  filterValue: z.string(),

  /** Is this a NET/roll-up row? */
  isNet: z.boolean(),

  /** Variables to aggregate for NET rows (empty array if not a NET) */
  netComponents: z.array(z.string()),

  /** Indentation level (0 = normal, 1 = indented under NET) */
  indent: z.number(),

  /** Canonical row kind from V3 assembly (value, net, stat, bin, rank, topk, not_answered).
   *  Optional for backward compatibility with legacy VerificationAgent output. */
  rowKind: z.string().optional(),

  /** Phase 4 compute contract — row-level denominator/aggregation behavior. */
  computeContext: z.object({
    version: z.literal(1),
    universeMode: z.enum([
      'masked_row_observed_n',
      'masked_shared_table_n',
      'model',
    ] as [ComputeRowUniverseModeV1, ...ComputeRowUniverseModeV1[]]),
    aggregationMode: z.enum([
      'none',
      'single_variable_value_set',
      'any_component_selected',
      'row_sum_components',
      'not_answered',
      'stat_summary',
    ] as [ComputeRowAggregationModeV1, ...ComputeRowAggregationModeV1[]]),
    sourceVariable: z.string().nullable(),
    componentVariables: z.array(z.string()),
    componentValues: z.array(z.string()),
  }).optional(),
});

export type ExtendedTableRow = z.infer<typeof ExtendedTableRowSchema>;

export const ComputeTableContextSchema = z.object({
  version: z.literal(1),
  referenceUniverse: z.enum(['total', 'question', 'cluster', 'model']).nullable(),
  effectiveBaseMode: z.enum(['table_mask_then_row_observed_n', 'table_mask_shared_n', 'model']).nullable(),
  tableMaskIntent: z.enum([
    'none',
    'question_universe',
    'precision_item',
    'cluster_universe',
    'legacy_additional_filter',
    'model',
  ]),
  tableMaskRecipe: z.union([
    z.object({ kind: z.literal('none') }),
    z.object({
      kind: z.literal('any_answered'),
      variables: z.array(z.string()).min(1),
    }),
    z.object({
      kind: z.literal('variable_answered'),
      variable: z.string(),
    }),
    z.object({ kind: z.literal('model') }),
  ]).nullable(),
  rebasePolicy: z.enum(['none', 'exclude_non_substantive_tail']),
  rebaseSourceVariables: z.array(z.string()),
  rebaseExcludedValues: z.array(z.number()),
  validityPolicy: z.enum(['none', 'legacy_expression']),
  validityExpression: z.string().nullable(),
  referenceBaseN: z.number().nullable(),
  itemBaseRange: z.tuple([z.number(), z.number()]).nullable(),
  baseViewRole: z.enum(['anchor', 'precision']).nullable(),
  plannerBaseComparability: z.enum(['shared', 'varying_but_acceptable', 'split_recommended', 'ambiguous']).nullable(),
  plannerBaseSignals: z.array(z.string()),
  computeRiskSignals: z.array(z.string()),
  legacyCompatibility: z.object({
    basePolicy: z.string(),
    additionalFilter: z.string(),
  }),
});

const WinCrossDenominatorSemanticSchema = z.enum([
  'answering_base',
  'sample_base',
  'qualified_respondents',
  'filtered_sample',
  'response_level',
]);

const ResolvedBaseValidationSchema = z.object({
  tautologicalSplitForbidden: z.boolean(),
  substantiveRebasingForbidden: z.boolean(),
  requiresSharedDisplayedBase: z.boolean(),
});

// =============================================================================
// Extended Table Definition Schema
// =============================================================================

/**
 * Extended table definition with derived table and exclusion support.
 *
 * NOTE: questionId is required for Azure OpenAI structured output compatibility.
 * The agent outputs it (can be empty string), and we overwrite with the correct value after.
 */
export const ExtendedTableDefinitionSchema = z.object({
  /** Unique table ID */
  tableId: z.string(),

  /** Question ID (e.g., "S1", "A3", "B2") - agent outputs empty string, we overwrite after */
  questionId: z.string(),

  /** Question text - the cleaned/improved question text from survey (used as table title) */
  questionText: z.string(),

  /** Table type - ONLY "frequency" or "mean_rows" allowed */
  tableType: TableTypeSchema,

  /** Table rows */
  rows: z.array(ExtendedTableRowSchema),

  /** Original table ID if this was split from another table (empty string if not split) */
  sourceTableId: z.string(),

  /** Is this a derived table (T2B, combined rankings, etc.)? */
  isDerived: z.boolean(),

  /** Should this table be excluded from main output? (moves to reference sheet) */
  exclude: z.boolean(),

  /** Reason for exclusion (empty string if not excluded) */
  excludeReason: z.string(),

  // =========================================================================
  // Phase 2: Additional Table Metadata
  // =========================================================================

  /**
   * Survey section name (verbatim from survey document, ALL CAPS)
   * Example: "SCREENER", "INDICATION AWARENESS, ALLOCATIONS & MONOTHERAPY PERCEPTIONS"
   * Empty string if section cannot be determined.
   */
  surveySection: z.string(),

  /**
   * Base text describing WHO was asked this question (not the question text itself)
   * Example: "Total interventional radiologists", "Those who manage primary liver cancers"
   * Empty string defaults to "All respondents" in Excel output.
   */
  baseText: z.string(),

  /**
   * Agent-generated note for additional context (use sparingly)
   * Example: "(Multiple answers accepted)", "(Asked if S2 = 1 or 2)", "(Responses sorted descending)"
   * Empty string if no note needed.
   */
  userNote: z.string(),

  /**
   * Subtitle differentiating this table from siblings derived from the same question.
   * Used when multiple tables are created from one source question (brand splits, comparison views, etc.)
   * Example: "Brand A (generic name)", "T2B Comparison", "Distribution: Years of Experience"
   * Empty string for original/overview tables or tables with no siblings.
   */
  tableSubtitle: z.string(),

  /** Canonical sort position from V3 assembly. Infrastructure-populated when available. */
  sortOrder: z.number().optional(),

  /** Canonical classification metadata required by compute/export paths. */
  tableKind: z.string().optional(),
  wincrossDenominatorSemantic: WinCrossDenominatorSemanticSchema.optional(),
  wincrossQualifiedCodes: z.array(z.string()).optional(),
  wincrossFilteredTotalExpr: z.string().nullable().optional(),
  resolvedBaseMode: z.enum([
    'total_base',
    'table_universe_base',
    'model_base',
  ] as [ResolvedBaseMode, ...ResolvedBaseMode[]]).optional(),
  resolvedSplitPolicy: z.enum(['none', 'required']).optional(),
  resolvedBaseTextTemplate: z.enum([
    'total_respondents',
    'shown_this_question',
    'shown_this_item',
    'model_derived',
  ] as [ResolvedBaseTextTemplate, ...ResolvedBaseTextTemplate[]]).optional(),
  resolvedBaseValidation: ResolvedBaseValidationSchema.optional(),

  // =========================================================================
  // Phase 3: Filter Fields (skip/show logic handling via FilterApplicator)
  // =========================================================================

  /**
   * Additional R filter expression to apply before counting.
   * Applied after banner cut, before calculating statistics.
   * Example: "Q3 == 1" or "usage_BrandX > 0"
   * Empty string means no additional filter.
   */
  additionalFilter: z.string(),

  /**
   * Whether this table's base filter requires human review.
   * Set true when agent is uncertain about skip logic interpretation.
   */
  filterReviewRequired: z.boolean(),

  /**
   * Original table ID if this was split by BaseFilterAgent due to different bases.
   * Different from sourceTableId (which is for VerificationAgent T2B/derived splits).
   * Empty string if not split from another table.
   */
  splitFromTableId: z.string(),

  // =========================================================================
  // Provenance Tracking
  // =========================================================================

  /**
   * Which agent last modified this table in a meaningful way.
   * Set by infrastructure code, not by agents themselves.
   * Used for debugging and review to trace responsibility.
   */
  lastModifiedBy: z.enum([
    'VerificationAgent',
    'FilterApplicator',
    'GridAutoSplitter',
    'MaxDiffConsolidator',
    'TableEnhancer',
    'DeterministicBaseEngine',
    'TableBlockAssembler',
    'TableMetadataPrefill',
  ]),

  /** Phase 4 compute contract — compute-only structural masking/base metadata. */
  computeContext: ComputeTableContextSchema.optional(),

});

export type ExtendedTableDefinition = z.infer<typeof ExtendedTableDefinitionSchema>;
export type { ComputeTableContextV1, ComputeRowContextV1 };

// =============================================================================
// Loop/Stacking Runtime Type
// =============================================================================

/**
 * ExtendedTableDefinition with loopDataFrame attached by infrastructure.
 *
 * loopDataFrame is NOT part of the AI-facing schema — agents should never
 * see or set this value. PipelineRunner attaches it after verification
 * based on which row variables are loop base names.
 *
 * Empty string = use default 'data' frame (non-loop tables).
 * Non-empty = use named stacked frame (e.g., 'stacked_loop_1').
 */
export type TableWithLoopFrame = ExtendedTableDefinition & {
  loopDataFrame: string;
  /**
   * Non-substantive scale codes to exclude from mean/median/stddev calculations.
   * E.g., [98, 99] for Don't Know / Refused on a 1-7 scale.
   * Set by canonical → compute adapter from CanonicalTable.statsSpec.excludeTailValues.
   * Empty array = no exclusions.
   */
  excludeTailValues?: number[];
};

// =============================================================================
// Verification Agent Output Schema
// =============================================================================

/**
 * Output from VerificationAgent for a single input table.
 * Contains the desired end state - may be 1 table, N tables (split), or 1 excluded table.
 */
export const VerificationAgentOutputSchema = z.object({
  /** Output tables (1+ tables representing the desired end state) */
  tables: z.array(ExtendedTableDefinitionSchema),

  /** List of changes made (empty array if no changes) */
  changes: z.array(z.string()),

  /** Confidence in the verification (0.0-1.0) */
  confidence: z.number().min(0).max(1),

  /** Brief plain-language summary of what was changed, for a non-technical user */
  userSummary: z.string(),
});

export type VerificationAgentOutput = z.infer<typeof VerificationAgentOutputSchema>;

// =============================================================================
// Verification Agent Input Schema
// =============================================================================

/**
 * Input to VerificationAgent for a single table.
 */
export const VerificationAgentInputSchema = z.object({
  /** The table definition from TableAgent */
  table: TableDefinitionSchema,

  /** Question context */
  questionId: z.string(),
  questionText: z.string(),

  /** Survey markdown (full or section) */
  surveyMarkdown: z.string(),

  /** Verbose datamap entries for variables in this table */
  datamapContext: z.string(),
});

export type VerificationAgentInput = z.infer<typeof VerificationAgentInputSchema>;

// =============================================================================
// Combined Results Schema
// =============================================================================

/**
 * Combined results from processing all tables.
 */
export const VerificationResultsSchema = z.object({
  /** All verified tables */
  tables: z.array(ExtendedTableDefinitionSchema),

  /** Processing metadata */
  metadata: z.object({
    totalInputTables: z.number(),
    totalOutputTables: z.number(),
    tablesModified: z.number(),
    tablesSplit: z.number(),
    tablesExcluded: z.number(),
    averageConfidence: z.number(),
  }),

  /** All changes across all tables */
  allChanges: z.array(
    z.object({
      tableId: z.string(),
      changes: z.array(z.string()),
    })
  ),
});

export type VerificationResults = z.infer<typeof VerificationResultsSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate VerificationAgent output.
 */
export const validateVerificationOutput = (data: unknown): VerificationAgentOutput => {
  return VerificationAgentOutputSchema.parse(data);
};

export const isValidVerificationOutput = (data: unknown): data is VerificationAgentOutput => {
  return VerificationAgentOutputSchema.safeParse(data).success;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a standard TableRow to ExtendedTableRow with defaults.
 */
export function toExtendedRow(row: z.infer<typeof TableRowSchema>): ExtendedTableRow {
  return {
    variable: row.variable,
    label: row.label,
    filterValue: row.filterValue,
    isNet: false,
    netComponents: [],
    indent: 0,
  };
}

/**
 * Convert a standard TableDefinition to ExtendedTableDefinition.
 * questionId defaults to empty string - caller should overwrite with correct value.
 *
 * Note: As of Part 4 refactor, hints are no longer included in ExtendedTableDefinition.
 */
export function toExtendedTable(
  table: z.infer<typeof TableDefinitionSchema>,
  questionId: string = '',
  questionText: string = ''
): ExtendedTableDefinition {
  return {
    tableId: table.tableId,
    questionId,
    questionText: questionText || table.questionText, // Use provided questionText or fall back to table.questionText
    tableType: table.tableType,
    rows: table.rows.map(toExtendedRow),
    sourceTableId: '',
    isDerived: false,
    exclude: false,
    excludeReason: '',
    // Phase 2: Additional table metadata (defaults)
    surveySection: '',
    baseText: '',
    userNote: '',
    tableSubtitle: '',
    // Phase 3: BaseFilterAgent fields (defaults)
    additionalFilter: '',
    filterReviewRequired: false,
    splitFromTableId: '',
    // Provenance tracking (set by infrastructure, not agents)
    lastModifiedBy: 'VerificationAgent',
  };
}

/**
 * Create a passthrough output (no changes).
 * questionId is empty - will be overwritten by caller.
 */
export function createPassthroughOutput(
  table: z.infer<typeof TableDefinitionSchema>
): VerificationAgentOutput {
  return {
    tables: [toExtendedTable(table, '')],
    changes: [],
    confidence: 1.0,
    userSummary: 'No changes needed.',
  };
}

/**
 * Get summary statistics for verification results.
 */
export function summarizeVerificationResults(
  results: VerificationAgentOutput[]
): VerificationResults['metadata'] {
  const totalInputTables = results.length;
  const totalOutputTables = results.reduce((sum, r) => sum + r.tables.length, 0);
  const tablesModified = results.filter((r) => r.changes.length > 0).length;
  const tablesSplit = results.filter((r) => r.tables.length > 1).length;
  const tablesExcluded = results.reduce(
    (sum, r) => sum + r.tables.filter((t) => t.exclude).length,
    0
  );
  const averageConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  return {
    totalInputTables,
    totalOutputTables,
    tablesModified,
    tablesSplit,
    tablesExcluded,
    averageConfidence,
  };
}
