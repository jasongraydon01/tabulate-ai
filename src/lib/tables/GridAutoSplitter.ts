/**
 * GridAutoSplitter
 *
 * Deterministic pre-verification processor that splits oversized grid tables
 * into one sub-table per unique variable. Runs post-FilterApplicator,
 * pre-VerificationAgent, so all filter fields carry through to each sub-table.
 *
 * @deprecated This module is retained for compatibility/rollback only and is
 * not invoked in active pipeline execution paths (PipelineRunner,
 * pipelineOrchestrator, reviewCompletion).
 *
 * A grid question with N items rated on a K-point scale produces N*K flat rows.
 * Splitting into N sub-tables of K rows each gives the VerificationAgent a
 * manageable scope per call.
 */

import type { ExtendedTableDefinition } from '../../schemas/verificationAgentSchema';
import type { VerboseDataMapType } from '../../schemas/processingSchemas';

// =============================================================================
// Types
// =============================================================================

export interface GridSplitAction {
  originalTableId: string;
  reason: string;
  rowCount: number;
  uniqueVariables: number;
  subTablesCreated: number;
}

export interface GridSplitResult {
  tables: ExtendedTableDefinition[];
  actions: GridSplitAction[];
  summary: {
    totalInput: number;
    totalOutput: number;
    tablesSplit: number;
    tablesPassedThrough: number;
  };
}

export interface GridSplitOptions {
  /** Row count threshold to trigger splitting (default: 140, env: GRID_SPLIT_THRESHOLD) */
  threshold?: number;
  /** Verbose datamap for subtitle generation */
  verboseDataMap?: VerboseDataMapType[];
}

// =============================================================================
// Default threshold
// =============================================================================

function getThreshold(options?: GridSplitOptions): number {
  if (options?.threshold !== undefined) return options.threshold;
  const envVal = process.env.GRID_SPLIT_THRESHOLD;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 140;
}

// =============================================================================
// Core function
// =============================================================================

/**
 * Split oversized grid tables into one sub-table per unique variable.
 *
 * Criteria for splitting:
 * - `rows.length > threshold` (default 140)
 * - More than 1 unique variable across all rows
 * - tableType is NOT `mean_rows` (always 1 row per variable, never oversized)
 *
 * Everything else passes through unchanged.
 *
 * @deprecated Inactive in active pipeline paths; retained for compatibility.
 */
export function splitOversizedGrids(
  tables: ExtendedTableDefinition[],
  options?: GridSplitOptions,
): GridSplitResult {
  const threshold = getThreshold(options);

  // Build datamap lookup for subtitle generation
  const datamapByColumn = new Map<string, VerboseDataMapType>();
  if (options?.verboseDataMap) {
    for (const entry of options.verboseDataMap) {
      datamapByColumn.set(entry.column, entry);
    }
  }

  const outputTables: ExtendedTableDefinition[] = [];
  const actions: GridSplitAction[] = [];
  let tablesSplit = 0;
  let tablesPassedThrough = 0;

  for (const table of tables) {
    // Skip mean_rows tables — always 1 row per variable
    if (table.tableType === 'mean_rows') {
      outputTables.push(table);
      tablesPassedThrough++;
      continue;
    }

    // Check row count against threshold
    if (table.rows.length <= threshold) {
      outputTables.push(table);
      tablesPassedThrough++;
      continue;
    }

    // Group rows by variable (insertion-order preserving Map)
    const rowsByVariable = new Map<string, typeof table.rows>();
    for (const row of table.rows) {
      const existing = rowsByVariable.get(row.variable);
      if (existing) {
        existing.push(row);
      } else {
        rowsByVariable.set(row.variable, [row]);
      }
    }

    // Need >1 unique variable to split
    if (rowsByVariable.size <= 1) {
      outputTables.push(table);
      tablesPassedThrough++;
      continue;
    }

    // Split: create one sub-table per variable
    for (const [variable, rows] of rowsByVariable) {
      // Build subtitle from datamap if available
      const datamapEntry = datamapByColumn.get(variable);
      const subtitle = datamapEntry
        ? `${variable}: ${datamapEntry.description}`
        : variable;

      const subTable: ExtendedTableDefinition = {
        tableId: `${table.tableId}_${variable.toLowerCase()}`,
        questionId: table.questionId,
        questionText: table.questionText,
        tableType: table.tableType,
        rows,
        sourceTableId: table.sourceTableId,
        isDerived: table.isDerived,
        exclude: table.exclude,
        excludeReason: table.excludeReason,
        surveySection: table.surveySection,
        baseText: table.baseText,
        userNote: table.userNote,
        tableSubtitle: subtitle,
        additionalFilter: table.additionalFilter,
        filterReviewRequired: table.filterReviewRequired,
        // Chain provenance: if already split by FilterApplicator, chain from that
        splitFromTableId: table.splitFromTableId || table.tableId,
        lastModifiedBy: 'GridAutoSplitter',
      };

      outputTables.push(subTable);
    }

    actions.push({
      originalTableId: table.tableId,
      reason: `${table.rows.length} rows > threshold ${threshold}, ${rowsByVariable.size} unique variables`,
      rowCount: table.rows.length,
      uniqueVariables: rowsByVariable.size,
      subTablesCreated: rowsByVariable.size,
    });
    tablesSplit++;
  }

  return {
    tables: outputTables,
    actions,
    summary: {
      totalInput: tables.length,
      totalOutput: outputTables.length,
      tablesSplit,
      tablesPassedThrough,
    },
  };
}
