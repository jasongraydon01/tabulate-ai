/**
 * V3 Runtime — Canonical → Compute Table Adapter
 *
 * Bridges stage 13d CanonicalTable output into the legacy TableWithLoopFrame
 * shape expected by the compute/R layer during the migration window.
 */

import type {
  CanonicalRow,
  CanonicalTable,
} from '@/lib/v3/runtime/canonical/types';
import type {
  ComputeRowContextV1,
  ComputeTableContextV1,
  ExtendedTableRow,
  TableWithLoopFrame,
} from '@/schemas/verificationAgentSchema';
import type { ComputeRiskSignal } from '@/lib/v3/runtime/canonical/types';

const ALLOWED_LAST_MODIFIED_BY = new Set<TableWithLoopFrame['lastModifiedBy']>([
  'VerificationAgent',
  'FilterApplicator',
  'GridAutoSplitter',
  'MaxDiffConsolidator',
  'TableEnhancer',
  'DeterministicBaseEngine',
  'TableBlockAssembler',
  'TableMetadataPrefill',
]);
const DEFAULT_SUM_TOLERANCE = 5;

function hasPhase4BaseMetadata(table: CanonicalTable): boolean {
  return Boolean(
    table.baseViewRole
    || table.plannerBaseComparability
    || (table.plannerBaseSignals && table.plannerBaseSignals.length > 0)
    || (table.computeRiskSignals && table.computeRiskSignals.length > 0)
    || table.baseContract.classification.referenceUniverse
    || table.baseContract.policy.effectiveBaseMode
    || table.baseContract.policy.rebasePolicy !== 'none'
    || table.baseContract.signals.length > 0
    || table.baseDisclosure?.referenceBaseN != null
    || table.baseDisclosure?.itemBaseRange != null
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function parseAppliesToColumns(table: CanonicalTable): string[] {
  if (!table.appliesToColumn) return [];
  return uniqueStrings(table.appliesToColumn.split(',').map(value => value.trim()));
}

function parseRowGroupId(variable: string): string | null {
  const match = variable.match(/^(.*?)[rR](\d+)[cC](\d+)$/);
  if (!match) return null;
  return `${match[1]}r${match[2]}`;
}

function buildSumConstraintValidityExpression(table: CanonicalTable): string | null {
  if (table.tableKind !== 'grid_row_detail') return null;
  if (table.analyticalSubtype !== 'allocation') return null;
  if (!table.sumConstraint?.detected) return null;
  if (table.sumConstraint.constraintAxis !== 'across-cols') return null;
  if (table.sumConstraint.constraintValue == null) return null;

  const variables = parseAppliesToColumns(table);
  if (variables.length < 2) return null;

  const rowGroups = uniqueStrings(variables.map(parseRowGroupId));
  if (rowGroups.length !== 1) return null;

  const completeExpr = variables.map(variable => `!is.na(\`${variable}\`)`).join(' & ');
  const sumExpr = variables.map(variable => `as.numeric(\`${variable}\`)`).join(' + ');
  return `(${completeExpr}) & (abs((${sumExpr}) - ${table.sumConstraint.constraintValue}) <= ${DEFAULT_SUM_TOLERANCE})`;
}

function collectStructuralVariables(table: CanonicalTable): string[] {
  const rowVariables = table.rows
    .filter(row => row.variable && row.variable !== '_CAT_')
    .flatMap(row => {
      const vars = [row.variable];
      if (row.isNet && row.netComponents.length > 0) {
        vars.push(...row.netComponents);
      }
      return vars;
    });
  return uniqueStrings([
    ...parseAppliesToColumns(table),
    ...rowVariables,
  ]);
}

function getRowVariables(table: CanonicalTable): string[] {
  return uniqueStrings(table.rows
    .filter(row => row.variable && row.variable !== '_CAT_')
    .map(row => row.variable));
}

function isRankingArtifactTable(table: CanonicalTable): boolean {
  return table.analyticalSubtype === 'ranking'
    && table.baseContract.classification.variationClass === 'ranking_artifact';
}

function resolvePrecisionVariable(table: CanonicalTable): string | null {
  const structuralVariables = collectStructuralVariables(table);
  if (
    table.computeMaskAnchorVariable
    && structuralVariables.includes(table.computeMaskAnchorVariable)
  ) {
    return table.computeMaskAnchorVariable;
  }
  if (table.computeMaskAnchorVariable) {
    console.warn(
      `[resolvePrecisionVariable] precision table "${table.tableId}" has invalid computeMaskAnchorVariable "${table.computeMaskAnchorVariable}"; falling back`,
    );
  }

  if (table.appliesToItem && structuralVariables.includes(table.appliesToItem)) {
    return table.appliesToItem;
  }

  const appliesToColumns = parseAppliesToColumns(table);
  const fallbackColumn = appliesToColumns[0] ?? null;
  if (fallbackColumn) {
    console.warn(
      `[resolvePrecisionVariable] precision table "${table.tableId}" is missing an explicit mask anchor; using first appliesToColumn "${fallbackColumn}"`,
    );
    return fallbackColumn;
  }

  const rowVariables = getRowVariables(table);
  const fallbackRowVariable = rowVariables[0] ?? null;
  if (fallbackRowVariable) {
    console.warn(
      `[resolvePrecisionVariable] precision table "${table.tableId}" is missing an explicit mask anchor; using first row variable "${fallbackRowVariable}"`,
    );
    return fallbackRowVariable;
  }

  return null;
}

function buildTableMaskIntent(table: CanonicalTable): ComputeTableContextV1['tableMaskIntent'] {
  const referenceUniverse = table.baseContract.classification.referenceUniverse;
  if (referenceUniverse === 'model') return 'model';
  if (referenceUniverse === 'cluster') return 'cluster_universe';
  if (isRankingArtifactTable(table)) {
    return referenceUniverse === 'question' ? 'question_universe' : 'none';
  }
  if (table.baseViewRole === 'precision') return 'precision_item';
  if ((table.additionalFilter || '').trim().length > 0) return 'legacy_additional_filter';
  if (referenceUniverse === 'question') return 'question_universe';
  return 'none';
}

function buildTableMaskRecipe(table: CanonicalTable): ComputeTableContextV1['tableMaskRecipe'] {
  const intent = buildTableMaskIntent(table);

  if (intent === 'model') {
    return { kind: 'model' };
  }
  if (intent === 'none') {
    return { kind: 'none' };
  }
  if (intent === 'precision_item') {
    const variable = resolvePrecisionVariable(table);
    return variable ? { kind: 'variable_answered', variable } : null;
  }
  if (intent === 'cluster_universe') {
    const variables = parseAppliesToColumns(table);
    return variables.length > 0 ? { kind: 'any_answered', variables } : null;
  }
  if (intent === 'question_universe') {
    const variables = collectStructuralVariables(table);
    if (variables.length > 0) {
      return { kind: 'any_answered', variables };
    }
    // Fallback: table has question-universe intent but no extractable variables.
    // This can happen with grid decomposition tables whose rows/columns didn't
    // resolve. Return 'none' (no mask) rather than null (broken) — the
    // compute-mask-required signal still flags it for auditing.
    console.warn(
      `[buildTableMaskRecipe] question_universe table "${table.tableId}" has no structural variables; falling back to no mask`,
    );
    return { kind: 'none' };
  }
  return null;
}

function buildTableComputeContext(table: CanonicalTable): ComputeTableContextV1 | undefined {
  if (!hasPhase4BaseMetadata(table)) return undefined;

  const rebaseSourceVariables = uniqueStrings(
    table.rows
      .filter(row => row.variable && row.variable !== '_CAT_')
      .map(row => row.variable),
  );
  const rebaseExcludedValues = table.statsSpec?.excludeTailValues ?? [];
  const tableMaskIntent = buildTableMaskIntent(table);
  const tableMaskRecipe = buildTableMaskRecipe(table);
  const validityExpression = (table.additionalFilter || '').trim() || buildSumConstraintValidityExpression(table);

  const computeRiskSignals = new Set<ComputeRiskSignal>(table.computeRiskSignals ?? []);

  return {
    version: 1,
    referenceUniverse: table.baseContract.classification.referenceUniverse,
    effectiveBaseMode: table.baseContract.policy.effectiveBaseMode,
    tableMaskIntent,
    tableMaskRecipe,
    rebasePolicy: table.baseContract.policy.rebasePolicy,
    rebaseSourceVariables,
    rebaseExcludedValues,
    validityPolicy: validityExpression ? 'legacy_expression' : 'none',
    validityExpression: validityExpression || null,
    referenceBaseN: table.baseDisclosure?.referenceBaseN ?? null,
    itemBaseRange: table.baseDisclosure?.itemBaseRange ?? null,
    baseViewRole: table.baseViewRole ?? null,
    plannerBaseComparability: table.plannerBaseComparability ?? null,
    plannerBaseSignals: [...(table.plannerBaseSignals ?? [])],
    computeRiskSignals: Array.from(computeRiskSignals),
    legacyCompatibility: {
      basePolicy: table.basePolicy,
      additionalFilter: table.additionalFilter || '',
    },
  };
}

function buildRowComputeContext(
  row: CanonicalRow,
  table: CanonicalTable,
): ComputeRowContextV1 | undefined {
  const tableContext = buildTableComputeContext(table);
  if (!tableContext) return undefined;
  const rankingArtifact = isRankingArtifactTable(table);

  const realNetComponents = row.isNet
    ? row.netComponents.filter(component => !/^\d+$/.test(component))
    : [];
  const componentValues = row.filterValue
    ? row.filterValue.split(',').map(value => value.trim()).filter(Boolean)
    : [];

  let aggregationMode: ComputeRowContextV1['aggregationMode'] = 'none';
  if (row.rowKind === 'stat') {
    aggregationMode = 'stat_summary';
  } else if (row.rowKind === 'not_answered') {
    aggregationMode = 'not_answered';
  } else if (row.isNet && realNetComponents.length > 0) {
    aggregationMode = table.tableType === 'mean_rows'
      ? 'row_sum_components'
      : 'any_component_selected';
  } else if (componentValues.length > 1) {
    aggregationMode = 'single_variable_value_set';
  }

  let universeMode: ComputeRowContextV1['universeMode'] = 'masked_row_observed_n';
  if (tableContext.effectiveBaseMode === 'model') {
    universeMode = 'model';
  } else if (
    rankingArtifact
    && (
      row.rowKind === 'rank'
      || row.rowKind === 'topk'
      || row.rowKind === 'not_answered'
    )
  ) {
    universeMode = 'masked_shared_table_n';
  } else if (
    tableContext.effectiveBaseMode === 'table_mask_shared_n'
    || aggregationMode === 'not_answered'
    || aggregationMode === 'any_component_selected'
    || aggregationMode === 'row_sum_components'
  ) {
    universeMode = 'masked_shared_table_n';
  }

  return {
    version: 1,
    universeMode,
    aggregationMode,
    sourceVariable: row.variable && row.variable !== '_CAT_' ? row.variable : null,
    componentVariables: realNetComponents,
    componentValues,
  };
}

function toExtendedRow(row: CanonicalRow, table: CanonicalTable): ExtendedTableRow {
  return {
    variable: row.variable,
    label: row.label,
    filterValue: row.filterValue,
    isNet: row.isNet,
    netComponents: row.netComponents,
    indent: row.indent,
    rowKind: row.rowKind,
    ...(buildRowComputeContext(row, table) ? { computeContext: buildRowComputeContext(row, table) } : {}),
  };
}

function normalizeLastModifiedBy(value: string): TableWithLoopFrame['lastModifiedBy'] {
  if (ALLOWED_LAST_MODIFIED_BY.has(value as TableWithLoopFrame['lastModifiedBy'])) {
    return value as TableWithLoopFrame['lastModifiedBy'];
  }
  return 'DeterministicBaseEngine';
}

export function canonicalToComputeTable(table: CanonicalTable): TableWithLoopFrame {
  const computeContext = buildTableComputeContext(table);
  const rows = table.rows.map(row => toExtendedRow(row, table));

  if (computeContext && rows.some(row =>
    row.computeContext?.universeMode === 'masked_shared_table_n'
    && (row.computeContext.aggregationMode === 'any_component_selected'
      || row.computeContext.aggregationMode === 'row_sum_components'),
  )) {
    computeContext.computeRiskSignals = Array.from(new Set([
      ...computeContext.computeRiskSignals,
      'net-uses-table-universe',
    ]));
  }

  return {
    tableId: table.tableId,
    questionId: table.questionId,
    questionText: table.questionText,
    tableType: table.tableType,
    rows,
    sourceTableId: table.sourceTableId || table.tableId,
    isDerived: table.isDerived,
    exclude: table.exclude,
    excludeReason: table.excludeReason,
    surveySection: table.surveySection || '',
    baseText: table.baseText || '',
    userNote: table.userNote || '',
    tableSubtitle: table.tableSubtitle || '',
    sortOrder: table.sortOrder,
    additionalFilter: table.additionalFilter || '',
    filterReviewRequired: table.filterReviewRequired,
    splitFromTableId: table.splitFromTableId || '',
    lastModifiedBy: normalizeLastModifiedBy(table.lastModifiedBy),
    loopDataFrame: '',
    excludeTailValues: table.statsSpec?.excludeTailValues ?? [],
    ...(computeContext ? { computeContext } : {}),
  };
}

export function canonicalToComputeTables(tables: CanonicalTable[]): TableWithLoopFrame[] {
  return tables.map(canonicalToComputeTable);
}
