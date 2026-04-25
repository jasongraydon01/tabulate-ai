import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  CrosstabRawArtifactSchema,
  ResultsTablesFinalContractSchema,
  SortedFinalArtifactSchema,
} from './inputArtifactSchemas';
import { parseExpression } from './expression';
import {
  EXPORT_ACTIVE_MANIFEST_VERSION,
  EXPORT_ARTIFACT_PATHS,
  type ExportManifestMetadata,
  type ExportReadiness,
  type ExportReadinessReasonCode,
  type ExportSupportItem,
  type ExportSupportReport,
  type ExportSupportSummary,
  type JobRoutingManifest,
  type TableRoutingArtifact,
  ExportSupportReportSchema,
  JobRoutingManifestSchema,
  TableRoutingArtifactSchema,
  ExportManifestMetadataSchema,
  type NormalizedExpression,
} from './types';

export interface BuildPhase1ManifestResult {
  metadata: ExportManifestMetadata;
  supportReport: ExportSupportReport;
  requiredArtifactPaths: string[];
  requiredDataFilePaths: string[];
}

export class ExportManifestBuildError extends Error {
  readonly reasonCodes: ExportReadinessReasonCode[];
  readonly details: string[];

  constructor(message: string, reasonCodes: ExportReadinessReasonCode[], details: string[] = []) {
    super(message);
    this.name = 'ExportManifestBuildError';
    this.reasonCodes = reasonCodes;
    this.details = details;
  }
}

interface FilterTranslatorOutput {
  filters?: Array<{
    ruleId?: string;
    questionId?: string;
    filterExpression?: string;
  }>;
}

interface SupportDecision {
  status: 'supported' | 'warning' | 'blocked';
  reasonCodes: string[];
  fallbackStrategy?: 'derived_variable' | 'skip' | 'manual_edit';
}

interface SupportPair {
  q: SupportDecision;
  wincross: SupportDecision;
}

interface ReadinessInputs {
  manifestVersion: string;
  missingArtifacts: string[];
  missingDataFiles: string[];
  checksumMismatches: string[];
  consistencyMismatches: string[];
  invalidResultsTablesContractDetails: string[];
  r2Finalized: boolean;
  missingR2ArtifactRefs: string[];
  missingR2DataFileRefs: string[];
}

export async function buildPhase1Manifest(outputDir: string): Promise<BuildPhase1ManifestResult> {
  const metadataPath = path.join(outputDir, EXPORT_ARTIFACT_PATHS.metadata);
  if (!(await fileExists(metadataPath))) {
    throw new ExportManifestBuildError(
      `Missing required export metadata: ${EXPORT_ARTIFACT_PATHS.metadata}`,
      ['missing_required_artifact'],
      [EXPORT_ARTIFACT_PATHS.metadata],
    );
  }

  const parsedMetadata = ExportManifestMetadataSchema.safeParse(
    JSON.parse(await fs.readFile(metadataPath, 'utf-8')),
  );
  if (!parsedMetadata.success) {
    throw new ExportManifestBuildError(
      'Export metadata is invalid and cannot be upgraded to phase1.v1',
      ['missing_required_artifact'],
      [parsedMetadata.error.message],
    );
  }

  if (parsedMetadata.data.manifestVersion !== EXPORT_ACTIVE_MANIFEST_VERSION) {
    throw new ExportManifestBuildError(
      `Manifest version '${parsedMetadata.data.manifestVersion}' is legacy and cannot be upgraded in forward-only mode.`,
      ['not_exportable_requires_rerun'],
      [`manifestVersion=${parsedMetadata.data.manifestVersion}`],
    );
  }

  const metadata: ExportManifestMetadata = {
    ...parsedMetadata.data,
    manifestVersion: EXPORT_ACTIVE_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    artifactPaths: {
      ...parsedMetadata.data.artifactPaths,
      outputs: {
        ...parsedMetadata.data.artifactPaths.outputs,
        supportReport: parsedMetadata.data.artifactPaths.outputs.supportReport ?? EXPORT_ARTIFACT_PATHS.supportReport,
      },
    },
  };
  const resultsTablesPath = metadata.artifactPaths.inputs.resultsTables;

  const crosstabRaw = await readRequiredJson(
    outputDir,
    metadata.artifactPaths.inputs.crosstabRaw,
    CrosstabRawArtifactSchema,
  );

  const sortedFinal = await readRequiredJson(
    outputDir,
    metadata.artifactPaths.inputs.sortedFinal,
    SortedFinalArtifactSchema,
  );

  const tableRouting = await readRequiredJson(
    outputDir,
    metadata.artifactPaths.outputs.tableRouting,
    TableRoutingArtifactSchema,
  );

  const jobRouting = await readRequiredJson(
    outputDir,
    metadata.artifactPaths.outputs.jobRoutingManifest,
    JobRoutingManifestSchema,
  );

  const filtertranslator = await readOptionalFilterTranslator(outputDir);
  const existingSupportReport = await readExistingSupportReport(outputDir);

  const expressions = collectExpressions(crosstabRaw, sortedFinal, filtertranslator);
  const supportItems = buildSupportItems(crosstabRaw, sortedFinal, filtertranslator, expressions);
  const supportSummary = summarizeSupport(supportItems);
  const consistencyMismatches = collectArtifactConsistencyMismatches({
    sortedFinal,
    tableRouting,
    jobRouting,
    supportItems,
  });

  const supportReport: ExportSupportReport = {
    generatedAt: existingSupportReport?.generatedAt ?? new Date().toISOString(),
    manifestVersion: metadata.manifestVersion,
    expressionSummary: {
      total: expressions.length,
      parsed: expressions.filter((expr) => expr.parseStatus === 'parsed').length,
      blocked: expressions.filter((expr) => expr.parseStatus === 'blocked').length,
    },
    expressions,
    supportItems,
    summary: supportSummary,
  };

  await writeJson(outputDir, EXPORT_ARTIFACT_PATHS.supportReport, supportReport);

  const requiredLocalArtifactPaths = [
    EXPORT_ARTIFACT_PATHS.metadata,
    resultsTablesPath,
    EXPORT_ARTIFACT_PATHS.tableRouting,
    EXPORT_ARTIFACT_PATHS.jobRoutingManifest,
    EXPORT_ARTIFACT_PATHS.loopPolicy,
    EXPORT_ARTIFACT_PATHS.supportReport,
  ];
  const requiredR2ArtifactPaths = [
    EXPORT_ARTIFACT_PATHS.metadata,
    EXPORT_ARTIFACT_PATHS.tableRouting,
    EXPORT_ARTIFACT_PATHS.jobRoutingManifest,
    EXPORT_ARTIFACT_PATHS.loopPolicy,
    EXPORT_ARTIFACT_PATHS.supportReport,
  ];
  const checksumArtifactPaths = requiredLocalArtifactPaths.filter(
    (relativePath) => relativePath !== EXPORT_ARTIFACT_PATHS.metadata,
  );
  const requiredDataFilePaths = [...new Set([
    EXPORT_ARTIFACT_PATHS.wideSav,
    ...jobRouting.jobs.map((job) => job.dataFileRelativePath),
  ])].sort();

  const missingArtifacts = await findMissingPaths(outputDir, requiredLocalArtifactPaths);
  const missingDataFiles = await findMissingPaths(outputDir, requiredDataFilePaths);
  const invalidResultsTablesContractDetails = await validateResultsTablesContract(outputDir, resultsTablesPath);

  const artifactChecksums = await hashExistingPaths(outputDir, checksumArtifactPaths);
  const dataFileChecksums = await hashExistingPaths(outputDir, requiredDataFilePaths);

  const previousIntegrity = metadata.integrity;
  const checksumMismatches = collectChecksumMismatches(previousIntegrity, artifactChecksums, dataFileChecksums);

  const metadataPayloadChecksum = hashObject(stableValue({
    manifestVersion: metadata.manifestVersion,
    weighting: metadata.weighting,
    sourceSavNames: metadata.sourceSavNames,
    availableDataFiles: metadata.availableDataFiles,
    artifactPaths: metadata.artifactPaths,
    convexRefs: metadata.convexRefs,
    warnings: metadata.warnings,
    support: supportSummary,
  }));

  const integrity = (previousIntegrity && checksumMismatches.length > 0)
    ? {
      ...previousIntegrity,
      verifiedAt: new Date().toISOString(),
    }
    : {
      algorithm: 'sha256' as const,
      metadataPayloadChecksum,
      artifactChecksums,
      dataFileChecksums,
      verifiedAt: new Date().toISOString(),
    };

  const integrityDigest = hashObject(stableValue({
    metadataPayloadChecksum: integrity.metadataPayloadChecksum,
    artifactChecksums: integrity.artifactChecksums,
    dataFileChecksums: integrity.dataFileChecksums,
  }));

  metadata.integrity = integrity;
  metadata.support = supportSummary;
  metadata.idempotency = {
    integrityDigest,
    jobs: buildIdempotencyJobs(metadata, jobRouting, integrityDigest),
  };

  const missingR2ArtifactRefs = requiredR2ArtifactPaths.filter((relativePath) => !metadata.r2Refs.artifacts[relativePath]);
  const missingR2DataFileRefs = requiredDataFilePaths.filter((relativePath) => !metadata.r2Refs.dataFiles[relativePath]);

  metadata.readiness = buildReadiness({
    manifestVersion: metadata.manifestVersion,
    missingArtifacts,
    missingDataFiles,
    checksumMismatches,
    consistencyMismatches,
    invalidResultsTablesContractDetails,
    r2Finalized: metadata.r2Refs.finalized,
    missingR2ArtifactRefs,
    missingR2DataFileRefs,
  });

  await writeJson(outputDir, EXPORT_ARTIFACT_PATHS.metadata, metadata);

  return {
    metadata,
    supportReport,
    requiredArtifactPaths: requiredLocalArtifactPaths,
    requiredDataFilePaths,
  };
}

export function evaluateExportReadiness(metadata: ExportManifestMetadata): ExportReadiness {
  const localDetails: string[] = [];
  const localCodes: ExportReadinessReasonCode[] = [];

  if (metadata.manifestVersion !== EXPORT_ACTIVE_MANIFEST_VERSION) {
    localCodes.push('not_exportable_requires_rerun');
    localDetails.push(`Manifest version '${metadata.manifestVersion}' is not exportable in forward-only mode.`);
  }

  const availableByPath = new Map(
    metadata.availableDataFiles.map((file) => [file.relativePath, file] as const),
  );
  const requiredDataFilePaths = new Set<string>([EXPORT_ARTIFACT_PATHS.wideSav]);
  for (const file of metadata.availableDataFiles) {
    if (file.exists) {
      requiredDataFilePaths.add(file.relativePath);
    }
  }
  const missingDataFiles = [...requiredDataFilePaths]
    .filter((relativePath) => !availableByPath.get(relativePath)?.exists);
  if (missingDataFiles.length > 0) {
    localCodes.push('missing_required_data_file');
    localDetails.push(`Missing local data files: ${missingDataFiles.join(', ')}`);
  }

  if (!metadata.integrity) {
    localCodes.push('checksum_mismatch');
    localDetails.push('Integrity checksums are missing from export metadata.');
  }

  const localReady = localCodes.length === 0;

  const reexportCodes: ExportReadinessReasonCode[] = localReady ? [] : [...localCodes];
  const reexportDetails = [...localDetails];

  if (!metadata.r2Refs.finalized) {
    reexportCodes.push('r2_not_finalized');
    reexportDetails.push('R2 refs are not finalized.');
  }

  const requiredArtifacts = [...new Set([
    ...Object.values(metadata.artifactPaths.outputs).filter((value): value is string => typeof value === 'string' && value.length > 0),
    EXPORT_ARTIFACT_PATHS.supportReport,
  ])];
  const missingArtifactRefs = requiredArtifacts.filter((relativePath) => !metadata.r2Refs.artifacts[relativePath]);
  if (missingArtifactRefs.length > 0) {
    reexportCodes.push('missing_required_r2_artifact_ref');
    reexportDetails.push(`Missing R2 artifact refs: ${missingArtifactRefs.join(', ')}`);
  }

  const missingDataRefs = [...requiredDataFilePaths]
    .filter((relativePath) => !!availableByPath.get(relativePath)?.exists)
    .filter((relativePath) => !metadata.r2Refs.dataFiles[relativePath]);
  if (missingDataRefs.length > 0) {
    reexportCodes.push('missing_required_r2_data_file_ref');
    reexportDetails.push(`Missing R2 data refs: ${missingDataRefs.join(', ')}`);
  }

  const uniqueLocalCodes = dedupeCodes(localReady ? ['ready'] : localCodes);
  const uniqueReexportCodes = dedupeCodes(reexportCodes.length === 0 ? ['ready'] : reexportCodes);

  return {
    evaluatedAt: new Date().toISOString(),
    local: {
      ready: localReady,
      reasonCodes: uniqueLocalCodes,
      details: localReady ? [] : unique(localDetails),
    },
    reexport: {
      ready: uniqueReexportCodes.length === 1 && uniqueReexportCodes[0] === 'ready',
      reasonCodes: uniqueReexportCodes,
      details: uniqueReexportCodes[0] === 'ready' ? [] : unique(reexportDetails),
    },
  };
}

function collectExpressions(
  crosstabRaw: { bannerCuts: Array<{ groupName: string; columns: Array<{ name: string; adjusted?: string; expressionType?: string }> }> },
  sortedFinal: { tables: Array<{ tableId: string; additionalFilter?: string }> },
  filtertranslator: FilterTranslatorOutput | null,
): NormalizedExpression[] {
  const expressions: NormalizedExpression[] = [];

  for (const group of crosstabRaw.bannerCuts) {
    for (const column of group.columns) {
      const original = (column.adjusted ?? '').trim();
      if (!original) continue;
      expressions.push(normalizeExpressionRecord('cut', `cut:${group.groupName}::${column.name}`, original));
    }
  }

  for (const table of sortedFinal.tables) {
    const original = (table.additionalFilter ?? '').trim();
    if (!original) continue;
    expressions.push(normalizeExpressionRecord('table_additional_filter', `table:${table.tableId}`, original));
  }

  for (const [index, filter] of (filtertranslator?.filters ?? []).entries()) {
    const original = (filter.filterExpression ?? '').trim();
    if (!original) continue;
    const filterId = filter.ruleId ?? filter.questionId ?? `idx_${index}`;
    expressions.push(normalizeExpressionRecord('filtertranslator', `filter:${filterId}`, original));
  }

  return expressions;
}

function normalizeExpressionRecord(
  source: NormalizedExpression['source'],
  sourceId: string,
  original: string,
): NormalizedExpression {
  const parsed = parseExpression(original);
  if (!parsed.ok || !parsed.parsed) {
    return {
      source,
      sourceId,
      original,
      parseStatus: 'blocked',
      reasonCodes: ['unsupported_expression'],
    };
  }

  return {
    source,
    sourceId,
    original,
    normalized: parsed.parsed.normalized,
    fingerprint: parsed.parsed.fingerprint,
    parseStatus: 'parsed',
    reasonCodes: ['ready'],
  };
}

function buildSupportItems(
  crosstabRaw: { bannerCuts: Array<{ groupName: string; columns: Array<{ name: string; adjusted?: string; expressionType?: string }> }> },
  sortedFinal: { tables: Array<{ tableId: string; additionalFilter?: string }> },
  filtertranslator: FilterTranslatorOutput | null,
  expressions: NormalizedExpression[],
): ExportSupportItem[] {
  const expressionById = new Map(expressions.map((expr) => [expr.sourceId, expr] as const));
  const items: ExportSupportItem[] = [];

  for (const group of crosstabRaw.bannerCuts) {
    for (const column of group.columns) {
      const sourceId = `cut:${group.groupName}::${column.name}`;
      const expression = expressionById.get(sourceId);
      const support = classifySupport(expression, column.expressionType);
      items.push({
        itemType: 'cut',
        itemId: sourceId,
        q: support.q,
        wincross: support.wincross,
      });
    }
  }

  for (const table of sortedFinal.tables) {
    const sourceId = `table:${table.tableId}`;
    const expression = expressionById.get(sourceId);
    const support = classifySupport(expression);
    items.push({
      itemType: 'table',
      itemId: sourceId,
      q: support.q,
      wincross: support.wincross,
    });
  }

  for (const [index, filter] of (filtertranslator?.filters ?? []).entries()) {
    const filterId = filter.ruleId ?? filter.questionId ?? `idx_${index}`;
    const sourceId = `filter:${filterId}`;
    const expression = expressionById.get(sourceId);
    const support = classifySupport(expression);
    items.push({
      itemType: 'filter',
      itemId: sourceId,
      q: support.q,
      wincross: support.wincross,
    });
  }

  return items.sort((a, b) => {
    const type = a.itemType.localeCompare(b.itemType);
    if (type !== 0) return type;
    return a.itemId.localeCompare(b.itemId);
  });
}

function classifySupport(expression: NormalizedExpression | undefined, expressionType?: string): SupportPair {
  if (!expression) {
    return {
      q: { status: 'supported', reasonCodes: ['no_expression'] },
      wincross: { status: 'supported', reasonCodes: ['no_expression'] },
    };
  }

  if (expression.parseStatus === 'blocked') {
    return {
      q: { status: 'blocked', reasonCodes: ['unsupported_expression'], fallbackStrategy: 'manual_edit' },
      wincross: { status: 'blocked', reasonCodes: ['unsupported_expression'], fallbackStrategy: 'manual_edit' },
    };
  }

  const parsed = parseExpression(expression.original);
  if (!parsed.ok || !parsed.parsed) {
    return {
      q: { status: 'blocked', reasonCodes: ['unsupported_expression'], fallbackStrategy: 'manual_edit' },
      wincross: { status: 'blocked', reasonCodes: ['unsupported_expression'], fallbackStrategy: 'manual_edit' },
    };
  }

  const analysis = parsed.parsed.analysis;
  const lowerExpressionType = (expressionType ?? '').toLowerCase();

  if (lowerExpressionType === 'placeholder') {
    return {
      q: { status: 'blocked', reasonCodes: ['placeholder_expression'], fallbackStrategy: 'manual_edit' },
      wincross: { status: 'blocked', reasonCodes: ['placeholder_expression'], fallbackStrategy: 'manual_edit' },
    };
  }

  if (lowerExpressionType === 'conceptual_filter') {
    return {
      q: { status: 'warning', reasonCodes: ['conceptual_filter'], fallbackStrategy: 'derived_variable' },
      wincross: { status: 'warning', reasonCodes: ['conceptual_filter'], fallbackStrategy: 'derived_variable' },
    };
  }

  if (analysis.functionCalls.some((name) => !isAllowedFunction(name))) {
    return {
      q: { status: 'blocked', reasonCodes: ['unsupported_function_call'], fallbackStrategy: 'manual_edit' },
      wincross: { status: 'blocked', reasonCodes: ['unsupported_function_call'], fallbackStrategy: 'manual_edit' },
    };
  }

  if (analysis.hasComparisonBetweenVariables) {
    return {
      q: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
      wincross: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
    };
  }

  if (analysis.hasNegation || analysis.hasInOperator || lowerExpressionType === 'from_list') {
    return {
      q: { status: 'warning', reasonCodes: ['complex_but_supported'], fallbackStrategy: 'derived_variable' },
      wincross: { status: 'warning', reasonCodes: ['complex_but_supported'], fallbackStrategy: 'derived_variable' },
    };
  }

  return {
    q: { status: 'supported', reasonCodes: ['direct_support'] },
    wincross: { status: 'supported', reasonCodes: ['direct_support'] },
  };
}

function summarizeSupport(items: ExportSupportItem[]): ExportSupportSummary {
  const summary: ExportSupportSummary = {
    q: { supported: 0, warning: 0, blocked: 0 },
    wincross: { supported: 0, warning: 0, blocked: 0 },
  };

  for (const item of items) {
    summary.q[item.q.status] += 1;
    summary.wincross[item.wincross.status] += 1;
  }

  return summary;
}

function collectArtifactConsistencyMismatches(input: {
  sortedFinal: { tables: Array<{ tableId: string }> };
  tableRouting: TableRoutingArtifact;
  jobRouting: JobRoutingManifest;
  supportItems: ExportSupportItem[];
}): string[] {
  const mismatches: string[] = [];
  const sortedIdsRaw = input.sortedFinal.tables.map((table) => table.tableId.trim());
  const sortedIds = sortedIdsRaw.filter((tableId) => tableId.length > 0);
  const emptySortedIndexes = sortedIdsRaw
    .map((tableId, index) => ({ tableId, index }))
    .filter((entry) => entry.tableId.length === 0)
    .map((entry) => entry.index);

  if (emptySortedIndexes.length > 0) {
    mismatches.push(
      `tables/07-sorted-final.json has empty tableId at indexes: ${emptySortedIndexes.join(', ')}`,
    );
  }

  const duplicateSortedIds = findDuplicateValues(sortedIds);
  if (duplicateSortedIds.length > 0) {
    mismatches.push(
      `tables/07-sorted-final.json has duplicate tableIds: ${duplicateSortedIds.join(', ')}`,
    );
  }

  const tableRoutingIds = Object.keys(input.tableRouting.tableToDataFrameRef).sort();
  const missingFromTableRouting = difference(sortedIds, tableRoutingIds);
  const extraInTableRouting = difference(tableRoutingIds, sortedIds);
  if (missingFromTableRouting.length > 0) {
    mismatches.push(
      `export/table-routing.json missing tableIds from sorted-final: ${missingFromTableRouting.join(', ')}`,
    );
  }
  if (extraInTableRouting.length > 0) {
    mismatches.push(
      `export/table-routing.json has tableIds not in sorted-final: ${extraInTableRouting.join(', ')}`,
    );
  }

  if (input.tableRouting.totalTables !== tableRoutingIds.length) {
    mismatches.push(
      `export/table-routing.json totalTables=${input.tableRouting.totalTables} does not match unique table IDs=${tableRoutingIds.length}`,
    );
  }

  const tableRoutingCountTotal = Object.values(input.tableRouting.countsByDataFrameRef).reduce((sum, count) => sum + count, 0);
  if (tableRoutingCountTotal !== tableRoutingIds.length) {
    mismatches.push(
      `export/table-routing.json countsByDataFrameRef totals ${tableRoutingCountTotal} but unique table IDs are ${tableRoutingIds.length}`,
    );
  }

  const jobRoutingTableIds = [...new Set(
    input.jobRouting.jobs.flatMap((job) => job.tableIds.map((tableId) => tableId.trim()).filter(Boolean)),
  )].sort();
  const missingFromJobRouting = difference(sortedIds, jobRoutingTableIds);
  const extraInJobRouting = difference(jobRoutingTableIds, sortedIds);
  if (missingFromJobRouting.length > 0) {
    mismatches.push(
      `export/job-routing-manifest.json missing tableIds from sorted-final: ${missingFromJobRouting.join(', ')}`,
    );
  }
  if (extraInJobRouting.length > 0) {
    mismatches.push(
      `export/job-routing-manifest.json has tableIds not in sorted-final: ${extraInJobRouting.join(', ')}`,
    );
  }

  if (input.jobRouting.totalTables !== jobRoutingTableIds.length) {
    mismatches.push(
      `export/job-routing-manifest.json totalTables=${input.jobRouting.totalTables} does not match unique table IDs=${jobRoutingTableIds.length}`,
    );
  }

  const tableToJobIds = Object.keys(input.jobRouting.tableToJobId).sort();
  const tableToJobDiff = difference(tableToJobIds, jobRoutingTableIds);
  const jobToTableDiff = difference(jobRoutingTableIds, tableToJobIds);
  if (tableToJobDiff.length > 0 || jobToTableDiff.length > 0) {
    mismatches.push(
      'export/job-routing-manifest.json tableToJobId keys do not match jobs[].tableIds',
    );
  }

  const supportTableIds = input.supportItems
    .filter((item) => item.itemType === 'table')
    .map((item) => item.itemId)
    .filter((itemId) => itemId.startsWith('table:'))
    .map((itemId) => itemId.slice('table:'.length).trim())
    .filter((tableId) => tableId.length > 0)
    .sort();
  const missingSupportItems = difference(sortedIds, supportTableIds);
  const extraSupportItems = difference(supportTableIds, sortedIds);
  if (missingSupportItems.length > 0) {
    mismatches.push(
      `export/support-report.json missing table support items: ${missingSupportItems.join(', ')}`,
    );
  }
  if (extraSupportItems.length > 0) {
    mismatches.push(
      `export/support-report.json has table support items not in sorted-final: ${extraSupportItems.join(', ')}`,
    );
  }

  return mismatches;
}

function buildIdempotencyJobs(
  metadata: ExportManifestMetadata,
  jobRouting: JobRoutingManifest,
  integrityDigest: string,
): Record<string, string> {
  const runIdentity = metadata.convexRefs.runId ?? metadata.convexRefs.pipelineId ?? 'unknown-run';
  const jobs: Record<string, string> = {};

  const sortedJobs = [...jobRouting.jobs].sort((a, b) => a.jobId.localeCompare(b.jobId));
  for (const job of sortedJobs) {
    for (const platform of ['q', 'wincross'] as const) {
      const key = `${platform}:${job.jobId}`;
      jobs[key] = hashString(`${runIdentity}|${metadata.manifestVersion}|${platform}|${job.jobId}|${integrityDigest}`);
    }
  }

  return jobs;
}

function buildReadiness(input: ReadinessInputs): ExportReadiness {
  const localCodes: ExportReadinessReasonCode[] = [];
  const localDetails: string[] = [];

  if (input.manifestVersion !== EXPORT_ACTIVE_MANIFEST_VERSION) {
    localCodes.push('not_exportable_requires_rerun');
    localDetails.push(`Manifest version '${input.manifestVersion}' is below required ${EXPORT_ACTIVE_MANIFEST_VERSION}.`);
  }
  if (input.missingArtifacts.length > 0) {
    localCodes.push('missing_required_artifact');
    localDetails.push(`Missing required artifacts: ${input.missingArtifacts.join(', ')}`);
  }
  if (input.missingDataFiles.length > 0) {
    localCodes.push('missing_required_data_file');
    localDetails.push(`Missing required data files: ${input.missingDataFiles.join(', ')}`);
  }
  if (input.checksumMismatches.length > 0) {
    localCodes.push('checksum_mismatch');
    localDetails.push(`Checksum mismatches: ${input.checksumMismatches.join(', ')}`);
  }
  if (input.consistencyMismatches.length > 0) {
    localCodes.push('artifact_consistency_mismatch');
    localDetails.push(`Artifact consistency mismatches: ${input.consistencyMismatches.join('; ')}`);
  }
  if (input.invalidResultsTablesContractDetails.length > 0) {
    localCodes.push('invalid_results_tables_contract');
    localDetails.push(...input.invalidResultsTablesContractDetails);
  }

  const localReasonCodes = dedupeCodes(localCodes.length === 0 ? ['ready'] : localCodes);
  const localReady = localReasonCodes.length === 1 && localReasonCodes[0] === 'ready';

  const reexportCodes: ExportReadinessReasonCode[] = localReady ? [] : [...localCodes];
  const reexportDetails = [...localDetails];

  if (!input.r2Finalized) {
    reexportCodes.push('r2_not_finalized');
    reexportDetails.push('R2 refs are not finalized.');
  }
  if (input.missingR2ArtifactRefs.length > 0) {
    reexportCodes.push('missing_required_r2_artifact_ref');
    reexportDetails.push(`Missing R2 artifact refs: ${input.missingR2ArtifactRefs.join(', ')}`);
  }
  if (input.missingR2DataFileRefs.length > 0) {
    reexportCodes.push('missing_required_r2_data_file_ref');
    reexportDetails.push(`Missing R2 data refs: ${input.missingR2DataFileRefs.join(', ')}`);
  }

  const reexportReasonCodes = dedupeCodes(reexportCodes.length === 0 ? ['ready'] : reexportCodes);
  const reexportReady = reexportReasonCodes.length === 1 && reexportReasonCodes[0] === 'ready';

  return {
    evaluatedAt: new Date().toISOString(),
    local: {
      ready: localReady,
      reasonCodes: localReasonCodes,
      details: localReady ? [] : unique(localDetails),
    },
    reexport: {
      ready: reexportReady,
      reasonCodes: reexportReasonCodes,
      details: reexportReady ? [] : unique(reexportDetails),
    },
  };
}

async function readRequiredJson<T>(
  outputDir: string,
  relativePath: string,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const absolutePath = path.join(outputDir, relativePath);
  if (!(await fileExists(absolutePath))) {
    throw new ExportManifestBuildError(
      `Missing required artifact: ${relativePath}`,
      ['missing_required_artifact'],
      [relativePath],
    );
  }

  const value = JSON.parse(await fs.readFile(absolutePath, 'utf-8')) as unknown;
  return schema.parse(value);
}

async function validateResultsTablesContract(
  outputDir: string,
  relativePath: string,
): Promise<string[]> {
  const absolutePath = path.join(outputDir, relativePath);
  if (!(await fileExists(absolutePath))) {
    return [];
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await fs.readFile(absolutePath, 'utf-8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`Invalid resultsTables contract at ${relativePath}: could not parse JSON (${message}).`];
  }

  const parsed = ResultsTablesFinalContractSchema.safeParse(parsedJson);
  if (parsed.success) {
    return [];
  }

  const issueSummary = parsed.error.issues
    .slice(0, 3)
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${issuePath}: ${issue.message}`;
    })
    .join('; ');

  return [
    `Invalid resultsTables contract at ${relativePath}: ${issueSummary}`,
  ];
}

async function readOptionalFilterTranslator(outputDir: string): Promise<FilterTranslatorOutput | null> {
  const canonical = path.join(outputDir, 'filtertranslator', 'filtertranslator-output-raw.json');
  if (await fileExists(canonical)) {
    return JSON.parse(await fs.readFile(canonical, 'utf-8')) as FilterTranslatorOutput;
  }

  const dir = path.join(outputDir, 'filtertranslator');
  if (!(await fileExists(dir))) {
    return null;
  }

  const entries = (await fs.readdir(dir)).filter((entry) => entry.startsWith('filtertranslator-output-') && entry.endsWith('.json')).sort();
  if (entries.length === 0) {
    return null;
  }

  return JSON.parse(await fs.readFile(path.join(dir, entries[0]), 'utf-8')) as FilterTranslatorOutput;
}

async function readExistingSupportReport(outputDir: string): Promise<ExportSupportReport | null> {
  const supportReportPath = path.join(outputDir, EXPORT_ARTIFACT_PATHS.supportReport);
  if (!(await fileExists(supportReportPath))) {
    return null;
  }

  try {
    const parsed = ExportSupportReportSchema.safeParse(
      JSON.parse(await fs.readFile(supportReportPath, 'utf-8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function findMissingPaths(outputDir: string, relativePaths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const relativePath of relativePaths) {
    if (!(await fileExists(path.join(outputDir, relativePath)))) {
      missing.push(relativePath);
    }
  }
  return missing;
}

async function hashExistingPaths(outputDir: string, relativePaths: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(outputDir, relativePath);
    if (!(await fileExists(absolutePath))) {
      continue;
    }
    const buffer = await fs.readFile(absolutePath);
    hashes[relativePath] = createHash('sha256').update(buffer).digest('hex');
  }
  return hashes;
}

function collectChecksumMismatches(
  previous: ExportManifestMetadata['integrity'] | undefined,
  currentArtifactChecksums: Record<string, string>,
  currentDataChecksums: Record<string, string>,
): string[] {
  if (!previous) return [];

  const mismatches: string[] = [];

  for (const [relativePath, previousHash] of Object.entries(previous.artifactChecksums)) {
    const currentHash = currentArtifactChecksums[relativePath];
    if (currentHash && currentHash !== previousHash) {
      mismatches.push(`artifact:${relativePath}`);
    }
  }

  for (const [relativePath, previousHash] of Object.entries(previous.dataFileChecksums)) {
    const currentHash = currentDataChecksums[relativePath];
    if (currentHash && currentHash !== previousHash) {
      mismatches.push(`data:${relativePath}`);
    }
  }

  return mismatches;
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashObject(value: unknown): string {
  return hashString(JSON.stringify(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function dedupeCodes(codes: ExportReadinessReasonCode[]): ExportReadinessReasonCode[] {
  return unique(codes);
}

function difference(source: string[], target: string[]): string[] {
  const targetSet = new Set(target);
  return [...new Set(source)].filter((value) => !targetSet.has(value)).sort((a, b) => a.localeCompare(b));
}

function findDuplicateValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort((a, b) => a.localeCompare(b));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isAllowedFunction(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === 'c' || normalized === 'is.na';
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(outputDir: string, relativePath: string, value: unknown): Promise<void> {
  const absolutePath = path.join(outputDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(value, null, 2), 'utf-8');
}
