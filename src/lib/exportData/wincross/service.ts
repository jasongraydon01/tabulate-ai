import { createHash } from 'crypto';
import { downloadFile } from '@/lib/r2/r2';
import type { ExportManifestMetadata } from '@/lib/exportData/types';
import {
  ExportManifestMetadataSchema,
  ExportSupportReportSchema,
  JobRoutingManifestSchema,
  TableRoutingArtifactSchema,
  WinCrossExportManifestSchema,
  WinCrossExportPackageDescriptorSchema,
  type WinCrossExportManifest,
} from '@/lib/exportData/types';
import {
  CrosstabRawArtifactSchema,
  LoopSummaryArtifactSchema,
  ResultsTablesArtifactSchema,
  SortedFinalArtifactSchema,
} from '@/lib/exportData/inputArtifactSchemas';
import { LoopSemanticsPolicySchema } from '@/schemas/loopSemanticsPolicySchema';
import {
  buildWinCrossExportDownloadUrls,
  writeWinCrossExportPackage,
  type DataFileEntry,
} from './packageWriter';
import {
  buildBlockedItemsFromTableStatuses,
  toWinCrossPackageDataFilePath,
} from './contract';
import { resolveWinCrossPreference } from './preferenceResolver';
import { serializeWinCrossJob } from './serializer';
import {
  WINCROSS_EXPORT_MANIFEST_VERSION,
  WINCROSS_EXPORTER_VERSION,
  WINCROSS_SERIALIZER_CONTRACT_VERSION,
  WinCrossExportServiceError,
  type WinCrossResolvedArtifacts,
  type WinCrossServiceInput,
  type WinCrossServiceResult,
} from './types';

export async function generateWinCrossExportPackage(input: WinCrossServiceInput): Promise<WinCrossServiceResult> {
  const runResult = input.runResult;
  const readiness = readNestedRecord(runResult, ['exportReadiness', 'reexport']);
  const reexportReady = readiness?.ready === true;
  if (!reexportReady) {
    const reasons = asStringArray(readiness?.reasonCodes);
    throw new WinCrossExportServiceError(
      'export_not_ready',
      'Run is not ready for deterministic re-export.',
      409,
      reasons.length > 0 ? reasons : ['reexport_not_ready'],
    );
  }

  const resolvedArtifacts = await resolveArtifacts(runResult);
  if (resolvedArtifacts.metadata.manifestVersion !== 'phase1.v1') {
    throw new WinCrossExportServiceError(
      'not_exportable_requires_rerun',
      `Manifest version '${resolvedArtifacts.metadata.manifestVersion}' is not exportable in forward-only mode.`,
      422,
      ['not_exportable_requires_rerun'],
    );
  }
  if (!resolvedArtifacts.metadata.idempotency?.integrityDigest) {
    throw new WinCrossExportServiceError(
      'missing_integrity_digest',
      'Export metadata is missing integrityDigest required for deterministic package identity.',
      422,
      ['checksum_mismatch'],
    );
  }

  const resolvedPreference = resolveWinCrossPreference(input.preferenceSource);
  const packageId = buildPackageId(
    resolvedArtifacts.metadata.idempotency.integrityDigest,
    resolvedPreference.profileDigest,
  );
  const allDataFileRefs = collectDataFileRefs(resolvedArtifacts.metadata, resolvedArtifacts.jobRoutingManifest);
  // When INDEX mode is active (loop groups exist), the .job file uses INDEX glossary
  // statements with wide.sav — stacked .sav files are not referenced and should not
  // be included in the package.
  const hasIndexedLoops = resolvedArtifacts.loopSummary.groups.length > 0;
  const dataFileRefs = hasIndexedLoops
    ? allDataFileRefs.filter((ref) => /\bwide\.sav$/i.test(ref.relativePath))
    : allDataFileRefs;

  const existingDescriptor = input.existingDescriptor
    ? WinCrossExportPackageDescriptorSchema.safeParse(input.existingDescriptor)
    : null;

  if (
    existingDescriptor?.success
    && existingDescriptor.data.packageId === packageId
    && existingDescriptor.data.manifestVersion === WINCROSS_EXPORT_MANIFEST_VERSION
    && existingDescriptor.data.profileDigest === resolvedPreference.profileDigest
    && existingDescriptor.data.serializerContractVersion === WINCROSS_SERIALIZER_CONTRACT_VERSION
    && hasCompleteCachedPackage(existingDescriptor.data.files)
    && hasCachedDataFiles(existingDescriptor.data.files, dataFileRefs)
  ) {
    try {
      const manifest = await readCachedManifest(existingDescriptor.data.files);
      return {
        descriptor: existingDescriptor.data,
        manifest,
        downloadUrls: await buildWinCrossExportDownloadUrls(existingDescriptor.data.files),
        cached: true,
        profile: resolvedPreference.profile,
        diagnostics: resolvedPreference.diagnostics,
        resolvedPreference,
      };
    } catch {
      // Cache can drift if package artifacts were evicted or descriptor is stale.
      // Fall through to deterministic rebuild using the same package identity.
    }
  }

  const serialized = serializeWinCrossJob(resolvedArtifacts, resolvedPreference.profile, {
    tableRouting: resolvedArtifacts.tableRouting,
    jobRouting: resolvedArtifacts.jobRoutingManifest,
  });

  const profileSourceKind = mapSourceKindToProfileSource(input.preferenceSource.kind);
  const blockedItems = buildBlockedItemsFromTableStatuses(serialized.tableStatuses);
  const manifest: WinCrossExportManifest = WinCrossExportManifestSchema.parse({
    manifestVersion: WINCROSS_EXPORT_MANIFEST_VERSION,
    exporterVersion: WINCROSS_EXPORTER_VERSION,
    generatedAt: new Date().toISOString(),
    packageId,
    sourceManifestVersion: resolvedArtifacts.metadata.manifestVersion,
    integrityDigest: resolvedArtifacts.metadata.idempotency.integrityDigest,
    tableCount: serialized.tableCount,
    useCount: serialized.useCount,
    afCount: serialized.afCount,
    blockedCount: serialized.blockedCount,
    profileSource: profileSourceKind,
    profileDigest: resolvedPreference.profileDigest,
    serializerContractVersion: WINCROSS_SERIALIZER_CONTRACT_VERSION,
    blockedItems,
    warnings: [...serialized.warnings, ...resolvedPreference.diagnostics.warnings],
    applicationDiagnostics: serialized.applicationDiagnostics,
    supportSummary: resolvedArtifacts.supportReport.summary.wincross,
  });

  const dataFiles = await downloadDataFiles(dataFileRefs);

  const descriptor = await writeWinCrossExportPackage({
    orgId: input.orgId,
    projectId: input.projectId,
    runId: input.runId,
    manifest,
    jobContent: serialized.content,
    profile: resolvedPreference.profile,
    diagnostics: resolvedPreference.diagnostics,
    profileDigest: resolvedPreference.profileDigest,
    sourceDigest: resolvedPreference.sourceDigest,
    serializerContractVersion: WINCROSS_SERIALIZER_CONTRACT_VERSION,
    tableStatuses: serialized.tableStatuses,
    supportReport: resolvedArtifacts.supportReport,
    tableRouting: resolvedArtifacts.tableRouting,
    jobRouting: resolvedArtifacts.jobRoutingManifest,
    dataFiles,
  });

  return {
    descriptor,
    manifest,
    downloadUrls: await buildWinCrossExportDownloadUrls(descriptor.files),
    cached: false,
    profile: resolvedPreference.profile,
    diagnostics: resolvedPreference.diagnostics,
    resolvedPreference,
  };
}

function mapSourceKindToProfileSource(
  kind: string,
): 'default' | 'reference_job' | 'embedded_reference' | 'inline_job' | 'org_profile' {
  switch (kind) {
    case 'default': return 'default';
    case 'embedded_reference': return 'embedded_reference';
    case 'inline_job': return 'inline_job';
    case 'org_profile': return 'org_profile';
    default: return 'default';
  }
}

function hasCompleteCachedPackage(files: Record<string, string>): boolean {
  const required = [
    'wincross/export.job',
    'wincross/wincross-export-manifest.json',
    'wincross/profile.json',
    'wincross/profile-diagnostics.json',
    'wincross/README.md',
    'wincross/index.json',
    'wincross/support-report.json',
    'wincross/table-routing.json',
    'wincross/job-routing-manifest.json',
    'wincross/export.zip',
  ];
  return required.every((path) => !!files[path]);
}

function hasCachedDataFiles(files: Record<string, string>, dataFiles: DataFileRef[]): boolean {
  return dataFiles.every((file) => !!files[file.relativePath]);
}

async function readCachedManifest(files: Record<string, string>): Promise<WinCrossExportManifest> {
  const manifestPath = 'wincross/wincross-export-manifest.json';
  const key = files[manifestPath];
  if (!key) {
    throw new WinCrossExportServiceError(
      'missing_cached_manifest',
      'Cached descriptor does not include wincross-export-manifest.json.',
      422,
      ['missing_required_artifact'],
    );
  }
  const payload = await downloadJsonFromKey(key);
  return WinCrossExportManifestSchema.parse(payload);
}

async function resolveArtifacts(runResult: Record<string, unknown>): Promise<WinCrossResolvedArtifacts> {
  const exportArtifacts = readRecord(runResult.exportArtifacts);
  if (!exportArtifacts) {
    throw new WinCrossExportServiceError(
      'missing_export_artifacts',
      'Run result is missing exportArtifacts.',
      422,
      ['missing_required_artifact'],
    );
  }

  const r2Refs = readRecord(exportArtifacts.r2Refs);
  const artifactMap = normalizedStringMap(readRecord(r2Refs?.artifacts));
  const exportDataFileMap = normalizedStringMap(readRecord(r2Refs?.dataFiles));
  const outputsMap = normalizedStringMap(readNestedRecord(runResult, ['r2Files', 'outputs']));

  const metadataPath = normalizeRelativePath(asString(exportArtifacts.metadataPath) ?? '');
  if (!metadataPath) {
    throw new WinCrossExportServiceError(
      'missing_export_metadata_path',
      'exportArtifacts.metadataPath is missing.',
      422,
      ['missing_required_artifact'],
    );
  }

  const metadataKey = artifactMap[metadataPath] ?? outputsMap[metadataPath];
  if (!metadataKey) {
    throw new WinCrossExportServiceError(
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
      throw new WinCrossExportServiceError(
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
      throw new WinCrossExportServiceError(
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
    },
  };
}

interface DataFileRef {
  relativePath: string;
  r2Key: string;
}

function collectDataFileRefs(metadata: ExportManifestMetadata, jobRouting: { jobs: Array<{ dataFileRelativePath: string }> }): DataFileRef[] {
  const dataFileRefs = normalizedStringMap(metadata.r2Refs.dataFiles);
  const availableBySourcePath = new Map(
    metadata.availableDataFiles
      .filter((file) => file.exists)
      .map((file) => [
        normalizeRelativePath(file.relativePath),
        {
          relativePath: toWinCrossPackageDataFilePath(normalizeRelativePath(file.relativePath)),
          r2Key: file.r2Key ?? dataFileRefs[normalizeRelativePath(file.relativePath)] ?? '',
        },
      ]),
  );

  const routed = jobRouting.jobs.map((job) => {
    const sourcePath = normalizeRelativePath(job.dataFileRelativePath);
    const existing = availableBySourcePath.get(sourcePath);
    const r2Key = existing?.r2Key ?? dataFileRefs[sourcePath] ?? '';
    if (!r2Key) {
      throw new WinCrossExportServiceError(
        'missing_required_r2_data_file_ref',
        `Missing required R2 data file ref for ${sourcePath}.`,
        422,
        ['missing_required_r2_data_file_ref', sourcePath],
      );
    }
    return {
      relativePath: existing?.relativePath ?? toWinCrossPackageDataFilePath(sourcePath),
      r2Key,
    };
  });

  return dedupeDataFiles(routed).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function downloadDataFiles(refs: DataFileRef[]): Promise<DataFileEntry[]> {
  const entries = await Promise.all(
    refs.map(async (ref) => {
      const content = await downloadFile(ref.r2Key);
      return { relativePath: ref.relativePath, content };
    }),
  );
  return entries;
}

function dedupeDataFiles(refs: DataFileRef[]): DataFileRef[] {
  const byPath = new Map<string, DataFileRef>();
  for (const ref of refs) {
    if (!byPath.has(ref.relativePath)) {
      byPath.set(ref.relativePath, ref);
    }
  }
  return [...byPath.values()];
}

function buildPackageId(integrityDigest: string, profileDigest: string): string {
  const payload = stableJson({
    integrityDigest,
    exporterVersion: WINCROSS_EXPORTER_VERSION,
    manifestVersion: WINCROSS_EXPORT_MANIFEST_VERSION,
    serializerContractVersion: WINCROSS_SERIALIZER_CONTRACT_VERSION,
    profileDigest,
  });
  return createHash('sha256').update(payload).digest('hex');
}

async function downloadJsonFromKey(key: string): Promise<unknown> {
  const buffer = await downloadFile(key);
  return JSON.parse(buffer.toString('utf-8')) as unknown;
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
    if (!record) return null;
    current = record[segment];
  }
  return readRecord(current);
}
