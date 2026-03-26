import type { ExtendedTableDefinition, ExtendedTableRow } from '@/schemas/verificationAgentSchema';
import type { EnhancerRuntimeContext } from './types';
import { allocateStableId } from '../enhancerDeterminism';

function parseRankValues(rows: ExtendedTableRow[]): number[] {
  const values = new Set<number>();
  for (const row of rows) {
    if (row.variable === '_CAT_' || row.filterValue.includes(',')) continue;
    const value = Number(row.filterValue);
    if (Number.isFinite(value)) values.add(value);
  }
  return Array.from(values).sort((a, b) => a - b);
}

function isContiguous(values: number[]): boolean {
  if (values.length <= 1) return true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

export function applyRankingEnrichment(
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
    skipped.push({ rule: 'ranking_enrichment', reason: 'table_not_frequency' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  if (!/\brank(?:ed|ing)?\b/i.test(table.questionText)) {
    skipped.push({ rule: 'ranking_enrichment', reason: 'question_text_not_rank_like' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const variables = Array.from(new Set(table.rows.map((r) => r.variable).filter((v) => v !== '_CAT_')));
  if (variables.length < 2) {
    skipped.push({ rule: 'ranking_enrichment', reason: 'insufficient_ranked_items' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const rankValues = parseRankValues(table.rows);
  if (rankValues.length < 2 || !isContiguous(rankValues) || rankValues[0] !== 1) {
    skipped.push({ rule: 'ranking_enrichment', reason: 'invalid_rank_value_domain' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  const rowByVarAndRank = new Map<string, ExtendedTableRow>();
  for (const row of table.rows) {
    if (row.variable === '_CAT_') continue;
    const rank = Number(row.filterValue);
    if (!Number.isFinite(rank)) continue;
    rowByVarAndRank.set(`${row.variable}::${rank}`, row);
  }

  const topNValues = [1, 2, 3].filter((value) => value <= rankValues.length);
  const cap = Math.min(ctx.options.maxRankRollups, topNValues.length);

  for (let i = 0; i < cap; i++) {
    const n = topNValues[i];
    const idSuffix = n === 1 ? 'rank1' : `top${n}`;
    const desiredId = `${table.questionId.toLowerCase()}_${idSuffix}`;
    const derivedId = allocateStableId(desiredId, ctx.usedIds, ctx.report.idCollisions);

    const rows: ExtendedTableRow[] = [];
    for (const variable of variables) {
      const source = rowByVarAndRank.get(`${variable}::1`);
      const label = source?.label || ctx.verboseByColumn.get(variable)?.description || variable;
      rows.push({
        variable,
        label,
        filterValue: n === 1 ? '1' : Array.from({ length: n }, (_, idx) => String(idx + 1)).join(','),
        isNet: n > 1,
        netComponents: [],
        indent: 0,
      });
    }

    derived.push({
      ...table,
      tableId: derivedId,
      sourceTableId: table.tableId,
      isDerived: true,
      tableSubtitle: n === 1 ? 'Ranked #1' : `Top ${n}`,
      rows,
      lastModifiedBy: 'TableEnhancer',
    });
  }

  if (derived.length === 0) {
    skipped.push({ rule: 'ranking_enrichment', reason: 'no_rank_rollups_created' });
    return { table, derived, applied, skipped, flaggedForAI };
  }

  applied.push('ranking_rollups');
  ctx.report.rankingEnrichments += 1;
  flaggedForAI.push('verify_ranking_semantics');

  return { table, derived, applied, skipped, flaggedForAI };
}
