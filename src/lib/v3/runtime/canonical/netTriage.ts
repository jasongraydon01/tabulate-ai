/**
 * NET Enrichment Triage — Deterministic filter for NET candidates (Stage 13e)
 *
 * Pure function that filters canonical tables to identify which ones are
 * candidates for NET (roll-up) enrichment by the NETEnrichmentAgent.
 *
 * A table is flagged for NET review if ALL criteria are met:
 * 1. tableKind === 'standard_overview'
 * 2. normalizedType is 'categorical_select' or 'binary_flag'
 * 3. Number of value rows (rowKind === 'value') > 4
 * 4. No existing isNet rows on the table
 * 5. analyticalSubtype is NOT scale, ranking, allocation, maxdiff, or numeric
 * 6. Table is not excluded
 */

import type { CanonicalTable } from './types';
import type { QuestionIdEntry } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NetTriageFlaggedTable {
  tableId: string;
  questionId: string;
  rowCount: number;
  reasons: string[];
}

export interface NetTriageSkippedTable {
  tableId: string;
  reason: string;
}

export interface NetTriageOutput {
  flagged: NetTriageFlaggedTable[];
  skipped: NetTriageSkippedTable[];
  summary: {
    totalTables: number;
    flaggedCount: number;
    skippedCount: number;
  };
}

export interface NetTriageInput {
  tables: CanonicalTable[];
  // Included for interface parity with other triage passes; currently unused.
  entries?: QuestionIdEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ELIGIBLE_NORMALIZED_TYPES = new Set(['categorical_select', 'binary_flag']);

const EXCLUDED_ANALYTICAL_SUBTYPES = new Set([
  'scale',
  'ranking',
  'allocation',
  'maxdiff',
  'numeric',
]);

const MIN_VALUE_ROWS = 5; // > 4, so minimum 5

// ─── Main Function ───────────────────────────────────────────────────────────

export function runNetTriage(input: NetTriageInput): NetTriageOutput {
  const flagged: NetTriageFlaggedTable[] = [];
  const skipped: NetTriageSkippedTable[] = [];

  for (const table of input.tables) {
    const skipReason = getSkipReason(table);
    if (skipReason) {
      skipped.push({ tableId: table.tableId, reason: skipReason });
    } else {
      const valueRowCount = table.rows.filter(r => r.rowKind === 'value').length;
      flagged.push({
        tableId: table.tableId,
        questionId: table.questionId,
        rowCount: valueRowCount,
        reasons: buildFlagReasons(table, valueRowCount),
      });
    }
  }

  return {
    flagged,
    skipped,
    summary: {
      totalTables: input.tables.length,
      flaggedCount: flagged.length,
      skippedCount: skipped.length,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the first reason a table should be skipped, or null if it passes all checks.
 */
function getSkipReason(table: CanonicalTable): string | null {
  if (table.exclude) {
    return 'table is excluded';
  }

  if (table.tableKind !== 'standard_overview') {
    return `not standard_overview (${table.tableKind})`;
  }

  if (!ELIGIBLE_NORMALIZED_TYPES.has(table.normalizedType)) {
    return `normalizedType not eligible (${table.normalizedType})`;
  }

  if (EXCLUDED_ANALYTICAL_SUBTYPES.has(table.analyticalSubtype)) {
    return `excluded analyticalSubtype (${table.analyticalSubtype})`;
  }

  const valueRowCount = table.rows.filter(r => r.rowKind === 'value').length;
  if (valueRowCount < MIN_VALUE_ROWS) {
    return `only ${valueRowCount} value rows (need > 4)`;
  }

  const hasExistingNets = table.rows.some(r => r.isNet);
  if (hasExistingNets) {
    return 'already has NET rows';
  }

  return null;
}

/**
 * Build human-readable reasons why a table was flagged for NET review.
 */
function buildFlagReasons(table: CanonicalTable, valueRowCount: number): string[] {
  const reasons: string[] = [];
  reasons.push(`standard_overview with ${valueRowCount} value rows`);
  reasons.push(`normalizedType: ${table.normalizedType}`);
  if (table.analyticalSubtype) {
    reasons.push(`analyticalSubtype: ${table.analyticalSubtype}`);
  }
  return reasons;
}
