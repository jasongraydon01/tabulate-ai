/**
 * @deprecated Support module for VerificationAgent which is deprecated.
 * V3 canonical assembly handles MaxDiff table structure deterministically
 * via the table planner (stage 13b) and subtype gate (stage 13c).
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

import type { TableDefinition } from '@/schemas/tableAgentSchema';
import {
  createPassthroughOutput,
  type VerificationAgentOutput,
} from '@/schemas/verificationAgentSchema';

export interface MaxDiffGuardResult {
  output: VerificationAgentOutput;
  adjusted: boolean;
  reason?: string;
}

/**
 * Enforce deterministic structure for consolidated MaxDiff tables after AI processing.
 *
 * Allowed AI edits:
 * - question text and table metadata (subtitle/base/user note/survey section)
 * - row labels
 *
 * Disallowed (and auto-corrected):
 * - splitting into multiple tables
 * - changing table type/id
 * - adding/removing/reordering rows
 * - changing row variables/filter values
 * - introducing NET/indent structures
 */
export function enforceConsolidatedMaxDiffGuard(
  originalTable: TableDefinition,
  agentOutput: VerificationAgentOutput,
): MaxDiffGuardResult {
  const reasons: string[] = [];
  const originalVariables = originalTable.rows.map(r => r.variable);
  const originalFilterByVar = new Map(originalTable.rows.map(r => [r.variable, r.filterValue]));
  const expectedVarSet = new Set(originalVariables);

  if (agentOutput.tables.length !== 1) {
    reasons.push(`split_output:${agentOutput.tables.length}`);
  }

  const firstTable = agentOutput.tables[0];
  if (!firstTable) {
    reasons.push('missing_output_table');
  } else {
    if (firstTable.tableId !== originalTable.tableId) {
      reasons.push('table_id_changed');
    }
    if (firstTable.tableType !== originalTable.tableType) {
      reasons.push(`table_type_changed:${firstTable.tableType}`);
    }
    if (firstTable.rows.length !== originalTable.rows.length) {
      reasons.push(`row_count_changed:${firstTable.rows.length}`);
    }

    const outputOrder = firstTable.rows.map(r => r.variable);
    if (outputOrder.join('|') !== originalVariables.join('|')) {
      reasons.push('row_order_changed');
    }

    for (const row of firstTable.rows) {
      if (!expectedVarSet.has(row.variable)) {
        reasons.push(`unexpected_variable:${row.variable}`);
      }
      if (row.isNet || row.netComponents.length > 0 || row.indent !== 0) {
        reasons.push(`invalid_row_shape:${row.variable}`);
      }
      const expectedFilter = originalFilterByVar.get(row.variable);
      if (expectedFilter !== undefined && row.filterValue !== expectedFilter) {
        reasons.push(`filter_value_changed:${row.variable}`);
      }
    }
  }

  const allOutputVars = new Set<string>();
  for (const table of agentOutput.tables) {
    for (const row of table.rows) {
      allOutputVars.add(row.variable);
    }
  }
  const missingVars = originalVariables.filter(v => !allOutputVars.has(v));
  const extraVars = [...allOutputVars].filter(v => !expectedVarSet.has(v));
  if (missingVars.length > 0) reasons.push(`missing_variables:${missingVars.join(',')}`);
  if (extraVars.length > 0) reasons.push(`extra_variables:${extraVars.join(',')}`);

  if (reasons.length === 0) {
    return { output: agentOutput, adjusted: false };
  }

  const labelByVariable = new Map<string, string>();
  for (const table of agentOutput.tables) {
    for (const row of table.rows) {
      if (!expectedVarSet.has(row.variable)) continue;
      if (labelByVariable.has(row.variable)) continue;
      const clean = row.label?.trim();
      if (clean) labelByVariable.set(row.variable, clean);
    }
  }

  const guarded = createPassthroughOutput(originalTable);
  const guardedTable = guarded.tables[0];
  const sourceTable = firstTable ?? guardedTable;

  guardedTable.questionText = sourceTable.questionText || guardedTable.questionText;
  guardedTable.surveySection = sourceTable.surveySection;
  guardedTable.baseText = sourceTable.baseText;
  guardedTable.userNote = sourceTable.userNote;
  guardedTable.tableSubtitle = sourceTable.tableSubtitle;
  guardedTable.exclude = false;
  guardedTable.excludeReason = '';

  guardedTable.rows = originalTable.rows.map((row) => ({
    variable: row.variable,
    label: labelByVariable.get(row.variable) ?? row.label,
    filterValue: row.filterValue,
    isNet: false,
    netComponents: [],
    indent: 0,
  }));

  guarded.changes = [
    ...agentOutput.changes,
    `Guardrail enforced for consolidated MaxDiff table: ${reasons.join('; ')}`,
  ];
  guarded.confidence = agentOutput.confidence;
  guarded.userSummary = agentOutput.userSummary
    ? `${agentOutput.userSummary} Consolidated MaxDiff structure was preserved.`
    : 'Consolidated MaxDiff structure was preserved.';

  return {
    output: guarded,
    adjusted: true,
    reason: reasons.join('; '),
  };
}
