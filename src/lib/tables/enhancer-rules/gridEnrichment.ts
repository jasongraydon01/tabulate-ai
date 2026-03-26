import type { ExtendedTableDefinition, ExtendedTableRow } from '@/schemas/verificationAgentSchema';
import type { EnhancerRuntimeContext } from './types';
import { allocateStableId } from '../enhancerDeterminism';

const FULL_DETAIL_VARIABLE_LIMIT = 20;

interface StructuredVariableToken {
  base: string;
  rowIndex: number;
  columnIndex: number | null;
}

function parseStructuredVariable(variable: string): StructuredVariableToken | null {
  const match = variable.match(/^(.*)r(\d+)(?:c(\d+))?$/i);
  if (!match) return null;

  const [, rawBase, rowStr, colStr] = match;
  const base = rawBase.trim();
  if (!base) return null;

  const rowIndex = Number(rowStr);
  if (!Number.isInteger(rowIndex) || rowIndex <= 0) return null;

  const columnIndex = colStr ? Number(colStr) : null;
  if (columnIndex !== null && (!Number.isInteger(columnIndex) || columnIndex <= 0)) return null;

  return {
    base: base.toLowerCase(),
    rowIndex,
    columnIndex,
  };
}

function buildFilterSignature(rows: ExtendedTableRow[]): string | null {
  const values = rows
    .filter((row) => !row.isNet && !row.filterValue.includes(',') && row.filterValue !== '')
    .map((row) => row.filterValue);

  if (values.length === 0) return null;

  const uniqueSorted = Array.from(new Set(values)).sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);
    return bothNumeric ? aNum - bNum : a.localeCompare(b);
  });

  return uniqueSorted.join('|');
}

function hasStructuredRepeatingPattern(rowsByVariable: Map<string, ExtendedTableRow[]>): {
  detected: boolean;
  hasColumnAxis: boolean;
} {
  const variables = Array.from(rowsByVariable.keys());
  if (variables.length < 3) {
    return { detected: false, hasColumnAxis: false };
  }

  const parsed = variables.map((variable) => parseStructuredVariable(variable));
  if (parsed.some((token) => token === null)) {
    return { detected: false, hasColumnAxis: false };
  }

  const tokens = parsed as StructuredVariableToken[];
  const base = tokens[0].base;
  if (tokens.some((token) => token.base !== base)) {
    return { detected: false, hasColumnAxis: false };
  }

  const rowSizes = new Set<number>();
  const signatures = new Set<string>();
  for (const rows of rowsByVariable.values()) {
    const nonNetRows = rows.filter((row) => !row.isNet);
    rowSizes.add(nonNetRows.length);
    const signature = buildFilterSignature(nonNetRows);
    if (!signature) {
      return { detected: false, hasColumnAxis: false };
    }
    signatures.add(signature);
  }

  if (rowSizes.size !== 1) {
    return { detected: false, hasColumnAxis: false };
  }

  const rowSize = Array.from(rowSizes)[0];
  if (rowSize < 2 || signatures.size !== 1) {
    return { detected: false, hasColumnAxis: false };
  }

  return {
    detected: true,
    hasColumnAxis: tokens.some((token) => token.columnIndex !== null),
  };
}

function resolveDerivedCap(variableCount: number, configuredCap: number): number {
  if (variableCount <= FULL_DETAIL_VARIABLE_LIMIT) {
    return Math.max(configuredCap, variableCount + 1);
  }
  return configuredCap;
}

function getTopBoxValues(rows: ExtendedTableRow[]): string | null {
  const numeric = rows
    .filter((row) => !row.isNet && !row.filterValue.includes(','))
    .map((row) => Number(row.filterValue))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const unique = Array.from(new Set(numeric));
  if (unique.length < 4) return null;
  const top = unique.slice(-2);
  return top.join(',');
}

export function applyGridEnrichment(
  table: ExtendedTableDefinition,
  ctx: EnhancerRuntimeContext,
): {
  table: ExtendedTableDefinition;
  derived: ExtendedTableDefinition[];
  applied: string[];
  skipped: Array<{ rule: string; reason: string }>;
} {
  const applied: string[] = [];
  const skipped: Array<{ rule: string; reason: string }> = [];
  const derived: ExtendedTableDefinition[] = [];

  if (table.tableType !== 'frequency') {
    skipped.push({ rule: 'grid_enrichment', reason: 'table_not_frequency' });
    return { table, derived, applied, skipped };
  }

  const rowsByVariable = new Map<string, ExtendedTableRow[]>();
  for (const row of table.rows) {
    if (row.variable === '_CAT_' || row.isNet) continue;
    const existing = rowsByVariable.get(row.variable);
    if (existing) existing.push(row);
    else rowsByVariable.set(row.variable, [row]);
  }

  const structure = hasStructuredRepeatingPattern(rowsByVariable);
  if (!structure.detected) {
    skipped.push({ rule: 'grid_enrichment', reason: 'structured_pattern_not_detected' });
    return { table, derived, applied, skipped };
  }

  const derivedCap = resolveDerivedCap(rowsByVariable.size, ctx.options.maxGridDerivedPerFamily);

  let derivedCount = 0;

  // Comparison table
  const comparisonRows: ExtendedTableRow[] = [];
  for (const [variable, rows] of rowsByVariable.entries()) {
    const topBox = getTopBoxValues(rows);
    if (!topBox) continue;

    comparisonRows.push({
      variable,
      label: ctx.verboseByColumn.get(variable)?.description || variable,
      filterValue: topBox,
      isNet: true,
      netComponents: [],
      indent: 0,
    });
  }

  if (comparisonRows.length > 1 && derivedCount < derivedCap) {
    const desiredId = `${table.tableId}_comp_t2b`;
    const derivedId = allocateStableId(desiredId, ctx.usedIds, ctx.report.idCollisions);
    derived.push({
      ...table,
      tableId: derivedId,
      sourceTableId: table.tableId,
      isDerived: true,
      tableSubtitle: structure.hasColumnAxis ? 'Grid Comparison: T2B' : 'Comparison: T2B',
      rows: comparisonRows,
      lastModifiedBy: 'TableEnhancer',
    });
    derivedCount += 1;
  }

  // Detail tables
  const detailBudget = Math.max(0, derivedCap - derivedCount);
  const detailEntries = Array.from(rowsByVariable.entries()).slice(0, detailBudget);
  for (let index = 0; index < detailEntries.length; index++) {
    const [variable, rows] = detailEntries[index];
    const desiredId = `${table.tableId}_detail_${index + 1}`;
    const derivedId = allocateStableId(desiredId, ctx.usedIds, ctx.report.idCollisions);
    derived.push({
      ...table,
      tableId: derivedId,
      sourceTableId: table.tableId,
      isDerived: true,
      tableSubtitle: `Detail: ${ctx.verboseByColumn.get(variable)?.description || variable}`,
      rows,
      lastModifiedBy: 'TableEnhancer',
    });
  }

  if (detailEntries.length < rowsByVariable.size) {
    skipped.push({
      rule: 'grid_enrichment',
      reason: `detail_tables_capped:${detailEntries.length}/${rowsByVariable.size}`,
    });
  }

  if (derived.length === 0) {
    skipped.push({ rule: 'grid_enrichment', reason: 'no_derived_grid_tables_created' });
    return { table, derived, applied, skipped };
  }

  applied.push('grid_comparison_and_detail');
  ctx.report.gridSplits += 1;

  return { table, derived, applied, skipped };
}
