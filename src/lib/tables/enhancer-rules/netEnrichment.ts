import type { ExtendedTableDefinition, ExtendedTableRow } from '@/schemas/verificationAgentSchema';
import type { EnhancerRuntimeContext } from './types';

function isBinaryFlagVariable(variable: string, ctx: EnhancerRuntimeContext): boolean {
  const meta = ctx.verboseByColumn.get(variable);
  return meta?.normalizedType === 'binary_flag';
}

function hasExistingAnyNet(rows: ExtendedTableRow[]): boolean {
  return rows.some((row) => row.isNet && /^any\b/i.test(row.label));
}

export function applyMultiSelectNet(
  table: ExtendedTableDefinition,
  ctx: EnhancerRuntimeContext,
): {
  table: ExtendedTableDefinition;
  applied: string[];
  skipped: Array<{ rule: string; reason: string }>;
  flaggedForAI: string[];
} {
  const applied: string[] = [];
  const skipped: Array<{ rule: string; reason: string }> = [];
  const flaggedForAI: string[] = [];

  if (table.tableType !== 'frequency') {
    skipped.push({ rule: 'multi_select_net', reason: 'table_not_frequency' });
    return { table, applied, skipped, flaggedForAI };
  }

  const componentVariables = Array.from(new Set(table.rows.map((r) => r.variable).filter((v) => v !== '_CAT_')));
  if (componentVariables.length < 2) {
    skipped.push({ rule: 'multi_select_net', reason: 'net_skipped_low_component_count' });
    return { table, applied, skipped, flaggedForAI };
  }

  if (!componentVariables.every((variable) => isBinaryFlagVariable(variable, ctx))) {
    skipped.push({ rule: 'multi_select_net', reason: 'not_all_binary_flags' });
    return { table, applied, skipped, flaggedForAI };
  }

  if (hasExistingAnyNet(table.rows)) {
    skipped.push({ rule: 'multi_select_net', reason: 'existing_any_net_present' });
    return { table, applied, skipped, flaggedForAI };
  }

  const parentLabel = table.questionText || table.questionId;
  const netRow: ExtendedTableRow = {
    variable: `_NET_${table.questionId}_Any`,
    label: `Any ${parentLabel} (NET)`,
    filterValue: '',
    isNet: true,
    netComponents: componentVariables,
    indent: 0,
  };

  const indentedRows = table.rows.map((row) => ({ ...row, indent: row.indent > 0 ? row.indent : 1 }));

  applied.push('multi_select_any_net');
  ctx.report.netsCreated += 1;
  flaggedForAI.push('net_label_needs_contextual_refinement');

  return {
    table: {
      ...table,
      rows: [netRow, ...indentedRows],
      lastModifiedBy: 'TableEnhancer',
    },
    applied,
    skipped,
    flaggedForAI,
  };
}
