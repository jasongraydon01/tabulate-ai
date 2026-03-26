import { promises as fs } from "fs";
import * as path from "path";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { api } from "../../../convex/_generated/api";
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  evaluateRunArtifacts,
  readJsonFileOrNull,
  type RunEvaluationResult,
  type EvaluationArtifacts,
  type RunDiagnosticsInput,
  type DivergenceLevel,
  type QualityGrade,
} from "@/lib/evaluation/RunEvaluator";

interface BaselineArtifacts {
  datasetKey: string;
  version?: number;
  source: "convex" | "local";
  baselineId?: Id<"goldenBaselines">;
  paths: {
    banner: string;
    crosstab: string;
    verification: string;
    data: string;
  };
}

interface RunQualitySnapshot {
  score: number;
  grade: QualityGrade;
  divergenceLevel: DivergenceLevel;
  evaluatedAt: string;
  baselineVersion?: number;
  datasetKey: string;
  evaluationId?: Id<"runEvaluations">;
}

export interface EvaluateAndPersistRunQualityParams {
  runId: string;
  outputDir: string;
  orgId?: string;
  projectId?: string;
  datasetKeyHint?: string;
}

export interface EvaluateAndPersistRunQualityResult {
  evaluated: boolean;
  reason?: "missing_artifacts" | "missing_baseline" | "missing_project_scope" | "evaluation_failed";
  quality?: RunQualitySnapshot;
  evaluation?: RunEvaluationResult;
  baseline?: {
    datasetKey: string;
    version?: number;
    source: "convex" | "local";
  };
}

function sanitizeDatasetKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function deriveDatasetKeyCandidates(outputDir: string, datasetKeyHint?: string): string[] {
  const outputDataset = path.basename(path.dirname(outputDir));
  const candidates = [
    datasetKeyHint ?? "",
    outputDataset,
    sanitizeDatasetKey(outputDataset),
    outputDataset.replace(/^data-/, ""),
    outputDataset.replace(/-data$/, ""),
    sanitizeDatasetKey(outputDataset.replace(/^data-/, "")),
    sanitizeDatasetKey(outputDataset.replace(/-data$/, "")),
  ];
  return uniqueStrings(candidates.filter(Boolean).map((value) => sanitizeDatasetKey(value)));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDatasetDirFromKey(datasetKey: string): Promise<string | null> {
  const direct = path.join(process.cwd(), "data", datasetKey);
  if (await fileExists(direct)) return direct;

  const dataRoot = path.join(process.cwd(), "data");
  try {
    const entries = await fs.readdir(dataRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (sanitizeDatasetKey(entry.name) === datasetKey) {
        return path.join(dataRoot, entry.name);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resolveExpectedArtifactPaths(baseDir: string): BaselineArtifacts["paths"] {
  return {
    banner: path.join(baseDir, "banner-expected.json"),
    crosstab: path.join(baseDir, "crosstab-expected.json"),
    verification: path.join(baseDir, "verification-expected.json"),
    data: path.join(baseDir, "data-expected.json"),
  };
}

async function hasAllExpectedArtifacts(paths: BaselineArtifacts["paths"]): Promise<boolean> {
  const checks = await Promise.all([
    fileExists(paths.banner),
    fileExists(paths.crosstab),
    fileExists(paths.verification),
    fileExists(paths.data),
  ]);
  return checks.every(Boolean);
}

async function resolveVersionedBaselineDir(goldenRoot: string): Promise<{ dir: string; version?: number } | null> {
  const versionedDirs = (await fs.readdir(goldenRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^v\d+$/i.test(entry.name))
    .map((entry) => ({
      version: Number(entry.name.slice(1)),
      dir: path.join(goldenRoot, entry.name),
    }))
    .filter((entry) => Number.isFinite(entry.version))
    .sort((a, b) => b.version - a.version);

  if (versionedDirs.length > 0) {
    return { dir: versionedDirs[0].dir, version: versionedDirs[0].version };
  }
  return { dir: goldenRoot };
}

function resolveArtifactPathFromKey(key: string): string {
  return path.isAbsolute(key) ? key : path.join(process.cwd(), key);
}

async function resolveBaselineFromConvex(orgId: string, datasetKeys: string[]): Promise<BaselineArtifacts | null> {
  if (datasetKeys.length === 0) return null;
  const convex = getConvexClient();
  const baseline = await convex.query(api.goldenBaselines.getActiveForDataset, {
    orgId: orgId as Id<"organizations">,
    datasetKeys,
  });
  if (!baseline) return null;

  const paths = {
    banner: resolveArtifactPathFromKey(baseline.artifactKeys.banner),
    crosstab: resolveArtifactPathFromKey(baseline.artifactKeys.crosstab),
    verification: resolveArtifactPathFromKey(baseline.artifactKeys.verification),
    data: resolveArtifactPathFromKey(baseline.artifactKeys.data),
  };
  if (!(await hasAllExpectedArtifacts(paths))) return null;

  return {
    datasetKey: baseline.datasetKey,
    version: baseline.version,
    source: "convex",
    baselineId: baseline._id,
    paths,
  };
}

async function resolveBaselineFromLocal(datasetKeys: string[]): Promise<BaselineArtifacts | null> {
  for (const datasetKey of datasetKeys) {
    const datasetDir = await resolveDatasetDirFromKey(datasetKey);
    if (!datasetDir) continue;

    const goldenRoot = path.join(datasetDir, "golden-datasets");
    if (!(await fileExists(goldenRoot))) continue;

    let versionDir: { dir: string; version?: number } | null = null;
    try {
      versionDir = await resolveVersionedBaselineDir(goldenRoot);
    } catch {
      versionDir = null;
    }
    if (!versionDir) continue;

    const paths = resolveExpectedArtifactPaths(versionDir.dir);
    if (!(await hasAllExpectedArtifacts(paths))) continue;

    return {
      datasetKey,
      version: versionDir.version,
      source: "local",
      paths,
    };
  }

  return null;
}

async function readRunDiagnostics(outputDir: string): Promise<RunDiagnosticsInput | undefined> {
  const summaryPath = path.join(outputDir, "pipeline-summary.json");
  const summary = await readJsonFileOrNull(summaryPath);
  if (!summary) return undefined;
  const runDiagnostics = (summary as { runDiagnostics?: RunDiagnosticsInput }).runDiagnostics;
  if (!runDiagnostics) return undefined;
  return {
    warnings: runDiagnostics.warnings ?? [],
    baseTextHallucinationCount: runDiagnostics.baseTextHallucinationCount ?? 0,
    unresolvedPlaceholderCount: runDiagnostics.unresolvedPlaceholderCount ?? 0,
    formatNormalizationAdjustments: runDiagnostics.formatNormalizationAdjustments ?? 0,
    splitCapViolations: runDiagnostics.splitCapViolations ?? 0,
  };
}

async function loadActualArtifacts(outputDir: string): Promise<EvaluationArtifacts | null> {
  const paths = {
    banner: path.join(outputDir, "banner", "banner-output-raw.json"),
    crosstab: path.join(outputDir, "crosstab", "crosstab-output-raw.json"),
    verification: path.join(outputDir, "verification", "verification-output-raw.json"),
    data: path.join(outputDir, "results", "data-streamlined.json"),
  };

  const exists = await Promise.all([
    fileExists(paths.banner),
    fileExists(paths.crosstab),
    fileExists(paths.verification),
    fileExists(paths.data),
  ]);
  if (!exists.every(Boolean)) return null;

  const [banner, crosstab, verification, data] = await Promise.all([
    readJsonFileOrNull(paths.banner),
    readJsonFileOrNull(paths.crosstab),
    readJsonFileOrNull(paths.verification),
    readJsonFileOrNull(paths.data),
  ]);

  if (!banner || !crosstab || !verification || !data) return null;
  return { banner, crosstab, verification, data };
}

async function loadExpectedArtifacts(paths: BaselineArtifacts["paths"]): Promise<EvaluationArtifacts | null> {
  const [banner, crosstab, verification, data] = await Promise.all([
    readJsonFileOrNull(paths.banner),
    readJsonFileOrNull(paths.crosstab),
    readJsonFileOrNull(paths.verification),
    readJsonFileOrNull(paths.data),
  ]);
  if (!banner || !crosstab || !verification || !data) return null;
  return { banner, crosstab, verification, data };
}

export async function evaluateAndPersistRunQuality(
  params: EvaluateAndPersistRunQualityParams
): Promise<EvaluateAndPersistRunQualityResult> {
  const datasetCandidates = deriveDatasetKeyCandidates(params.outputDir, params.datasetKeyHint);
  const actualArtifacts = await loadActualArtifacts(params.outputDir);
  if (!actualArtifacts) {
    return { evaluated: false, reason: "missing_artifacts" };
  }

  let baseline: BaselineArtifacts | null = null;
  try {
    if (params.orgId) {
      baseline = await resolveBaselineFromConvex(params.orgId, datasetCandidates);
    }
  } catch (err) {
    console.warn("[runEvaluationService] Convex baseline lookup failed:", err);
  }

  if (!baseline) {
    baseline = await resolveBaselineFromLocal(datasetCandidates);
  }
  if (!baseline) {
    return { evaluated: false, reason: "missing_baseline" };
  }

  const expectedArtifacts = await loadExpectedArtifacts(baseline.paths);
  if (!expectedArtifacts) {
    return { evaluated: false, reason: "missing_baseline" };
  }

  try {
    const runDiagnostics = await readRunDiagnostics(params.outputDir);
    const evaluation = evaluateRunArtifacts({
      expected: expectedArtifacts,
      actual: actualArtifacts,
      runDiagnostics,
    });

    const evaluatedAt = new Date().toISOString();
    let evaluationId: Id<"runEvaluations"> | undefined;

    if (params.orgId && params.projectId) {
      evaluationId = await mutateInternal(internal.runEvaluations.upsertForRun, {
        orgId: params.orgId as Id<"organizations">,
        projectId: params.projectId as Id<"projects">,
        runId: params.runId as Id<"runs">,
        datasetKey: baseline.datasetKey,
        ...(baseline.baselineId ? { baselineId: baseline.baselineId } : {}),
        ...(baseline.version !== undefined ? { baselineVersion: baseline.version } : {}),
        score: evaluation.score,
        grade: evaluation.grade,
        divergenceLevel: evaluation.divergenceLevel,
        summary: evaluation.summary,
        breakdown: evaluation.breakdown,
        diffCounts: evaluation.diffCounts,
        topDiffs: evaluation.topDiffs.map((diff) => ({
          category: diff.category,
          severity: diff.severity,
          kind: diff.kind,
          message: diff.message,
          ...(diff.tableId ? { tableId: diff.tableId } : {}),
          ...(diff.groupName ? { groupName: diff.groupName } : {}),
          ...(diff.columnName ? { columnName: diff.columnName } : {}),
          ...(diff.cut ? { cut: diff.cut } : {}),
          ...(diff.rowKey ? { rowKey: diff.rowKey } : {}),
          ...(diff.field ? { field: diff.field } : {}),
          ...(diff.expected !== undefined ? { expected: diff.expected } : {}),
          ...(diff.actual !== undefined ? { actual: diff.actual } : {}),
        })),
      });

      await mutateInternal(internal.runs.setQualitySummary, {
        runId: params.runId as Id<"runs">,
        quality: {
          score: evaluation.score,
          grade: evaluation.grade,
          divergenceLevel: evaluation.divergenceLevel,
          evaluatedAt,
          ...(baseline.version !== undefined ? { baselineVersion: baseline.version } : {}),
          datasetKey: baseline.datasetKey,
          ...(evaluationId ? { evaluationId } : {}),
        },
      });
    }

    const quality: RunQualitySnapshot = {
      score: evaluation.score,
      grade: evaluation.grade,
      divergenceLevel: evaluation.divergenceLevel,
      evaluatedAt,
      ...(baseline.version !== undefined ? { baselineVersion: baseline.version } : {}),
      datasetKey: baseline.datasetKey,
      ...(evaluationId ? { evaluationId } : {}),
    };

    return {
      evaluated: true,
      quality,
      evaluation,
      baseline: {
        datasetKey: baseline.datasetKey,
        version: baseline.version,
        source: baseline.source,
      },
    };
  } catch (err) {
    console.error("[runEvaluationService] Evaluation failed:", err);
    return {
      evaluated: false,
      reason: params.orgId && params.projectId ? "evaluation_failed" : "missing_project_scope",
    };
  }
}
