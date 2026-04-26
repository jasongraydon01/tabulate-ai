import fs from 'fs/promises';
import path from 'path';

import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { mutateInternal } from '@/lib/convex';
import { startHeartbeatInterval } from '@/lib/api/heartbeat';
import { downloadToTemp, uploadPipelineOutputs } from '@/lib/r2/R2FileManager';
import { canonicalToComputeTables } from '@/lib/v3/runtime/compute/canonicalToComputeTables';
import { runComputePipeline } from '@/lib/v3/runtime/compute/runComputePipeline';
import { assessPostV3Processing, runPostV3Processing } from '@/lib/v3/runtime/postV3Processing';
import { createPipelineCheckpoint } from '@/lib/v3/runtime/contracts';
import { assertAnalysisRunNotCancelled, isAnalysisComputeAbortError } from '@/lib/analysis/computeLane/cancellation';
import { buildExtendedPlanningArtifacts } from '@/lib/analysis/computeLane/mergePlanningArtifacts';
import type { AnalysisBannerExtensionPayload } from '@/lib/analysis/computeLane/types';
import type { ProjectConfig } from '@/schemas/projectConfigSchema';
import type { RunResultShape } from '@/schemas/runResultSchema';
import type { CanonicalTableOutput } from '@/lib/v3/runtime/canonical/types';
import type { QuestionIdEntry } from '@/lib/v3/runtime/questionId/types';
import { deriveLoopMappings } from '@/lib/v3/runtime/loopMappingsFromQuestionId';
import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import { resolveStatConfig } from '@/lib/v3/runtime/compute/resolveStatConfig';
import { runLoopSemanticsPolicyAgent, buildEnrichedLoopSummary } from '@/agents/LoopSemanticsPolicyAgent';
import { buildLoopSemanticsExcerpt } from '@/lib/questionContext';
import {
  LoopSemanticsPolicySchema,
  type LoopSemanticsPolicy,
} from '@/schemas/loopSemanticsPolicySchema';
import { compileLoopContract } from '@/lib/v3/runtime/compileLoopContract';
import type { WorkerPipelineContext } from '@/lib/worker/recovery';
import { runWithPipelineContext } from '@/lib/pipeline/PipelineContext';

const QUESTION_ID_FINAL_PATH = 'enrichment/12-questionid-final.json';
const TABLE_ENRICHED_PATH = 'tables/13e-table-enriched.json';
const TABLE_CANONICAL_PATH = 'tables/13d-table-canonical.json';
const DATA_FILE_PATH = 'dataFile.sav';
const PARENT_LOOP_POLICY_PATH = 'agents/loop-semantics/loop-semantics-policy.json';
const BANNER_PLAN_PATH = 'planning/20-banner-plan.json';
const CROSSTAB_PLAN_PATH = 'planning/21-crosstab-plan.json';

type RunStatus = 'in_progress' | 'resuming' | 'success' | 'partial' | 'error' | 'cancelled';

async function updateRunStatus(runId: string, updates: {
  status: RunStatus;
  stage?: string;
  progress?: number;
  message?: string;
  result?: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  await mutateInternal(internal.runs.updateStatus, {
    runId: runId as Id<'runs'>,
    status: updates.status as never,
    ...(updates.stage ? { stage: updates.stage as never } : {}),
    ...(updates.progress !== undefined ? { progress: updates.progress } : {}),
    ...(updates.message !== undefined ? { message: updates.message } : {}),
    ...(updates.result !== undefined ? { result: updates.result } : {}),
    ...(updates.error !== undefined ? { error: updates.error } : {}),
  });
}

async function appendAnalysisSessionMessage(params: {
  orgId: string;
  sessionId: string;
  content: string;
}): Promise<void> {
  await mutateInternal(internal.analysisMessages.create, {
    sessionId: params.sessionId as Id<'analysisSessions'>,
    orgId: params.orgId as Id<'organizations'>,
    role: 'assistant',
    content: params.content,
    parts: [{ type: 'text', text: params.content }],
  });
}

async function downloadRequiredArtifact(params: {
  outputs: Record<string, string>;
  relativePath: string;
  outputDir: string;
}): Promise<void> {
  const key = params.outputs[params.relativePath];
  if (!key) throw new Error(`Parent run is missing required artifact: ${params.relativePath}`);
  await downloadToTemp(key, path.join(params.outputDir, params.relativePath));
}

async function downloadOptionalArtifact(params: {
  outputs: Record<string, string>;
  relativePath: string;
  outputDir: string;
}): Promise<boolean> {
  const key = params.outputs[params.relativePath];
  if (!key) return false;
  await downloadToTemp(key, path.join(params.outputDir, params.relativePath));
  return true;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function unwrapQuestionIdEntries(raw: unknown): QuestionIdEntry[] {
  if (Array.isArray(raw)) return raw as QuestionIdEntry[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { questionIds?: unknown }).questionIds)) {
    return (raw as { questionIds: QuestionIdEntry[] }).questionIds;
  }
  throw new Error('Parent question-id artifact has invalid shape.');
}

function buildKnownColumnSet(entries: QuestionIdEntry[]): Set<string> {
  const knownColumns = new Set<string>();
  for (const entry of entries) {
    for (const item of entry.items ?? []) {
      if (item.column) knownColumns.add(item.column);
    }
  }
  return knownColumns;
}

async function resolveLoopSemanticsForExtension(params: {
  outputDir: string;
  entries: QuestionIdEntry[];
  extendedCrosstabPlan: import('@/schemas/agentOutputSchema').ValidationResultType;
  extension: AnalysisBannerExtensionPayload;
  abortSignal?: AbortSignal;
}): Promise<{
  loopMappings?: import('@/lib/validation/LoopCollapser').LoopGroupMapping[];
  loopSemanticsPolicy?: LoopSemanticsPolicy;
  compiledLoopContract?: import('@/schemas/compiledLoopContractSchema').CompiledLoopContract;
}> {
  const loopDerivation = deriveLoopMappings(params.entries);
  if (!loopDerivation.hasLoops) return {};

  const parentPolicyPath = path.join(params.outputDir, PARENT_LOOP_POLICY_PATH);
  let parentPolicy: LoopSemanticsPolicy;
  try {
    parentPolicy = LoopSemanticsPolicySchema.parse(await readJson<unknown>(parentPolicyPath));
  } catch {
    throw new Error(
      'Parent run has looped data but no loop semantics policy artifact. Analysis banner extension is blocked for this run.',
    );
  }

  const appendedPlan = { bannerCuts: [params.extension.frozenValidatedGroup] };
  const appendedCutsSpec = buildCutsSpec(appendedPlan);
  const appendedPolicy = await runLoopSemanticsPolicyAgent({
    loopSummary: buildEnrichedLoopSummary(loopDerivation.loopMappings, params.entries),
    bannerGroups: appendedCutsSpec.groups.map((group) => ({
      groupName: group.groupName,
      columns: group.cuts.map((cut) => ({ name: cut.name, original: cut.name })),
    })),
    cuts: appendedCutsSpec.cuts.map((cut) => ({
      name: cut.name,
      groupName: cut.groupName,
      rExpression: cut.rExpression,
    })),
    datamapExcerpt: buildLoopSemanticsExcerpt(params.entries, appendedCutsSpec.cuts),
    loopMappings: loopDerivation.loopMappings,
    outputDir: params.outputDir,
    abortSignal: params.abortSignal,
  });

  const loopSemanticsPolicy: LoopSemanticsPolicy = {
    ...parentPolicy,
    bannerGroups: [
      ...parentPolicy.bannerGroups,
      ...appendedPolicy.bannerGroups,
    ],
    warnings: [
      ...parentPolicy.warnings,
      ...appendedPolicy.warnings,
    ],
    reasoning: `${parentPolicy.reasoning}\n\nAnalysis extension appended group: ${appendedPolicy.reasoning}`,
    fallbackApplied: parentPolicy.fallbackApplied || appendedPolicy.fallbackApplied,
    fallbackReason: [parentPolicy.fallbackReason, appendedPolicy.fallbackReason].filter(Boolean).join('; '),
  };

  await writeJson(parentPolicyPath, loopSemanticsPolicy);

  const fullCutsSpec = buildCutsSpec(params.extendedCrosstabPlan);
  const compiledLoopContract = compileLoopContract({
    policy: loopSemanticsPolicy,
    cuts: fullCutsSpec.cuts.map((cut) => ({
      name: cut.name,
      groupName: cut.groupName,
      rExpression: cut.rExpression,
    })),
    loopMappings: loopDerivation.loopMappings,
    knownColumns: buildKnownColumnSet(params.entries),
  });

  await writeJson(
    path.join(params.outputDir, 'agents', 'loop-semantics', 'compiled-loop-contract.json'),
    compiledLoopContract,
  );

  return {
    loopMappings: loopDerivation.loopMappings,
    loopSemanticsPolicy,
    compiledLoopContract,
  };
}

export async function runAnalysisBannerExtensionRun(params: {
  runId: string;
  orgId: string;
  projectId: string;
  launchedBy?: string;
  sessionId: string;
  workerId: string;
  pipelineContext: WorkerPipelineContext;
  config: ProjectConfig;
  extension: AnalysisBannerExtensionPayload;
  loopStatTestingMode?: 'suppress' | 'complement';
  abortSignal?: AbortSignal;
}): Promise<void> {
  const outputDir = params.pipelineContext.outputDir;
  const pipelineId = params.pipelineContext.pipelineId;
  const datasetName = params.pipelineContext.datasetName;

  return runWithPipelineContext(
    {
      pipelineId,
      runId: params.runId,
      sessionId: params.sessionId,
      source: 'analysisExtension',
    },
    async () => {
  const stopHeartbeat = startHeartbeatInterval(params.runId, 30_000, params.workerId);

  try {
    const assertNotCancelled = async () => {
      await assertAnalysisRunNotCancelled({
        runId: params.runId,
        orgId: params.orgId,
        abortSignal: params.abortSignal,
      });
    };

    await assertNotCancelled();
    await mutateInternal(internal.analysisComputeJobs.updateStatus, {
      jobId: params.extension.jobId as Id<'analysisComputeJobs'>,
      status: 'running',
    });
    await appendAnalysisSessionMessage({
      orgId: params.orgId,
      sessionId: params.sessionId,
      content: 'TabulateAI is creating a derived run with the confirmed banner extension. I will post back here when the run finishes.',
    });

    await updateRunStatus(params.runId, {
      status: 'in_progress',
      stage: 'loading_v3_artifacts',
      progress: 10,
      message: 'Loading parent run artifacts...',
    });
    await assertNotCancelled();

    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
      downloadRequiredArtifact({ outputs: params.extension.parentR2Outputs, relativePath: QUESTION_ID_FINAL_PATH, outputDir }),
      downloadRequiredArtifact({ outputs: params.extension.parentR2Outputs, relativePath: DATA_FILE_PATH, outputDir }),
      downloadRequiredArtifact({ outputs: params.extension.parentR2Outputs, relativePath: BANNER_PLAN_PATH, outputDir }),
      downloadRequiredArtifact({ outputs: params.extension.parentR2Outputs, relativePath: CROSSTAB_PLAN_PATH, outputDir }),
      downloadOptionalArtifact({ outputs: params.extension.parentR2Outputs, relativePath: TABLE_ENRICHED_PATH, outputDir }),
      downloadOptionalArtifact({ outputs: params.extension.parentR2Outputs, relativePath: TABLE_CANONICAL_PATH, outputDir }),
      downloadOptionalArtifact({ outputs: params.extension.parentR2Outputs, relativePath: PARENT_LOOP_POLICY_PATH, outputDir }),
    ]);
    await assertNotCancelled();

    const loadedParentBannerPlan = await readJson<import('@/schemas/bannerPlanSchema').BannerPlanInputType>(
      path.join(outputDir, BANNER_PLAN_PATH),
    );
    const loadedParentCrosstabPlan = await readJson<import('@/schemas/agentOutputSchema').ValidationResultType>(
      path.join(outputDir, CROSSTAB_PLAN_PATH),
    );
    const extendedPlanning = buildExtendedPlanningArtifacts({
      parentBannerPlan: loadedParentBannerPlan,
      parentCrosstabPlan: loadedParentCrosstabPlan,
      frozenBannerGroup: params.extension.frozenBannerGroup,
      frozenValidatedGroup: params.extension.frozenValidatedGroup,
    });

    await Promise.all([
      writeJson(path.join(outputDir, BANNER_PLAN_PATH), extendedPlanning.bannerPlan),
      writeJson(path.join(outputDir, CROSSTAB_PLAN_PATH), extendedPlanning.crosstabPlan),
      writeJson(path.join(outputDir, 'planning/analysis-extension-metadata.json'), {
        schemaVersion: 1,
        parentRunId: params.extension.parentRunId,
        jobId: params.extension.jobId,
        fingerprint: params.extension.fingerprint,
        appendedGroupName: params.extension.frozenBannerGroup.groupName,
        createdAt: new Date().toISOString(),
      }),
    ]);
    await assertNotCancelled();

    const rawQuestionId = await readJson<unknown>(path.join(outputDir, QUESTION_ID_FINAL_PATH));
    const entries = unwrapQuestionIdEntries(rawQuestionId);
    const canonicalPath = await fs.access(path.join(outputDir, TABLE_ENRICHED_PATH))
      .then(() => path.join(outputDir, TABLE_ENRICHED_PATH))
      .catch(() => path.join(outputDir, TABLE_CANONICAL_PATH));
    const canonicalOutput = await readJson<CanonicalTableOutput>(canonicalPath);
    if (!canonicalOutput.tables?.length) {
      throw new Error('Parent canonical table artifact is missing tables.');
    }

    const loopResult = await resolveLoopSemanticsForExtension({
      outputDir,
      entries,
      extendedCrosstabPlan: extendedPlanning.crosstabPlan,
      extension: params.extension,
      abortSignal: params.abortSignal,
    });
    await assertNotCancelled();

    await updateRunStatus(params.runId, {
      status: 'in_progress',
      stage: 'v3_compute',
      progress: 55,
      message: 'Running compute for derived run...',
    });
    await assertNotCancelled();

    const computeResult = await runComputePipeline({
      tables: canonicalToComputeTables(canonicalOutput.tables),
      crosstabPlan: extendedPlanning.crosstabPlan,
      outputDir,
      pipelineId,
      dataset: datasetName,
      abortSignal: params.abortSignal,
      checkpoint: createPipelineCheckpoint(pipelineId, datasetName),
      statTestingConfig: resolveStatConfig({
        wizard: params.config.statTesting
          ? {
              thresholds: params.config.statTesting.thresholds,
              minBase: params.config.statTesting.minBase,
            }
          : undefined,
      }),
      loopMappings: loopResult.loopMappings,
      loopSemanticsPolicy: loopResult.loopSemanticsPolicy,
      compiledLoopContract: loopResult.compiledLoopContract,
      loopStatTestingMode: params.loopStatTestingMode,
      weightVariable: params.config.weightVariable,
      maxRespondents: params.config.maxRespondents,
    });
    await assertNotCancelled();

    await updateRunStatus(params.runId, {
      status: 'in_progress',
      stage: 'executing_r',
      progress: 70,
      message: 'Generating and executing R script...',
    });
    await assertNotCancelled();

    const postResult = await runPostV3Processing({
      compute: computeResult,
      outputDir,
      dataFilePath: DATA_FILE_PATH,
      pipelineId,
      dataset: datasetName,
      format: params.config.format ?? 'standard',
      displayMode: params.config.displayMode ?? 'frequency',
      separateWorkbooks: params.config.separateWorkbooks ?? false,
      theme: params.config.theme,
      abortSignal: params.abortSignal,
      log: (message) => console.log(message),
      onFinalTableStageStart: async () => {
        await updateRunStatus(params.runId, {
          status: 'in_progress',
          stage: 'finalizing_tables',
          progress: 80,
          message: 'Finalizing derived tables...',
        });
      },
    });
    await assertNotCancelled();

    const assessment = assessPostV3Processing(postResult);
    await updateRunStatus(params.runId, {
      status: 'in_progress',
      stage: 'r2_finalize',
      progress: 92,
      message: 'Uploading derived run artifacts...',
    });
    await assertNotCancelled();

    const r2Manifest = await uploadPipelineOutputs(
      params.orgId,
      params.projectId,
      params.runId,
      outputDir,
      { projectName: 'Analysis extension', runTimestamp: new Date().toISOString() },
    );
    await assertNotCancelled();

    const tableCount = computeResult.rScriptInput.tables.length;
    const cutCount = computeResult.rScriptInput.cuts.length;
    const finalStatus = assessment.status;
    const result: RunResultShape = {
      formatVersion: 3,
      pipelineId,
      outputDir,
      downloadUrl: postResult.excelExport.success
        ? `/api/runs/${encodeURIComponent(params.runId)}/download/crosstabs.xlsx`
        : undefined,
      dataset: datasetName,
      v3Checkpoint: computeResult.checkpoint,
      r2Files: {
        inputs: r2Manifest.inputs,
        outputs: r2Manifest.outputs,
      },
      summary: {
        tables: tableCount,
        cuts: cutCount,
        bannerGroups: extendedPlanning.crosstabPlan.bannerCuts.length,
        durationMs: postResult.rExecution.durationMs + postResult.finalTableContract.durationMs + postResult.excelExport.durationMs,
      },
      postProcessing: postResult as unknown as RunResultShape['postProcessing'],
      analysisExtension: {
        parentRunId: params.extension.parentRunId,
        jobId: params.extension.jobId,
        fingerprint: params.extension.fingerprint,
        appendedGroupName: params.extension.frozenBannerGroup.groupName,
      },
    };

    await updateRunStatus(params.runId, {
      status: finalStatus,
      stage: finalStatus === 'error' ? 'error' : 'complete',
      progress: 100,
      message: finalStatus === 'success'
        ? `Derived run complete. Generated ${tableCount} tables with ${cutCount} cuts.`
        : assessment.message,
      result,
    });
    await assertNotCancelled();

    await mutateInternal(internal.analysisComputeJobs.updateStatus, {
      jobId: params.extension.jobId as Id<'analysisComputeJobs'>,
      status: finalStatus === 'success' || finalStatus === 'partial' ? 'success' : 'failed',
      r2Keys: r2Manifest.outputs,
    });
    await appendAnalysisSessionMessage({
      orgId: params.orgId,
      sessionId: params.sessionId,
      content: `The derived run is ready. Continue analysis here: /projects/${encodeURIComponent(params.projectId)}/runs/${encodeURIComponent(params.runId)}/analysis`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mutateInternal(internal.analysisComputeJobs.updateStatus, {
      jobId: params.extension.jobId as Id<'analysisComputeJobs'>,
      status: isAnalysisComputeAbortError(error) ? 'cancelled' : 'failed',
      error: message,
    });
    await updateRunStatus(params.runId, {
      status: isAnalysisComputeAbortError(error) ? 'cancelled' : 'error',
      stage: isAnalysisComputeAbortError(error) ? 'cancelled' : 'error',
      progress: 100,
      message,
      error: message,
      result: {
        formatVersion: 3,
        pipelineId,
        outputDir,
        dataset: datasetName,
      },
    });
    await appendAnalysisSessionMessage({
      orgId: params.orgId,
      sessionId: params.sessionId,
      content: `The derived run could not be completed: ${message}`,
    });
    throw error;
  } finally {
    stopHeartbeat();
  }
    },
  );
}
