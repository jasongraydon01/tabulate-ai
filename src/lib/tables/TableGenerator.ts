/**
 * TableGenerator
 *
 * @deprecated V3 Migration: This module is superseded by the V3 canonical table
 * assembly pipeline (step 13d). It remains in use by the legacy production pipeline
 * on `main` but will be removed after V3 runtime migration Phase 6.
 * See: docs/v3-runtime-architecture-refactor-plan.md
 * Replacement: src/lib/v3/runtime/canonical/assemble.ts (Phase 2)
 *
 * Purpose: Deterministically generate table definitions from grouped datamap.
 * This replaces the LLM-based TableAgent with consistent, predictable output.
 *
 * Architecture:
 *   VerboseDataMap → DataMapGrouper → TableGenerator → VerificationAgent
 *
 * Mapping Rules:
 * | normalizedType      | tableType   | filterValue        | Notes                    |
 * |---------------------|-------------|--------------------|--------------------------
 * | numeric_range       | mean_rows   | "" (empty)         | One row per item         |
 * | binary_flag         | frequency   | "1"                | One row per item         |
 * | categorical_select  | frequency   | value code         | One row per value/item   |
 * | ordinal_scale       | frequency   | value code         | Same as categorical      |
 *
 * What TableGenerator does:
 * - Creates one "overview" table per question group
 * - Applies deterministic mapping rules
 * - Calculates structural metadata (itemCount, rowCount, etc.)
 *
 * What TableGenerator does NOT do:
 * - No table splitting (VerificationAgent's job)
 * - No semantic hints (hints field removed)
 * - No LLM reasoning (this is deterministic code)
 */

import type { QuestionGroup, QuestionItem } from './DataMapGrouper';
import type { TableDefinition, TableRow } from '../../schemas/tableAgentSchema';

// =============================================================================
// Types
// =============================================================================

/**
 * Structural metadata about a generated table
 */
export interface TableMeta {
  /** Number of unique variables/columns in the table */
  itemCount: number;
  /** Number of rows in the table */
  rowCount: number;
  /** Value range for numeric tables [min, max] */
  valueRange?: [number, number];
  /** Count of unique values for categorical tables */
  uniqueValues?: number;
  /** Grid dimensions if detected from variable naming pattern */
  gridDimensions?: {
    rows: number;
    cols: number;
  };
}

/**
 * Extended table definition with metadata
 */
export interface TableDefinitionWithMeta extends Omit<TableDefinition, 'hints'> {
  /** Structural metadata */
  meta: TableMeta;
}

/**
 * Output for a single question group
 */
export interface TableGeneratorOutput {
  /** Parent question ID */
  questionId: string;
  /** Question text */
  questionText: string;
  /** Generated tables (typically one per group) */
  tables: TableDefinitionWithMeta[];
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate table definitions from grouped datamap.
 * Creates one table per question group using deterministic mapping rules.
 *
 * @param groups - Question groups from DataMapGrouper
 * @returns Array of table outputs, one per group
 */
export function generateTables(groups: QuestionGroup[]): TableGeneratorOutput[] {
  const outputs: TableGeneratorOutput[] = [];

  for (const group of groups) {
    const table = generateTableForGroup(group);
    outputs.push({
      questionId: group.questionId,
      questionText: group.questionText,
      tables: [table],
    });
  }

  return outputs;
}

/**
 * Generate a single table for a question group
 */
function generateTableForGroup(group: QuestionGroup): TableDefinitionWithMeta {
  const { questionId, questionText, items } = group;

  // Determine table type based on first item's normalizedType
  // All items in a group should have the same type (grouped by parent)
  const primaryType = items[0]?.normalizedType || 'unknown';
  const tableType = determineTableType(primaryType);

  // Generate rows based on table type and items
  const rows = generateRows(items, tableType);

  // Calculate metadata
  const meta = calculateMeta(items, rows, tableType);

  // Generate table ID (lowercase, sanitized)
  const tableId = sanitizeTableId(questionId);

  return {
    tableId,
    questionText: questionText || questionId,
    tableType,
    rows,
    meta,
  };
}

// =============================================================================
// Table Type Determination
// =============================================================================

/**
 * Map normalizedType to tableType
 */
function determineTableType(normalizedType: string): 'frequency' | 'mean_rows' {
  switch (normalizedType) {
    case 'numeric_range':
      return 'mean_rows';

    case 'binary_flag':
    case 'categorical_select':
    case 'ordinal_scale':
    case 'matrix_single_choice':
    case 'percentage_per_option':
    default:
      return 'frequency';
  }
}

// =============================================================================
// Row Generation
// =============================================================================

/**
 * Generate rows based on table type and items
 */
function generateRows(
  items: QuestionItem[],
  tableType: 'frequency' | 'mean_rows'
): TableRow[] {
  if (tableType === 'mean_rows') {
    return generateMeanRows(items);
  } else {
    return generateFrequencyRows(items);
  }
}

/**
 * Generate rows for mean_rows table (one row per item)
 */
function generateMeanRows(items: QuestionItem[]): TableRow[] {
  return items.map(item => ({
    variable: item.column,
    label: item.label,
    filterValue: '', // Always empty for mean_rows
  }));
}

/**
 * Generate rows for frequency table
 * Strategy depends on item characteristics:
 * - binary_flag: One row per item, filterValue = "1"
 * - categorical_select: One row per value per item
 */
function generateFrequencyRows(items: QuestionItem[]): TableRow[] {
  const rows: TableRow[] = [];
  const shouldPrefixScaleLabels = items.length > 1 && items.some(item => Boolean(item.subItemLabel));

  for (const item of items) {
    const { normalizedType, allowedValues, scaleLabels, column, label, subItemLabel } = item;

    if (normalizedType === 'binary_flag') {
      // Binary flag: one row showing "checked" state
      rows.push({
        variable: column,
        label: label,
        filterValue: '1',
      });
    } else if (allowedValues && allowedValues.length > 0) {
      // Categorical/ordinal: one row per allowed value
      for (const value of allowedValues) {
        const valueLabel = getValueLabel(
          value,
          scaleLabels,
          label,
          shouldPrefixScaleLabels ? subItemLabel : undefined,
        );
        rows.push({
          variable: column,
          label: valueLabel,
          filterValue: String(value),
        });
      }
    } else {
      // Fallback: single row with empty filter (will be flagged in validation)
      rows.push({
        variable: column,
        label: label,
        filterValue: '',
      });
    }
  }

  return rows;
}

/**
 * Get display label for a value
 * Prefers scaleLabels if available, otherwise constructs from item label
 */
function getValueLabel(
  value: number | string,
  scaleLabels: Array<{ value: number | string; label: string }> | undefined,
  itemLabel: string,
  subItemLabel?: string,
): string {
  // Check if we have a scale label for this value
  if (scaleLabels && scaleLabels.length > 0) {
    const scaleLabel = scaleLabels.find(sl => String(sl.value) === String(value));
    if (scaleLabel) {
      return combineSubItemAndScaleLabel(subItemLabel, scaleLabel.label);
    }
  }

  // Fallback: item label + value
  return `${itemLabel} - ${value}`;
}

function combineSubItemAndScaleLabel(subItemLabel: string | undefined, scaleLabel: string): string {
  const item = (subItemLabel || '').trim();
  const value = scaleLabel.trim();
  if (!item) return value;

  const normalizedItem = normalizeComparableText(item);
  const normalizedValue = normalizeComparableText(value);
  if (normalizedValue.startsWith(normalizedItem)) {
    return value;
  }

  return `${item} - ${value}`;
}

function normalizeComparableText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// =============================================================================
// Metadata Calculation
// =============================================================================

/**
 * Calculate structural metadata for a table
 */
function calculateMeta(
  items: QuestionItem[],
  rows: TableRow[],
  tableType: 'frequency' | 'mean_rows'
): TableMeta {
  const meta: TableMeta = {
    itemCount: items.length,
    rowCount: rows.length,
  };

  // Calculate value range for numeric items
  if (tableType === 'mean_rows') {
    const ranges = items
      .filter(item => item.rangeMin !== undefined && item.rangeMax !== undefined)
      .map(item => [item.rangeMin!, item.rangeMax!]);

    if (ranges.length > 0) {
      const minValue = Math.min(...ranges.map(r => r[0]));
      const maxValue = Math.max(...ranges.map(r => r[1]));
      meta.valueRange = [minValue, maxValue];
    }
  }

  // Calculate unique values for categorical items
  if (tableType === 'frequency') {
    const uniqueValues = new Set<string>();
    for (const row of rows) {
      if (row.filterValue) {
        uniqueValues.add(row.filterValue);
      }
    }
    meta.uniqueValues = uniqueValues.size;
  }

  // Detect grid dimensions from variable naming patterns
  const gridDims = detectGridDimensions(items);
  if (gridDims) {
    meta.gridDimensions = gridDims;
  }

  return meta;
}

/**
 * Detect grid dimensions from variable naming patterns
 * Looks for patterns like: Q5r1c1, Q5r1c2, Q5r2c1, Q5r2c2
 */
function detectGridDimensions(
  items: QuestionItem[]
): { rows: number; cols: number } | undefined {
  if (items.length < 2) return undefined;

  // Pattern: [prefix]r[row]c[col]
  const pattern = /^(.+?)r(\d+)c(\d+)$/i;

  const rowNums = new Set<number>();
  const colNums = new Set<number>();

  for (const item of items) {
    const match = item.column.match(pattern);
    if (match) {
      rowNums.add(parseInt(match[2], 10));
      colNums.add(parseInt(match[3], 10));
    }
  }

  // Only return if we found a consistent grid pattern
  if (rowNums.size > 0 && colNums.size > 0) {
    const expectedItems = rowNums.size * colNums.size;
    // Allow some tolerance (might have some missing cells)
    if (items.length >= expectedItems * 0.8) {
      return {
        rows: rowNums.size,
        cols: colNums.size,
      };
    }
  }

  return undefined;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Sanitize question ID for use as table ID
 */
function sanitizeTableId(questionId: string): string {
  return questionId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
    .replace(/_+/g, '_');
}

/**
 * Get statistics about generated tables
 */
export function getGeneratorStats(outputs: TableGeneratorOutput[]): {
  totalGroups: number;
  totalTables: number;
  totalRows: number;
  tableTypeDistribution: Record<string, number>;
  avgRowsPerTable: number;
} {
  const totalTables = outputs.reduce((sum, o) => sum + o.tables.length, 0);
  const totalRows = outputs.reduce(
    (sum, o) => sum + o.tables.reduce((s, t) => s + t.rows.length, 0),
    0
  );

  const tableTypeDistribution: Record<string, number> = {};
  for (const output of outputs) {
    for (const table of output.tables) {
      tableTypeDistribution[table.tableType] = (tableTypeDistribution[table.tableType] || 0) + 1;
    }
  }

  return {
    totalGroups: outputs.length,
    totalTables,
    totalRows,
    tableTypeDistribution,
    avgRowsPerTable: totalTables > 0 ? totalRows / totalTables : 0,
  };
}

// =============================================================================
// Conversion to Legacy Format
// =============================================================================

/**
 * Convert TableDefinitionWithMeta to TableDefinition (legacy format without hints)
 * Used for compatibility with existing VerificationAgent pipeline
 */
export function toTableDefinition(
  table: TableDefinitionWithMeta
): Omit<TableDefinition, 'hints'> & { hints: never[]; meta?: TableMeta } {
  return {
    tableId: table.tableId,
    questionText: table.questionText,
    tableType: table.tableType,
    rows: table.rows,
    hints: [], // Empty array for compatibility
    meta: table.meta, // Preserve meta field for VerificationAgent
  };
}

/**
 * Convert all outputs to legacy format
 */
export function convertToLegacyFormat(
  outputs: TableGeneratorOutput[]
): Array<{
  questionId: string;
  questionText: string;
  tables: Array<Omit<TableDefinition, 'hints'> & { hints: never[] }>;
  confidence: number;
  reasoning: string;
}> {
  return outputs.map(output => ({
    questionId: output.questionId,
    questionText: output.questionText,
    tables: output.tables.map(toTableDefinition),
    confidence: 1.0, // Deterministic = always confident
    reasoning: 'Deterministic generation from datamap structure',
  }));
}
