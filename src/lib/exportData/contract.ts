import { promises as fs } from 'fs';
import * as path from 'path';
import type { LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';
import type { CompiledLoopContract } from '@/schemas/compiledLoopContractSchema';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import { SortedFinalArtifactSchema } from './inputArtifactSchemas';
import {
  EXPORT_ARTIFACT_PATHS,
  EXPORT_ACTIVE_MANIFEST_VERSION,
  type ExportArtifactRefs,
  type ExportDataFileRef,
  type ExportPhase0Metadata,
  type JobRoutingManifest,
  type TableRoutingArtifact,
} from './types';

export interface PersistPhase0ArtifactsParams {
  outputDir: string;
  tablesWithLoopFrame: TableWithLoopFrame[];
  loopMappings: LoopGroupMapping[];
  loopSemanticsPolicy?: LoopSemanticsPolicy;
  compiledLoopContract?: CompiledLoopContract;
  weightVariable?: string | null;
  sourceSavUploadedName: string;
  sourceSavRuntimeName?: string;
  hasDualWeightOutputs?: boolean;
  convexRefs?: {
    runId?: string;
    projectId?: string;
    orgId?: string;
    pipelineId?: string;
  };
}

const REQUIRED_INPUT_ARTIFACTS = {
  sortedFinal: 'tables/13e-table-enriched.json',
  resultsTables: 'results/tables.json',
  crosstabRaw: 'planning/21-crosstab-plan.json',
  loopSummary: 'enrichment/loop-summary.json',
  loopPolicy: 'agents/loop-semantics/loop-semantics-policy.json',
  compiledLoopContract: 'agents/loop-semantics/compiled-loop-contract.json',
} as const;

const RESULTS_TABLES_VARIANTS = {
  canonical: 'results/tables.json',
  weighted: 'results/tables-weighted.json',
  unweighted: 'results/tables-unweighted.json',
} as const;

const FALLBACK_INPUT_ARTIFACTS = {
  sortedFinal: ['tables/13d-table-canonical.json', 'tables/07-sorted-final.json'],
  crosstabRaw: ['planning/21-crosstab-plan.json', 'crosstab/crosstab-output-raw.json'],
  loopSummary: ['enrichment/loop-summary.json', 'stages/loop-summary.json'],
  loopPolicy: ['loop-policy/loop-semantics-policy.json'],
  compiledLoopContract: ['loop-policy/compiled-loop-contract.json'],
} as const;

function getDataFrameRef(loopDataFrame?: string | null): string {
  const trimmed = typeof loopDataFrame === 'string' ? loopDataFrame.trim() : '';
  return trimmed.length > 0 ? trimmed : 'wide';
}

function getWeightingMode(weightVariable: string | null | undefined, hasDualWeightOutputs: boolean): 'weighted' | 'unweighted' | 'both' {
  if (hasDualWeightOutputs) return 'both';
  return weightVariable ? 'weighted' : 'unweighted';
}

function rankDataFrameRef(dataFrameRef: string): number {
  return dataFrameRef === 'wide' ? 0 : 1;
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveVerboseDataMapInputPath(outputDir: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && /-verbose-.*\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates[candidates.length - 1];
  } catch {
    return undefined;
  }
}

async function resolveResultsTablesInputPath(params: {
  outputDir: string;
  weightVariable?: string | null;
  hasDualWeightOutputs?: boolean;
}): Promise<string> {
  const candidates = params.hasDualWeightOutputs
    ? [
        RESULTS_TABLES_VARIANTS.weighted,
        RESULTS_TABLES_VARIANTS.unweighted,
        RESULTS_TABLES_VARIANTS.canonical,
      ]
    : params.weightVariable
      ? [
          RESULTS_TABLES_VARIANTS.weighted,
          RESULTS_TABLES_VARIANTS.canonical,
          RESULTS_TABLES_VARIANTS.unweighted,
        ]
      : [
          RESULTS_TABLES_VARIANTS.canonical,
          RESULTS_TABLES_VARIANTS.weighted,
          RESULTS_TABLES_VARIANTS.unweighted,
        ];

  return resolveFirstExistingRelativePath(
    params.outputDir,
    candidates,
    RESULTS_TABLES_VARIANTS.canonical,
  );
}

async function writeJsonFile(outputDir: string, relativePath: string, value: unknown): Promise<void> {
  const absolutePath = path.join(outputDir, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(value, null, 2), 'utf-8');
}

async function readJsonFile<T>(outputDir: string, relativePath: string): Promise<T> {
  const absolutePath = path.join(outputDir, relativePath);
  return JSON.parse(await fs.readFile(absolutePath, 'utf-8')) as T;
}

async function resolveRoutingTables(
  outputDir: string,
  sortedFinalPath: string,
  fallbackTables: TableWithLoopFrame[],
): Promise<TableWithLoopFrame[]> {
  const absolutePath = path.join(outputDir, sortedFinalPath);
  if (!(await fileExists(absolutePath))) {
    return fallbackTables;
  }

  try {
    const parsed = SortedFinalArtifactSchema.parse(
      JSON.parse(await fs.readFile(absolutePath, 'utf-8')),
    );
    if (parsed.tables.length === 0) {
      return fallbackTables;
    }
    return parsed.tables as unknown as TableWithLoopFrame[];
  } catch {
    return fallbackTables;
  }
}

function buildNoLoopSemanticsPolicy(): LoopSemanticsPolicy {
  return {
    policyVersion: '1.0',
    bannerGroups: [],
    warnings: [],
    reasoning: 'No loop groups detected. Export defaults to respondent-anchored semantics.',
    fallbackApplied: false,
    fallbackReason: '',
  };
}

function buildExpectedDataFiles(
  loopMappings: LoopGroupMapping[],
  tableRouting: TableRoutingArtifact,
): ExportDataFileRef[] {
  const refs: ExportDataFileRef[] = [
    {
      dataFrameRef: 'wide',
      fileName: 'wide.sav',
      relativePath: EXPORT_ARTIFACT_PATHS.wideSav,
      exists: false,
    },
  ];

  const seen = new Set<string>(['wide']);
  for (const loopMapping of loopMappings) {
    if (seen.has(loopMapping.stackedFrameName)) continue;
    refs.push({
      dataFrameRef: loopMapping.stackedFrameName,
      fileName: `${loopMapping.stackedFrameName}.sav`,
      relativePath: `export/data/${loopMapping.stackedFrameName}.sav`,
      exists: false,
    });
    seen.add(loopMapping.stackedFrameName);
  }

  for (const dataFrameRef of Object.keys(tableRouting.countsByDataFrameRef)) {
    if (seen.has(dataFrameRef)) continue;
    refs.push({
      dataFrameRef,
      fileName: `${dataFrameRef}.sav`,
      relativePath: dataFrameRef === 'wide'
        ? EXPORT_ARTIFACT_PATHS.wideSav
        : `export/data/${dataFrameRef}.sav`,
      exists: false,
    });
    seen.add(dataFrameRef);
  }

  refs.sort((a, b) => {
    const rankDiff = rankDataFrameRef(a.dataFrameRef) - rankDataFrameRef(b.dataFrameRef);
    return rankDiff !== 0 ? rankDiff : a.dataFrameRef.localeCompare(b.dataFrameRef);
  });
  return refs;
}

function buildLoopSummary(loopMappings: LoopGroupMapping[]): {
  totalLoopGroups: number;
  totalIterationVars: number;
  totalBaseVars: number;
  groups: Array<{
    stackedFrameName: string;
    skeleton: string;
    iterations: string[];
    variableCount: number;
    variables: Array<{
      baseName: string;
      label: string;
      iterationColumns: Record<string, string>;
    }>;
  }>;
} {
  const totalLoopGroups = loopMappings.length;
  const totalBaseVars = loopMappings.reduce((sum, mapping) => sum + mapping.variables.length, 0);
  const totalIterationVars = loopMappings.reduce(
    (sum, mapping) => sum + mapping.variables.length * mapping.iterations.length,
    0,
  );

  return {
    totalLoopGroups,
    totalIterationVars,
    totalBaseVars,
    groups: loopMappings.map((mapping) => ({
      stackedFrameName: mapping.stackedFrameName,
      skeleton: mapping.skeleton,
      iterations: mapping.iterations,
      variableCount: mapping.variables.length,
      variables: mapping.variables.map((variable) => ({
        baseName: variable.baseName,
        label: variable.label,
        iterationColumns: variable.iterationColumns,
      })),
    })),
  };
}

async function ensureLoopSummaryArtifact(
  outputDir: string,
  loopSummaryPath: string,
  loopMappings: LoopGroupMapping[],
): Promise<boolean> {
  const absolutePath = path.join(outputDir, loopSummaryPath);
  if (await fileExists(absolutePath)) {
    return false;
  }

  const fallbackSummary = buildLoopSummary(loopMappings);
  await writeJsonFile(outputDir, loopSummaryPath, fallbackSummary);
  if (loopSummaryPath !== 'stages/loop-summary.json') {
    await writeJsonFile(outputDir, 'stages/loop-summary.json', fallbackSummary);
  }
  return true;
}

function buildWarnings(params: {
  loopMappings: LoopGroupMapping[];
  loopSemanticsPolicy?: LoopSemanticsPolicy;
  requiredInputPresence: Record<string, boolean>;
  synthesizedLoopSummary: boolean;
  missingJobDataFiles: string[];
}): string[] {
  const warnings: string[] = [];
  if (params.loopMappings.length > 0 && !params.loopSemanticsPolicy) {
    warnings.push('Loop mappings exist but no loop semantics policy was provided; using no-loop fallback policy for export contract.');
  }
  if (params.loopMappings.length > 0 && params.synthesizedLoopSummary) {
    warnings.push('Loop summary artifact was missing at completion and was synthesized for export contract determinism.');
  }
  if (params.missingJobDataFiles.length > 0) {
    warnings.push(`Job-routed export data files missing at completion: ${params.missingJobDataFiles.join(', ')}`);
  }
  for (const [artifactName, exists] of Object.entries(params.requiredInputPresence)) {
    if (!exists) {
      warnings.push(`Required input artifact missing at completion: ${artifactName}`);
    }
  }
  return warnings;
}

function resolveTableDataFrameRef(
  table: TableWithLoopFrame,
  baseToFrame: Map<string, string>,
): string {
  const explicit = getDataFrameRef(table.loopDataFrame);
  if (explicit !== 'wide') {
    return explicit;
  }

  const rowVars = Array.isArray(table.rows)
    ? table.rows
      .map((row) => (typeof row.variable === 'string' ? row.variable.trim() : ''))
      .filter((variable) => variable.length > 0)
    : [];

  if (rowVars.length === 0 || baseToFrame.size === 0) {
    return 'wide';
  }

  const baseNames = [...baseToFrame.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  for (const variable of rowVars) {
    for (const baseName of baseNames) {
      if (variable === baseName || variable.startsWith(`${baseName}_`) || variable.startsWith(`${baseName}.`)) {
        return baseToFrame.get(baseName) ?? 'wide';
      }
    }
  }
  return 'wide';
}

export function buildTableRoutingArtifact(
  tablesWithLoopFrame: TableWithLoopFrame[],
  loopMappings: LoopGroupMapping[] = [],
): TableRoutingArtifact {
  const seenTableIds = new Map<string, number>();
  const normalizedTables = tablesWithLoopFrame.map((table) => {
    const rawTableId = typeof table.tableId === 'string' ? table.tableId.trim() : '';
    const fallbackRoot = (() => {
      const questionId = typeof table.questionId === 'string' && table.questionId.trim().length > 0
        ? table.questionId.trim()
        : 'unknown';
      return `table_${questionId}`;
    })();
    const baseId = rawTableId.length > 0 ? rawTableId : fallbackRoot;
    const nextCount = (seenTableIds.get(baseId) ?? 0) + 1;
    seenTableIds.set(baseId, nextCount);
    const normalizedId = nextCount === 1 ? baseId : `${baseId}_${nextCount}`;
    return {
      ...table,
      tableId: normalizedId,
    };
  });

  const sortedTables = normalizedTables.sort((a, b) => a.tableId.localeCompare(b.tableId));
  const baseToFrame = new Map<string, string>();
  for (const mapping of loopMappings) {
    for (const variable of mapping.variables ?? []) {
      if (variable?.baseName && variable.baseName.trim().length > 0) {
        baseToFrame.set(variable.baseName.trim(), mapping.stackedFrameName);
      }
    }
  }
  const tableToDataFrameRef: Record<string, string> = {};
  const countsByDataFrameRef: Record<string, number> = {};

  for (const table of sortedTables) {
    const dataFrameRef = resolveTableDataFrameRef(table, baseToFrame);
    tableToDataFrameRef[table.tableId] = dataFrameRef;
    countsByDataFrameRef[dataFrameRef] = (countsByDataFrameRef[dataFrameRef] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    totalTables: sortedTables.length,
    tableToDataFrameRef,
    countsByDataFrameRef,
  };
}

export function buildJobRoutingManifest(tableRouting: TableRoutingArtifact): JobRoutingManifest {
  const tableIds = Object.keys(tableRouting.tableToDataFrameRef).sort();
  const jobsByFrame = new Map<string, string[]>();
  const tableToJobId: Record<string, string> = {};

  for (const tableId of tableIds) {
    const dataFrameRef = tableRouting.tableToDataFrameRef[tableId];
    const existing = jobsByFrame.get(dataFrameRef) ?? [];
    existing.push(tableId);
    jobsByFrame.set(dataFrameRef, existing);
  }

  const orderedFrames = [...jobsByFrame.keys()].sort((a, b) => {
    const rankDiff = rankDataFrameRef(a) - rankDataFrameRef(b);
    return rankDiff !== 0 ? rankDiff : a.localeCompare(b);
  });

  const jobs = orderedFrames.map((dataFrameRef) => {
    const jobId = `${dataFrameRef}.job`;
    const tableIdsForFrame = [...(jobsByFrame.get(dataFrameRef) ?? [])].sort();
    for (const tableId of tableIdsForFrame) {
      tableToJobId[tableId] = jobId;
    }
    return {
      jobId,
      dataFrameRef,
      dataFileRelativePath: dataFrameRef === 'wide'
        ? EXPORT_ARTIFACT_PATHS.wideSav
        : `export/data/${dataFrameRef}.sav`,
      tableIds: tableIdsForFrame,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totalJobs: jobs.length,
    totalTables: tableIds.length,
    jobs,
    tableToJobId,
  };
}

export async function ensureWideSavFallback(outputDir: string, runtimeSavRelativePath: string = 'dataFile.sav'): Promise<boolean> {
  const widePath = path.join(outputDir, EXPORT_ARTIFACT_PATHS.wideSav);
  if (await fileExists(widePath)) {
    return false;
  }

  const runtimeSavPath = path.join(outputDir, runtimeSavRelativePath);
  if (!(await fileExists(runtimeSavPath))) {
    return false;
  }

  await fs.mkdir(path.dirname(widePath), { recursive: true });
  await fs.copyFile(runtimeSavPath, widePath);
  return true;
}

export async function persistPhase0Artifacts(params: PersistPhase0ArtifactsParams): Promise<{
  metadata: ExportPhase0Metadata;
  tableRouting: TableRoutingArtifact;
  jobRoutingManifest: JobRoutingManifest;
}> {
  const sortedFinalPath = await resolveFirstExistingRelativePath(
    params.outputDir,
    [REQUIRED_INPUT_ARTIFACTS.sortedFinal, ...FALLBACK_INPUT_ARTIFACTS.sortedFinal],
    REQUIRED_INPUT_ARTIFACTS.sortedFinal,
  );
  const crosstabRawPath = await resolveFirstExistingRelativePath(
    params.outputDir,
    [...FALLBACK_INPUT_ARTIFACTS.crosstabRaw],
    REQUIRED_INPUT_ARTIFACTS.crosstabRaw,
  );
  const resultsTablesPath = await resolveResultsTablesInputPath({
    outputDir: params.outputDir,
    weightVariable: params.weightVariable,
    hasDualWeightOutputs: params.hasDualWeightOutputs,
  });
  const loopSummaryPath = await resolveFirstExistingRelativePath(
    params.outputDir,
    [...FALLBACK_INPUT_ARTIFACTS.loopSummary],
    REQUIRED_INPUT_ARTIFACTS.loopSummary,
  );

  const loopPolicy = params.loopSemanticsPolicy ?? buildNoLoopSemanticsPolicy();
  const routingTables = await resolveRoutingTables(
    params.outputDir,
    sortedFinalPath,
    params.tablesWithLoopFrame,
  );
  const tableRouting = buildTableRoutingArtifact(routingTables, params.loopMappings);
  const jobRoutingManifest = buildJobRoutingManifest(tableRouting);
  const expectedDataFiles = buildExpectedDataFiles(params.loopMappings, tableRouting);
  const verboseDataMapInputPath = await resolveVerboseDataMapInputPath(params.outputDir);

  const synthesizedLoopSummary = await ensureLoopSummaryArtifact(params.outputDir, loopSummaryPath, params.loopMappings);

  for (const dataFileRef of expectedDataFiles) {
    dataFileRef.exists = await fileExists(path.join(params.outputDir, dataFileRef.relativePath));
  }

  const dataFileExistsByPath = new Map(
    expectedDataFiles.map((dataFileRef) => [dataFileRef.relativePath, dataFileRef.exists] as const),
  );
  const missingJobDataFiles = [...new Set(
    jobRoutingManifest.jobs
      .map((job) => job.dataFileRelativePath)
      .filter((relativePath) => !dataFileExistsByPath.get(relativePath)),
  )];

  const requiredInputPresence = {
    sortedFinal: await fileExists(path.join(params.outputDir, sortedFinalPath)),
    resultsTables: await fileExists(path.join(params.outputDir, resultsTablesPath)),
    crosstabRaw: await fileExists(path.join(params.outputDir, crosstabRawPath)),
    loopSummary: await fileExists(path.join(params.outputDir, loopSummaryPath)),
    loopPolicy: (
      params.loopMappings.length === 0
      || !!params.loopSemanticsPolicy
      || await fileExists(path.join(params.outputDir, REQUIRED_INPUT_ARTIFACTS.loopPolicy))
      || (FALLBACK_INPUT_ARTIFACTS.loopPolicy
        ? await fileExists(path.join(params.outputDir, FALLBACK_INPUT_ARTIFACTS.loopPolicy[0]))
        : false)
    ),
  };

  const metadata: ExportPhase0Metadata = {
    manifestVersion: EXPORT_ACTIVE_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    weighting: {
      weightVariable: params.weightVariable ?? null,
      mode: getWeightingMode(params.weightVariable, !!params.hasDualWeightOutputs),
    },
    sourceSavNames: {
      uploaded: params.sourceSavUploadedName,
      runtime: params.sourceSavRuntimeName ?? 'dataFile.sav',
    },
    availableDataFiles: expectedDataFiles,
    artifactPaths: {
      inputs: {
        sortedFinal: sortedFinalPath,
        resultsTables: resultsTablesPath,
        crosstabRaw: crosstabRawPath,
        loopSummary: loopSummaryPath,
        loopPolicy: REQUIRED_INPUT_ARTIFACTS.loopPolicy,
        ...(params.compiledLoopContract ? { compiledLoopContract: REQUIRED_INPUT_ARTIFACTS.compiledLoopContract } : {}),
        ...(verboseDataMapInputPath ? { verboseDataMap: verboseDataMapInputPath } : {}),
      },
      outputs: {
        metadata: EXPORT_ARTIFACT_PATHS.metadata,
        tableRouting: EXPORT_ARTIFACT_PATHS.tableRouting,
        jobRoutingManifest: EXPORT_ARTIFACT_PATHS.jobRoutingManifest,
        loopPolicy: EXPORT_ARTIFACT_PATHS.loopPolicy,
        ...(params.compiledLoopContract ? { compiledLoopContract: EXPORT_ARTIFACT_PATHS.compiledLoopContract } : {}),
        supportReport: EXPORT_ARTIFACT_PATHS.supportReport,
      },
    },
    convexRefs: {
      runId: params.convexRefs?.runId,
      projectId: params.convexRefs?.projectId,
      orgId: params.convexRefs?.orgId,
      pipelineId: params.convexRefs?.pipelineId,
    },
    r2Refs: {
      finalized: false,
      artifacts: {},
      dataFiles: {},
    },
    warnings: buildWarnings({
      loopMappings: params.loopMappings,
      loopSemanticsPolicy: params.loopSemanticsPolicy,
      requiredInputPresence,
      synthesizedLoopSummary,
      missingJobDataFiles,
    }),
  };

  // Canonical export contract location.
  await writeJsonFile(params.outputDir, EXPORT_ARTIFACT_PATHS.loopPolicy, loopPolicy);
  // Legacy/debug location retained for backward compatibility.
  await writeJsonFile(params.outputDir, REQUIRED_INPUT_ARTIFACTS.loopPolicy, loopPolicy);
  // Compiled loop contract (if available).
  if (params.compiledLoopContract) {
    await writeJsonFile(params.outputDir, EXPORT_ARTIFACT_PATHS.compiledLoopContract, params.compiledLoopContract);
    await writeJsonFile(params.outputDir, REQUIRED_INPUT_ARTIFACTS.compiledLoopContract, params.compiledLoopContract);
  }
  await writeJsonFile(params.outputDir, EXPORT_ARTIFACT_PATHS.tableRouting, tableRouting);
  await writeJsonFile(params.outputDir, EXPORT_ARTIFACT_PATHS.jobRoutingManifest, jobRoutingManifest);
  await writeJsonFile(params.outputDir, EXPORT_ARTIFACT_PATHS.metadata, metadata);

  return { metadata, tableRouting, jobRoutingManifest };
}

export async function finalizeExportMetadataWithR2Refs(
  outputDir: string,
  r2Outputs: Record<string, string>,
): Promise<ExportPhase0Metadata> {
  const metadata = await readJsonFile<ExportPhase0Metadata>(outputDir, EXPORT_ARTIFACT_PATHS.metadata);
  const artifactPaths = [...new Set([
    ...Object.values(metadata.artifactPaths.outputs).filter((value): value is string => typeof value === 'string' && value.length > 0),
    ...(metadata.manifestVersion === EXPORT_ACTIVE_MANIFEST_VERSION ? [EXPORT_ARTIFACT_PATHS.supportReport] : []),
  ])];
  const artifactRefs: Record<string, string> = {};
  const dataFileRefs: Record<string, string> = {};

  for (const artifactPath of artifactPaths) {
    const artifactKey = r2Outputs[artifactPath];
    if (artifactKey) {
      artifactRefs[artifactPath] = artifactKey;
    }
  }

  for (const [relativePath, key] of Object.entries(r2Outputs)) {
    if (relativePath.startsWith('export/data/')) {
      dataFileRefs[relativePath] = key;
    }
  }

  const metadataArtifactPath = metadata.artifactPaths.outputs.metadata;
  const requiredArtifactRefsComplete = artifactPaths.every((artifactPath) => !!artifactRefs[artifactPath]);
  const metadataArtifactRefExists = !!artifactRefs[metadataArtifactPath];
  const requiredDataFilePaths = new Set<string>([EXPORT_ARTIFACT_PATHS.wideSav]);
  try {
    const jobManifest = await readJsonFile<JobRoutingManifest>(outputDir, EXPORT_ARTIFACT_PATHS.jobRoutingManifest);
    for (const job of jobManifest.jobs) {
      requiredDataFilePaths.add(job.dataFileRelativePath);
    }
  } catch {
    for (const dataFileRef of metadata.availableDataFiles) {
      if (dataFileRef.exists) {
        requiredDataFilePaths.add(dataFileRef.relativePath);
      }
    }
  }

  const missingRequiredLocalDataFiles: string[] = [];
  for (const relativePath of requiredDataFilePaths) {
    if (!(await fileExists(path.join(outputDir, relativePath)))) {
      missingRequiredLocalDataFiles.push(relativePath);
    }
  }
  const missingRequiredR2DataFileRefs = [...requiredDataFilePaths]
    .filter((relativePath) => !dataFileRefs[relativePath]);
  const finalizationComplete = (
    metadataArtifactRefExists
    && requiredArtifactRefsComplete
    && missingRequiredLocalDataFiles.length === 0
    && missingRequiredR2DataFileRefs.length === 0
  );
  const missingArtifactRefs = artifactPaths.filter((artifactPath) => !artifactRefs[artifactPath]);
  const warnings = [...metadata.warnings];

  if (!metadataArtifactRefExists) {
    warnings.push('R2 finalization incomplete: export metadata artifact key was not uploaded.');
  }
  if (missingArtifactRefs.length > 0) {
    warnings.push(`R2 finalization missing artifact refs: ${missingArtifactRefs.join(', ')}`);
  }
  if (missingRequiredLocalDataFiles.length > 0) {
    warnings.push(`R2 finalization blocked by missing local data files: ${missingRequiredLocalDataFiles.join(', ')}`);
  }
  if (missingRequiredR2DataFileRefs.length > 0) {
    warnings.push(`R2 finalization missing required data file refs: ${missingRequiredR2DataFileRefs.join(', ')}`);
  }

  const dedupedWarnings = [...new Set(warnings)];

  const finalized: ExportPhase0Metadata = {
    ...metadata,
    generatedAt: new Date().toISOString(),
    availableDataFiles: metadata.availableDataFiles.map((dataFile) => ({
      ...dataFile,
      ...(dataFileRefs[dataFile.relativePath] ? { r2Key: dataFileRefs[dataFile.relativePath] } : {}),
    })),
    r2Refs: {
      finalized: finalizationComplete,
      artifacts: artifactRefs,
      dataFiles: dataFileRefs,
    },
    warnings: dedupedWarnings,
  };

  await writeJsonFile(outputDir, EXPORT_ARTIFACT_PATHS.metadata, finalized);
  return finalized;
}

export function buildExportArtifactRefs(metadata: ExportPhase0Metadata): ExportArtifactRefs {
  return {
    manifestVersion: metadata.manifestVersion,
    metadataPath: metadata.artifactPaths.outputs.metadata,
    tableRoutingPath: metadata.artifactPaths.outputs.tableRouting,
    jobRoutingManifestPath: metadata.artifactPaths.outputs.jobRoutingManifest,
    loopPolicyPath: metadata.artifactPaths.outputs.loopPolicy,
    supportReportPath: metadata.artifactPaths.outputs.supportReport,
    dataFiles: metadata.availableDataFiles,
    r2Refs: metadata.r2Refs,
    readiness: metadata.readiness,
  };
}

async function resolveFirstExistingRelativePath(
  outputDir: string,
  candidates: string[],
  fallback: string,
): Promise<string> {
  for (const candidate of candidates) {
    if (await fileExists(path.join(outputDir, candidate))) {
      return candidate;
    }
  }
  return fallback;
}
