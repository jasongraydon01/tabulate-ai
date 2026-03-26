import type { ExtendedTableDefinition, ExtendedTableRow } from '@/schemas/verificationAgentSchema';
import type { EnhancerRuntimeContext } from './types';
import { allocateStableId } from '../enhancerDeterminism';

interface ScaleRollupSpec {
  label: string;
  values: number[];
  idSuffix?: string;
}

function parseNumericRows(rows: ExtendedTableRow[]): Array<{ row: ExtendedTableRow; value: number }> {
  const parsed: Array<{ row: ExtendedTableRow; value: number }> = [];
  for (const row of rows) {
    if (row.isNet || row.variable === '_CAT_') continue;
    if (row.filterValue.includes(',')) continue;
    const value = Number(row.filterValue);
    if (!Number.isFinite(value)) continue;
    parsed.push({ row, value });
  }
  return parsed;
}

function isNonSubstantive(row: ExtendedTableRow, value: number): boolean {
  if (value >= 90) return true;
  return /\b(dk|don'?t know|refused|na|n\/a|not applicable|none of these)\b/i.test(row.label);
}

function isContiguous(values: number[]): boolean {
  if (values.length <= 1) return true;
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function hasScaleSemantics(table: ExtendedTableDefinition, labels: string[], ctx: EnhancerRuntimeContext, variable: string): boolean {
  const meta = ctx.verboseByColumn.get(variable);
  if (meta?.normalizedType === 'ordinal_scale') return true;

  const question = table.questionText.toLowerCase();
  const questionLooksScale = /\b(rate|rating|satisf|agree|disagree|importance|important|likely|unlikely|confidence|effective|effectiveness|quality|favorab|favourab|extent)\b/i.test(question);

  const labelLooksScale = labels.some((label) =>
    /\b(strongly|very|somewhat|neither|not at all|excellent|good|fair|poor|high|low|likely|unlikely|satisfied|dissatisfied|agree|disagree|important|unimportant|always|often|sometimes|rarely|never)\b/i.test(label),
  );

  return questionLooksScale || labelLooksScale;
}

function getRollupSpecs(scaleLength: number, min: number, max: number): ScaleRollupSpec[] {
  switch (scaleLength) {
    case 4:
      return [
        { label: `Top 2 Box (${max - 1}-${max})`, values: [max - 1, max], idSuffix: 't2b' },
        { label: `Bottom 2 Box (${min}-${min + 1})`, values: [min, min + 1], idSuffix: 'b2b' },
      ];
    case 5:
      return [
        { label: `Top 2 Box (${max - 1}-${max})`, values: [max - 1, max], idSuffix: 't2b' },
        { label: `Bottom 2 Box (${min}-${min + 1})`, values: [min, min + 1], idSuffix: 'b2b' },
      ];
    case 7:
      return [
        { label: `Top 2 Box (${max - 1}-${max})`, values: [max - 1, max], idSuffix: 't2b' },
        { label: `Middle 3 Box (${min + 2}-${min + 4})`, values: [min + 2, min + 3, min + 4] },
        { label: `Bottom 2 Box (${min}-${min + 1})`, values: [min, min + 1], idSuffix: 'b2b' },
      ];
    case 10:
      return [
        { label: `Top 3 Box (${max - 2}-${max})`, values: [max - 2, max - 1, max], idSuffix: 't3b' },
        { label: `Middle 4 Box (${min + 3}-${min + 6})`, values: [min + 3, min + 4, min + 5, min + 6] },
        { label: `Bottom 3 Box (${min}-${min + 2})`, values: [min, min + 1, min + 2], idSuffix: 'b3b' },
      ];
    default:
      return [];
  }
}

export function applyScaleEnrichment(
  table: ExtendedTableDefinition,
  ctx: EnhancerRuntimeContext,
): {
  table: ExtendedTableDefinition;
  derived: ExtendedTableDefinition[];
  applied: string[];
  skipped: Array<{ rule: string; reason: string }>;
  flaggedForAI: string[];
} {
  const applied: string[] = [];
  const skipped: Array<{ rule: string; reason: string }> = [];
  const flaggedForAI: string[] = [];
  const derived: ExtendedTableDefinition[] = [];

  if (table.tableType !== 'frequency') {
    skipped.push({ rule: 'scale_enrichment', reason: 'table_not_frequency' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const variables = Array.from(new Set(table.rows.map((row) => row.variable).filter((v) => v !== '_CAT_')));
  if (variables.length !== 1) {
    skipped.push({ rule: 'scale_enrichment', reason: 'requires_single_variable_frequency_table' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const parsed = parseNumericRows(table.rows);
  const substantive = parsed.filter(({ row, value }) => !isNonSubstantive(row, value));
  const values = Array.from(new Set(substantive.map((entry) => entry.value))).sort((a, b) => a - b);

  if (values.length < 4) {
    skipped.push({ rule: 'scale_enrichment', reason: 'insufficient_scale_cardinality' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  if (!isContiguous(values)) {
    skipped.push({ rule: 'scale_enrichment', reason: 'non_contiguous_scale_values' });
    flaggedForAI.push('scaleDirectionNeedsReview');
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const min = values[0];
  const max = values[values.length - 1];
  const labelSet = substantive.map((entry) => entry.row.label);
  if (!hasScaleSemantics(table, labelSet, ctx, variables[0])) {
    skipped.push({ rule: 'scale_enrichment', reason: 'missing_scale_semantics' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const rollups = getRollupSpecs(values.length, min, max);

  if (rollups.length === 0) {
    skipped.push({ rule: 'scale_enrichment', reason: 'unsupported_scale_length' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const rowByValue = new Map<number, ExtendedTableRow>();
  for (const entry of substantive) {
    rowByValue.set(entry.value, entry.row);
  }

  const rollupRows: ExtendedTableRow[] = [];
  const consumedPairs = new Set<string>();
  const variable = variables[0];
  for (const rollup of rollups) {
    const presentValues = rollup.values.filter((value) => rowByValue.has(value));
    if (presentValues.length < 2) continue;

    const currentRollupRows: ExtendedTableRow[] = [];
    currentRollupRows.push({
      variable,
      label: rollup.label,
      filterValue: presentValues.join(','),
      isNet: true,
      netComponents: [],
      indent: 0,
    });

    for (const value of presentValues.slice().sort((a, b) => b - a)) {
      const sourceRow = rowByValue.get(value);
      if (!sourceRow) continue;
      consumedPairs.add(`${sourceRow.variable}::${sourceRow.filterValue}`);
      currentRollupRows.push({
        ...sourceRow,
        isNet: false,
        netComponents: [],
        indent: 1,
      });
    }
    rollupRows.push(...currentRollupRows);

    if (rollup.idSuffix === 't2b' || rollup.idSuffix === 't3b') {
      const desiredId = `${table.tableId}_${rollup.idSuffix}`;
      const derivedId = allocateStableId(desiredId, ctx.usedIds, ctx.report.idCollisions);
      derived.push({
        ...table,
        tableId: derivedId,
        sourceTableId: table.tableId,
        isDerived: true,
        tableSubtitle: rollup.label,
        rows: currentRollupRows,
        lastModifiedBy: 'TableEnhancer',
      });
    }
  }

  if (rollupRows.length === 0) {
    skipped.push({ rule: 'scale_enrichment', reason: 'no_valid_rollup_rows_generated' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  applied.push('scale_rollups');
  ctx.report.scaleEnrichments += 1;

  const remainingBaseRows = table.rows.filter((row) => {
    if (row.variable === '_CAT_') return true;
    if (row.isNet) return true;
    const key = `${row.variable}::${row.filterValue}`;
    return !consumedPairs.has(key);
  });

  return {
    table: {
      ...table,
      rows: [...rollupRows, ...remainingBaseRows],
      lastModifiedBy: 'TableEnhancer',
    },
    derived,
    applied,
    skipped,
    flaggedForAI: [...flaggedForAI, 'rollup_labels_template'],
  };
}
