import { createHash } from 'crypto';
import {
  WinCrossExportPackageDescriptorSchema,
  type ExportSupportReport,
  type JobRoutingManifest,
  type TableRoutingArtifact,
  type WinCrossExportManifest,
  type WinCrossExportPackageDescriptor,
  type WinCrossParseDiagnostics,
  type WinCrossPreferenceProfile,
} from '@/lib/exportData/types';
import {
  getDownloadUrlsForArtifactMap,
  uploadWinCrossExportPackageArtifacts,
} from '@/lib/r2/R2FileManager';
import { createDeterministicArchive, type ArchiveEntry } from '@/lib/exportData/archiveWriter';
import type { SerializedTableStatus } from './serializer';

export interface DataFileEntry {
  relativePath: string;
  content: Buffer;
}

export interface WriteWinCrossExportPackageParams {
  orgId: string;
  projectId: string;
  runId: string;
  manifest: WinCrossExportManifest;
  jobContent: string | Buffer;
  profile: WinCrossPreferenceProfile;
  diagnostics: WinCrossParseDiagnostics;
  profileDigest: string;
  sourceDigest: string;
  serializerContractVersion: string;
  tableStatuses: SerializedTableStatus[];
  supportReport: ExportSupportReport;
  tableRouting: TableRoutingArtifact;
  jobRouting: JobRoutingManifest;
  dataFiles?: DataFileEntry[];
}

export async function writeWinCrossExportPackage(
  params: WriteWinCrossExportPackageParams,
): Promise<WinCrossExportPackageDescriptor> {
  const manifestJson = stableJson(params.manifest);
  const diagnosticsJson = stableJson(params.diagnostics);
  const profileJson = stableJson(params.profile);
  const readme = buildReadme(params.manifest, params.tableStatuses, params.dataFiles ?? []);

  const packageArtifacts: Record<string, string | Buffer> = {
    'wincross/export.job': params.jobContent,
    'wincross/wincross-export-manifest.json': manifestJson,
    'wincross/profile.json': profileJson,
    'wincross/profile-diagnostics.json': diagnosticsJson,
    'wincross/README.md': readme,
    'wincross/support-report.json': stableJson(params.supportReport),
    'wincross/table-routing.json': stableJson(params.tableRouting),
    'wincross/job-routing-manifest.json': stableJson(params.jobRouting),
  };

  // Add data files to package
  for (const df of params.dataFiles ?? []) {
    packageArtifacts[df.relativePath] = df.content;
  }

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
  packageArtifacts['wincross/index.json'] = indexPayload;

  const archiveArtifacts: Record<string, string | Buffer> = {
    'wincross/export.job': params.jobContent,
    'wincross/README.md': readme,
  };
  for (const df of params.dataFiles ?? []) {
    archiveArtifacts[df.relativePath] = df.content;
  }

  // Build deterministic archive for the user-facing package only.
  const archiveEntries: ArchiveEntry[] = Object.entries(archiveArtifacts).map(([relativePath, content]) => ({
    relativePath,
    content,
  }));
  const archiveResult = await createDeterministicArchive(archiveEntries);
  packageArtifacts['wincross/export.zip'] = archiveResult.buffer;

  const uploaded = await uploadWinCrossExportPackageArtifacts(
    params.orgId,
    params.projectId,
    params.runId,
    params.manifest.packageId,
    packageArtifacts,
  );

  return WinCrossExportPackageDescriptorSchema.parse({
    packageId: params.manifest.packageId,
    exporterVersion: params.manifest.exporterVersion,
    manifestVersion: params.manifest.manifestVersion,
    generatedAt: params.manifest.generatedAt,
    manifestHash: sha256(manifestJson),
    jobHash: sha256Content(params.jobContent),
    profileDigest: params.profileDigest,
    sourceDigest: params.sourceDigest,
    serializerContractVersion: params.serializerContractVersion,
    archivePath: 'wincross/export.zip',
    archiveHash: archiveResult.hash,
    entrypointPath: 'wincross/export.job',
    files: uploaded,
  });
}

export async function buildWinCrossExportDownloadUrls(files: Record<string, string>): Promise<Record<string, string>> {
  return getDownloadUrlsForArtifactMap(files);
}

function buildReadme(manifest: WinCrossExportManifest, tableStatuses: SerializedTableStatus[], dataFiles: DataFileEntry[]): string {
  const lines: string[] = [];
  lines.push('# TabulateAI WinCross Export Package');
  lines.push('');
  lines.push(`- Generated At: ${manifest.generatedAt}`);
  lines.push(`- Tables Emitted: ${manifest.tableCount}`);
  lines.push(`- Blocked Count: ${manifest.blockedCount}`);
  lines.push(`- Warning Count: ${manifest.warnings.length}`);
  lines.push(`- Profile Source: ${manifest.profileSource}`);
  lines.push('');

  const blocked = tableStatuses.filter((s) => s.semanticExportStatus === 'blocked');
  if (blocked.length > 0) {
    lines.push('## Blocked Tables');
    lines.push('');
    for (const table of blocked) {
      lines.push(`- ${table.tableId}: ${table.warnings.join('; ')}`);
    }
    lines.push('');
  }

  if (dataFiles.length > 0) {
    lines.push('## Data Files');
    lines.push('');
    for (const df of dataFiles) {
      lines.push(`- \`${df.relativePath}\``);
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('- Open `export.job` in WinCross desktop and point it at the matching `data/wide.sav` file first.');
  lines.push('- The `.job` file uses generated WinCross `INDEX` glossary statements for stacked-table logic and does not switch `DATA=` paths inside `[TABLES]`.');
  if (dataFiles.length > 0) {
    lines.push('- The package includes only the `.sav` files needed for desktop execution and fallback inspection.');
  }
  lines.push('- Banner content is always derived from the run\'s actual banner cuts, not from the preference profile.');
  lines.push('');
  lines.push('Generated by TabulateAI WinCross exporter.');
  return `${lines.join('\n')}\n`;
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Content(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
