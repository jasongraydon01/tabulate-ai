import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  ExportManifestMetadataSchema,
  ExportSupportReportSchema,
  JobRoutingManifestSchema,
  TableRoutingArtifactSchema,
  WinCrossExportManifestSchema,
  type ExportDataFileRef,
  type JobRoutingManifest,
  type TableRoutingArtifact,
  type WinCrossExportManifest,
} from '@/lib/exportData/types';
import {
  CrosstabRawArtifactSchema,
  LoopSummaryArtifactSchema,
  ResultsTablesFinalContractSchema,
  SortedFinalArtifactSchema,
} from '@/lib/exportData/inputArtifactSchemas';
import { LoopSemanticsPolicySchema } from '@/schemas/loopSemanticsPolicySchema';
import { buildBlockedItemsFromTableStatuses } from './contract';
import { resolveWinCrossPreference } from './preferenceResolver';
import {
  serializeWinCrossJob,
  type WinCrossQuestionTitleHint,
} from './serializer';
import {
  WINCROSS_EXPORTER_VERSION,
  WINCROSS_EXPORT_MANIFEST_VERSION,
  WINCROSS_SERIALIZER_CONTRACT_VERSION,
  type WinCrossResolvedArtifacts,
} from './types';

type SortedFinalTable = WinCrossResolvedArtifacts['sortedFinal']['tables'][number];

interface ValidationTableSpec {
  tableId: string;
  focus: string;
  bucket:
    | 'indexed_filter_nets'
    | 'indexed_stats_controls'
    | 'indexed_base_controls'
    | 'wide_controls';
}

interface SelectedValidationTable extends ValidationTableSpec {
  ordinal: number;
  questionId: string;
  frame: string;
  title: string;
  rowCount: number;
  netRowCount: number;
}

interface ValidationVariantSpec {
  id: '01-net';
  label: 'NET';
}

interface ValidationVariantResult {
  id: ValidationVariantSpec['id'];
  label: ValidationVariantSpec['label'];
  outputDir: string;
  jobPath: string;
  manifestPath: string;
  warningCount: number;
}

export interface GenerateIndexedValidationHarnessParams {
  runDir: string;
  outputDir: string;
  preferenceJobPath?: string;
}

export interface GenerateIndexedValidationHarnessResult {
  outputDir: string;
  readmePath: string;
  reportPath: string;
  tableMapPath: string;
  selectionJsonPath: string;
  selectedTables: SelectedValidationTable[];
  variants: ValidationVariantResult[];
}

const VALIDATION_VARIANTS: ValidationVariantSpec[] = [
  { id: '01-net', label: 'NET' },
];

const VALIDATION_TABLE_SPECS: ValidationTableSpec[] = [
  {
    tableId: 's1__standard_overview__net_summary',
    bucket: 'wide_controls',
    focus: 'Wide synthetic-net control; should stay NET in both variants.',
  },
  {
    tableId: 's1__standard_overview',
    bucket: 'wide_controls',
    focus: 'Wide base comparison for the synthetic-net control.',
  },
  {
    tableId: 'hage__standard_overview__net_summary',
    bucket: 'wide_controls',
    focus: 'Wide simple filter-range net control.',
  },
  {
    tableId: 'hrace__standard_overview__net_summary',
    bucket: 'wide_controls',
    focus: 'Wide single-net control with one grouped net and indented children.',
  },
  {
    tableId: 's2__numeric_item_s2',
    bucket: 'wide_controls',
    focus: 'Wide numeric/stat control to compare against indexed numeric tables.',
  },
  {
    tableId: 'a2__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed time-of-day net summary for iteration 1.',
  },
  {
    tableId: 'a2__standard_overview-2__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed time-of-day net summary for iteration 2.',
  },
  {
    tableId: 'a3__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed weekday/weekend net summary for iteration 1.',
  },
  {
    tableId: 'a3__standard_overview-2__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed weekday/weekend net summary for iteration 2.',
  },
  {
    tableId: 'a4__standard_overview',
    bucket: 'indexed_base_controls',
    focus: 'Base comparison for the indexed categorical net case.',
  },
  {
    tableId: 'a4__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed categorical net rows expressed as direct filter ranges on a single indexed variable.',
  },
  {
    tableId: 'a6__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed recommendation-net summary for iteration 1.',
  },
  {
    tableId: 'a6__standard_overview-2__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed recommendation-net summary for iteration 2.',
  },
  {
    tableId: 'a10__numeric_item_a10_1',
    bucket: 'indexed_stats_controls',
    focus: 'Indexed numeric binned distribution with stat rows but no nets.',
  },
  {
    tableId: 'a10__numeric_pervalue_a10_1',
    bucket: 'indexed_stats_controls',
    focus: 'Indexed numeric per-value distribution to confirm non-net INDEX behavior on a long row block.',
  },
  {
    tableId: 'a11__scale_overview_full',
    bucket: 'indexed_stats_controls',
    focus: 'Indexed scale table with both nets and mean/median/std stats for iteration 1.',
  },
  {
    tableId: 'a11__scale_overview_full-2',
    bucket: 'indexed_stats_controls',
    focus: 'Indexed scale table with both nets and stats for iteration 2.',
  },
  {
    tableId: 'a13__standard_overview',
    bucket: 'indexed_base_controls',
    focus: 'Base comparison for the dense indexed brand frame with no nets.',
  },
  {
    tableId: 'a13__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Largest indexed net summary; stresses dense single-variable INDEX remapping plus many net rows.',
  },
  {
    tableId: 'a14b__standard_overview',
    bucket: 'indexed_base_controls',
    focus: 'Base comparison for indexed retail-channel nets.',
  },
  {
    tableId: 'a14b__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed retail-channel nets with long labels and several grouped nets for iteration 1.',
  },
  {
    tableId: 'a14b__standard_overview-2__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed retail-channel nets for iteration 2.',
  },
  {
    tableId: 'ha14b__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed derived h-variable net summary to compare with the direct A14b indexed frame.',
  },
  {
    tableId: 'a15__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed bottle-size nets with small row counts for an easy desktop sanity check.',
  },
  {
    tableId: 'a18__standard_overview__net_summary',
    bucket: 'indexed_filter_nets',
    focus: 'Indexed reason-summary nets on another single indexed variable.',
  },
];

export async function generateIndexedWinCrossValidationHarness(
  params: GenerateIndexedValidationHarnessParams,
): Promise<GenerateIndexedValidationHarnessResult> {
  const outputDir = path.resolve(params.outputDir);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const resolved = await resolveLocalValidationArtifacts(params.runDir);
  const selectedTables = selectValidationTables(resolved.sortedFinal.tables, resolved.tableRouting);
  const subset = buildValidationSubset(resolved, selectedTables);
  const selectedDataFiles = collectSelectedDataFiles(subset.metadata.availableDataFiles, subset.jobRoutingManifest);
  const questionTitleHintsById = await loadOptionalWinCrossQuestionTitleHints(params.runDir);
  const resolvedPreference = params.preferenceJobPath
    ? resolveWinCrossPreference({
      kind: 'inline_job',
      content: await fs.readFile(params.preferenceJobPath),
      fileName: path.basename(params.preferenceJobPath),
    })
    : resolveWinCrossPreference({
      kind: 'embedded_reference',
      referenceId: 'hcp_vaccines',
    });
  const profileLabel = params.preferenceJobPath
    ? `inline_job:${path.resolve(params.preferenceJobPath)}`
    : 'embedded_reference:hcp_vaccines';

  const variants: ValidationVariantResult[] = [];
  const renderedVariants: Array<{
    variant: ValidationVariantSpec;
    manifest: WinCrossExportManifest;
    serialized: ReturnType<typeof serializeWinCrossJob>;
  }> = [];

  for (const variant of VALIDATION_VARIANTS) {
    const variantOutputDir = path.join(outputDir, variant.id);
    await fs.mkdir(variantOutputDir, { recursive: true });

    const serialized = serializeWinCrossJob(subset, resolvedPreference.profile, {
      tableRouting: subset.tableRouting,
      jobRouting: subset.jobRoutingManifest,
      questionTitleHintsById,
    });
    const manifest = buildValidationManifest(subset, serialized, resolvedPreference.profileDigest);

    await writeVariantArtifacts({
      variant,
      variantOutputDir,
      runDir: params.runDir,
      selectedTables,
      selectedDataFiles,
      tableRouting: subset.tableRouting,
      jobRouting: subset.jobRoutingManifest,
      loopSummary: subset.loopSummary,
      profile: resolvedPreference.profile,
      diagnostics: resolvedPreference.diagnostics,
      serialized,
      manifest,
    });

    renderedVariants.push({ variant, manifest, serialized });
    variants.push({
      id: variant.id,
      label: variant.label,
      outputDir: variantOutputDir,
      jobPath: path.join(variantOutputDir, 'export.job'),
      manifestPath: path.join(variantOutputDir, 'wincross-export-manifest.local.json'),
      warningCount: manifest.warnings.length,
    });
  }

  const referenceVariant = renderedVariants[0];
  if (!referenceVariant) {
    throw new Error('No validation variants were rendered.');
  }

  const orderedSelections = withOrdinals(selectedTables, referenceVariant.serialized.tableStatuses);
  const tableMapPath = path.join(outputDir, 'table-map.md');
  const selectionJsonPath = path.join(outputDir, 'selected-tables.json');
  const readmePath = path.join(outputDir, 'README.md');
  const reportPath = path.join(outputDir, 'validation-report.md');

  await fs.writeFile(selectionJsonPath, JSON.stringify(orderedSelections, null, 2), 'utf8');
  await fs.writeFile(tableMapPath, buildTableMapMarkdown(orderedSelections), 'utf8');
  await fs.writeFile(
    readmePath,
    buildRootReadme(outputDir, orderedSelections, variants, selectedDataFiles, profileLabel),
    'utf8',
  );
  await fs.writeFile(
    reportPath,
    buildValidationReport({
      runDir: path.resolve(params.runDir),
      orderedSelections,
      variants,
      profileLabel,
      selectedDataFiles,
      indexedNetRowCount: orderedSelections
        .filter((selection) => selection.frame !== 'wide')
        .reduce((sum, selection) => sum + selection.netRowCount, 0),
    }),
    'utf8',
  );

  return {
    outputDir,
    readmePath,
    reportPath,
    tableMapPath,
    selectionJsonPath,
    selectedTables: orderedSelections,
    variants,
  };
}

async function resolveLocalValidationArtifacts(runDir: string): Promise<WinCrossResolvedArtifacts> {
  const metadataPath = path.join(runDir, 'export', 'export-metadata.json');
  const metadata = ExportManifestMetadataSchema.parse(await readJson(metadataPath));

  const tableRouting = TableRoutingArtifactSchema.parse(
    await readJson(path.join(runDir, metadata.artifactPaths.outputs.tableRouting)),
  );
  const jobRoutingManifest = JobRoutingManifestSchema.parse(
    await readJson(path.join(runDir, metadata.artifactPaths.outputs.jobRoutingManifest)),
  );
  const supportReport = ExportSupportReportSchema.parse(
    await readJson(path.join(runDir, metadata.artifactPaths.outputs.supportReport ?? 'export/support-report.json')),
  );
  const sortedFinal = SortedFinalArtifactSchema.parse(
    await readJson(path.join(runDir, metadata.artifactPaths.inputs.sortedFinal)),
  );
  const resultsTables = ResultsTablesFinalContractSchema.parse(
    await readJson(path.join(runDir, metadata.artifactPaths.inputs.resultsTables)),
  );
  const crosstabRaw = CrosstabRawArtifactSchema.parse(
    await readJson(path.join(runDir, metadata.artifactPaths.inputs.crosstabRaw)),
  );
  const loopSummary = LoopSummaryArtifactSchema.parse(
    await readJson(path.join(runDir, metadata.artifactPaths.inputs.loopSummary)),
  );
  const loopPolicyValue = await readJson(path.join(runDir, metadata.artifactPaths.outputs.loopPolicy));
  const loopPolicy = LoopSemanticsPolicySchema.safeParse(loopPolicyValue);

  return {
    metadata,
    tableRouting,
    jobRoutingManifest,
    loopPolicy: loopPolicy.success ? loopPolicy.data : null,
    supportReport,
    sortedFinal,
    resultsTables,
    crosstabRaw,
    loopSummary,
    r2Keys: {
      metadata: '',
      tableRouting: '',
      jobRoutingManifest: '',
      loopPolicy: '',
      supportReport: '',
      sortedFinal: '',
      resultsTables: '',
      crosstabRaw: '',
      loopSummary: '',
    },
  };
}

function selectValidationTables(
  tables: SortedFinalTable[],
  tableRouting: TableRoutingArtifact,
): SelectedValidationTable[] {
  const tableById = new Map(tables.map((table) => [table.tableId, table] as const));

  return VALIDATION_TABLE_SPECS.map((spec) => {
    const table = tableById.get(spec.tableId);
    if (!table) {
      throw new Error(`Validation harness could not find selected table "${spec.tableId}".`);
    }
    return {
      ...spec,
      ordinal: 0,
      questionId: table.questionId,
      frame: tableRouting.tableToDataFrameRef[table.tableId] ?? 'wide',
      title: resolveTableTitle(table),
      rowCount: table.rows.length,
      netRowCount: table.rows.filter((row) => Boolean(row.isNet)).length,
    };
  });
}

function buildValidationSubset(
  resolved: WinCrossResolvedArtifacts,
  selectedTables: SelectedValidationTable[],
): WinCrossResolvedArtifacts {
  const selectedIds = new Set(selectedTables.map((selection) => selection.tableId));
  const selectedFrames = new Set(['wide']);
  for (const selection of selectedTables) {
    selectedFrames.add(selection.frame);
  }

  const sortedFinalTables = resolved.sortedFinal.tables.filter((table) => selectedIds.has(table.tableId));
  const tableToDataFrameRef = Object.fromEntries(
    selectedTables.map((selection) => [selection.tableId, selection.frame]),
  );
  const countsByDataFrameRef = selectedTables.reduce<Record<string, number>>((acc, selection) => {
    acc[selection.frame] = (acc[selection.frame] ?? 0) + 1;
    return acc;
  }, {});

  const jobEntries = resolved.jobRoutingManifest.jobs
    .map((job) => ({
      ...job,
      tableIds: job.tableIds.filter((tableId) => selectedIds.has(tableId)),
    }))
    .filter((job) => job.tableIds.length > 0);

  const tableToJobId = Object.fromEntries(
    jobEntries.flatMap((job) => job.tableIds.map((tableId) => [tableId, job.jobId] as const)),
  );

  const selectedResultTables = Object.fromEntries(
    Object.entries(resolved.resultsTables.tables).filter(([tableId]) => selectedIds.has(tableId)),
  );

  return {
    ...resolved,
    metadata: {
      ...resolved.metadata,
      availableDataFiles: resolved.metadata.availableDataFiles.filter((file) => selectedFrames.has(file.dataFrameRef)),
    },
    sortedFinal: {
      ...resolved.sortedFinal,
      tables: sortedFinalTables,
    },
    resultsTables: {
      ...resolved.resultsTables,
      tables: selectedResultTables,
    },
    tableRouting: {
      generatedAt: resolved.tableRouting.generatedAt,
      totalTables: sortedFinalTables.length,
      tableToDataFrameRef,
      countsByDataFrameRef,
    },
    jobRoutingManifest: {
      generatedAt: resolved.jobRoutingManifest.generatedAt,
      totalJobs: jobEntries.length,
      totalTables: sortedFinalTables.length,
      jobs: jobEntries,
      tableToJobId,
    },
    loopSummary: {
      ...resolved.loopSummary,
      totalLoopGroups: resolved.loopSummary.groups.filter((group) => selectedFrames.has(group.stackedFrameName)).length,
      groups: resolved.loopSummary.groups.filter((group) => selectedFrames.has(group.stackedFrameName)),
    },
  };
}

function collectSelectedDataFiles(
  dataFiles: ExportDataFileRef[],
  jobRoutingManifest: JobRoutingManifest,
): ExportDataFileRef[] {
  const usedFrames = new Set(jobRoutingManifest.jobs.map((job) => job.dataFrameRef));
  usedFrames.add('wide');
  return dataFiles.filter((file) => usedFrames.has(file.dataFrameRef));
}

function buildValidationManifest(
  artifacts: WinCrossResolvedArtifacts,
  serialized: ReturnType<typeof serializeWinCrossJob>,
  profileDigest: string,
): WinCrossExportManifest {
  const packageId = createHash('sha256').update(stableJson({
    integrityDigest: artifacts.metadata.idempotency?.integrityDigest ?? '',
    profileDigest,
    selectedTableIds: serialized.tableStatuses.map((status) => status.tableId),
  })).digest('hex');

  return WinCrossExportManifestSchema.parse({
    manifestVersion: WINCROSS_EXPORT_MANIFEST_VERSION,
    exporterVersion: WINCROSS_EXPORTER_VERSION,
    generatedAt: new Date().toISOString(),
    packageId,
    sourceManifestVersion: artifacts.metadata.manifestVersion,
    integrityDigest: artifacts.metadata.idempotency?.integrityDigest ?? '',
    tableCount: serialized.tableCount,
    useCount: serialized.useCount,
    afCount: serialized.afCount,
    blockedCount: serialized.blockedCount,
    profileSource: 'embedded_reference',
    profileDigest,
    serializerContractVersion: WINCROSS_SERIALIZER_CONTRACT_VERSION,
    blockedItems: buildBlockedItemsFromTableStatuses(serialized.tableStatuses),
    warnings: serialized.warnings,
    applicationDiagnostics: serialized.applicationDiagnostics,
    supportSummary: artifacts.supportReport.summary.wincross,
  });
}

async function writeVariantArtifacts(params: {
  variant: ValidationVariantSpec;
  variantOutputDir: string;
  runDir: string;
  selectedTables: SelectedValidationTable[];
  selectedDataFiles: ExportDataFileRef[];
  tableRouting: TableRoutingArtifact;
  jobRouting: JobRoutingManifest;
  loopSummary: WinCrossResolvedArtifacts['loopSummary'];
  profile: ReturnType<typeof resolveWinCrossPreference>['profile'];
  diagnostics: ReturnType<typeof resolveWinCrossPreference>['diagnostics'];
  serialized: ReturnType<typeof serializeWinCrossJob>;
  manifest: WinCrossExportManifest;
}): Promise<void> {
  const dataDir = path.join(params.variantOutputDir, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  await fs.writeFile(path.join(params.variantOutputDir, 'export.job'), params.serialized.content);
  await fs.writeFile(
    path.join(params.variantOutputDir, 'wincross-export-manifest.local.json'),
    JSON.stringify(params.manifest, null, 2),
    'utf8',
  );
  await fs.writeFile(path.join(params.variantOutputDir, 'profile.json'), JSON.stringify(params.profile, null, 2), 'utf8');
  await fs.writeFile(
    path.join(params.variantOutputDir, 'profile-diagnostics.json'),
    JSON.stringify(params.diagnostics, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(params.variantOutputDir, 'table-routing.json'),
    JSON.stringify(params.tableRouting, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(params.variantOutputDir, 'job-routing-manifest.json'),
    JSON.stringify(params.jobRouting, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(params.variantOutputDir, 'loop-summary.json'),
    JSON.stringify(params.loopSummary, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(params.variantOutputDir, 'README.md'),
    buildVariantReadme(params.variant, params.selectedTables, params.selectedDataFiles),
    'utf8',
  );

  for (const dataFile of params.selectedDataFiles) {
    await fs.copyFile(
      path.join(params.runDir, dataFile.relativePath),
      path.join(dataDir, dataFile.fileName),
    );
  }
}

function withOrdinals(
  selectedTables: SelectedValidationTable[],
  tableStatuses: Array<{ tableId: string; ordinal: number }>,
): SelectedValidationTable[] {
  const ordinalByTableId = new Map(tableStatuses.map((status) => [status.tableId, status.ordinal] as const));
  return selectedTables
    .map((selection) => ({
      ...selection,
      ordinal: ordinalByTableId.get(selection.tableId) ?? 0,
    }))
    .sort((left, right) => left.ordinal - right.ordinal || left.tableId.localeCompare(right.tableId));
}

function buildRootReadme(
  outputDir: string,
  selectedTables: SelectedValidationTable[],
  variants: ValidationVariantResult[],
  selectedDataFiles: ExportDataFileRef[],
  profileLabel: string,
): string {
  const lines: string[] = [];
  lines.push('# WinCross Indexed Desktop Validation Harness');
  lines.push('');
  lines.push(`- Output root: \`${outputDir}\``);
  lines.push(`- Style profile: \`${profileLabel}\`.`);
  lines.push(`- Selected tables: ${selectedTables.length}`);
  lines.push(`- Included data files: ${selectedDataFiles.length}`);
  lines.push('- Primary desktop pairing: open `01-net/export.job` against `01-net/data/wide.sav`.');
  lines.push('- Routed stacked `.sav` files are included only for inspection and fallback testing; the `.job` does not switch `DATA=` paths.');
  lines.push('');
  lines.push('## Package');
  lines.push('');
  for (const variant of variants) {
    lines.push(`- \`${path.relative(outputDir, variant.jobPath)}\` is the canonical indexed desktop-validation job using plain \`${variant.label}\` rows.`);
  }
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push('- `table-map.md`: table ordinals, source table IDs, frames, and selection rationale.');
  lines.push('- `validation-report.md`: what to compare in WinCross desktop.');
  lines.push('- `selected-tables.json`: machine-readable version of the curated 25-table set.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildVariantReadme(
  variant: ValidationVariantSpec,
  selectedTables: SelectedValidationTable[],
  selectedDataFiles: ExportDataFileRef[],
): string {
  const indexedNetTableCount = selectedTables.filter((selection) => selection.frame !== 'wide' && selection.netRowCount > 0).length;
  const lines: string[] = [];
  lines.push(`# ${variant.label} Variant`);
  lines.push('');
  lines.push('- Indexed tables still use generated `INDEX` statements plus `AF=IDX(...)` where needed.');
  lines.push(`- Indexed net rows serialize as plain \`${variant.label}\`.`);
  lines.push(`- Tables in this harness: ${selectedTables.length}`);
  lines.push(`- Indexed tables with net rows: ${indexedNetTableCount}`);
  lines.push('- Open `export.job` against `data/wide.sav` first.');
  lines.push('- The extra stacked `.sav` files are included only for desktop inspection and fallback checks.');
  lines.push('');
  lines.push('## Data Files');
  lines.push('');
  for (const dataFile of selectedDataFiles) {
    lines.push(`- \`data/${dataFile.fileName}\` (${dataFile.dataFrameRef})`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildTableMapMarkdown(selectedTables: SelectedValidationTable[]): string {
  const lines: string[] = [];
  lines.push('# Table Map');
  lines.push('');
  lines.push('| Ordinal | Table ID | Frame | Question | Net Rows | Focus |');
  lines.push('| --- | --- | --- | --- | ---: | --- |');
  for (const table of selectedTables) {
    lines.push(`| T${table.ordinal} | \`${table.tableId}\` | \`${table.frame}\` | \`${table.questionId}\` | ${table.netRowCount} | ${escapeMarkdownCell(table.focus)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildValidationReport(params: {
  runDir: string;
  orderedSelections: SelectedValidationTable[];
  variants: ValidationVariantResult[];
  profileLabel: string;
  selectedDataFiles: ExportDataFileRef[];
  indexedNetRowCount: number;
}): string {
  const indexedSelections = params.orderedSelections.filter((selection) => selection.frame !== 'wide');
  const wideSelections = params.orderedSelections.filter((selection) => selection.frame === 'wide');
  const lines: string[] = [];
  lines.push('# Validation Report');
  lines.push('');
  lines.push(`- Source run: \`${params.runDir}\``);
  lines.push(`- Style profile applied: \`${params.profileLabel}\``);
  lines.push(`- Curated table count: ${params.orderedSelections.length}`);
  lines.push(`- Indexed tables: ${indexedSelections.length}`);
  lines.push(`- Wide controls: ${wideSelections.length}`);
  lines.push(`- Indexed net rows validated on plain \`NET\`: ${params.indexedNetRowCount}`);
  lines.push('');
  lines.push('## What Was Generated');
  lines.push('');
  for (const variant of params.variants) {
    lines.push(`- \`${variant.id}\`: canonical indexed-validation package at \`${variant.outputDir}\``);
  }
  lines.push('');
  lines.push('## Validation Conclusion');
  lines.push('');
  lines.push('- Desktop validation confirmed that indexed tables should keep plain `NET` rows.');
  lines.push('- `IDXNET` did not match the Excel first-100 validation output and is not part of the canonical serializer path.');
  lines.push('- Loop/index routing remains validated through generated `INDEX` statements and `AF=IDX(...)` usage.');
  lines.push('- The included wide and stacked `.sav` files remain available for fallback inspection in desktop.');
  lines.push('');
  lines.push('## Table Buckets');
  lines.push('');
  lines.push(`- Indexed filter-range nets: ${params.orderedSelections.filter((selection) => selection.bucket === 'indexed_filter_nets').map((selection) => `\`${selection.tableId}\``).join(', ')}`);
  lines.push(`- Indexed stat/no-net controls: ${params.orderedSelections.filter((selection) => selection.bucket === 'indexed_stats_controls').map((selection) => `\`${selection.tableId}\``).join(', ')}`);
  lines.push(`- Indexed base comparisons: ${params.orderedSelections.filter((selection) => selection.bucket === 'indexed_base_controls').map((selection) => `\`${selection.tableId}\``).join(', ')}`);
  lines.push(`- Wide controls: ${params.orderedSelections.filter((selection) => selection.bucket === 'wide_controls').map((selection) => `\`${selection.tableId}\``).join(', ')}`);
  lines.push('');
  lines.push('## Included Data Files');
  lines.push('');
  for (const dataFile of params.selectedDataFiles) {
    lines.push(`- \`${dataFile.fileName}\` from frame \`${dataFile.dataFrameRef}\``);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function loadOptionalWinCrossQuestionTitleHints(
  outputDir: string,
): Promise<Record<string, WinCrossQuestionTitleHint> | undefined> {
  const candidatePaths = [
    path.join(outputDir, 'enrichment', '12-questionid-final.json'),
    path.join(outputDir, 'enrichment', '00-questionid-raw.json'),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const payload = await readJson(candidatePath);
      const hints = buildQuestionTitleHintsById(payload);
      if (Object.keys(hints).length > 0) {
        return hints;
      }
    } catch {
      // Best-effort only.
    }
  }

  return undefined;
}

function buildQuestionTitleHintsById(payload: unknown): Record<string, WinCrossQuestionTitleHint> {
  const entries = extractQuestionTitleHintEntries(payload);
  const hints: Record<string, WinCrossQuestionTitleHint> = {};

  for (const entry of entries) {
    const questionId = typeof entry.questionId === 'string' ? entry.questionId.trim() : '';
    if (!questionId) continue;

    hints[questionId] = {
      questionText: typeof entry.questionText === 'string' ? entry.questionText : undefined,
      surveyText: typeof entry.surveyText === 'string' ? entry.surveyText : undefined,
      savLabel: typeof entry.savLabel === 'string' ? entry.savLabel : undefined,
      label: typeof entry.label === 'string' ? entry.label : undefined,
    };
  }

  return hints;
}

function extractQuestionTitleHintEntries(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object');
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.questionIds)) {
    return record.questionIds.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object');
  }

  return [];
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

function resolveTableTitle(table: SortedFinalTable): string {
  const subtitle = typeof table.tableSubtitle === 'string' ? table.tableSubtitle.trim() : '';
  const questionText = typeof table.questionText === 'string' ? table.questionText.trim() : '';
  return subtitle || questionText || table.tableId;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
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
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}
