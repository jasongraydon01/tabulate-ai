import { cloneBaseContract } from '../baseContract';
import type {
  CanonicalBaseDisclosure,
  CanonicalTable,
  CanonicalTableOutput,
  ResolvedBaseMode,
  ResolvedBaseTextTemplate,
  ResolvedBaseValidation,
  TableKind,
} from './types';

const MODEL_TABLE_KINDS = new Set<TableKind>([
  'maxdiff_api',
  'maxdiff_ap',
  'maxdiff_sharpref',
]);

const ITEM_BASE_TEXT_KINDS = new Set<TableKind>([
  'standard_item_detail',
  'grid_row_detail',
  'grid_col_detail',
  'numeric_item_detail',
  'numeric_per_value_detail',
  'numeric_optimized_bin_detail',
  'scale_item_detail_full',
  'allocation_item_detail',
  'ranking_item_rank',
]);

function isModelTable(table: CanonicalTable): boolean {
  return MODEL_TABLE_KINDS.has(table.tableKind)
    || table.baseContract.classification.referenceUniverse === 'model'
    || table.basePolicy === 'score_family_model_base';
}

function hasMeaningfulItemSplit(table: CanonicalTable): boolean {
  if (!table.appliesToItem) return false;
  if (!ITEM_BASE_TEXT_KINDS.has(table.tableKind)) return false;
  return !isTautologicalSplit(table);
}

function isTautologicalSplit(table: CanonicalTable): boolean {
  if (!table.appliesToItem) return false;
  if (!ITEM_BASE_TEXT_KINDS.has(table.tableKind)) return false;

  const contentRows = table.rows.filter(row =>
    row.rowKind !== 'stat'
    && row.rowKind !== 'not_answered'
    && row.variable
    && row.variable !== '_CAT_',
  );

  if (contentRows.length !== 1) return false;

  const [onlyRow] = contentRows;
  return onlyRow.variable === table.appliesToItem && onlyRow.filterValue.trim().length > 0;
}

function resolveBaseMode(table: CanonicalTable): ResolvedBaseMode {
  if (isModelTable(table)) return 'model_base';

  const meaningfulItemSplit = hasMeaningfulItemSplit(table);
  if (
    table.baseContract.classification.referenceUniverse === 'total'
    && !meaningfulItemSplit
  ) {
    return 'total_base';
  }

  return 'table_universe_base';
}

function resolveBaseTextTemplate(
  table: CanonicalTable,
  mode: ResolvedBaseMode,
): ResolvedBaseTextTemplate {
  if (mode === 'model_base') return 'model_derived';
  if (hasMeaningfulItemSplit(table)) return 'shown_this_item';
  if (mode === 'total_base') return 'total_respondents';
  return 'shown_this_question';
}

function resolveBaseValidation(table: CanonicalTable): ResolvedBaseValidation {
  const tautologicalSplitForbidden = isTautologicalSplit(table);
  return {
    tautologicalSplitForbidden,
    substantiveRebasingForbidden: true,
    requiresSharedDisplayedBase: true,
  };
}

function resolveBaseText(template: ResolvedBaseTextTemplate): string {
  switch (template) {
    case 'total_respondents':
      return 'Total respondents';
    case 'shown_this_question':
      return 'Respondents shown this question';
    case 'shown_this_item':
      return 'Respondents shown this item';
    case 'model_derived':
      return 'Model-derived base';
  }
}

function normalizeBasePolicy(
  table: CanonicalTable,
  template: ResolvedBaseTextTemplate,
): string {
  if (!table.basePolicy.includes('rebased')) return table.basePolicy;
  if (table.basePolicy === 'score_family_model_base') return table.basePolicy;
  if (template === 'total_respondents') return 'total_base';
  if (template === 'shown_this_item') return 'item_base';
  return 'question_base_shared';
}

function normalizeBaseDisclosure(
  table: CanonicalTable,
  template: ResolvedBaseTextTemplate,
): CanonicalBaseDisclosure | undefined {
  if (!table.baseDisclosure) return undefined;
  return {
    ...table.baseDisclosure,
    defaultBaseText: resolveBaseText(template),
    defaultNoteTokens: table.baseDisclosure.defaultNoteTokens.filter(
      token => token === 'low-base-caution',
    ),
    excludedResponseLabels: undefined,
  };
}

function normalizeWinCrossSemantic(
  mode: ResolvedBaseMode,
  template: ResolvedBaseTextTemplate,
): CanonicalTable['wincrossDenominatorSemantic'] {
  if (mode === 'model_base') return 'sample_base';
  if (mode === 'total_base') return 'sample_base';
  if (template === 'shown_this_item') return 'answering_base';
  return 'sample_base';
}

function resolveTable(table: CanonicalTable): CanonicalTable {
  const resolvedBaseMode = resolveBaseMode(table);
  const resolvedBaseTextTemplate = resolveBaseTextTemplate(table, resolvedBaseMode);
  const resolvedBaseValidation = resolveBaseValidation(table);
  const resolvedSplitPolicy = hasMeaningfulItemSplit(table) ? 'required' : 'none';
  const baseContract = cloneBaseContract(table.baseContract);

  baseContract.policy.effectiveBaseMode =
    resolvedBaseMode === 'model_base'
      ? 'model'
      : 'table_mask_shared_n';
  baseContract.policy.rebasePolicy = 'none';
  baseContract.signals = baseContract.signals.filter(signal => signal !== 'rebased-base');

  const nextTable: CanonicalTable = {
    ...table,
    basePolicy: normalizeBasePolicy(table, resolvedBaseTextTemplate),
    baseContract,
    plannerBaseSignals: (table.plannerBaseSignals ?? []).filter(signal => signal !== 'rebased-base'),
    baseDisclosure: normalizeBaseDisclosure(table, resolvedBaseTextTemplate),
    wincrossDenominatorSemantic: normalizeWinCrossSemantic(
      resolvedBaseMode,
      resolvedBaseTextTemplate,
    ),
    wincrossQualifiedCodes: undefined,
    resolvedBaseMode,
    resolvedSplitPolicy,
    resolvedBaseTextTemplate,
    resolvedBaseValidation,
  };

  const defaultBaseText = resolveBaseText(resolvedBaseTextTemplate);
  if (!nextTable.baseText || nextTable.baseText.trim().length === 0 || table.basePolicy.includes('rebased')) {
    nextTable.baseText = defaultBaseText;
  }

  if (
    nextTable.lastModifiedBy !== 'DeterministicBaseEngine'
    && (
      nextTable.basePolicy !== table.basePolicy
      || nextTable.baseText !== table.baseText
      || nextTable.wincrossDenominatorSemantic !== table.wincrossDenominatorSemantic
      || nextTable.resolvedBaseMode !== table.resolvedBaseMode
      || nextTable.resolvedBaseTextTemplate !== table.resolvedBaseTextTemplate
    )
  ) {
    nextTable.lastModifiedBy = 'DeterministicBaseEngine';
  }

  return nextTable;
}

export function resolveCanonicalBaseContract(
  canonicalOutput: CanonicalTableOutput,
): CanonicalTableOutput {
  return {
    ...canonicalOutput,
    tables: canonicalOutput.tables.map(resolveTable),
  };
}
