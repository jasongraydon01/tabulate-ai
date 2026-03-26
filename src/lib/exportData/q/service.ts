import { createHash } from 'crypto';
import { downloadFile } from '@/lib/r2/r2';
import {
  ExportManifestMetadataSchema,
  ExportSupportReportSchema,
  JobRoutingManifestSchema,
  type ExportManifestMetadata,
  type QExportManifest,
  QExportManifestSchema,
  QExportPackageDescriptorSchema,
  TableRoutingArtifactSchema,
  type QExportPackageDescriptor,
} from '@/lib/exportData/types';
import {
  CrosstabRawArtifactSchema,
  LoopSummaryArtifactSchema,
  ResultsTablesArtifactSchema,
  SortedFinalArtifactSchema,
} from '@/lib/exportData/inputArtifactSchemas';
import { LoopSemanticsPolicySchema } from '@/schemas/loopSemanticsPolicySchema';
import { buildQExportManifest } from './manifestBuilder';
import { emitQScript } from './qscriptEmitter';
import {
  buildQExportDownloadUrls,
  toQPackageDataFilePath,
  writeQExportPackage,
  type QPackageDataFileRef,
} from './packageWriter';
import {
  Q_EXPORTER_VERSION,
  Q_EXPORT_MANIFEST_VERSION,
  Q_EXPORT_RUNTIME_CONTRACT,
  QExportServiceError,
  type QExportResolvedArtifacts,
  type QExportServiceInput,
  type QExportServiceResult,
} from './types';

export async function generateQExportPackage(input: QExportServiceInput): Promise<QExportServiceResult> {
  if (process.env.ENABLE_Q_EXPORT_NATIVE_QSCRIPT === 'false') {
    throw new QExportServiceError(
      'native_qscript_disabled',
      'Native QScript export is disabled by configuration.',
      404,
      ['native_qscript_disabled'],
    );
  }

  const runResult = input.runResult;
  const readiness = readNestedRecord(runResult, ['exportReadiness', 'reexport']);
  const reexportReady = readiness?.ready === true;
  if (!reexportReady) {
    const reasons = asStringArray(readiness?.reasonCodes);
    throw new QExportServiceError(
      'export_not_ready',
      'Run is not ready for deterministic re-export.',
      409,
      reasons.length > 0 ? reasons : ['reexport_not_ready'],
    );
  }

  const resolvedArtifacts = await resolveArtifacts(runResult);

  if (resolvedArtifacts.metadata.manifestVersion !== 'phase1.v1') {
    throw new QExportServiceError(
      'not_exportable_requires_rerun',
      `Manifest version '${resolvedArtifacts.metadata.manifestVersion}' is not exportable in forward-only mode.`,
      422,
      ['not_exportable_requires_rerun'],
    );
  }

  if (!resolvedArtifacts.metadata.idempotency?.integrityDigest) {
    throw new QExportServiceError(
      'missing_integrity_digest',
      'Export metadata is missing integrityDigest required for deterministic Q package identity.',
      422,
      ['checksum_mismatch'],
    );
  }

  for (const job of resolvedArtifacts.jobRoutingManifest.jobs) {
    const dataFilePath = normalizeRelativePath(job.dataFileRelativePath);
    if (!resolvedArtifacts.metadata.r2Refs.dataFiles[dataFilePath]) {
      throw new QExportServiceError(
        'missing_required_r2_data_file_ref',
        `Missing required R2 data file ref for ${job.dataFileRelativePath}.`,
        422,
        ['missing_required_r2_data_file_ref', job.dataFileRelativePath],
      );
    }
  }

  const packageId = buildPackageId(
    resolvedArtifacts.metadata.idempotency.integrityDigest,
    Q_EXPORT_RUNTIME_CONTRACT.contractVersion,
    Q_EXPORT_RUNTIME_CONTRACT.helperRuntimeHash,
  );
  const packageDataFiles = collectPackageDataFiles(resolvedArtifacts.metadata);
  const cachedDescriptor = input.existingDescriptor
    ? QExportPackageDescriptorSchema.safeParse(input.existingDescriptor)
    : null;

  if (
    cachedDescriptor?.success
    && cachedDescriptor.data.packageId === packageId
    && cachedDescriptor.data.manifestVersion === Q_EXPORT_MANIFEST_VERSION
    && cachedDescriptor.data.runtimeContractVersion === Q_EXPORT_RUNTIME_CONTRACT.contractVersion
    && cachedDescriptor.data.helperRuntimeHash === Q_EXPORT_RUNTIME_CONTRACT.helperRuntimeHash
    && hasCompleteCachedPackage(cachedDescriptor.data.files, packageDataFiles)
  ) {
    try {
      return {
        descriptor: cachedDescriptor.data,
        manifest: await readCachedManifest(cachedDescriptor.data.files),
        downloadUrls: await buildQExportDownloadUrls(cachedDescriptor.data.files),
        cached: true,
      };
    } catch {
      // Cache can drift if package artifacts were evicted or descriptor is stale.
      // Fall through to deterministic rebuild using the same package identity.
    }
  }

  const manifest = buildQExportManifest({
    packageId,
    exporterVersion: Q_EXPORTER_VERSION,
    artifacts: resolvedArtifacts,
  });
  const qScript = emitQScript(manifest);
  const descriptor = await writeQExportPackage({
    orgId: input.orgId,
    projectId: input.projectId,
    runId: input.runId,
    manifest,
    qScript,
    supportReport: resolvedArtifacts.supportReport,
    dataFiles: packageDataFiles,
  });

  return {
    descriptor,
    manifest,
    downloadUrls: await buildQExportDownloadUrls(descriptor.files),
    cached: false,
  };
}

function collectPackageDataFiles(metadata: ExportManifestMetadata): QPackageDataFileRef[] {
  const dataFileRefs = normalizedStringMap(metadata.r2Refs.dataFiles);
  return metadata.availableDataFiles
    .filter((file) => file.exists)
    .map((file) => ({
      relativePath: normalizeRelativePath(file.relativePath),
      r2Key: file.r2Key ?? dataFileRefs[normalizeRelativePath(file.relativePath)] ?? '',
    }))
    .filter((file) => file.r2Key.length > 0)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function hasCompleteCachedPackage(
  files: Record<string, string>,
  dataFiles: QPackageDataFileRef[],
): boolean {
  const required = new Set<string>([
    'q/setup-project.QScript',
    'q/q-export-manifest.json',
    'q/runtime-contract.json',
    'q/support-report.json',
    'q/filter-bindings.json',
    'q/runtime-binding-strategy.json',
    'q/row-label-audit.json',
    'q/header-row-audit.json',
    'q/README.md',
    'q/index.json',
    'q/export.zip',
    ...dataFiles.map((file) => toQPackageDataFilePath(file.relativePath)),
  ]);

  for (const relativePath of required) {
    if (!files[relativePath]) {
      return false;
    }
  }
  return Object.keys(files).length > 0;
}

async function resolveArtifacts(runResult: Record<string, unknown>): Promise<QExportResolvedArtifacts> {
  const exportArtifacts = readRecord(runResult.exportArtifacts);
  if (!exportArtifacts) {
    throw new QExportServiceError('missing_export_artifacts', 'Run result is missing exportArtifacts.', 422, ['missing_required_artifact']);
  }

  const r2Refs = readRecord(exportArtifacts.r2Refs);
  const artifactMap = normalizedStringMap(readRecord(r2Refs?.artifacts));
  const exportDataFileMap = normalizedStringMap(readRecord(r2Refs?.dataFiles));
  const outputsMap = normalizedStringMap(readNestedRecord(runResult, ['r2Files', 'outputs']));

  const metadataPath = normalizeRelativePath(asString(exportArtifacts.metadataPath) ?? '');
  if (!metadataPath) {
    throw new QExportServiceError('missing_export_metadata_path', 'exportArtifacts.metadataPath is missing.', 422, ['missing_required_artifact']);
  }

  const metadataKey = artifactMap[metadataPath] ?? outputsMap[metadataPath];
  if (!metadataKey) {
    throw new QExportServiceError(
      'missing_required_r2_artifact_ref',
      `Missing R2 key for ${metadataPath}.`,
      422,
      ['missing_required_r2_artifact_ref', metadataPath],
    );
  }

  const metadata = hydrateMetadataR2Refs(
    ExportManifestMetadataSchema.parse(await downloadJsonFromKey(metadataKey)),
    artifactMap,
    exportDataFileMap,
    outputsMap,
  );

  const tableRoutingPath = metadata.artifactPaths.outputs.tableRouting;
  const jobRoutingPath = metadata.artifactPaths.outputs.jobRoutingManifest;
  const loopPolicyPath = metadata.artifactPaths.outputs.loopPolicy;
  const supportPath = metadata.artifactPaths.outputs.supportReport ?? 'export/support-report.json';

  const sortedFinalPath = metadata.artifactPaths.inputs.sortedFinal;
  const resultsTablesPath = metadata.artifactPaths.inputs.resultsTables;
  const crosstabRawPath = metadata.artifactPaths.inputs.crosstabRaw;
  const loopSummaryPath = metadata.artifactPaths.inputs.loopSummary;

  const keyForOutput = (relativePath: string): string => {
    const normalizedPath = normalizeRelativePath(relativePath);
    const key = metadata.r2Refs.artifacts[normalizedPath]
      ?? artifactMap[normalizedPath]
      ?? outputsMap[normalizedPath];
    if (!key) {
      throw new QExportServiceError(
        'missing_required_r2_artifact_ref',
        `Missing R2 key for ${relativePath}.`,
        422,
        ['missing_required_r2_artifact_ref', relativePath],
      );
    }
    return key;
  };

  const keyForInput = (relativePath: string): string => {
    const normalizedPath = normalizeRelativePath(relativePath);
    const key = outputsMap[normalizedPath]
      ?? metadata.r2Refs.artifacts[normalizedPath]
      ?? artifactMap[normalizedPath];
    if (!key) {
      throw new QExportServiceError(
        'missing_required_r2_artifact_ref',
        `Missing R2 key for ${relativePath}.`,
        422,
        ['missing_required_r2_artifact_ref', relativePath],
      );
    }
    return key;
  };

  const tableRoutingKey = keyForOutput(tableRoutingPath);
  const jobRoutingKey = keyForOutput(jobRoutingPath);
  const loopPolicyKey = keyForOutput(loopPolicyPath);
  const supportKey = keyForOutput(supportPath);

  const sortedFinalKey = keyForInput(sortedFinalPath);
  const resultsTablesKey = keyForInput(resultsTablesPath);
  const crosstabRawKey = keyForInput(crosstabRawPath);
  const loopSummaryKey = keyForInput(loopSummaryPath);

  const [
    tableRouting,
    jobRoutingManifest,
    supportReport,
    sortedFinal,
    resultsTables,
    crosstabRaw,
    loopSummary,
  ] = await Promise.all([
    downloadJsonFromKey(tableRoutingKey).then((value) => TableRoutingArtifactSchema.parse(value)),
    downloadJsonFromKey(jobRoutingKey).then((value) => JobRoutingManifestSchema.parse(value)),
    downloadJsonFromKey(supportKey).then((value) => ExportSupportReportSchema.parse(value)),
    downloadJsonFromKey(sortedFinalKey).then((value) => SortedFinalArtifactSchema.parse(value)),
    downloadJsonFromKey(resultsTablesKey).then((value) => ResultsTablesArtifactSchema.parse(value)),
    downloadJsonFromKey(crosstabRawKey).then((value) => CrosstabRawArtifactSchema.parse(value)),
    downloadJsonFromKey(loopSummaryKey).then((value) => LoopSummaryArtifactSchema.parse(value)),
  ]);

  const verboseCandidatePaths = [
    metadata.artifactPaths.inputs.verboseDataMap,
    ...Object.keys(outputsMap)
      .filter((relativePath) => /-verbose-.*\.json$/i.test(relativePath))
      .sort((a, b) => a.localeCompare(b))
      .reverse(),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  let verboseDataMap: unknown[] | null = null;
  let verboseDataMapKey: string | undefined;
  for (const relativePath of verboseCandidatePaths) {
    const normalizedPath = normalizeRelativePath(relativePath);
    const key = outputsMap[normalizedPath] ?? metadata.r2Refs.artifacts[normalizedPath];
    if (!key) continue;
    const payload = await downloadJsonFromKey(key);
    if (Array.isArray(payload)) {
      verboseDataMap = payload;
      verboseDataMapKey = key;
      break;
    }
  }

  const parsedLoopPolicy = await downloadJsonFromKey(loopPolicyKey);
  const loopPolicyResult = LoopSemanticsPolicySchema.safeParse(parsedLoopPolicy);

  return {
    metadata,
    tableRouting,
    jobRoutingManifest,
    loopPolicy: loopPolicyResult.success ? loopPolicyResult.data : null,
    supportReport,
    sortedFinal,
    resultsTables,
    crosstabRaw,
    loopSummary,
    verboseDataMap,
    r2Keys: {
      metadata: metadataKey,
      tableRouting: tableRoutingKey,
      jobRoutingManifest: jobRoutingKey,
      loopPolicy: loopPolicyKey,
      supportReport: supportKey,
      sortedFinal: sortedFinalKey,
      resultsTables: resultsTablesKey,
      crosstabRaw: crosstabRawKey,
      loopSummary: loopSummaryKey,
      ...(verboseDataMapKey ? { verboseDataMap: verboseDataMapKey } : {}),
    },
  };
}

async function readCachedManifest(files: QExportPackageDescriptor['files']): Promise<QExportManifest> {
  const manifestPath = Object.keys(files).find((name) => name.endsWith('/q-export-manifest.json'))
    ?? 'q/q-export-manifest.json';
  const key = files[manifestPath];
  if (!key) {
    throw new QExportServiceError('missing_cached_manifest', 'Cached descriptor does not include q-export-manifest.json.', 422, ['missing_required_artifact']);
  }
  const payload = await downloadJsonFromKey(key);
  return QExportManifestSchema.parse(payload);
}

async function downloadJsonFromKey(key: string): Promise<unknown> {
  const buffer = await downloadFile(key);
  return JSON.parse(buffer.toString('utf-8')) as unknown;
}

function buildPackageId(
  integrityDigest: string,
  runtimeContractVersion: string,
  helperRuntimeHash: string,
): string {
  const payload = stableJson({
    integrityDigest,
    exporterVersion: Q_EXPORTER_VERSION,
    manifestVersion: Q_EXPORT_MANIFEST_VERSION,
    runtimeContractVersion,
    helperRuntimeHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
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

function hydrateMetadataR2Refs(
  metadata: ExportManifestMetadata,
  artifactMap: Record<string, string>,
  exportDataFileMap: Record<string, string>,
  outputsMap: Record<string, string>,
): ExportManifestMetadata {
  const metadataArtifactRefs = normalizedStringMap(metadata.r2Refs.artifacts);
  const metadataDataFileRefs = normalizedStringMap(metadata.r2Refs.dataFiles);
  const outputDataFileRefs = Object.fromEntries(
    Object.entries(outputsMap).filter(([relativePath]) => relativePath.startsWith('export/data/')),
  );
  const mergedDataFileRefs = {
    ...metadataDataFileRefs,
    ...outputDataFileRefs,
    ...exportDataFileMap,
  };

  return {
    ...metadata,
    availableDataFiles: metadata.availableDataFiles.map((file) => {
      const relativePath = normalizeRelativePath(file.relativePath);
      const mergedR2Key = file.r2Key ?? mergedDataFileRefs[relativePath];
      return {
        ...file,
        relativePath,
        ...(mergedR2Key ? { r2Key: mergedR2Key } : {}),
      };
    }),
    r2Refs: {
      ...metadata.r2Refs,
      artifacts: {
        ...metadataArtifactRefs,
        ...artifactMap,
      },
      dataFiles: mergedDataFileRefs,
    },
  };
}

function normalizedStringMap(value: Record<string, unknown> | Record<string, string> | null | undefined): Record<string, string> {
  if (!value) return {};
  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    normalized[normalizeRelativePath(key)] = entry;
  }
  return normalized;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNestedRecord(value: unknown, path: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const segment of path) {
    const record = readRecord(current);
    if (!record) {
      return null;
    }
    current = record[segment];
  }
  return readRecord(current);
}
