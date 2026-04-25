import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  ExportManifestMetadataSchema,
  ExportSupportReportSchema,
  JobRoutingManifestSchema,
  TableRoutingArtifactSchema,
  WinCrossExportManifestSchema,
  type ExportManifestMetadata,
  type WinCrossExportManifest,
} from '@/lib/exportData/types';
import {
  CrosstabRawArtifactSchema,
  LoopSummaryArtifactSchema,
  ResultsTablesFinalContractSchema,
  SortedFinalArtifactSchema,
} from '@/lib/exportData/inputArtifactSchemas';
import { LoopSemanticsPolicySchema } from '@/schemas/loopSemanticsPolicySchema';
import { buildQExportManifest } from '@/lib/exportData/q/manifestBuilder';
import { emitQScript } from '@/lib/exportData/q/qscriptEmitter';
import {
  Q_EXPORTER_VERSION,
  Q_EXPORT_MANIFEST_VERSION,
  Q_EXPORT_RUNTIME_CONTRACT,
  type QExportResolvedArtifacts,
} from '@/lib/exportData/q/types';
import { resolveWinCrossPreference } from '@/lib/exportData/wincross/preferenceResolver';
import {
  serializeWinCrossJob,
  type WinCrossQuestionTitleHint,
} from '@/lib/exportData/wincross/serializer';
import {
  WINCROSS_EXPORTER_VERSION,
  WINCROSS_EXPORT_MANIFEST_VERSION,
  WINCROSS_SERIALIZER_CONTRACT_VERSION,
  type WinCrossResolvedArtifacts,
} from '@/lib/exportData/wincross/types';
import { buildBlockedItemsFromTableStatuses } from '@/lib/exportData/wincross/contract';

export interface LocalExportGenerationResult {
  q: { success: boolean; scriptPath?: string; error?: string };
  wincross: { success: boolean; jobPath?: string; manifestPath?: string; error?: string };
  errors: Array<{ format: 'q' | 'wincross'; stage: 'readiness' | 'serialize'; message: string; retryable: boolean; timestamp: string }>;
}

export async function generateLocalQAndWinCrossExports(outputDir: string): Promise<LocalExportGenerationResult> {
  const result: LocalExportGenerationResult = {
    q: { success: false },
    wincross: { success: false },
    errors: [],
  };

  const metadata = await readLocalExportMetadata(outputDir);
  const readinessBlocked = applyLocalReadinessGate(metadata, result);
  if (readinessBlocked) {
    return result;
  }

  const resolved = await resolveLocalArtifacts(outputDir);

  try {
    const packageId = buildQPackageId(
      resolved.q.metadata.idempotency?.integrityDigest ?? '',
      Q_EXPORT_RUNTIME_CONTRACT.contractVersion,
      Q_EXPORT_RUNTIME_CONTRACT.helperRuntimeHash,
    );
    const qManifest = buildQExportManifest({
      packageId,
      exporterVersion: Q_EXPORTER_VERSION,
      artifacts: resolved.q,
    });
    const qScript = emitQScript(qManifest);
    const scriptPath = path.join(outputDir, 'results', 'crosstabs.qscript');
    const manifestPath = path.join(outputDir, 'export', 'q-export-manifest.local.json');
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(scriptPath, qScript, 'utf8');
    await fs.writeFile(manifestPath, JSON.stringify(qManifest, null, 2), 'utf8');
    result.q = { success: true, scriptPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.q = { success: false, error: message };
    result.errors.push({
      format: 'q',
      stage: 'serialize',
      message,
      retryable: true,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const resolvedPref = resolveWinCrossPreference({ kind: 'default' });
    const questionTitleHintsById = await loadOptionalWinCrossQuestionTitleHints(outputDir);
    const serialized = serializeWinCrossJob(resolved.wincross, resolvedPref.profile, {
      tableRouting: resolved.wincross.tableRouting,
      jobRouting: resolved.wincross.jobRoutingManifest,
      questionTitleHintsById,
    });
    const blockedItems = buildBlockedItemsFromTableStatuses(serialized.tableStatuses);
    const manifest: WinCrossExportManifest = WinCrossExportManifestSchema.parse({
      manifestVersion: WINCROSS_EXPORT_MANIFEST_VERSION,
      exporterVersion: WINCROSS_EXPORTER_VERSION,
      generatedAt: new Date().toISOString(),
      packageId: buildWinCrossPackageId(
        resolved.wincross.metadata.idempotency?.integrityDigest ?? '',
        resolvedPref.profileDigest,
      ),
      sourceManifestVersion: resolved.wincross.metadata.manifestVersion,
      integrityDigest: resolved.wincross.metadata.idempotency?.integrityDigest ?? '',
      tableCount: serialized.tableCount,
      useCount: serialized.useCount,
      afCount: serialized.afCount,
      blockedCount: serialized.blockedCount,
      profileSource: 'default',
      profileDigest: resolvedPref.profileDigest,
      serializerContractVersion: WINCROSS_SERIALIZER_CONTRACT_VERSION,
      blockedItems,
      warnings: serialized.warnings,
      supportSummary: resolved.wincross.supportReport.summary.wincross,
    });

    const jobPath = path.join(outputDir, 'results', 'crosstabs.job');
    const manifestPath = path.join(outputDir, 'export', 'wincross-export-manifest.local.json');
    await writeLocalWinCrossArtifacts(jobPath, manifestPath, serialized.content, manifest);
    result.wincross = { success: true, jobPath, manifestPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.wincross = { success: false, error: message };
    result.errors.push({
      format: 'wincross',
      stage: 'serialize',
      message,
      retryable: true,
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}

async function resolveLocalArtifacts(outputDir: string): Promise<{
  q: QExportResolvedArtifacts;
  wincross: WinCrossResolvedArtifacts;
}> {
  const metadata = await readLocalExportMetadata(outputDir);

  const tableRouting = TableRoutingArtifactSchema.parse(
    await readJson(path.join(outputDir, metadata.artifactPaths.outputs.tableRouting)),
  );
  const jobRoutingManifest = JobRoutingManifestSchema.parse(
    await readJson(path.join(outputDir, metadata.artifactPaths.outputs.jobRoutingManifest)),
  );
  const supportReport = ExportSupportReportSchema.parse(
    await readJson(path.join(outputDir, metadata.artifactPaths.outputs.supportReport ?? 'export/support-report.json')),
  );
  const sortedFinal = SortedFinalArtifactSchema.parse(
    await readJson(path.join(outputDir, metadata.artifactPaths.inputs.sortedFinal)),
  );
  const resultsTables = ResultsTablesFinalContractSchema.parse(
    await readJson(path.join(outputDir, metadata.artifactPaths.inputs.resultsTables)),
  );
  const crosstabRaw = CrosstabRawArtifactSchema.parse(
    await readJson(path.join(outputDir, metadata.artifactPaths.inputs.crosstabRaw)),
  );
  const loopSummary = LoopSummaryArtifactSchema.parse(
    await readJson(path.join(outputDir, metadata.artifactPaths.inputs.loopSummary)),
  );
  const loopPolicyValue = await readJson(path.join(outputDir, metadata.artifactPaths.outputs.loopPolicy));
  const loopPolicy = LoopSemanticsPolicySchema.safeParse(loopPolicyValue);

  let verboseDataMap: unknown[] | null = null;
  const verbosePath = metadata.artifactPaths.inputs.verboseDataMap
    ? path.join(outputDir, metadata.artifactPaths.inputs.verboseDataMap)
    : null;
  if (verbosePath) {
    try {
      const verboseValue = await readJson(verbosePath);
      if (Array.isArray(verboseValue)) verboseDataMap = verboseValue;
    } catch {
      // Non-fatal.
    }
  }

  const resolvedBase = {
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

  return {
    q: { ...resolvedBase, verboseDataMap },
    wincross: resolvedBase,
  };
}

async function readLocalExportMetadata(outputDir: string): Promise<ExportManifestMetadata> {
  return ExportManifestMetadataSchema.parse(
    await readJson(path.join(outputDir, 'export', 'export-metadata.json')),
  );
}

function applyLocalReadinessGate(
  metadata: ExportManifestMetadata,
  result: LocalExportGenerationResult,
): boolean {
  const readiness = metadata.readiness?.local;
  if (readiness?.ready === true) {
    return false;
  }

  const reasonCodes = readiness?.reasonCodes ?? ['readiness_missing'];
  const details = readiness?.details ?? ['Local export readiness metadata is missing.'];
  const message = `Local export blocked: ${[...reasonCodes, ...details].join(' | ')}`;
  const timestamp = new Date().toISOString();

  result.q = { success: false, error: message };
  result.wincross = { success: false, error: message };
  result.errors.push({
    format: 'q',
    stage: 'readiness',
    message,
    retryable: true,
    timestamp,
  });
  result.errors.push({
    format: 'wincross',
    stage: 'readiness',
    message,
    retryable: true,
    timestamp,
  });

  return true;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
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

export async function writeLocalWinCrossArtifacts(
  jobPath: string,
  manifestPath: string,
  jobContent: Buffer,
  manifest: WinCrossExportManifest,
): Promise<void> {
  await fs.mkdir(path.dirname(jobPath), { recursive: true });
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(jobPath, jobContent);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function buildQPackageId(integrityDigest: string, runtimeContractVersion: string, helperRuntimeHash: string): string {
  const payload = stableJson({
    integrityDigest,
    exporterVersion: Q_EXPORTER_VERSION,
    manifestVersion: Q_EXPORT_MANIFEST_VERSION,
    runtimeContractVersion,
    helperRuntimeHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function buildWinCrossPackageId(
  integrityDigest: string,
  profileDigest: string,
): string {
  const payload = stableJson({
    integrityDigest,
    exporterVersion: WINCROSS_EXPORTER_VERSION,
    manifestVersion: WINCROSS_EXPORT_MANIFEST_VERSION,
    serializerContractVersion: WINCROSS_SERIALIZER_CONTRACT_VERSION,
    profileDigest,
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
