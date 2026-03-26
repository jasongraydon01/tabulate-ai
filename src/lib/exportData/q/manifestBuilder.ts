import {
  type QExportBannerGroupStrategy,
  type QExportBannerPlan,
  QExportManifestSchema,
  type ExportPlatformSupportSummary,
  type ExportPlatformSupportStatus,
  type ExportSupportItem,
  type QExportBlockedItem,
  type QExportCut,
  type QExportFilter,
  type QExportFilterTree,
  type QExportJob,
  type QExportManifest,
  type QExportRowPlan,
  type QExportTable,
  type QExportTableStrategy,
} from '@/lib/exportData/types';
import { createHash } from 'crypto';
import { Q_EXPORT_MANIFEST_VERSION, Q_EXPORT_RUNTIME_CONTRACT, type QExportResolvedArtifacts } from './types';
import { compileQFilter } from './filterCompiler';
import { computeHelperIdentity } from './helperIdentity';
import { resolveExportBaseContext } from '@/lib/exportData/baseContext';

export interface BuildQExportManifestParams {
  packageId: string;
  exporterVersion: string;
  artifacts: QExportResolvedArtifacts;
}

export function buildQExportManifest(params: BuildQExportManifestParams): QExportManifest {
  const { artifacts, packageId, exporterVersion } = params;
  const supportByItemId = new Map(artifacts.supportReport.supportItems.map((item) => [item.itemId, item] as const));
  const loopPolicyByGroup = new Map((artifacts.loopPolicy?.bannerGroups ?? []).map((policy) => [policy.groupName, policy] as const));
  const sortedFinalOrderByTableId = new Map<string, number>();
  const sortedFinalTableById = new Map<string, (typeof artifacts.sortedFinal.tables)[number]>();
  for (const [index, table] of artifacts.sortedFinal.tables.entries()) {
    sortedFinalOrderByTableId.set(table.tableId, index);
    sortedFinalTableById.set(table.tableId, table);
  }
  const variableLabelByName = buildVariableLabelByName(artifacts.verboseDataMap);
  const dataFrames = [...new Set(artifacts.jobRoutingManifest.jobs.map((job) => job.dataFrameRef))].sort((a, b) => a.localeCompare(b));

  const warnings = [...new Set([
    ...(artifacts.metadata.warnings ?? []),
    ...(artifacts.loopPolicy?.warnings ?? []),
    ...(artifacts.loopPolicy?.fallbackApplied ? [`Loop semantics fallback applied: ${artifacts.loopPolicy.fallbackReason}`] : []),
    ...(!artifacts.loopPolicy ? ['Loop semantics policy unavailable; cuts requiring loop context were blocked.'] : []),
  ])].sort((a, b) => a.localeCompare(b));

  const blockedItems: QExportBlockedItem[] = [];
  const filters: QExportFilter[] = [];
  const cuts: QExportCut[] = [];
  const tables: QExportTable[] = [];

  const orderedGroups = [...artifacts.crosstabRaw.bannerCuts];
  for (const group of orderedGroups) {
    const orderedColumns = [...group.columns];
    for (const column of orderedColumns) {
      const sourceId = `cut:${group.groupName}::${column.name}`;
      const supportItem = supportByItemId.get(sourceId);
      if (!supportItem) {
        blockedItems.push({
          itemType: 'cut',
          itemId: sourceId,
          reasonCodes: ['missing_support_item'],
          detail: 'Cut is missing from support-report.json and was blocked for deterministic export safety.',
        });
        continue;
      }

      const supportStatus = supportItem.q.status;
      const supportReasons = supportItem.q.reasonCodes;
      const expression = (column.adjusted ?? '').trim();

      const policy = loopPolicyByGroup.get(group.groupName);
      const framesForCut = resolveCutFrames({
        dataFrames,
        policy,
      });

      if (!expression) {
        blockedItems.push({
          itemType: 'cut',
          itemId: sourceId,
          reasonCodes: ['missing_expression'],
          detail: 'Cut was omitted because no adjusted expression was provided.',
        });
        continue;
      }

      if (supportStatus === 'blocked') {
        blockedItems.push({
          itemType: 'cut',
          itemId: sourceId,
          reasonCodes: supportReasons,
          detail: 'Cut support report classified this expression as blocked for Q.',
        });
        continue;
      }

      if (framesForCut.blocked) {
        blockedItems.push({
          itemType: 'cut',
          itemId: sourceId,
          reasonCodes: framesForCut.reasonCodes,
          detail: framesForCut.detail,
        });
        continue;
      }

      for (const dataFrameRef of framesForCut.frames) {
        const filterId = `${sourceId}@${dataFrameRef}`;
        const compiled = compileQFilter(expression, {
          dataFrameRef,
          filterId,
        });
        if (compiled.parseStatus === 'blocked' || !compiled.filterTree) {
          blockedItems.push({
            itemType: 'cut',
            itemId: filterId,
            reasonCodes: compiled.reasonCodes,
            detail: `Cut expression could not be compiled for ${dataFrameRef}.`,
          });
          continue;
        }

        const helperIdentity = computeHelperIdentity({
          filterId,
          fingerprint: compiled.fingerprint,
          source: 'cut',
          sourceId,
          dataFrameRef,
          columnName: column.name,
        });

        filters.push({
          filterId,
          source: 'cut',
          sourceId,
          expression,
          normalizedExpression: compiled.normalized,
          fingerprint: compiled.fingerprint,
          filterTree: compiled.filterTree,
          parseStatus: compiled.parseStatus,
          loweringStrategy: compiled.loweringStrategy,
          reasonCodes: [...new Set([...supportReasons, ...compiled.reasonCodes])],
          dataFrameRef,
          helperVarName: helperIdentity.helperVarName,
          helperVarLabel: helperIdentity.helperVarLabel,
          consumerRefs: [`banner:${dataFrameRef}`],
        });

        cuts.push({
          cutId: filterId,
          groupName: group.groupName,
          columnName: column.name,
          expression,
          dataFrameRef,
          filterId,
          supportStatus,
          reasonCodes: [...new Set([...supportReasons, ...compiled.reasonCodes])],
        });
      }
    }
  }

  const sortedJobs = [...artifacts.jobRoutingManifest.jobs].sort((a, b) => a.jobId.localeCompare(b.jobId));
  const jobs: QExportJob[] = [];
  const emittedTableIds = new Set<string>();

  for (const job of sortedJobs) {
    const emittedTableIdsForJob: string[] = [];
    const orderedTableIdsForJob = [...job.tableIds].sort((a, b) => {
      const aOrder = sortedFinalOrderByTableId.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = sortedFinalOrderByTableId.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return a.localeCompare(b);
    });

    for (const tableId of orderedTableIdsForJob) {
      const sourceId = `table:${tableId}`;
      const supportItem = supportByItemId.get(sourceId);
      if (!supportItem) {
        blockedItems.push({
          itemType: 'table',
          itemId: sourceId,
          reasonCodes: ['missing_support_item'],
          detail: 'Table is missing from support-report.json and was blocked for deterministic export safety.',
        });
        continue;
      }

      const supportStatus = supportItem.q.status;
      const supportReasons = supportItem.q.reasonCodes;
      const tableDataFrame = artifacts.tableRouting.tableToDataFrameRef[tableId];

      if (!tableDataFrame) {
        blockedItems.push({
          itemType: 'table',
          itemId: sourceId,
          reasonCodes: ['missing_table_routing'],
          detail: `Table ${tableId} is missing from table-routing.json.`,
        });
        continue;
      }

      if (tableDataFrame !== job.dataFrameRef) {
        blockedItems.push({
          itemType: 'table',
          itemId: sourceId,
          reasonCodes: ['table_routing_mismatch'],
          detail: `Table ${tableId} routed to ${tableDataFrame}, but job ${job.jobId} expects ${job.dataFrameRef}.`,
        });
        continue;
      }

      const table = sortedFinalTableById.get(tableId);
      if (!table) {
        blockedItems.push({
          itemType: 'table',
          itemId: sourceId,
          reasonCodes: ['missing_sorted_final_table'],
          detail: `Table ${tableId} is not present in sorted-final artifact.`,
        });
        continue;
      }

      if (supportStatus === 'blocked') {
        blockedItems.push({
          itemType: 'table',
          itemId: sourceId,
          reasonCodes: supportReasons,
          detail: 'Table additional filter support report classified this item as blocked for Q.',
        });
        continue;
      }

      const rawAdditionalFilter = (table.additionalFilter ?? '').trim();
      let additionalFilterId: string | undefined;
      if (rawAdditionalFilter.length > 0) {
        additionalFilterId = `${sourceId}:additionalFilter`;
        const compiled = compileQFilter(rawAdditionalFilter, {
          dataFrameRef: job.dataFrameRef,
          filterId: additionalFilterId,
        });
        if (compiled.parseStatus === 'blocked' || !compiled.filterTree) {
          blockedItems.push({
            itemType: 'table',
            itemId: additionalFilterId,
            reasonCodes: compiled.reasonCodes,
            detail: `Table additional filter for ${tableId} could not be compiled.`,
          });
          continue;
        }

        const tableHelperIdentity = computeHelperIdentity({
          filterId: additionalFilterId,
          fingerprint: compiled.fingerprint,
          source: 'table',
          sourceId,
          dataFrameRef: job.dataFrameRef,
        });

        filters.push({
          filterId: additionalFilterId,
          source: 'table',
          sourceId,
          expression: rawAdditionalFilter,
          normalizedExpression: compiled.normalized,
          fingerprint: compiled.fingerprint,
          filterTree: compiled.filterTree,
          parseStatus: compiled.parseStatus,
          loweringStrategy: compiled.loweringStrategy,
          reasonCodes: [...new Set([...supportReasons, ...compiled.reasonCodes])],
          dataFrameRef: job.dataFrameRef,
          helperVarName: tableHelperIdentity.helperVarName,
          helperVarLabel: tableHelperIdentity.helperVarLabel,
          consumerRefs: [`table:${tableId}`],
        });
      }

      emittedTableIds.add(tableId);
      emittedTableIdsForJob.push(tableId);
      const tableOrderIndex = sortedFinalOrderByTableId.get(table.tableId) ?? Number.MAX_SAFE_INTEGER;
      const primaryStrategy = table.tableType === 'mean_rows'
        ? 'numeric_row_plan_primary' as const
        : 'row_plan_primary' as const;
      const tableStrategy = classifyTableStrategy(table);
      const sourceQuestionName = resolveSourceQuestionName(table, tableStrategy, table.questionId);
      const headerRows = buildTableHeaderRows(table.rows);
      const rowPlans = buildTableRowPlans({
        tableType: table.tableType,
        rows: table.rows,
        variableLabelByName,
      });
      const baseContext = resolveExportBaseContext(table as Record<string, unknown>);
      tables.push({
        tableId: table.tableId,
        tableOrderIndex,
        jobId: job.jobId,
        dataFrameRef: job.dataFrameRef,
        questionId: table.questionId,
        questionText: buildExportQuestionText(table),
        tableType: table.tableType,
        primaryStrategy,
        tableStrategy,
        ...(sourceQuestionName ? { sourceQuestionName } : {}),
        ...(rawAdditionalFilter.length > 0 ? { additionalFilter: rawAdditionalFilter } : {}),
        ...(additionalFilterId ? { additionalFilterId } : {}),
        ...(additionalFilterId ? { additionalFilterBindPath: 'table_filters_variable' as const } : {}),
        supportStatus,
        reasonCodes: supportReasons,
        rowCount: Array.isArray(table.rows) ? table.rows.length : 0,
        rows: rowPlans,
        headerRows,
        baseContext,
      });
    }

    const dataFileR2Key = artifacts.metadata.r2Refs.dataFiles[job.dataFileRelativePath];
    jobs.push({
      jobId: job.jobId,
      dataFrameRef: job.dataFrameRef,
      dataFileRelativePath: job.dataFileRelativePath,
      packageDataFilePath: toPackageDataFilePath(job.dataFileRelativePath),
      ...(dataFileR2Key ? { dataFileR2Key } : {}),
      tableIds: emittedTableIdsForJob,
    });
  }

  for (const tableId of artifacts.jobRoutingManifest.jobs.flatMap((job) => job.tableIds)) {
    if (emittedTableIds.has(tableId)) {
      continue;
    }
    const sourceId = `table:${tableId}`;
    if (blockedItems.some((blocked) => blocked.itemId === sourceId || blocked.itemId.startsWith(`${sourceId}:`))) {
      continue;
    }
    blockedItems.push({
      itemType: 'table',
      itemId: sourceId,
      reasonCodes: ['table_not_emitted'],
      detail: `Table ${tableId} did not emit and was automatically blocked for deterministic export safety.`,
    });
  }

  const bannerPlans = buildBannerPlans(cuts, filters);

  const manifest: QExportManifest = {
    manifestVersion: Q_EXPORT_MANIFEST_VERSION,
    exporterVersion,
    generatedAt: artifacts.metadata.generatedAt,
    packageId,
    sourceManifestVersion: artifacts.metadata.manifestVersion,
    integrityDigest: artifacts.metadata.idempotency?.integrityDigest ?? '',
    artifacts: {
      metadataPath: artifacts.metadata.artifactPaths.outputs.metadata,
      tableRoutingPath: artifacts.metadata.artifactPaths.outputs.tableRouting,
      jobRoutingManifestPath: artifacts.metadata.artifactPaths.outputs.jobRoutingManifest,
      loopPolicyPath: artifacts.metadata.artifactPaths.outputs.loopPolicy,
      supportReportPath: artifacts.metadata.artifactPaths.outputs.supportReport ?? 'export/support-report.json',
      sortedFinalPath: artifacts.metadata.artifactPaths.inputs.sortedFinal,
      resultsTablesPath: artifacts.metadata.artifactPaths.inputs.resultsTables,
      crosstabRawPath: artifacts.metadata.artifactPaths.inputs.crosstabRaw,
      loopSummaryPath: artifacts.metadata.artifactPaths.inputs.loopSummary,
      ...(artifacts.metadata.artifactPaths.inputs.verboseDataMap
        ? { verboseDataMapPath: artifacts.metadata.artifactPaths.inputs.verboseDataMap }
        : {}),
    },
    provenance: {
      runId: artifacts.metadata.convexRefs.runId,
      projectId: artifacts.metadata.convexRefs.projectId,
      orgId: artifacts.metadata.convexRefs.orgId,
    },
    runtimeContract: Q_EXPORT_RUNTIME_CONTRACT,
    jobs: jobs.sort((a, b) => a.jobId.localeCompare(b.jobId)),
    tables: tables.sort((a, b) => {
      if (a.tableOrderIndex !== b.tableOrderIndex) {
        return a.tableOrderIndex - b.tableOrderIndex;
      }
      return a.tableId.localeCompare(b.tableId);
    }),
    cuts: cuts.sort((a, b) => a.cutId.localeCompare(b.cutId)),
    filters: filters.sort((a, b) => a.filterId.localeCompare(b.filterId)),
    bannerPlans,
    blockedItems: blockedItems.sort((a, b) => a.itemId.localeCompare(b.itemId)),
    warnings,
    supportSummary: summarizeManifestSupport({
      cutSourceIds: orderedGroups.flatMap((group) =>
        [...group.columns]
          .map((column) => `cut:${group.groupName}::${column.name}`),
      ),
      tableIds: sortedJobs.flatMap((job) => [...job.tableIds].sort((a, b) => a.localeCompare(b))),
      cuts,
      tables,
      blockedItems,
    }),
    sourceSupportSummary: artifacts.supportReport.summary.q,
  };

  return QExportManifestSchema.parse(manifest);
}

interface ClassifiableTable {
  tableType: string;
  rows: unknown;
  exclude?: boolean;
}

function classifyTableStrategy(table: ClassifiableTable): QExportTableStrategy {
  if (table.exclude) return 'excluded';

  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (rows.length === 0) return 'synthetic_rows';

  const hasNets = rows.some((r: Record<string, unknown>) => r.isNet === true);
  const hasNetComponents = rows.some(
    (r: Record<string, unknown>) => Array.isArray(r.netComponents) && r.netComponents.length > 0,
  );
  const hasHeaders = rows.some(
    (r: Record<string, unknown>) => typeof r.variable === 'string' && r.variable === '_CAT_',
  );
  const hasRangeFilters = rows.some(
    (r: Record<string, unknown>) => typeof r.filterValue === 'string' && /^\d+-\d+/.test(r.filterValue),
  );

  const realRows = rows.filter((r: Record<string, unknown>) => {
    const v = typeof r.variable === 'string' ? r.variable : '';
    return v !== '_CAT_' && !v.startsWith('_NET_');
  });
  const uniqueVars = [...new Set(realRows.map((r: Record<string, unknown>) => String(r.variable ?? '')))];
  const singleVariable = uniqueVars.length === 1;

  const nonNetRows = rows.filter((r: Record<string, unknown>) => {
    const v = typeof r.variable === 'string' ? r.variable : '';
    return r.isNet !== true && v !== '_CAT_';
  });
  const allFilterValue1 = nonNetRows.length > 0 && nonNetRows.every(
    (r: Record<string, unknown>) => String(r.filterValue ?? '') === '1',
  );

  if (table.tableType === 'mean_rows') {
    return rows.length === 1 ? 'native_numeric_single' : 'native_numeric_multi';
  }

  if (table.tableType === 'frequency') {
    if (hasRangeFilters) return 'synthetic_rows';
    if (hasHeaders) return 'synthetic_rows';

    if (!singleVariable) {
      if (allFilterValue1 && !hasNetComponents) return 'cross_variable';
      if (hasNetComponents) return 'native_pick_any';
      return 'cross_variable';
    }

    if (hasNets || hasNetComponents) return 'native_pick_one_with_nets';
    return 'native_pick_one';
  }

  return 'synthetic_rows';
}

function resolveSourceQuestionName(
  table: ClassifiableTable,
  strategy: QExportTableStrategy,
  questionId: string,
): string | undefined {
  if (strategy === 'excluded' || strategy === 'synthetic_rows') return undefined;

  const rows = Array.isArray(table.rows) ? table.rows : [];
  const realRows = rows.filter((r: Record<string, unknown>) => {
    const v = typeof r.variable === 'string' ? r.variable : '';
    return v !== '_CAT_' && !v.startsWith('_NET_');
  });
  const uniqueVars = [...new Set(realRows.map((r: Record<string, unknown>) => String(r.variable ?? '')))];

  return uniqueVars.length === 1 ? uniqueVars[0] : questionId;
}

function buildVariableLabelByName(verboseDataMap: unknown[] | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(verboseDataMap)) {
    return map;
  }

  for (const entry of verboseDataMap) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const column = typeof candidate.column === 'string' ? candidate.column.trim() : '';
    if (!column) {
      continue;
    }
    const label = typeof candidate.label === 'string' && candidate.label.trim().length > 0
      ? candidate.label.trim()
      : (typeof candidate.description === 'string' && candidate.description.trim().length > 0
        ? candidate.description.trim()
        : '');
    if (!label) {
      continue;
    }
    if (!map.has(column)) {
      map.set(column, label);
    }
  }
  return map;
}

function buildTableRowPlans(params: {
  tableType: string;
  rows: unknown;
  variableLabelByName: Map<string, string>;
}): QExportRowPlan[] {
  const { tableType, rows, variableLabelByName } = params;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((rawRow, rowIndex) => {
    const candidate = rawRow && typeof rawRow === 'object'
      ? (rawRow as Record<string, unknown>)
      : {};

    const variable = typeof candidate.variable === 'string' ? candidate.variable.trim() : '';
    const rowLabel = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const filterValue = typeof candidate.filterValue === 'string' ? candidate.filterValue.trim() : '';
    const isNet = candidate.isNet === true;
    const netComponents = Array.isArray(candidate.netComponents)
      ? candidate.netComponents
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
      : [];
    const indent = typeof candidate.indent === 'number' && Number.isFinite(candidate.indent)
      ? candidate.indent
      : 0;

    const sourceLabel = variableLabelByName.get(variable);
    const resolvedLabel = resolveEffectiveLabel({
      rowLabel,
      sourceLabel,
      variable,
      filterValue,
    });

    // Category header rows are display metadata only in this phase.
    if (!variable || variable === '_CAT_') {
      return {
        rowIndex,
        variable: variable || '_UNKNOWN_',
        label: rowLabel,
        filterValue,
        isNet,
        netComponents,
        indent,
        strategy: 'blocked' as const,
        strategyReason: variable === '_CAT_'
          ? 'category_header_row'
          : 'missing_row_variable',
        selectedValues: [],
        sourceLabel,
        effectiveLabel: resolvedLabel.effectiveLabel,
        labelSource: resolvedLabel.labelSource,
      };
    }

    if (netComponents.length > 0) {
      return {
        rowIndex,
        variable,
        label: rowLabel,
        filterValue,
        isNet,
        netComponents,
        indent,
        strategy: 'synthetic_expression' as const,
        strategyReason: 'cross_variable_net_components',
        selectedValues: [],
        syntheticExpression: buildNetComponentsExpression(netComponents),
        sourceLabel,
        effectiveLabel: resolvedLabel.effectiveLabel,
        labelSource: resolvedLabel.labelSource,
      };
    }

    const filterInterpretation = interpretFilterValue(filterValue);
    if (filterInterpretation.type === 'range') {
      return {
        rowIndex,
        variable,
        label: rowLabel,
        filterValue,
        isNet,
        netComponents,
        indent,
        strategy: 'synthetic_expression' as const,
        strategyReason: 'range_filter_expression',
        selectedValues: [],
        syntheticExpression: buildRangeExpression(variable, filterInterpretation),
        sourceLabel,
        effectiveLabel: resolvedLabel.effectiveLabel,
        labelSource: resolvedLabel.labelSource,
      };
    }

    if (filterInterpretation.type === 'tokenized') {
      return {
        rowIndex,
        variable,
        label: rowLabel,
        filterValue,
        isNet,
        netComponents,
        indent,
        strategy: 'duplicate_value_attributes' as const,
        strategyReason: filterInterpretation.values.length > 1 ? 'multi_value_codes' : 'single_value_code',
        selectedValues: filterInterpretation.values,
        sourceLabel,
        effectiveLabel: resolvedLabel.effectiveLabel,
        labelSource: resolvedLabel.labelSource,
      };
    }

    if (filterInterpretation.type === 'tokenized_string') {
      return {
        rowIndex,
        variable,
        label: rowLabel,
        filterValue,
        isNet,
        netComponents,
        indent,
        strategy: 'synthetic_expression' as const,
        strategyReason: filterInterpretation.tokens.length > 1
          ? 'multi_value_string_expression'
          : 'single_value_string_expression',
        selectedValues: [],
        syntheticExpression: buildTokenExpression(variable, filterInterpretation.tokens),
        sourceLabel,
        effectiveLabel: resolvedLabel.effectiveLabel,
        labelSource: resolvedLabel.labelSource,
      };
    }

    if (filterInterpretation.type === 'empty') {
      if (tableType === 'mean_rows') {
        return {
          rowIndex,
          variable,
          label: rowLabel,
          filterValue,
          isNet,
          netComponents,
          indent,
          strategy: 'direct_source_variable' as const,
          strategyReason: 'mean_row_direct_numeric',
          selectedValues: [],
          sourceLabel,
          effectiveLabel: resolvedLabel.effectiveLabel,
          labelSource: resolvedLabel.labelSource,
        };
      }
      return {
        rowIndex,
        variable,
        label: rowLabel,
        filterValue,
        isNet,
        netComponents,
        indent,
        strategy: 'duplicate_value_attributes' as const,
        strategyReason: 'presence_row_no_filter',
        selectedValues: [],
        sourceLabel,
        effectiveLabel: resolvedLabel.effectiveLabel,
        labelSource: resolvedLabel.labelSource,
      };
    }

    return {
      rowIndex,
      variable,
      label: rowLabel,
      filterValue,
      isNet,
      netComponents,
      indent,
      strategy: 'blocked' as const,
      strategyReason: 'unsupported_filter_value',
      selectedValues: [],
      sourceLabel,
      effectiveLabel: resolvedLabel.effectiveLabel,
      labelSource: resolvedLabel.labelSource,
    };
  });
}

function buildTableHeaderRows(rows: unknown): Array<{
  rowIndex: number;
  label: string;
  filterValue: string;
  indent: number;
}> {
  if (!Array.isArray(rows)) {
    return [];
  }
  const headers: Array<{
    rowIndex: number;
    label: string;
    filterValue: string;
    indent: number;
  }> = [];
  for (let index = 0; index < rows.length; index += 1) {
    const candidate = rows[index];
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const row = candidate as Record<string, unknown>;
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    if (variable !== '_CAT_') {
      continue;
    }
    headers.push({
      rowIndex: index,
      label: typeof row.label === 'string' ? row.label.trim() : '',
      filterValue: typeof row.filterValue === 'string' ? row.filterValue.trim() : '',
      indent: typeof row.indent === 'number' && Number.isFinite(row.indent) ? row.indent : 0,
    });
  }
  return headers;
}

function resolveEffectiveLabel(params: {
  rowLabel: string;
  sourceLabel: string | undefined;
  variable: string;
  filterValue: string;
}): { effectiveLabel: string; labelSource: QExportRowPlan['labelSource'] } {
  if (params.rowLabel.length > 0) {
    return {
      effectiveLabel: params.rowLabel,
      labelSource: 'row_label',
    };
  }
  if (params.sourceLabel && params.sourceLabel.length > 0) {
    return {
      effectiveLabel: params.sourceLabel,
      labelSource: 'variable_label',
    };
  }
  const fallback = params.filterValue
    ? `${params.variable} [${params.filterValue}]`
    : params.variable;
  return {
    effectiveLabel: fallback,
    labelSource: 'generated_placeholder',
  };
}

function buildExportQuestionText(table: { questionId: string; questionText?: string; [key: string]: unknown }): string {
  const subtitle = (typeof table.tableSubtitle === 'string' ? table.tableSubtitle.trim() : '') || '';
  const rawTitle = table.questionText ?? table.questionId;
  return subtitle ? `${subtitle} - ${rawTitle}` : rawTitle;
}

function coerceTokenValue(token: string): string | number {
  if (/^-?0\d/.test(token)) {
    return token;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(token)) {
    return Number(token);
  }
  return token;
}

type FilterInterpretation =
  | { type: 'empty' }
  | { type: 'tokenized'; values: Array<string | number> }
  | { type: 'tokenized_string'; tokens: string[] }
  | { type: 'range'; kind: 'between' | 'gte' | 'lte'; min?: number; max?: number }
  | { type: 'unsupported' };

function interpretFilterValue(filterValue: string): FilterInterpretation {
  if (!filterValue) {
    return { type: 'empty' };
  }

  const betweenMatch = filterValue.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (betweenMatch) {
    return {
      type: 'range',
      kind: 'between',
      min: Number(betweenMatch[1]),
      max: Number(betweenMatch[2]),
    };
  }

  const gteMatch = filterValue.match(/^(-?\d+(?:\.\d+)?)\s*\+$/);
  if (gteMatch) {
    return {
      type: 'range',
      kind: 'gte',
      min: Number(gteMatch[1]),
    };
  }

  const lteMatch = filterValue.match(/^<=?\s*(-?\d+(?:\.\d+)?)$/);
  if (lteMatch) {
    return {
      type: 'range',
      kind: 'lte',
      max: Number(lteMatch[1]),
    };
  }

  const tokens = filterValue
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length > 0 && tokens.every((token) => /^-?\d+(?:\.\d+)?$/.test(token))) {
    return {
      type: 'tokenized',
      values: tokens.map((token) => coerceTokenValue(token)),
    };
  }

  if (tokens.length > 0 && tokens.every((token) => /^[A-Za-z0-9_]+$/.test(token))) {
    return {
      type: 'tokenized_string',
      tokens,
    };
  }

  return { type: 'unsupported' };
}

function buildNumericCastExpression(variableName: string): string {
  return `suppressWarnings(as.numeric(${toRVariableRef(variableName)}))`;
}

function buildTokenExpression(variableName: string, tokens: string[]): string {
  const ref = toRVariableRef(variableName);
  const comparisons = tokens.map((token) => `(as.character(${ref}) == ${JSON.stringify(token)})`);
  return `(!is.na(${ref}) & (${comparisons.join(' | ')}))`;
}

function buildNetComponentsExpression(netComponents: string[]): string {
  const comparisons = netComponents.map((componentName) => {
    const numeric = buildNumericCastExpression(componentName);
    return `(!is.na(${numeric}) & ${numeric} > 0)`;
  });
  return comparisons.join(' | ');
}

function buildRangeExpression(
  variableName: string,
  filter: Extract<FilterInterpretation, { type: 'range' }>,
): string {
  const numeric = buildNumericCastExpression(variableName);
  if (filter.kind === 'between') {
    return `(!is.na(${numeric}) & ${numeric} >= ${String(filter.min)} & ${numeric} <= ${String(filter.max)})`;
  }
  if (filter.kind === 'gte') {
    return `(!is.na(${numeric}) & ${numeric} >= ${String(filter.min)})`;
  }
  return `(!is.na(${numeric}) & ${numeric} <= ${String(filter.max)})`;
}

function toRVariableRef(variableName: string): string {
  const trimmed = variableName.trim();
  const escaped = trimmed.replace(/`/g, '\\`');
  return `\`${escaped}\``;
}

function summarizeManifestSupport(input: {
  cutSourceIds: string[];
  tableIds: string[];
  cuts: QExportCut[];
  tables: QExportTable[];
  blockedItems: QExportBlockedItem[];
}): ExportPlatformSupportSummary {
  const summary: ExportPlatformSupportSummary = { supported: 0, warning: 0, blocked: 0 };

  const cutStatusBySource = new Map<string, ExportPlatformSupportStatus>();
  for (const cut of input.cuts) {
    const sourceId = `cut:${cut.groupName}::${cut.columnName}`;
    const previous = cutStatusBySource.get(sourceId);
    cutStatusBySource.set(sourceId, mergeSupportStatus(previous, cut.supportStatus));
  }

  const tableStatusBySource = new Map<string, ExportPlatformSupportStatus>(
    input.tables.map((table) => [`table:${table.tableId}`, table.supportStatus] as const),
  );

  const blockedCutSources = new Set(
    input.blockedItems
      .filter((item) => item.itemType === 'cut')
      .map((item) => item.itemId.replace(/@.+$/, '')),
  );
  const blockedTableSources = new Set(
    input.blockedItems
      .filter((item) => item.itemType === 'table')
      .map((item) => item.itemId.replace(/:additionalFilter$/, '')),
  );

  for (const sourceId of [...new Set(input.cutSourceIds)]) {
    if (blockedCutSources.has(sourceId)) {
      summary.blocked += 1;
      continue;
    }
    const status = cutStatusBySource.get(sourceId) ?? 'supported';
    summary[status] += 1;
  }

  for (const tableId of [...new Set(input.tableIds)]) {
    const sourceId = `table:${tableId}`;
    if (blockedTableSources.has(sourceId)) {
      summary.blocked += 1;
      continue;
    }
    const status = tableStatusBySource.get(sourceId) ?? 'supported';
    summary[status] += 1;
  }

  return summary;
}

function mergeSupportStatus(
  previous: ExportPlatformSupportStatus | undefined,
  next: ExportPlatformSupportStatus,
): ExportPlatformSupportStatus {
  if (!previous) {
    return next;
  }
  if (previous === 'blocked' || next === 'blocked') {
    return 'blocked';
  }
  if (previous === 'warning' || next === 'warning') {
    return 'warning';
  }
  return 'supported';
}

function resolveCutFrames(input: {
  dataFrames: string[];
  policy: {
    anchorType: 'respondent' | 'entity';
    stackedFrameName: string;
  } | undefined;
}):
  | { blocked: false; frames: string[] }
  | { blocked: true; reasonCodes: string[]; detail: string } {
  const frames = [...new Set(
    input.dataFrames
      .map((frame) => frame.trim())
      .filter((frame) => frame.length > 0),
  )];

  if (frames.length === 0) {
    return {
      blocked: true,
      reasonCodes: ['missing_job_data_frames'],
      detail: 'No routed jobs were available to anchor this cut group.',
    };
  }

  if (!input.policy) {
    if (frames.length === 1) {
      return { blocked: false, frames };
    }
    return {
      blocked: true,
      reasonCodes: ['missing_loop_semantics_policy'],
      detail: 'Loop semantics policy for this cut group was not available.',
    };
  }

  if (input.policy.anchorType === 'entity') {
    // Entity-anchored cuts apply to all compatible stacked frames.
    // The compiled contract already validated frame compatibility upstream —
    // return all available frames so the cut is applied across all loop families.
    return { blocked: false, frames };
  }

  return { blocked: false, frames };
}

export function getSupportStatusForItem(
  supportItem: ExportSupportItem | undefined,
): { status: ExportPlatformSupportStatus; reasonCodes: string[] } {
  return {
    status: supportItem?.q.status ?? 'supported',
    reasonCodes: supportItem?.q.reasonCodes ?? ['no_expression'],
  };
}

function toPackageDataFilePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith('export/data/')) {
    return normalized.slice('export/'.length);
  }
  if (normalized.startsWith('data/')) {
    return normalized;
  }
  const basename = normalized.split('/').filter((part) => part.length > 0).pop() ?? normalized;
  return `data/${basename}`;
}

function buildBannerPlans(cuts: QExportCut[], filters: QExportFilter[]): QExportBannerPlan[] {
  // Group cuts by (dataFrameRef, groupName) to produce per-group banner structure.
  // Each group becomes its own Pick Any question; groups are composed via createBanner.
  const cutsByFrameAndGroup = new Map<string, QExportCut[]>();
  for (const cut of cuts) {
    if (!cut.filterId) continue;
    const key = `${cut.dataFrameRef}\0${cut.groupName}`;
    const existing = cutsByFrameAndGroup.get(key) ?? [];
    existing.push(cut);
    cutsByFrameAndGroup.set(key, existing);
  }

  // Build filter lookup for classification
  const filterById = new Map(filters.map((f) => [f.filterId, f]));

  // Collect groups per data frame, preserving insertion order (spec ordering)
  const frameGroups = new Map<string, Array<{
    groupName: string;
    filterIds: string[];
    groupStrategy: QExportBannerGroupStrategy;
    sourceQuestionName?: string;
  }>>();
  for (const [key, groupCuts] of cutsByFrameAndGroup.entries()) {
    const separatorIndex = key.indexOf('\0');
    const dataFrameRef = key.slice(0, separatorIndex);
    const groupName = key.slice(separatorIndex + 1);
    // Filter IDs sorted for deterministic hashing, but group/column display order is preserved
    const filterIds = [...new Set(groupCuts.map((c) => c.filterId).filter((id): id is string => !!id))].sort((a, b) => a.localeCompare(b));
    if (filterIds.length === 0) continue;

    // Classify group strategy based on filter tree analysis.
    // NOTE: native_question is disabled for banner groups — question.duplicate() gives ALL
    // values, but banner cuts are analyst-curated subsets (often merged/recoded). Synthetic
    // is correct by construction. Classification kept for future use / diagnostics.
    const _classification = classifyBannerGroupStrategy(filterIds, filterById);

    const existing = frameGroups.get(dataFrameRef) ?? [];
    existing.push({
      groupName,
      filterIds,
      groupStrategy: 'synthetic_filter' as const,
    });
    frameGroups.set(dataFrameRef, existing);
  }

  const plans: QExportBannerPlan[] = [];
  for (const [dataFrameRef, groups] of frameGroups.entries()) {
    // Preserve spec ordering — do NOT sort groups alphabetically
    const allFilterIds = groups.flatMap((g) => g.filterIds);
    const planId = `banner:${dataFrameRef}`;
    const suffix = createHash('sha256')
      .update(`${planId}|${allFilterIds.join('|')}`)
      .digest('hex')
      .slice(0, 12);

    const bannerGroups = groups.map((g) => ({
      groupName: g.groupName,
      groupQuestionName: g.groupName,
      filterIds: g.filterIds,
      groupStrategy: g.groupStrategy,
      ...(g.sourceQuestionName ? { sourceQuestionName: g.sourceQuestionName } : {}),
    }));

    plans.push({
      planId,
      dataFrameRef,
      sourceCutFilterIds: [...new Set(allFilterIds)].sort((a, b) => a.localeCompare(b)),
      bannerQuestionName: `HT_Banner_${suffix}`,
      groups: bannerGroups,
    });
  }

  // Sort plans by planId for deterministic manifest output (not display order)
  return plans.sort((a, b) => a.planId.localeCompare(b.planId));
}

/**
 * Classify a banner group as native_question or synthetic_filter.
 *
 * native_question: ALL cuts in the group reference the SAME single variable
 * with equality (==) or any_of (%in%) operators only. This means the group
 * can use question.duplicate() instead of creating N synthetic filter variables.
 *
 * synthetic_filter: Anything else (multi-variable, range, derived comparisons, etc.)
 */
function classifyBannerGroupStrategy(
  filterIds: string[],
  filterById: Map<string, QExportFilter>,
): { strategy: QExportBannerGroupStrategy; sourceQuestionName?: string } {
  if (filterIds.length === 0) {
    return { strategy: 'synthetic_filter' };
  }

  let commonSourceVar: string | null = null;

  for (const filterId of filterIds) {
    const filter = filterById.get(filterId);
    if (!filter || !filter.filterTree) {
      return { strategy: 'synthetic_filter' };
    }

    const sourceVar = extractSingleSourceVariable(filter.filterTree);
    if (!sourceVar) {
      return { strategy: 'synthetic_filter' };
    }

    if (commonSourceVar === null) {
      commonSourceVar = sourceVar;
    } else if (commonSourceVar !== sourceVar) {
      return { strategy: 'synthetic_filter' };
    }
  }

  if (!commonSourceVar) {
    return { strategy: 'synthetic_filter' };
  }

  return {
    strategy: 'native_question',
    sourceQuestionName: commonSourceVar,
  };
}

/**
 * Extract the single source variable from a filter tree, if the tree is a simple
 * equality/any_of expression on one variable. Returns null for complex trees.
 */
function extractSingleSourceVariable(tree: QExportFilterTree): string | null {
  if (tree.type === 'term') {
    // Only equals and any_of are compatible with native question strategy
    if (tree.op !== 'equals' && tree.op !== 'any_of') {
      return null;
    }
    return tree.leftRef;
  }

  // OR of simple terms on the same variable is still native-compatible
  // (e.g., S9 == 1 | S9 == 2 compiles to S9 %in% c(1,2))
  if (tree.type === 'or') {
    let commonRef: string | null = null;
    for (const child of tree.children) {
      const ref = extractSingleSourceVariable(child);
      if (!ref) return null;
      if (commonRef === null) {
        commonRef = ref;
      } else if (commonRef !== ref) {
        return null;
      }
    }
    return commonRef;
  }

  // AND, NOT, derived_comparison → not native-compatible
  return null;
}
