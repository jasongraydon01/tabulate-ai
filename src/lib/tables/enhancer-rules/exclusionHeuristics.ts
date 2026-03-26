import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';
import type { EnhancerRuntimeContext } from './types';

const EXCLUSION_REASON: Record<string, string> = {
  admin: 'Auto-excluded administrative variable table',
  weight: 'Auto-excluded weight variable table',
  single_row: 'Auto-excluded low-information single-row table',
  no_variance: 'Auto-excluded table with no apparent variance',
};

export function applyExclusionHeuristics(
  table: ExtendedTableDefinition,
  ctx: EnhancerRuntimeContext,
): {
  table: ExtendedTableDefinition;
  applied: string[];
  skipped: Array<{ rule: string; reason: string }>;
} {
  const applied: string[] = [];
  const skipped: Array<{ rule: string; reason: string }> = [];

  const uniqueVars = Array.from(new Set(table.rows.map((r) => r.variable)));
  const firstVar = uniqueVars[0];
  const firstMeta = firstVar ? ctx.verboseByColumn.get(firstVar) : undefined;

  if (firstMeta?.normalizedType === 'admin') {
    applied.push('exclude_admin');
    ctx.report.autoExclusions += 1;
    return {
      table: {
        ...table,
        exclude: true,
        excludeReason: EXCLUSION_REASON.admin,
      },
      applied,
      skipped,
    };
  }

  if (firstMeta?.normalizedType === 'weight') {
    applied.push('exclude_weight');
    ctx.report.autoExclusions += 1;
    return {
      table: {
        ...table,
        exclude: true,
        excludeReason: EXCLUSION_REASON.weight,
      },
      applied,
      skipped,
    };
  }

  if (table.tableType === 'frequency' && table.rows.length === 1 && !table.isDerived) {
    applied.push('exclude_single_row');
    ctx.report.autoExclusions += 1;
    return {
      table: {
        ...table,
        exclude: true,
        excludeReason: EXCLUSION_REASON.single_row,
      },
      applied,
      skipped,
    };
  }

  const nonCategoryRows = table.rows.filter((r) => r.variable !== '_CAT_');
  const uniquePairs = new Set(nonCategoryRows.map((r) => `${r.variable}::${r.filterValue}`));
  if (
    table.tableType === 'frequency' &&
    nonCategoryRows.length > 0 &&
    uniquePairs.size <= 1 &&
    !table.isDerived
  ) {
    applied.push('exclude_no_variance');
    ctx.report.autoExclusions += 1;
    return {
      table: {
        ...table,
        exclude: true,
        excludeReason: EXCLUSION_REASON.no_variance,
      },
      applied,
      skipped,
    };
  }

  skipped.push({ rule: 'exclusion_heuristics', reason: 'no_conservative_exclusion_trigger' });
  return { table, applied, skipped };
}
