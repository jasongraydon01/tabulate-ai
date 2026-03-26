/**
 * Deterministic Base Engine — Type Definitions
 *
 * Types for the data-driven base inference pipeline that replaces
 * the AI-driven skip logic chain (SkipLogicAgent → FilterTranslatorAgent → FilterApplicator).
 *
 * The engine reads the .sav file directly to compute who answered what,
 * then generates R filter expressions and base text deterministically.
 */

import type { ExtendedTableDefinition } from '../../schemas/verificationAgentSchema';

// =============================================================================
// Base Directive — computed per table by DeterministicBaseEngine
// =============================================================================

export interface BaseDirective {
  tableId: string;
  questionId: string;
  totalN: number;

  // Table-level metrics
  tableAskedN: number;
  tableGapPct: number;           // 100 - (askedN/totalN * 100)
  tableFilter: string;           // R expression: "!is.na(v1) | !is.na(v2) | ..."
  tableBaseText: string;         // "Those answering Q5" or ""
  needsTableFilter: boolean;     // true if gap >= threshold

  // Row-group-level (for grids with differing applicability)
  rowGroups: RowGroupDirective[];
  needsRowSplit: boolean;        // true if any row group differs significantly from table

  // Sum-to-100 detection
  sumConstraint: { detected: boolean; completionRate: number } | null;
}

export interface RowGroupDirective {
  groupId: string;
  variables: string[];
  askedN: number;
  gapPct: number;
  gapVsTable: number;           // difference from table-level askedPct
  filter: string;               // R expression for this row group
}

// =============================================================================
// Engine Result — returned by computeBaseDirectives()
// =============================================================================

export interface BaseEngineResult {
  directives: BaseDirective[];
  totalN: number;
  tablesAnalyzed: number;
  tablesWithBaseGap: number;
  tablesWithRowSplits: number;
  durationMs: number;
}

// =============================================================================
// Applicator Result — returned by applyBaseDirectives()
// =============================================================================

export interface BaseApplicatorResult {
  tables: ExtendedTableDefinition[];
  summary: {
    totalInputTables: number;
    totalOutputTables: number;
    passCount: number;
    filterCount: number;
    splitCount: number;
  };
}

// =============================================================================
// Internal types used by the engine
// =============================================================================

export interface TableSpec {
  tableId: string;
  questionId: string;
  variables: string[];
  rowGroups: { groupId: string; variables: string[] }[];
  expectsSum100: boolean;
}

export interface RTableMetric {
  tableId: string;
  questionId: string;
  varCount: number;
  existingVarCount: number;
  askedN: number;
  completeN: number;
  isNumericTable: boolean;
  tableSum100N: number | null;
  tableSum100RateAsked: number | null;
  tableSum100RateComplete: number | null;
  rowGroups: RGroupMetric[];
}

export interface RGroupMetric {
  groupId: string;
  varCount: number;
  existingVarCount: number;
  askedN: number;
  completeN: number;
  isNumericGroup: boolean;
  sum100N: number | null;
  sum100RateAsked: number | null;
  sum100RateComplete: number | null;
}

export interface RAuditResult {
  totalN: number;
  tables: RTableMetric[];
}

export interface BaseEngineOptions {
  /** Base gap threshold in percent (default: 2) */
  baseGapPct?: number;
  /** Row-group gap threshold in percent vs table askedPct (default: 2) */
  rowGapPct?: number;
  /** Minimum sum-to-100 completion rate (default: 0.9) */
  sumCompleteMin?: number;
  /** Sum tolerance for detecting 100% sums (default: 5) */
  sumTolerance?: number;
}
