/**
 * @deprecated Support module for VerificationAgent which is deprecated.
 * V3 canonical assembly handles table mutations deterministically.
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

import type { ExtendedTableDefinition, ExtendedTableRow } from '@/schemas/verificationAgentSchema';
import {
  ApplyTableMutationsInputSchema,
  type ApplyTableMutationsInput,
  type MutationAudit,
  type MutationOp,
  MutationAuditSchema,
  type RowKey,
} from '@/schemas/verificationMutationSchema';
import { deterministicHash } from '@/lib/tables/enhancerDeterminism';

export interface ApplyTableMutationsOptions {
  allowReservedOperations?: boolean;
  netVariablePrefix?: string;
}

export interface ApplyTableMutationsResult {
  table: ExtendedTableDefinition;
  audit: MutationAudit;
}

export function computeTableVersionHash(table: ExtendedTableDefinition): string {
  return deterministicHash({
    tableId: table.tableId,
    questionId: table.questionId,
    tableType: table.tableType,
    rows: table.rows,
    metadata: {
      surveySection: table.surveySection,
      baseText: table.baseText,
      userNote: table.userNote,
      tableSubtitle: table.tableSubtitle,
      exclude: table.exclude,
      excludeReason: table.excludeReason,
    },
  });
}

export function applyTableMutations(
  table: ExtendedTableDefinition,
  rawInput: ApplyTableMutationsInput,
  options: ApplyTableMutationsOptions = {},
): ApplyTableMutationsResult {
  const input = ApplyTableMutationsInputSchema.parse(rawInput);
  const audit: MutationAudit = {
    applied: [],
    skipped: [],
    warnings: [],
    requestedOverrides: [],
    reviewFlags: [],
  };

  if (input.targetTableId !== table.tableId) {
    throw new Error(`Mutation target mismatch: expected ${table.tableId}, got ${input.targetTableId}`);
  }

  const expectedVersion = computeTableVersionHash(table);
  if (expectedVersion !== input.tableVersionHash) {
    throw new Error(`Mutation version mismatch for ${table.tableId}`);
  }

  const allowReservedOperations = options.allowReservedOperations ?? false;
  const netVariablePrefix = options.netVariablePrefix || '_NET_CONCEPT_';

  let nextTable: ExtendedTableDefinition = {
    ...table,
    rows: table.rows.map((row) => ({ ...row })),
  };

  for (const operation of input.operations) {
    const result = applyMutation(nextTable, operation, {
      allowReservedOperations,
      netVariablePrefix,
    });

    nextTable = result.table;
    audit.applied.push(...result.applied);
    audit.skipped.push(...result.skipped);
    audit.warnings.push(...result.warnings);
    audit.requestedOverrides.push(...result.requestedOverrides);
    audit.reviewFlags.push(...result.reviewFlags);
  }

  validateTableInvariants(nextTable, audit);

  return {
    table: {
      ...nextTable,
      lastModifiedBy: 'VerificationAgent',
    },
    audit: MutationAuditSchema.parse(audit),
  };
}

interface PerMutationResult {
  table: ExtendedTableDefinition;
  applied: string[];
  skipped: string[];
  warnings: string[];
  requestedOverrides: string[];
  reviewFlags: string[];
}

interface InternalOptions {
  allowReservedOperations: boolean;
  netVariablePrefix: string;
}

function applyMutation(
  table: ExtendedTableDefinition,
  operation: MutationOp,
  options: InternalOptions,
): PerMutationResult {
  const applied: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const requestedOverrides: string[] = [];
  const reviewFlags: string[] = [];

  switch (operation.kind) {
    case 'update_label': {
      const idx = findRowIndex(table.rows, operation.rowKey);
      if (idx < 0) {
        skipped.push(`update_label:${operation.rowKey.variable}:${operation.rowKey.filterValue}:row_not_found`);
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      const rows = table.rows.map((row, rowIndex) =>
        rowIndex === idx ? { ...row, label: operation.label } : row,
      );

      applied.push(`update_label:${operation.rowKey.variable}:${operation.rowKey.filterValue}`);
      return {
        table: { ...table, rows },
        applied,
        skipped,
        warnings,
        requestedOverrides,
        reviewFlags,
      };
    }

    case 'set_metadata': {
      const patch = operation.patch;
      // Empty string = no change (Azure structured output requires all fields present)
      const next = {
        ...table,
        surveySection: patch.surveySection || table.surveySection,
        baseText: patch.baseText || table.baseText,
        userNote: patch.userNote || table.userNote,
        tableSubtitle: patch.tableSubtitle || table.tableSubtitle,
      };
      applied.push('set_metadata');
      return { table: next, applied, skipped, warnings, requestedOverrides, reviewFlags };
    }

    case 'create_conceptual_net': {
      const missingComponents = operation.components.filter(
        (component) => !table.rows.some((row) => row.variable === component),
      );
      if (missingComponents.length > 0) {
        skipped.push(`create_conceptual_net:missing_components:${missingComponents.join(',')}`);
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      const netVariable = `${options.netVariablePrefix}${sanitizeIdentifier(table.tableId)}_${table.rows.length + 1}`;
      const netRow: ExtendedTableRow = {
        variable: netVariable,
        label: operation.label,
        filterValue: '',
        isNet: true,
        netComponents: operation.components,
        indent: 0,
      };

      const rows = insertNetRow(table.rows, netRow, operation.position);
      applied.push(`create_conceptual_net:${operation.label}`);
      return { table: { ...table, rows }, applied, skipped, warnings, requestedOverrides, reviewFlags };
    }

    case 'set_exclusion': {
      if (operation.exclude && !canApplyExclusion(operation)) {
        skipped.push('set_exclusion:insufficient_redundancy_evidence');
        warnings.push('Exclusion skipped due to insufficient redundancy evidence');
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      applied.push('set_exclusion');
      return {
        table: {
          ...table,
          exclude: operation.exclude,
          excludeReason: operation.exclude ? operation.excludeReason : '',
        },
        applied,
        skipped,
        warnings,
        requestedOverrides,
        reviewFlags,
      };
    }

    case 'request_structural_override': {
      if (!options.allowReservedOperations) {
        skipped.push('request_structural_override:reserved_op_disabled');
        requestedOverrides.push(operation.requestedAction);
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      requestedOverrides.push(operation.requestedAction);
      applied.push('request_structural_override');
      return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
    }

    case 'flag_for_review': {
      if (!options.allowReservedOperations) {
        skipped.push('flag_for_review:reserved_op_disabled');
        reviewFlags.push(operation.flag);
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      reviewFlags.push(operation.flag);
      applied.push('flag_for_review');
      return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
    }

    case 'set_question_text': {
      applied.push('set_question_text');
      return {
        table: { ...table, questionText: operation.questionText },
        applied,
        skipped,
        warnings,
        requestedOverrides,
        reviewFlags,
      };
    }

    case 'update_row_fields': {
      const idx = findRowIndex(table.rows, operation.rowKey);
      if (idx < 0) {
        skipped.push(`update_row_fields:${operation.rowKey.variable}:${operation.rowKey.filterValue}:row_not_found`);
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      const patch = operation.patch;

      // Empty string / -1 / empty array = no change (Azure structured output requires all fields)
      const hasFilterValue = patch.filterValue !== '';
      const hasLabel = patch.label !== '';
      const hasIsNet = patch.isNet !== '';
      const hasNetComponents = patch.netComponents.length > 0;
      const hasIndent = patch.indent >= 0;

      // If filterValue is changing, check for uniqueness conflicts
      if (hasFilterValue) {
        const newKey = { variable: operation.rowKey.variable, filterValue: patch.filterValue };
        const conflictIdx = findRowIndex(table.rows, newKey);
        if (conflictIdx >= 0 && conflictIdx !== idx) {
          skipped.push(`update_row_fields:${operation.rowKey.variable}:${operation.rowKey.filterValue}:filterValue_conflict`);
          warnings.push(`filterValue change would create duplicate row key: ${newKey.variable}::${newKey.filterValue}`);
          return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
        }
      }

      const rows = table.rows.map((row, rowIndex) => {
        if (rowIndex !== idx) return row;
        return {
          ...row,
          ...(hasLabel && { label: patch.label }),
          ...(hasFilterValue && { filterValue: patch.filterValue }),
          ...(hasIsNet && { isNet: patch.isNet === 'true' }),
          ...(hasNetComponents && { netComponents: patch.netComponents }),
          ...(hasIndent && { indent: patch.indent }),
        };
      });

      applied.push(`update_row_fields:${operation.rowKey.variable}:${operation.rowKey.filterValue}`);
      return { table: { ...table, rows }, applied, skipped, warnings, requestedOverrides, reviewFlags };
    }

    case 'delete_row': {
      const idx = findRowIndex(table.rows, operation.rowKey);
      if (idx < 0) {
        skipped.push(`delete_row:${operation.rowKey.variable}:${operation.rowKey.filterValue}:row_not_found`);
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      // Prevent deleting the last row
      if (table.rows.length <= 1) {
        skipped.push(`delete_row:${operation.rowKey.variable}:${operation.rowKey.filterValue}:last_row_prevention`);
        warnings.push('Cannot delete the last row in a table');
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      const deletedRow = table.rows[idx];
      const rows = [...table.rows.slice(0, idx), ...table.rows.slice(idx + 1)];

      // Position-based indent cascade: if we removed a NET at indent 0,
      // reset consecutive indented rows from the deletion point forward
      if (deletedRow.isNet && deletedRow.indent === 0) {
        for (let i = idx; i < rows.length; i++) {
          if (rows[i].indent > 0) {
            rows[i] = { ...rows[i], indent: 0 };
          } else {
            break;
          }
        }
      }

      // Component cascade: remove deleted row's variable from any parent NET's netComponents
      if (!deletedRow.isNet) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.isNet && row.netComponents.length > 0 && row.netComponents.includes(deletedRow.variable)) {
            const updatedComponents = row.netComponents.filter((c) => c !== deletedRow.variable);
            rows[i] = { ...rows[i], netComponents: updatedComponents };
            if (updatedComponents.length < 2 && updatedComponents.length > 0) {
              warnings.push(`NET "${row.label}" dropped below 2 components after removing ${deletedRow.variable}`);
            }
          }
        }
      }

      applied.push(`delete_row:${operation.rowKey.variable}:${operation.rowKey.filterValue}`);
      return { table: { ...table, rows }, applied, skipped, warnings, requestedOverrides, reviewFlags };
    }

    case 'create_same_variable_net': {
      // Validate all filterValues exist as non-NET rows for that variable
      const matchingRows = table.rows.filter(
        (row) => row.variable === operation.variable && !row.isNet,
      );
      const matchingFilterValues = new Set(matchingRows.map((row) => row.filterValue));
      const missingValues = operation.filterValues.filter((fv) => !matchingFilterValues.has(fv));

      if (missingValues.length > 0) {
        skipped.push(`create_same_variable_net:missing_filter_values:${missingValues.join(',')}`);
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      // Validate strict subset (not all values for that variable)
      const allNonNetFilterValues = matchingRows.map((row) => row.filterValue);
      if (operation.filterValues.length >= allNonNetFilterValues.length) {
        skipped.push(`create_same_variable_net:trivial_net:covers_all_values`);
        warnings.push('Same-variable NET must be a strict subset, not all values');
        return { table, applied, skipped, warnings, requestedOverrides, reviewFlags };
      }

      // Create NET row
      const netRow: ExtendedTableRow = {
        variable: operation.variable,
        label: operation.label,
        filterValue: operation.filterValues.join(','),
        isNet: true,
        netComponents: [],
        indent: 0,
      };

      // Separate component rows from non-component rows.
      // Components must be regrouped immediately after the NET to satisfy
      // the invariant that indented rows follow their parent NET.
      const filterValuesSet = new Set(operation.filterValues);
      const isComponent = (row: ExtendedTableRow) =>
        row.variable === operation.variable && !row.isNet && filterValuesSet.has(row.filterValue);

      const componentRows = table.rows.filter(isComponent).map((row) => ({ ...row, indent: 1 }));
      const nonComponentRows = table.rows.filter((row) => !isComponent(row)).map((row) => ({ ...row }));

      // Insert NET row at the desired position within non-component rows,
      // then splice component rows immediately after the NET.
      const rowsWithNet = insertNetRow(nonComponentRows, netRow, operation.position);
      const netIdx = rowsWithNet.findIndex((row) => row === netRow);
      const result = [
        ...rowsWithNet.slice(0, netIdx + 1),
        ...componentRows,
        ...rowsWithNet.slice(netIdx + 1),
      ];

      applied.push(`create_same_variable_net:${operation.label}`);
      return { table: { ...table, rows: result }, applied, skipped, warnings, requestedOverrides, reviewFlags };
    }
  }
}

function validateTableInvariants(table: ExtendedTableDefinition, audit: MutationAudit): void {
  const uniqueIds = new Set<string>();
  for (const row of table.rows) {
    const key = `${row.variable}::${row.filterValue}`;
    if (uniqueIds.has(key)) {
      audit.warnings.push(`duplicate_row_pair:${key}`);
    } else {
      uniqueIds.add(key);
    }

    if (row.isNet && row.netComponents.length > 0) {
      const missing = row.netComponents.filter(
        (component) => !table.rows.some((candidate) => candidate.variable === component),
      );
      if (missing.length > 0) {
        throw new Error(`Net row ${row.label} references missing component(s): ${missing.join(', ')}`);
      }
    }
  }

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (row.indent <= 0) continue;

    let hasParentNet = false;
    for (let j = i - 1; j >= 0; j--) {
      if (table.rows[j].isNet && table.rows[j].indent === 0) {
        hasParentNet = true;
        break;
      }
      if (table.rows[j].indent === 0 && !table.rows[j].isNet) {
        break;
      }
    }

    if (!hasParentNet) {
      throw new Error(`Invariant violation: orphan indented row at index ${i} (${row.variable})`);
    }
  }
}

function findRowIndex(rows: ExtendedTableRow[], rowKey: RowKey): number {
  return rows.findIndex(
    (row) => row.variable === rowKey.variable && row.filterValue === rowKey.filterValue,
  );
}

function insertNetRow(
  rows: ExtendedTableRow[],
  netRow: ExtendedTableRow,
  position: 'top' | 'bottom' | { afterRowKey: RowKey },
): ExtendedTableRow[] {
  if (position === 'top') {
    return [netRow, ...rows];
  }
  if (position === 'bottom') {
    return [...rows, netRow];
  }

  const idx = findRowIndex(rows, position.afterRowKey);
  if (idx < 0) {
    return [...rows, netRow];
  }

  return [...rows.slice(0, idx + 1), netRow, ...rows.slice(idx + 1)];
}

function sanitizeIdentifier(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
    .toLowerCase();
}

function canApplyExclusion(operation: Extract<MutationOp, { kind: 'set_exclusion' }>): boolean {
  if (!operation.exclude) return true;
  return (
    operation.redundancyEvidence.sameFilterSignature &&
    operation.redundancyEvidence.overlapsWithTableIds.length > 0 &&
    operation.redundancyEvidence.dominanceSignal !== 'low'
  );
}
