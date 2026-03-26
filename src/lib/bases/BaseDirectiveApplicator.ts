/**
 * BaseDirectiveApplicator
 *
 * Pure deterministic code (no R, no AI). Takes tables and directives from
 * DeterministicBaseEngine, and applies additionalFilter/baseText to tables.
 *
 * Logic per table:
 * 1. No directive or no gap → pass through unchanged
 * 2. Table-level filter needed → set additionalFilter + baseText
 * 3. Row splits needed → create split tables (rows grouped by differing base)
 *
 * Sets lastModifiedBy: 'DeterministicBaseEngine' on modified tables.
 */

import type { ExtendedTableDefinition } from '../../schemas/verificationAgentSchema';
import type { BaseDirective, BaseApplicatorResult } from './types';

/**
 * Main entry point: apply base directives to tables.
 *
 * @param tables - ExtendedTableDefinition[] (post-verification or post-survey-filter)
 * @param directives - BaseDirective[] from DeterministicBaseEngine
 * @returns BaseApplicatorResult with updated tables and summary
 */
export function applyBaseDirectives(
  tables: ExtendedTableDefinition[],
  directives: BaseDirective[],
): BaseApplicatorResult {
  // Build lookup: tableId → directive
  const directiveById = new Map<string, BaseDirective>(
    directives.map(d => [d.tableId, d]),
  );

  const outputTables: ExtendedTableDefinition[] = [];
  let passCount = 0;
  let filterCount = 0;
  let splitCount = 0;

  for (const table of tables) {
    const directive = directiveById.get(table.tableId);

    // No directive → pass through
    if (!directive) {
      outputTables.push(table);
      passCount++;
      continue;
    }

    // No gap → pass through
    if (!directive.needsTableFilter && !directive.needsRowSplit) {
      outputTables.push(table);
      passCount++;
      continue;
    }

    // Row splits needed: create split tables per row group
    if (directive.needsRowSplit && directive.rowGroups.length > 0) {
      const splitTables = createRowSplitTables(table, directive);
      outputTables.push(...splitTables);
      splitCount += splitTables.length;
      continue;
    }

    // Table-level filter only
    if (directive.needsTableFilter) {
      outputTables.push({
        ...table,
        additionalFilter: directive.tableFilter,
        baseText: directive.tableBaseText || table.baseText,
        lastModifiedBy: 'DeterministicBaseEngine',
      });
      filterCount++;
      continue;
    }

    // Fallback: pass through
    outputTables.push(table);
    passCount++;
  }

  return {
    tables: outputTables,
    summary: {
      totalInputTables: tables.length,
      totalOutputTables: outputTables.length,
      passCount,
      filterCount,
      splitCount,
    },
  };
}

/**
 * Create split tables when row groups have differing bases.
 *
 * Each row group with a significantly different base gets its own table
 * with the appropriate filter. Rows NOT in any group are placed in a
 * "remainder" table with the table-level filter.
 */
function createRowSplitTables(
  table: ExtendedTableDefinition,
  directive: BaseDirective,
): ExtendedTableDefinition[] {
  const results: ExtendedTableDefinition[] = [];

  // Identify which variables belong to which row group
  const varToGroup = new Map<string, string>();
  for (const rg of directive.rowGroups) {
    for (const v of rg.variables) {
      varToGroup.set(v, rg.groupId);
    }
  }

  // Group rows by their row-group directive (or 'remainder' if no group)
  const groupedRows = new Map<string, typeof table.rows>();
  for (const row of table.rows) {
    const groupId = varToGroup.get(row.variable) || '_remainder';
    if (!groupedRows.has(groupId)) groupedRows.set(groupId, []);
    groupedRows.get(groupId)!.push(row);
  }

  // Only split if we actually have multiple groups with rows
  const groupIds = [...groupedRows.keys()].filter(k => groupedRows.get(k)!.length > 0);
  if (groupIds.length <= 1) {
    // No actual split needed — apply table-level filter instead
    return [{
      ...table,
      additionalFilter: directive.tableFilter,
      baseText: directive.tableBaseText || table.baseText,
      lastModifiedBy: 'DeterministicBaseEngine',
    }];
  }

  // Create one table per group
  let splitIndex = 0;
  for (const groupId of groupIds) {
    const rows = groupedRows.get(groupId)!;
    const rgDirective = directive.rowGroups.find(rg => rg.groupId === groupId);

    // Use group-level filter if we have one; otherwise table-level
    const filter = rgDirective?.filter || directive.tableFilter;
    const baseText = rgDirective
      ? `Those answering ${directive.questionId} (${groupId})`
      : directive.tableBaseText;

    splitIndex++;
    results.push({
      ...table,
      tableId: `${table.tableId}_split${splitIndex}`,
      rows,
      additionalFilter: filter,
      baseText: baseText || table.baseText,
      splitFromTableId: table.tableId,
      lastModifiedBy: 'DeterministicBaseEngine',
    });
  }

  return results;
}
