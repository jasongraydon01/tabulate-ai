import fs from 'fs/promises';
import path from 'path';
import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';
import type { EnhancementReport } from '@/lib/tables/enhancer-rules/types';
import { deterministicHash } from '@/lib/tables/enhancerDeterminism';
import {
  getTableEnhancerCanaryDatasets,
  getTableEnhancerRollbackMaxExpansionRatio,
  getVerificationMutationMaxLabelChangeRate,
  getVerificationMutationMaxStructuralRate,
  isTableEnhancerAutoRollbackEnabled,
} from '@/lib/env';
import type { VerificationEditReport } from '@/schemas/verificationEditReportSchema';

export type TableEnhancerMode = 'disabled' | 'shadow' | 'active';

export interface TableEnhancerRolloutDecision {
  requestedMode: TableEnhancerMode;
  effectiveMode: TableEnhancerMode;
  applyEnhancedOutput: boolean;
  canaryDatasets: string[];
  canaryMatched: boolean;
  expansionRatio: number;
  maxExpansionRatio: number;
  rollbackTriggered: boolean;
  reasons: string[];
}

export interface TableEnhancerShadowDiffReport {
  baselineHash: string;
  enhancedHash: string;
  baselineTableCount: number;
  enhancedTableCount: number;
  tableCountDelta: number;
  addedTableIds: string[];
  removedTableIds: string[];
  duplicateTableIds: {
    baseline: string[];
    enhanced: string[];
  };
  changedTables: Array<{
    tableId: string;
    rowCountBefore: number;
    rowCountAfter: number;
    rowCountDelta: number;
    rowsChanged: boolean;
    tableTypeChanged: boolean;
    excludeChanged: boolean;
    sourceTableIdChanged: boolean;
    isDerivedChanged: boolean;
    additionalFilterChanged: boolean;
    splitFromTableIdChanged: boolean;
    filterReviewRequiredChanged: boolean;
    baseTextChanged: boolean;
  }>;
  unchangedTableCount: number;
}

export interface EnhancementVerificationAggregate {
  generatedAt: string;
  enhancementReportFound: boolean;
  verificationEditReportFound: boolean;
  flaggedForAICount: number;
  totalEditReports: number;
  structuralMutationCount: number;
  structuralMutationRate: number;
  labelsChanged: number;
  labelsTotal: number;
  labelChangeRate: number;
  metadataChangeCount: number;
  exclusionChangeCount: number;
  netsAdded: number;
  netsRemoved: number;
  thresholds: {
    maxStructuralMutationRate: number;
    maxLabelChangeRate: number;
  };
  thresholdBreaches: string[];
}

export interface EnhancerRunDiagnostics {
  warnings: string[];
  aggregate: EnhancementVerificationAggregate | null;
}

export function decideTableEnhancerRollout(input: {
  datasetName: string;
  baselineTableCount: number;
  enhancedTableCount: number;
  enhancerEnabled: boolean;
  enhancerShadowMode: boolean;
}): TableEnhancerRolloutDecision {
  const requestedMode: TableEnhancerMode =
    input.enhancerEnabled && !input.enhancerShadowMode
      ? 'active'
      : input.enhancerEnabled || input.enhancerShadowMode
        ? 'shadow'
        : 'disabled';

  if (requestedMode === 'disabled') {
    return {
      requestedMode,
      effectiveMode: 'disabled',
      applyEnhancedOutput: false,
      canaryDatasets: [],
      canaryMatched: false,
      expansionRatio: 1,
      maxExpansionRatio: getTableEnhancerRollbackMaxExpansionRatio(),
      rollbackTriggered: false,
      reasons: [],
    };
  }

  const canaryDatasets = getTableEnhancerCanaryDatasets();
  const canaryMatched = matchesCanaryDataset(input.datasetName, canaryDatasets);
  const expansionRatio =
    input.baselineTableCount > 0
      ? Number((input.enhancedTableCount / input.baselineTableCount).toFixed(3))
      : 1;
  const maxExpansionRatio = getTableEnhancerRollbackMaxExpansionRatio();
  const autoRollbackEnabled = isTableEnhancerAutoRollbackEnabled();
  const reasons: string[] = [];

  let effectiveMode: TableEnhancerMode = requestedMode;
  let rollbackTriggered = false;

  if (requestedMode === 'active' && canaryDatasets.length > 0 && !canaryMatched) {
    effectiveMode = 'shadow';
    reasons.push('dataset_not_in_canary_cohort');
  }

  if (requestedMode === 'active' && autoRollbackEnabled && expansionRatio > maxExpansionRatio) {
    effectiveMode = 'shadow';
    rollbackTriggered = true;
    reasons.push(`expansion_ratio_breach:${expansionRatio}>${maxExpansionRatio}`);
  }

  return {
    requestedMode,
    effectiveMode,
    applyEnhancedOutput: effectiveMode === 'active',
    canaryDatasets,
    canaryMatched,
    expansionRatio,
    maxExpansionRatio,
    rollbackTriggered,
    reasons,
  };
}

export function buildEnhancerShadowDiff(
  baselineTables: ExtendedTableDefinition[],
  enhancedTables: ExtendedTableDefinition[],
): TableEnhancerShadowDiffReport {
  const baselineIndex = indexByTableId(baselineTables);
  const enhancedIndex = indexByTableId(enhancedTables);

  const baselineIds = Array.from(baselineIndex.byId.keys());
  const enhancedIds = Array.from(enhancedIndex.byId.keys());
  const baselineSet = new Set(baselineIds);
  const enhancedSet = new Set(enhancedIds);

  const addedTableIds = enhancedIds.filter((tableId) => !baselineSet.has(tableId)).sort();
  const removedTableIds = baselineIds.filter((tableId) => !enhancedSet.has(tableId)).sort();
  const sharedIds = baselineIds.filter((tableId) => enhancedSet.has(tableId)).sort();

  const changedTables: TableEnhancerShadowDiffReport['changedTables'] = [];
  let unchangedTableCount = 0;

  for (const tableId of sharedIds) {
    const before = baselineIndex.byId.get(tableId);
    const after = enhancedIndex.byId.get(tableId);
    if (!before || !after) continue;

    const rowCountBefore = before.rows.length;
    const rowCountAfter = after.rows.length;
    const rowsChanged = deterministicHash(before.rows) !== deterministicHash(after.rows);
    const tableTypeChanged = before.tableType !== after.tableType;
    const excludeChanged = before.exclude !== after.exclude || before.excludeReason !== after.excludeReason;
    const sourceTableIdChanged = before.sourceTableId !== after.sourceTableId;
    const isDerivedChanged = before.isDerived !== after.isDerived;
    const additionalFilterChanged = before.additionalFilter !== after.additionalFilter;
    const splitFromTableIdChanged = before.splitFromTableId !== after.splitFromTableId;
    const filterReviewRequiredChanged = before.filterReviewRequired !== after.filterReviewRequired;
    const baseTextChanged = before.baseText !== after.baseText;

    const changed =
      rowsChanged ||
      tableTypeChanged ||
      excludeChanged ||
      sourceTableIdChanged ||
      isDerivedChanged ||
      additionalFilterChanged ||
      splitFromTableIdChanged ||
      filterReviewRequiredChanged ||
      baseTextChanged;

    if (!changed) {
      unchangedTableCount += 1;
      continue;
    }

    changedTables.push({
      tableId,
      rowCountBefore,
      rowCountAfter,
      rowCountDelta: rowCountAfter - rowCountBefore,
      rowsChanged,
      tableTypeChanged,
      excludeChanged,
      sourceTableIdChanged,
      isDerivedChanged,
      additionalFilterChanged,
      splitFromTableIdChanged,
      filterReviewRequiredChanged,
      baseTextChanged,
    });
  }

  return {
    baselineHash: deterministicHash(
      baselineTables.map((table) => ({ tableId: table.tableId, rows: table.rows, exclude: table.exclude })),
    ),
    enhancedHash: deterministicHash(
      enhancedTables.map((table) => ({ tableId: table.tableId, rows: table.rows, exclude: table.exclude })),
    ),
    baselineTableCount: baselineTables.length,
    enhancedTableCount: enhancedTables.length,
    tableCountDelta: enhancedTables.length - baselineTables.length,
    addedTableIds,
    removedTableIds,
    duplicateTableIds: {
      baseline: baselineIndex.duplicates.sort(),
      enhanced: enhancedIndex.duplicates.sort(),
    },
    changedTables,
    unchangedTableCount,
  };
}

export async function persistTableEnhancerArtifacts(input: {
  outputDir: string;
  baselineTables: ExtendedTableDefinition[];
  enhancedTables: ExtendedTableDefinition[];
  enhancementReport: EnhancementReport;
  rolloutDecision: TableEnhancerRolloutDecision;
}): Promise<TableEnhancerShadowDiffReport> {
  const enhancerDir = path.join(input.outputDir, 'enhancer');
  await fs.mkdir(enhancerDir, { recursive: true });

  const shadowDiff = buildEnhancerShadowDiff(input.baselineTables, input.enhancedTables);

  await fs.writeFile(
    path.join(enhancerDir, 'enhancement-report.json'),
    JSON.stringify(input.enhancementReport, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(enhancerDir, 'enhanced-tables.json'),
    JSON.stringify(input.enhancedTables, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(enhancerDir, 'shadow-diff.json'),
    JSON.stringify(shadowDiff, null, 2),
    'utf-8',
  );
  await fs.writeFile(
    path.join(enhancerDir, 'rollout-decision.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        ...input.rolloutDecision,
      },
      null,
      2,
    ),
    'utf-8',
  );

  if (input.rolloutDecision.rollbackTriggered) {
    await fs.writeFile(
      path.join(enhancerDir, 'rollback-triggered.json'),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          reasons: input.rolloutDecision.reasons,
          expansionRatio: input.rolloutDecision.expansionRatio,
          maxExpansionRatio: input.rolloutDecision.maxExpansionRatio,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  return shadowDiff;
}

export async function collectEnhancerRunDiagnostics(outputDir: string): Promise<EnhancerRunDiagnostics> {
  const warnings: string[] = [];
  let enhancementReport: EnhancementReport | null = null;
  let editReports: VerificationEditReport[] = [];

  try {
    const enhancementReportRaw = await fs.readFile(
      path.join(outputDir, 'enhancer', 'enhancement-report.json'),
      'utf-8',
    );
    enhancementReport = JSON.parse(enhancementReportRaw) as EnhancementReport;
  } catch {
    // optional artifact
  }

  try {
    const editReportsRaw = await fs.readFile(
      path.join(outputDir, 'verification', 'verification-edit-reports.json'),
      'utf-8',
    );
    const parsed = JSON.parse(editReportsRaw) as VerificationEditReport[];
    if (Array.isArray(parsed)) {
      editReports = parsed;
    }
  } catch {
    // optional artifact
  }

  const flaggedForAICount = enhancementReport?.flaggedForAI?.length ?? 0;
  if (flaggedForAICount > 0) {
    warnings.push(`enhancerFlaggedForAI>${0} (${flaggedForAICount})`);
  }

  const structuralMutationCount = editReports.reduce(
    (sum, report) => sum + (report.structuralMutations?.length ?? 0),
    0,
  );
  if (structuralMutationCount > 0) {
    warnings.push(`verificationStructuralMutations>${0} (${structuralMutationCount})`);
  }

  if (!enhancementReport && editReports.length === 0) {
    return { warnings, aggregate: null };
  }

  const labelsChanged = editReports.reduce((sum, report) => sum + (report.labelsChanged ?? 0), 0);
  const labelsTotal = editReports.reduce((sum, report) => sum + (report.labelsTotal ?? 0), 0);
  const metadataChangeCount = editReports.reduce(
    (sum, report) => sum + (report.metadataChanges?.length ?? 0),
    0,
  );
  const exclusionChangeCount = editReports.filter((report) => report.exclusionChanged).length;
  const netsAdded = editReports.reduce((sum, report) => sum + (report.netsAdded ?? 0), 0);
  const netsRemoved = editReports.reduce((sum, report) => sum + (report.netsRemoved ?? 0), 0);
  const reportsWithStructuralMutations = editReports.filter(
    (report) => (report.structuralMutations?.length ?? 0) > 0,
  ).length;
  const structuralMutationRate =
    editReports.length > 0 ? Number((reportsWithStructuralMutations / editReports.length).toFixed(3)) : 0;
  const labelChangeRate = labelsTotal > 0 ? Number((labelsChanged / labelsTotal).toFixed(3)) : 0;

  const thresholds = {
    maxStructuralMutationRate: getVerificationMutationMaxStructuralRate(),
    maxLabelChangeRate: getVerificationMutationMaxLabelChangeRate(),
  };
  const thresholdBreaches: string[] = [];

  if (structuralMutationRate > thresholds.maxStructuralMutationRate) {
    thresholdBreaches.push(
      `structuralMutationRate>${thresholds.maxStructuralMutationRate} (${structuralMutationRate})`,
    );
  }
  if (labelChangeRate > thresholds.maxLabelChangeRate) {
    thresholdBreaches.push(`labelChangeRate>${thresholds.maxLabelChangeRate} (${labelChangeRate})`);
  }

  if (thresholdBreaches.length > 0) {
    warnings.push(`enhancerRollbackThresholdBreach>${0} (${thresholdBreaches.join('; ')})`);
  }

  const aggregate: EnhancementVerificationAggregate = {
    generatedAt: new Date().toISOString(),
    enhancementReportFound: !!enhancementReport,
    verificationEditReportFound: editReports.length > 0,
    flaggedForAICount,
    totalEditReports: editReports.length,
    structuralMutationCount,
    structuralMutationRate,
    labelsChanged,
    labelsTotal,
    labelChangeRate,
    metadataChangeCount,
    exclusionChangeCount,
    netsAdded,
    netsRemoved,
    thresholds,
    thresholdBreaches,
  };

  const enhancerDir = path.join(outputDir, 'enhancer');
  await fs.mkdir(enhancerDir, { recursive: true });
  await fs.writeFile(
    path.join(enhancerDir, 'enhancement-verification-aggregate.json'),
    JSON.stringify(aggregate, null, 2),
    'utf-8',
  );

  if (thresholdBreaches.length > 0 && isTableEnhancerAutoRollbackEnabled()) {
    await fs.writeFile(
      path.join(enhancerDir, 'rollback-threshold-breach.json'),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          thresholdBreaches,
          thresholds,
          structuralMutationCount,
          structuralMutationRate,
          labelsChanged,
          labelsTotal,
          labelChangeRate,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  return { warnings, aggregate };
}

function indexByTableId(tables: ExtendedTableDefinition[]): {
  byId: Map<string, ExtendedTableDefinition>;
  duplicates: string[];
} {
  const byId = new Map<string, ExtendedTableDefinition>();
  const duplicates: string[] = [];
  for (const table of tables) {
    if (byId.has(table.tableId)) {
      duplicates.push(table.tableId);
      continue;
    }
    byId.set(table.tableId, table);
  }
  return { byId, duplicates };
}

function matchesCanaryDataset(datasetName: string, canaryDatasets: string[]): boolean {
  if (canaryDatasets.length === 0) return true;
  const normalizedDataset = datasetName.toLowerCase();

  return canaryDatasets.some((entry) => {
    const normalizedEntry = entry.toLowerCase().trim();
    if (!normalizedEntry) return false;
    if (normalizedEntry.includes('*')) {
      const escaped = normalizedEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      return new RegExp(`^${escaped}$`, 'i').test(datasetName);
    }
    return normalizedDataset.includes(normalizedEntry);
  });
}
