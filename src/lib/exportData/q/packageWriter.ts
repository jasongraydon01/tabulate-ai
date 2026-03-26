import { createHash } from 'crypto';
import * as path from 'path';
import {
  QExportPackageDescriptorSchema,
  type ExportSupportReport,
  type QExportManifest,
  type QExportPackageDescriptor,
} from '@/lib/exportData/types';
import { createDeterministicArchive, type ArchiveEntry } from '@/lib/exportData/archiveWriter';
import { downloadFile } from '@/lib/r2/r2';
import { getDownloadUrlsForArtifactMap, uploadQExportPackageArtifacts } from '@/lib/r2/R2FileManager';

export interface QPackageDataFileRef {
  relativePath: string;
  r2Key: string;
}

export interface WriteQExportPackageParams {
  orgId: string;
  projectId: string;
  runId: string;
  manifest: QExportManifest;
  qScript: string;
  supportReport: ExportSupportReport;
  dataFiles: QPackageDataFileRef[];
}

export async function writeQExportPackage(params: WriteQExportPackageParams): Promise<QExportPackageDescriptor> {
  const manifestJson = stableJson(params.manifest);
  const supportJson = stableJson(params.supportReport);
  const runtimeContractJson = stableJson(params.manifest.runtimeContract);
  const readme = buildReadme(params.manifest, params.dataFiles);
  const filterBindings = buildFilterBindings(params.manifest);
  const runtimeBindingStrategy = buildRuntimeBindingStrategy(params.manifest);
  const rowLabelAudit = buildRowLabelAudit(params.manifest);
  const headerRowAudit = buildHeaderRowAudit(params.manifest);
  const dataFileArtifacts = await buildDataFileArtifacts(params.dataFiles);
  const baseArtifacts: Record<string, string | Buffer> = {
    'q/setup-project.QScript': params.qScript,
    'q/q-export-manifest.json': manifestJson,
    'q/runtime-contract.json': runtimeContractJson,
    'q/support-report.json': supportJson,
    'q/filter-bindings.json': filterBindings,
    'q/runtime-binding-strategy.json': runtimeBindingStrategy,
    'q/row-label-audit.json': rowLabelAudit,
    'q/header-row-audit.json': headerRowAudit,
    'q/README.md': readme,
    ...dataFileArtifacts,
  };
  const packageArtifacts: Record<string, string | Buffer> = { ...baseArtifacts };

  const manifestHash = sha256(manifestJson);
  const scriptHash = sha256(params.qScript);
  const indexPayload = stableJson({
    packageId: params.manifest.packageId,
    exporterVersion: params.manifest.exporterVersion,
    generatedAt: params.manifest.generatedAt,
    files: Object.fromEntries(
      Object.entries(packageArtifacts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([relativePath, content]) => [relativePath, sha256Content(content)]),
    ),
  });
  packageArtifacts['q/index.json'] = indexPayload;

  const archiveEntries: ArchiveEntry[] = Object.entries(packageArtifacts).map(([relativePath, content]) => ({
    relativePath,
    content,
  }));
  const archiveResult = await createDeterministicArchive(archiveEntries);
  packageArtifacts['q/export.zip'] = archiveResult.buffer;

  const uploaded = await uploadQExportPackageArtifacts(
    params.orgId,
    params.projectId,
    params.runId,
    params.manifest.packageId,
    packageArtifacts,
  );

  return QExportPackageDescriptorSchema.parse({
    packageId: params.manifest.packageId,
    exporterVersion: params.manifest.exporterVersion,
    manifestVersion: params.manifest.manifestVersion,
    runtimeContractVersion: params.manifest.runtimeContract.contractVersion,
    helperRuntimeHash: params.manifest.runtimeContract.helperRuntimeHash,
    generatedAt: params.manifest.generatedAt,
    manifestHash,
    scriptHash,
    archivePath: 'q/export.zip',
    archiveHash: archiveResult.hash,
    files: uploaded,
  });
}

export async function buildQExportDownloadUrls(files: Record<string, string>): Promise<Record<string, string>> {
  return getDownloadUrlsForArtifactMap(files);
}

function buildReadme(manifest: QExportManifest, dataFiles: QPackageDataFileRef[]): string {
  const blocked = manifest.blockedItems.length;
  const warningCount = manifest.warnings.length;
  const lines: string[] = [];
  lines.push('# TabulateAI Q Export Package');
  lines.push('');
  lines.push(`- Package ID: ${manifest.packageId}`);
  lines.push(`- Manifest Version: ${manifest.manifestVersion}`);
  lines.push(`- Exporter Version: ${manifest.exporterVersion}`);
  lines.push(`- Generated At: ${manifest.generatedAt}`);
  lines.push(`- Runtime Contract: ${manifest.runtimeContract.contractVersion}`);
  lines.push(`- Runtime Helper Hash: ${manifest.runtimeContract.helperRuntimeHash}`);
  lines.push(`- Tables Emitted: ${manifest.tables.length}`);
  lines.push(`- Cuts Emitted: ${manifest.cuts.length}`);
  lines.push(`- Blocked Items: ${blocked}`);
  lines.push(`- Warning Count: ${warningCount}`);
  lines.push('');
  lines.push('## Job Routing');
  for (const job of manifest.jobs) {
    lines.push(`- ${job.jobId}: ${job.dataFrameRef} (${job.tableIds.length} tables)`);
  }
  lines.push('');
  lines.push('## Data Files');
  if (dataFiles.length === 0) {
    lines.push('- None');
  } else {
    for (const dataFile of [...dataFiles].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      lines.push(`- ${toQPackageDataFilePath(dataFile.relativePath)}`);
    }
  }
  lines.push('');
  if (manifest.blockedItems.length > 0) {
    lines.push('## Blocked Items');
    for (const item of manifest.blockedItems) {
      lines.push(`- ${item.itemType}:${item.itemId} -> ${item.reasonCodes.join(', ')} (${item.detail})`);
    }
    lines.push('');
  }
  if (manifest.filters.length > 0) {
    lines.push('## Generated Filter Variables');
    lines.push('');
    lines.push('Helper variables are deterministic binary selectors (`1` include, `0` exclude).');
    lines.push('They are used for banner construction and additional table filtering.');
    lines.push('');
    const sortedFilters = [...manifest.filters].sort((a, b) => a.filterId.localeCompare(b.filterId));
    for (const filter of sortedFilters) {
      lines.push(`### ${filter.filterId}`);
      lines.push(`- Source: ${filter.source}`);
      lines.push(`- Data Frame: ${filter.dataFrameRef}`);
      lines.push(`- Helper Variable: \`${filter.helperVarName}\``);
      lines.push(`- Helper Label: ${filter.helperVarLabel}`);
      lines.push(`- Normalized Expression: \`${filter.normalizedExpression}\``);
      lines.push('');
    }
    lines.push('Runtime-selected table bind paths are resolved in Q execution preflight.');
    lines.push('See `q/runtime-binding-strategy.json` and runtime logs (`HT_FRAME_BINDING_STRATEGY`, `HT_RUNTIME_BINDING_SUMMARY`).');
    lines.push('');
  }
  if (manifest.warnings.length > 0) {
    lines.push('## Warnings');
    for (const warning of manifest.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }
  lines.push('Generated by TabulateAI Q exporter.');
  return `${lines.join('\n')}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Content(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function buildDataFileArtifacts(dataFiles: QPackageDataFileRef[]): Promise<Record<string, Buffer>> {
  const byPath = new Map<string, string>();
  for (const file of dataFiles) {
    if (!file.relativePath || !file.r2Key) continue;
    byPath.set(file.relativePath, file.r2Key);
  }

  const resolvedEntries = [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b));
  const downloaded = await Promise.all(
    resolvedEntries.map(async ([relativePath, r2Key]) => {
      const buffer = await downloadFile(r2Key);
      return [toQPackageDataFilePath(relativePath), buffer] as const;
    }),
  );
  return Object.fromEntries(downloaded);
}

export function toQPackageDataFilePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith('export/data/')) {
    return normalized.slice('export/'.length);
  }
  if (normalized.startsWith('data/')) {
    return normalized;
  }
  return `data/${path.basename(normalized)}`;
}

function buildFilterBindings(manifest: QExportManifest): string {
  type FilterBindingRow = {
    filterId: string;
    dataFrameRef: string;
    helperVarName: string;
    consumerRef: string;
    bindPath: string;
    runtimeBindingResolution: 'not_applicable' | 'pending_q_runtime_preflight';
    runtimeSelectedBindPath: 'table_filters_variable' | 'table_primary_masked' | null;
    runtimeSelectionFrameRef: string | null;
    runtimeSelectionLogTag: 'HT_FRAME_BINDING_STRATEGY' | null;
  };
  const bindings: Array<{
    filterId: string;
    dataFrameRef: string;
    helperVarName: string;
    consumerRef: string;
    bindPath: string;
    runtimeBindingResolution: 'not_applicable' | 'pending_q_runtime_preflight';
    runtimeSelectedBindPath: 'table_filters_variable' | 'table_primary_masked' | null;
    runtimeSelectionFrameRef: string | null;
    runtimeSelectionLogTag: 'HT_FRAME_BINDING_STRATEGY' | null;
  }> = [];

  for (const filter of [...manifest.filters].sort((a, b) => a.filterId.localeCompare(b.filterId))) {
    for (const consumerRef of [...filter.consumerRefs].sort((a, b) => a.localeCompare(b))) {
      let bindPath = 'banner_variable';
      let runtimeBindingResolution: FilterBindingRow['runtimeBindingResolution'] = 'not_applicable';
      let runtimeSelectedBindPath: FilterBindingRow['runtimeSelectedBindPath'] = null;
      let runtimeSelectionFrameRef: FilterBindingRow['runtimeSelectionFrameRef'] = null;
      let runtimeSelectionLogTag: FilterBindingRow['runtimeSelectionLogTag'] = null;
      if (consumerRef.startsWith('table:')) {
        const tableId = consumerRef.slice('table:'.length);
        const table = manifest.tables.find((t) => t.tableId === tableId);
        bindPath = table?.additionalFilterBindPath ?? 'table_filters_variable';
        runtimeBindingResolution = 'pending_q_runtime_preflight';
        runtimeSelectedBindPath = null;
        runtimeSelectionFrameRef = filter.dataFrameRef;
        runtimeSelectionLogTag = 'HT_FRAME_BINDING_STRATEGY';
      }
      bindings.push({
        filterId: filter.filterId,
        dataFrameRef: filter.dataFrameRef,
        helperVarName: filter.helperVarName,
        consumerRef,
        bindPath,
        runtimeBindingResolution,
        runtimeSelectedBindPath,
        runtimeSelectionFrameRef,
        runtimeSelectionLogTag,
      });
    }
  }

  return stableJson(bindings);
}

function buildRuntimeBindingStrategy(manifest: QExportManifest): string {
  type RuntimeBindingRow = {
    dataFrameRef: string;
    requiresTableFilterBinding: boolean;
    manifestBindPathHint: 'table_filters_variable' | 'table_primary_masked' | null;
    runtimeBindingResolution: 'not_required' | 'pending_q_runtime_preflight';
    runtimeSelectedBindPath: 'table_filters_variable' | 'table_primary_masked' | null;
    runtimeSelectionLogTag: 'HT_FRAME_BINDING_STRATEGY' | null;
    runtimeSummaryLogTag: 'HT_RUNTIME_BINDING_SUMMARY';
  };

  const tableHintByFrame = new Map<string, Array<'table_filters_variable' | 'table_primary_masked'>>();
  for (const table of manifest.tables) {
    if (!table.additionalFilterId) continue;
    const hints = tableHintByFrame.get(table.dataFrameRef) ?? [];
    if (table.additionalFilterBindPath) {
      hints.push(table.additionalFilterBindPath);
    }
    tableHintByFrame.set(table.dataFrameRef, hints);
  }

  const frames = [...new Set(manifest.jobs.map((job) => job.dataFrameRef))].sort((a, b) => a.localeCompare(b));
  const rows: RuntimeBindingRow[] = [];
  for (const frame of frames) {
    const hints = tableHintByFrame.get(frame) ?? [];
    const requiresTableFilterBinding = hints.length > 0;
    const manifestBindPathHint = requiresTableFilterBinding
      ? (hints.includes('table_primary_masked') ? 'table_primary_masked' : 'table_filters_variable')
      : null;
    rows.push({
      dataFrameRef: frame,
      requiresTableFilterBinding,
      manifestBindPathHint,
      runtimeBindingResolution: requiresTableFilterBinding ? 'pending_q_runtime_preflight' : 'not_required',
      runtimeSelectedBindPath: null,
      runtimeSelectionLogTag: requiresTableFilterBinding ? 'HT_FRAME_BINDING_STRATEGY' : null,
      runtimeSummaryLogTag: 'HT_RUNTIME_BINDING_SUMMARY',
    });
  }

  return stableJson({
    generatedAt: manifest.generatedAt,
    packageId: manifest.packageId,
    runtimeSelection: {
      status: 'pending_q_runtime_preflight',
      frameLogTag: 'HT_FRAME_BINDING_STRATEGY',
      summaryLogTag: 'HT_RUNTIME_BINDING_SUMMARY',
    },
    frames: rows,
  });
}

function buildRowLabelAudit(manifest: QExportManifest): string {
  const rows = manifest.tables.flatMap((table) =>
    table.rows.map((row) => ({
      tableId: table.tableId,
      tableOrderIndex: table.tableOrderIndex,
      rowIndex: row.rowIndex,
      variable: row.variable,
      strategy: row.strategy,
      label: row.label,
      sourceLabel: row.sourceLabel ?? null,
      effectiveLabel: row.effectiveLabel,
      labelSource: row.labelSource,
      usedFallback: row.labelSource !== 'row_label',
    })),
  );

  const summary = {
    totalRows: rows.length,
    fallbackRows: rows.filter((row) => row.usedFallback).length,
    generatedPlaceholderRows: rows.filter((row) => row.labelSource === 'generated_placeholder').length,
  };

  return stableJson({
    generatedAt: manifest.generatedAt,
    packageId: manifest.packageId,
    summary,
    rows,
  });
}

function buildHeaderRowAudit(manifest: QExportManifest): string {
  const rows = manifest.tables.flatMap((table) =>
    table.headerRows.map((header) => ({
      tableId: table.tableId,
      tableOrderIndex: table.tableOrderIndex,
      rowIndex: header.rowIndex,
      label: header.label,
      filterValue: header.filterValue,
      indent: header.indent,
    })),
  );

  const summary = {
    totalHeaderRows: rows.length,
    tablesWithHeaders: new Set(rows.map((row) => row.tableId)).size,
    tablesWithoutHeaders: manifest.tables.filter((table) => table.headerRows.length === 0).length,
  };

  return stableJson({
    generatedAt: manifest.generatedAt,
    packageId: manifest.packageId,
    summary,
    rows,
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value), null, 2);
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
