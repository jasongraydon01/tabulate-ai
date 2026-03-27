/**
 * Pipeline Orchestrator (V3 — Phase 6b)
 *
 * V3 is the ONLY execution path. Legacy agents (BannerAgent, CrosstabAgent,
 * VerificationAgent, TableGenerator, etc.) are no longer imported or called.
 *
 * Flow:
 *   Setup (auth, Convex, console capture, heartbeat, metrics, input file copy)
 *   → Step 1: ValidationRunner (skipLoopDetection: true) + weight detection + MaxDiff enrichment
 *   → Step 2: V3 Question-ID chain (stages 00-12) via runQuestionIdPipeline
 *   → Step 3: FORK canonical (13b-13e) + planning (20-21)
 *   → Step 4: Build crosstab review payload from V3 planning result
 *   → IF review payload has columns: persist V3 checkpoint + review state, set Convex to pending_review, return
 *   → IF no review columns: derive loop mappings, resolve loop semantics, compute chain (22-14),
 *     shared postV3Processing (R script → R execution → Excel), summary, R2, PostHog, email
 */

import * as Sentry from '@sentry/nextjs';
import { getConvexClient, mutateInternal, queryInternal } from '@/lib/convex';
import { api } from '../../../convex/_generated/api';
import { internal } from '../../../convex/_generated/api';
import { cleanupAbort } from '@/lib/abortStore';
import { cleanupSession } from '@/lib/storage';
import {
  uploadPipelineOutputs,
  uploadReviewFile,
  uploadRunOutputArtifact,
  type R2FileManifest,
  type ReviewR2Keys,
} from '@/lib/r2/R2FileManager';
import type { Id } from '../../../convex/_generated/dataModel';
import {
  buildExportArtifactRefs,
  buildPhase1Manifest,
  ensureWideSavFallback,
  finalizeExportMetadataWithR2Refs,
  persistPhase0Artifacts,
  type ExportArtifactRefs,
} from '@/lib/exportData';

// V3 runtime imports
import { runQuestionIdPipeline } from '@/lib/v3/runtime/questionId/runQuestionIdPipeline';
import type { QuestionIdChainResult } from '@/lib/v3/runtime/questionId/types';
import type { DatasetIntakeConfig } from '@/lib/v3/runtime/questionId/types';
import { runTriage } from '@/lib/v3/runtime/questionId/gates/triage';
import { runCanonicalPipeline } from '@/lib/v3/runtime/canonical/runCanonicalPipeline';
import { runPlanningPipeline } from '@/lib/v3/runtime/planning/runPlanningPipeline';
import type { PlanningChainResult } from '@/lib/v3/runtime/planning/types';
import { runComputePipeline } from '@/lib/v3/runtime/compute/runComputePipeline';
import { canonicalToComputeTables } from '@/lib/v3/runtime/compute/canonicalToComputeTables';
import { mergeParallelCheckpoints } from '@/lib/v3/runtime/runV3Pipeline';
import type { V3PipelineResult } from '@/lib/v3/runtime/runV3Pipeline';
import { runPostV3Processing } from '@/lib/v3/runtime/postV3Processing';
import { buildPipelineSummary } from '@/lib/v3/runtime/buildPipelineSummary';
import type { PipelineSummary as V3PipelineSummaryType } from '@/lib/v3/runtime/buildPipelineSummary';
import { writeTableReport } from '@/lib/v3/runtime/tableReport';
import { buildDecisionsSummary, buildPipelineDecisions } from '@/lib/v3/runtime/pipelineDecisions';
import {
  deriveLoopMappings,
  persistLoopSummaryArtifact,
} from '@/lib/v3/runtime/loopMappingsFromQuestionId';
import { resolveStatConfig } from '@/lib/v3/runtime/compute/resolveStatConfig';
import {
  createPipelineCheckpoint,
  type V3PipelineCheckpoint,
} from '@/lib/v3/runtime/contracts';
import { writeCheckpoint } from '@/lib/v3/runtime/persistence';

// Loop semantics
import { runLoopSemanticsPolicyAgent, buildEnrichedLoopSummary } from '@/agents/LoopSemanticsPolicyAgent';
import { buildLoopSemanticsExcerpt } from '@/lib/questionContext';
import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import { createRespondentAnchoredFallbackPolicy, type LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';

// MaxDiff
import { detectMaxDiffFamilies } from '@/lib/maxdiff/detectMaxDiffFamilies';
import { resolveAndParseMaxDiffMessages } from '@/lib/maxdiff/resolveMaxDiffMessages';
import { enrichDataMapWithMessages } from '@/lib/maxdiff/enrichDataMapWithMessages';
import { MaxDiffWarnings } from '@/lib/maxdiff/warnings';

// HITL review
import { getFlaggedCrosstabColumns } from './hitlManager';
import type { BannerProcessingResult } from '@/agents/BannerAgent';
import { buildAgentDataMapForCrosstab } from './buildAgentDataMapForCrosstab';

// Pipeline infrastructure
import { sanitizeDatasetName } from './fileHandler';
import type {
  PipelineSummary,
  CrosstabReviewState,
  SavedFilePaths,
} from './types';
import { startHeartbeatInterval } from './heartbeat';
import { AgentMetricsCollector, runWithMetricsCollector, WideEvent } from '@/lib/observability';
import { getPipelineCostSummary } from '@/lib/observability';
import {
  persistSystemError,
  getGlobalSystemOutputDir,
  readPipelineErrors,
  summarizePipelineErrors,
} from '@/lib/errors/ErrorPersistence';
import { ConsoleCapture } from '@/lib/logging/ConsoleCapture';
import { registerPipelineCleanup, runWithPipelineContext } from '@/lib/pipeline/PipelineContext';
import { evaluateAndPersistRunQuality } from '@/lib/evaluation/runEvaluationService';
import { getPostHogClient } from '@/lib/posthog-server';
import { sendPipelineNotification } from '@/lib/notifications/email';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import { deriveMethodologyFromLegacy, type ProjectConfig } from '@/schemas/projectConfigSchema';
import type { V3PipelineStage } from '@/schemas/pipelineStageSchema';
import type { RunResultShape } from '@/schemas/runResultSchema';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';

import { promises as fs } from 'fs';
import * as path from 'path';

// -------------------------------------------------------------------------
// Pipeline Summary Helpers
// -------------------------------------------------------------------------

export async function writePipelineSummary(outputDir: string, summary: PipelineSummary): Promise<void> {
  await fs.writeFile(
    path.join(outputDir, 'pipeline-summary.json'),
    JSON.stringify(summary, null, 2)
  );
}

export async function updatePipelineSummary(
  outputDir: string,
  updates: Partial<PipelineSummary>
): Promise<void> {
  const summaryPath = path.join(outputDir, 'pipeline-summary.json');
  try {
    const existing = JSON.parse(await fs.readFile(summaryPath, 'utf-8')) as PipelineSummary;

    // Don't overwrite cancelled status (unless we're explicitly setting cancelled)
    if (existing.status === 'cancelled' && updates.status !== 'cancelled') {
      console.log('Pipeline was cancelled - not overwriting summary');
      return;
    }

    const updated = { ...existing, ...updates };
    await fs.writeFile(summaryPath, JSON.stringify(updated, null, 2));
  } catch {
    // If file doesn't exist, ignore - should have been created already
    console.warn('Could not update pipeline summary - file may not exist');
  }
}

// -------------------------------------------------------------------------
// Convex Status Helper
// -------------------------------------------------------------------------

type RunStatus = "in_progress" | "pending_review" | "resuming" | "success" | "partial" | "error" | "cancelled";
type CancelCheck = () => Promise<void>;

async function updateRunStatus(runId: string, updates: {
  status: RunStatus;
  stage?: V3PipelineStage;
  progress?: number;
  message?: string;
  result?: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  try {
    await mutateInternal(internal.runs.updateStatus, {
      runId: runId as Id<"runs">,
      status: updates.status,
      ...(updates.stage !== undefined && { stage: updates.stage }),
      ...(updates.progress !== undefined && { progress: updates.progress }),
      ...(updates.message !== undefined && { message: updates.message }),
      ...(updates.result !== undefined && { result: updates.result }),
      ...(updates.error !== undefined && { error: updates.error }),
    });
  } catch (err) {
    // Log but don't fail pipeline on status update errors
    console.warn('Failed to update Convex run status:', err);
  }
}

/** Format a duration in ms to a human-readable string (e.g., "31m 37s"). */
function formatDurationHuman(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Helper to check if an error is an AbortError
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error) {
    return error.message.includes('aborted') || error.message.includes('AbortError');
  }
  return false;
}

/**
 * Handle pipeline cancellation - update status and clean up
 */
export async function handleCancellation(
  outputDir: string,
  runId: string,
  reason: string
): Promise<void> {
  console.log(`Pipeline cancelled: ${reason}`);

  await updateRunStatus(runId, {
    status: 'cancelled',
    stage: 'cancelled',
    progress: 100,
    message: 'Pipeline cancelled by user',
  });
  cleanupAbort(runId);

  try {
    await updatePipelineSummary(outputDir, {
      status: 'cancelled',
      currentStage: 'cancelled'
    });
  } catch {
    // Summary might not exist yet
  }
}

const REVIEW_STATE_FILENAME = 'crosstab-review-state.json';

async function writeReviewStateFile(
  outputDir: string,
  reviewState: CrosstabReviewState,
): Promise<void> {
  await fs.writeFile(
    path.join(outputDir, REVIEW_STATE_FILENAME),
    JSON.stringify(reviewState, null, 2),
  );
}

async function updatePendingReviewMetadata(
  runId: string,
  reviewState: CrosstabReviewState,
  options?: {
    totalCanonicalTables?: number;
    v3Checkpoint?: V3PipelineCheckpoint;
  },
): Promise<void> {
  try {
    await mutateInternal(internal.runs.updateReviewState, {
      runId: runId as Id<"runs">,
      reviewState: {
        pipelineId: reviewState.pipelineId,
        status: reviewState.status,
        createdAt: reviewState.createdAt,
        flaggedColumns: reviewState.flaggedColumns,
        pathBStatus: reviewState.pathBStatus,
        pathCStatus: reviewState.pathCStatus,
        v3LastCompletedStage: options?.v3Checkpoint?.lastCompletedStage ?? undefined,
        totalCanonicalTables: options?.totalCanonicalTables,
        bannerGroupCount: reviewState.crosstabResult.bannerCuts.length,
        totalColumns: reviewState.crosstabResult.bannerCuts.reduce(
          (sum: number, group: { columns: unknown[] }) => sum + group.columns.length,
          0,
        ),
      },
    });
  } catch (err) {
    console.warn('Failed to push review state to Convex:', err);
  }
}


// -------------------------------------------------------------------------
// Intake Config Derivation
// -------------------------------------------------------------------------

function deriveIntakeConfigFromWizard(
  wizardConfig?: ProjectConfig,
  messageListPath?: string | null,
): DatasetIntakeConfig | undefined {
  if (!wizardConfig) return undefined;
  // Store relative path (inputs/<filename>) so messageLabelMatcher can resolve
  // against the dataset/output directory. The absolute temp path would produce
  // an invalid join when combined with datasetPath.
  const relativeMessagePath = messageListPath
    ? `inputs/${path.basename(messageListPath)}`
    : null;
  // Derive from wizard config fields — mirrors the shape of intake.json for
  // test datasets. studyMethodology is the source of truth for isMessageTesting,
  // not the file path presence.
  const { studyMethodology, analysisMethod } = deriveMethodologyFromLegacy(wizardConfig);
  return {
    isMessageTesting: studyMethodology === 'message_testing',
    isConceptTesting: studyMethodology === 'concept_testing',
    hasMaxDiff: analysisMethod === 'maxdiff',
    hasAnchoredScores: wizardConfig.maxdiffHasAnchoredScores ?? null,
    messageTemplatePath: relativeMessagePath,
    isDemandSurvey: wizardConfig.isDemandSurvey ?? (studyMethodology === 'demand'),
    hasChoiceModelExercise: wizardConfig.hasChoiceModelExercise ?? null,
  };
}

// -------------------------------------------------------------------------
// V3 Banner Adapter for HITL Flagging
// -------------------------------------------------------------------------

function buildV3BannerAdapter(planningResult: PlanningChainResult): BannerProcessingResult {
  const resolvedPlan = planningResult.crosstabPlan.resolvedBannerPlan;
  const now = new Date().toISOString();

  return {
    success: true,
    confidence: planningResult.crosstabPlan.averageConfidence,
    verbose: {
      success: true,
      timestamp: now,
      data: {
        success: true,
        extractionType: 'v3_planning',
        timestamp: now,
        extractedStructure: {
          bannerCuts: resolvedPlan.bannerCuts.map(g => ({
            groupName: g.groupName,
            columns: g.columns.map(c => ({
              name: c.name,
              original: c.original,
              adjusted: '',
              statLetter: '',
              confidence: 0,
              requiresInference: false,
              reasoning: '',
              uncertainties: [],
            })),
          })),
          notes: [],
          processingMetadata: { totalColumns: 0 },
        },
        errors: [],
        warnings: [],
      },
    },
    agent: [],
    errors: [],
    warnings: [],
  } as unknown as BannerProcessingResult;
}

// -------------------------------------------------------------------------
// V3 Summary → Legacy PipelineSummary Adapter
// -------------------------------------------------------------------------

function adaptV3SummaryToLegacy(
  v3Summary: V3PipelineSummaryType,
  pipelineId: string,
  datasetName: string,
  fileNames: { dataMap: string; bannerPlan: string; dataFile: string; survey: string | null },
  terminalStatus: RunStatus,
  v3Checkpoint: V3PipelineCheckpoint,
): PipelineSummary {
  return {
    pipelineId,
    dataset: datasetName,
    timestamp: v3Summary.timestamp,
    source: 'ui',
    status: terminalStatus,
    inputs: {
      datamap: fileNames.dataMap,
      banner: fileNames.bannerPlan,
      spss: fileNames.dataFile,
      survey: fileNames.survey,
    },
    duration: v3Summary.duration,
    outputs: {
      variables: v3Summary.outputs.variables,
      tableGeneratorTables: v3Summary.outputs.canonicalTables,
      verifiedTables: v3Summary.outputs.totalTablesInR,
      validatedTables: v3Summary.outputs.totalTablesInR,
      excludedTables: 0,
      totalTablesInR: v3Summary.outputs.totalTablesInR,
      cuts: v3Summary.outputs.cuts,
      bannerGroups: v3Summary.outputs.bannerGroups,
      sorting: { screeners: 0, main: v3Summary.outputs.totalTablesInR, other: 0 },
    },
    costs: {
      byAgent: (v3Summary.costs.byAgent as Array<{
        agentName: string; model: string; calls: number;
        totalInputTokens: number; totalOutputTokens: number;
        totalDurationMs: number; estimatedCostUsd: number;
      }>).map(a => ({
        agent: a.agentName,
        model: a.model,
        calls: a.calls,
        inputTokens: a.totalInputTokens,
        outputTokens: a.totalOutputTokens,
        durationMs: a.totalDurationMs,
        estimatedCostUsd: a.estimatedCostUsd,
      })),
      totals: v3Summary.costs.totals as PipelineSummary['costs'] extends { totals: infer T } ? T : never,
    },
    v3Checkpoint,
    errors: v3Summary.errors as PipelineSummary['errors'],
  };
}

// -------------------------------------------------------------------------
// Main Pipeline Orchestrator
// -------------------------------------------------------------------------

export interface PipelineRunParams {
  runId: string;
  sessionId: string;
  workerId?: string;
  convexOrgId?: string;
  convexProjectId?: string;
  launchedBy?: string;
  fileNames: {
    dataMap: string;
    bannerPlan: string;
    dataFile: string;
    survey: string | null;
  };
  savedPaths: SavedFilePaths;
  abortSignal?: AbortSignal;
  loopStatTestingMode?: 'suppress' | 'complement';
  /** Full project config from wizard (Phase 3.3). When present, overrides individual fields. */
  config?: ProjectConfig;
}

/**
 * Run the full V3 pipeline from uploaded files.
 * This is the background processing function — it updates run status via Convex
 * and writes results to disk (dual-write). All errors are handled internally.
 */
export async function runPipelineFromUpload(params: PipelineRunParams): Promise<void> {
  const {
    runId,
    sessionId,
    workerId,
    convexOrgId,
    convexProjectId,
    launchedBy,
    fileNames,
    savedPaths,
    abortSignal,
    loopStatTestingMode,
    config: wizardConfig,
  } = params;

  console.log(`wizardConfig: displayMode=${wizardConfig?.displayMode ?? 'undefined'}, separateWorkbooks=${wizardConfig?.separateWorkbooks ?? 'undefined'}, format=${wizardConfig?.format ?? 'undefined'}`);

  const processingStartTime = Date.now();

  // Create output folder path
  const datasetName = sanitizeDatasetName(fileNames.dataFile);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const pipelineId = `pipeline-${timestamp}`;
  const outputDir = path.join(process.cwd(), 'outputs', datasetName, pipelineId);

  return runWithPipelineContext(
    {
      pipelineId,
      runId,
      sessionId,
      source: 'orchestrator',
    },
    async () => {

  // Observability: pipeline-scoped metrics collector (isolated via AsyncLocalStorage)
  const metricsCollector = new AgentMetricsCollector();
  const wideEvent = new WideEvent({
    pipelineId,
    dataset: datasetName,
    orgId: convexOrgId,
    userId: runId,
    projectId: convexProjectId,
  });
  metricsCollector.bindWideEvent(wideEvent);

  return runWithMetricsCollector(metricsCollector, async () => {
  const stopHeartbeat = startHeartbeatInterval(runId, 30_000, workerId);

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Fetch project name for console capture context
  let projectName = 'Pipeline';
  if (convexProjectId && convexOrgId) {
    try {
      const project = await getConvexClient().query(api.projects.get, {
        projectId: convexProjectId as Id<"projects">,
        orgId: convexOrgId as Id<"organizations">
      });
      projectName = project?.name || convexProjectId;
    } catch (err) {
      console.warn('[API] Failed to fetch project name:', err);
      projectName = convexProjectId || 'Pipeline';
    }
  }

  // Start console capture: adds context prefix + writes to logs/pipeline.log
  const consoleCapture = new ConsoleCapture(outputDir, {
    projectName,
    runId: pipelineId,
  });
  await consoleCapture.start();
  registerPipelineCleanup(async () => {
    await consoleCapture.stop();
  });

  // Run pipeline with console context isolation (AsyncLocalStorage)
  return consoleCapture.run(async () => {
  try {

    console.log(`[API] Starting V3 pipeline processing for session: ${sessionId}`);
    console.log(`[API] Output directory: ${outputDir}`);
    const projectSubType = wizardConfig?.projectSubType ?? 'standard';
    if (projectSubType !== 'standard') {
      console.log(`[API] Project sub-type: ${projectSubType}`);
    }

    const { dataMapPath, bannerPlanPath, spssPath, surveyPath, messageListPath } = savedPaths;
    const assertNotCancelled: CancelCheck = async () => {
      if (abortSignal?.aborted) {
        throw new DOMException('Pipeline cancelled', 'AbortError');
      }
      try {
        const liveRun = await getConvexClient().query(api.runs.get, {
          runId: runId as Id<"runs">,
          orgId: convexOrgId as Id<"organizations">,
        });
        if (liveRun?.cancelRequested || liveRun?.status === 'cancelled') {
          throw new DOMException('Pipeline cancelled', 'AbortError');
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        // If cancellation probe fails, do not fail the pipeline.
      }
    };

    // Copy input files to inputs/ folder with original names
    const inputsDir = path.join(outputDir, 'inputs');
    await fs.mkdir(inputsDir, { recursive: true });
    if (dataMapPath && dataMapPath !== spssPath && fileNames.dataMap) {
      await fs.copyFile(dataMapPath, path.join(inputsDir, fileNames.dataMap));
    }
    if (bannerPlanPath && fileNames.bannerPlan) {
      await fs.copyFile(bannerPlanPath, path.join(inputsDir, fileNames.bannerPlan));
    }
    await fs.copyFile(spssPath, path.join(inputsDir, fileNames.dataFile));
    if (surveyPath && fileNames.survey) {
      await fs.copyFile(surveyPath, path.join(inputsDir, fileNames.survey));
    }
    if (messageListPath) {
      const messageListFileName = path.basename(messageListPath);
      await fs.copyFile(messageListPath, path.join(inputsDir, messageListFileName));
      console.log(`[API] Copied message list to inputs/${messageListFileName}`);
    }
    console.log('[API] Copied input files to inputs/ folder');

    // Copy SPSS to output dir root (needed for R script execution)
    await fs.copyFile(spssPath, path.join(outputDir, 'dataFile.sav'));

    // -----------------------------------------------------------------------
    // Step 1: Validation + Weight Detection + MaxDiff Enrichment
    // -----------------------------------------------------------------------
    await updateRunStatus(runId, {
      status: 'in_progress',
      stage: 'parsing',
      progress: 5,
      message: 'Validating data file...',
    });
    console.log('[API] Step 1: Running validation...');

    const { validate: runValidation } = await import('@/lib/validation/ValidationRunner');
    const validationResult = await runValidation({
      spssPath,
      outputDir,
      skipLoopDetection: true, // V3 handles loops in enrichment chain (stages 00/10a)
      maxRows: wizardConfig?.maxRespondents,
    });

    const dataMapResult = validationResult.processingResult || {
      success: false, verbose: [], agent: [],
      validationPassed: false, confidence: 0,
      errors: ['Validation failed'], warnings: [],
    };
    let verboseDataMap = dataMapResult.verbose as VerboseDataMapType[];
    console.log(`[API] Processed ${verboseDataMap.length} variables`);

    // Mark weight variable so downstream excludes it
    if (wizardConfig?.weightVariable) {
      const weightVar = wizardConfig.weightVariable;
      verboseDataMap = verboseDataMap.map(v =>
        v.column === weightVar ? { ...v, normalizedType: 'weight' as const } : v
      );
    }

    // Stacking guard: block obviously stacked data
    const stackingColumns = validationResult.dataFileStats?.stackingColumns ?? [];
    if (stackingColumns.length >= 2) {
      const msg = 'Data appears to be already stacked. Please upload the original wide-format data.';
      console.error(`[API] ${msg}`);
      metricsCollector.unbindWideEvent();
      wideEvent.finish('error', msg);
      throw new Error(msg);
    }

    // Derive intake config from wizard (needed before message resolution)
    const intakeConfig = deriveIntakeConfigFromWizard(wizardConfig, messageListPath);

    // Message resolution — runs for all message testing studies (MaxDiff or standard)
    // MaxDiff-specific enrichment (family detection, value label rewriting) only runs for MaxDiff.
    const maxdiffWarnings = new MaxDiffWarnings();
    const isMessageTestingStudy = intakeConfig?.isMessageTesting ?? projectSubType === 'maxdiff';
    if (isMessageTestingStudy) {
      const messageResolution = await resolveAndParseMaxDiffMessages(wizardConfig, messageListPath, maxdiffWarnings);
      if (messageResolution.entries && messageResolution.entries.length > 0) {
        if (projectSubType === 'maxdiff') {
          // MaxDiff-specific: detect families and enrich variable/value labels
          const maxdiffDetectionForEnrich = detectMaxDiffFamilies(verboseDataMap);
          if (maxdiffDetectionForEnrich.detected) {
            const enrichResult = enrichDataMapWithMessages(verboseDataMap, messageResolution.entries, maxdiffDetectionForEnrich);
            verboseDataMap = enrichResult.enriched;
            console.log(`[API] MaxDiff message enrichment (${messageResolution.source}): ${enrichResult.stats.variableLabelsEnriched} variable labels, ${enrichResult.stats.valueLabelsEnriched} value labels`);
            if (enrichResult.stats.unmatchedMessages.length > 0) {
              console.log(`[API] Unmatched message codes: ${enrichResult.stats.unmatchedMessages.join(', ')}`);
              maxdiffWarnings.add('unmatched_messages', `${enrichResult.stats.unmatchedMessages.length} message code(s) did not match any variable or value label`, enrichResult.stats.unmatchedMessages.join(', '));
            }
          }
        } else {
          console.log(`[API] Message stimuli resolved (${messageResolution.source}): ${messageResolution.entries.length} entries — will feed into enrichment chain via messageTemplatePath`);
        }
      }
    }

    wideEvent.recordStage('validation', 'ok', Date.now() - processingStartTime);
    console.log(`[API] Step 1 complete: ${verboseDataMap.length} variables`);

    // Write initial pipeline summary (for sidebar visibility)
    const initialCheckpoint = createPipelineCheckpoint(pipelineId, datasetName);
    const initialSummary: PipelineSummary = {
      pipelineId,
      dataset: datasetName,
      timestamp: new Date().toISOString(),
      source: 'ui',
      status: 'in_progress',
      currentStage: 'v3_enrichment',
      options: { loopStatTestingMode },
      inputs: {
        datamap: fileNames.dataMap,
        banner: fileNames.bannerPlan,
        spss: fileNames.dataFile,
        survey: fileNames.survey,
      },
      v3Checkpoint: initialCheckpoint,
    };
    await writePipelineSummary(outputDir, initialSummary);
    console.log('Initial pipeline summary written');

    // Resolve stat testing config
    const resolvedStatConfig = wizardConfig?.statTesting
      ? resolveStatConfig({
          wizard: {
            thresholds: wizardConfig.statTesting.thresholds,
            minBase: wizardConfig.statTesting.minBase,
          },
        })
      : resolveStatConfig({});

    await assertNotCancelled();
    if (abortSignal?.aborted) {
      console.log('Pipeline cancelled before V3 pipeline');
      metricsCollector.unbindWideEvent();
      wideEvent.finish('cancelled', 'Cancelled before V3 pipeline');
      await handleCancellation(outputDir, runId, 'Cancelled before V3 pipeline');
      return;
    }

    // -----------------------------------------------------------------------
    // Step 2: V3 Question-ID Enrichment Chain (stages 00-12)
    // -----------------------------------------------------------------------
    await updateRunStatus(runId, {
      status: 'in_progress',
      stage: 'v3_enrichment',
      progress: 10,
      message: 'Running V3 enrichment chain...',
    });
    console.log('[V3] Running question-id enrichment chain (stages 00-12)...');
    const v3QidStart = Date.now();

    const v3QuestionIdResult: QuestionIdChainResult = await runQuestionIdPipeline({
      savPath: spssPath,
      datasetPath: outputDir,
      outputDir,
      pipelineId,
      dataset: datasetName,
      abortSignal,
      checkpoint: initialCheckpoint,
      intakeConfig,
      maxRespondents: wizardConfig?.maxRespondents,
    });

    const v3QidDuration = Date.now() - v3QidStart;
    wideEvent.recordStage('v3_enrichment', 'ok', v3QidDuration);
    console.log(`[V3] Enrichment complete: ${v3QuestionIdResult.entries.length} entries in ${v3QidDuration}ms`);

    await assertNotCancelled();

    // -----------------------------------------------------------------------
    // Step 3: FORK — Canonical (13b-13e) + Planning (20-21)
    // -----------------------------------------------------------------------
    await updateRunStatus(runId, {
      status: 'in_progress',
      stage: 'v3_fork_join',
      progress: 30,
      message: 'Running table assembly and banner planning...',
    });
    console.log('[V3] FORK: Starting canonical + planning chains in parallel...');
    const forkStart = Date.now();

    const v3QidCheckpoint = v3QuestionIdResult.checkpoint;
    const v3TriageFlagged = runTriage(
      v3QuestionIdResult.entries,
      v3QuestionIdResult.metadata,
    ).flagged;
    let resolvedLoopMappings: LoopGroupMapping[] = [];
    const loopDerivation = deriveLoopMappings(v3QuestionIdResult.entries);
    if (loopDerivation.hasLoops) {
      resolvedLoopMappings = loopDerivation.loopMappings;
      console.log(`[V3] Loop mappings derived: ${loopDerivation.summary}`);
      await persistLoopSummaryArtifact(outputDir, loopDerivation);
    }

    // Use a child AbortController so that if one chain fails, the sibling
    // is aborted immediately (prevents wasting tokens on a doomed fork).
    const forkAbort = new AbortController();
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => forkAbort.abort(abortSignal.reason), { once: true });
    }

    const canonicalPromise = runCanonicalPipeline({
        entries: v3QuestionIdResult.entries,
        loopMappings: resolvedLoopMappings,
        metadata: v3QuestionIdResult.metadata,
        triageFlagged: v3TriageFlagged,
        surveyParsed: v3QuestionIdResult.surveyParsed,
        outputDir,
        pipelineId,
        dataset: datasetName,
        abortSignal: forkAbort.signal,
        checkpoint: v3QidCheckpoint,
        tablePresentationConfig: wizardConfig?.tablePresentation,
      }).catch((err) => {
        forkAbort.abort(err);
        throw err;
      });

    const planningResult = await runPlanningPipeline({
        entries: v3QuestionIdResult.entries,
        metadata: v3QuestionIdResult.metadata,
        savPath: spssPath,
        datasetPath: outputDir,
        outputDir,
        pipelineId,
        dataset: datasetName,
        abortSignal: forkAbort.signal,
        maxRespondents: wizardConfig?.maxRespondents,
        researchObjectives: wizardConfig?.researchObjectives,
        cutSuggestions: wizardConfig?.bannerHints,
        projectType: wizardConfig?.projectSubType,
      }).catch(err => {
        forkAbort.abort(err);
        throw err;
      });

    let mergedCheckpoint = planningResult.checkpoint;
    await writeCheckpoint(outputDir, mergedCheckpoint);

    await assertNotCancelled();

    // -----------------------------------------------------------------------
    // Step 4: Check Flagged Columns for HITL Review
    // -----------------------------------------------------------------------
    await updateRunStatus(runId, {
      status: 'in_progress',
      stage: 'review_check',
      progress: 50,
      message: 'Checking for columns needing review...',
    });

    const v3BannerAdapter = buildV3BannerAdapter(planningResult);
    const flaggedCrosstabColumns = getFlaggedCrosstabColumns(
      planningResult.crosstabPlan.crosstabPlan,
      v3BannerAdapter,
    );

    if (flaggedCrosstabColumns.length > 0 && !wizardConfig?.demoMode) {
      // -------------------------------------------------------------------
      // HITL Review Required — Await Canonical, Then Pause Pipeline
      // -------------------------------------------------------------------
      // Await canonical chain before pausing for review. This ensures all
      // artifacts (including NET enrichment from 13e) are ready when the
      // user submits review, eliminating background execution and the
      // polling/waiting loop in reviewCompletion.
      await updateRunStatus(runId, {
        status: 'in_progress',
        stage: 'v3_fork_join',
        progress: 40,
        message: `Review required (${flaggedCrosstabColumns.length} columns) — completing table assembly...`,
      });

      const canonicalResult = await canonicalPromise;

      mergedCheckpoint = mergeParallelCheckpoints(
        v3QidCheckpoint,
        canonicalResult.checkpoint,
        planningResult.checkpoint,
      );
      await writeCheckpoint(outputDir, mergedCheckpoint);

      const forkDuration = Date.now() - forkStart;
      wideEvent.recordStage('v3_fork_join', 'ok', forkDuration);

      console.log(
        `[V3] JOIN: Both chains complete (${forkDuration}ms). ` +
        `Tables: ${canonicalResult.tables.length}, ` +
        `Banner groups: ${planningResult.crosstabPlan.crosstabPlan.bannerCuts.length}`,
      );
      console.log(`Review required: ${flaggedCrosstabColumns.length} columns pending human confirmation`);
      const reviewCreatedAt = new Date().toISOString();

      // Build agentDataMap for review state (needed for hint re-runs)
      const agentDataMap = buildAgentDataMapForCrosstab(dataMapResult.agent, verboseDataMap);

      const reviewState: CrosstabReviewState = {
        pipelineId,
        status: 'awaiting_review',
        createdAt: reviewCreatedAt,
        projectName,
        crosstabResult: planningResult.crosstabPlan.crosstabPlan,
        flaggedColumns: flaggedCrosstabColumns,
        bannerResult: v3BannerAdapter,
        agentDataMap,
        outputDir,
        pathBStatus: 'completed',
        pathBResult: null,
        pathCStatus: 'skipped',
        pathCResult: null,
        verboseDataMap,
        surveyMarkdown: null,
        spssPath,
        loopMappings: [],
        baseNameToLoopIndex: {},
        wizardConfig,
        loopStatTestingMode,
        messageListPath: messageListPath || undefined,
        crosstabScratchpadByGroup: planningResult.crosstabPlan.scratchpadByGroup,
      };

      await writeReviewStateFile(outputDir, reviewState);
      console.log('Review state saved to crosstab-review-state.json');

      // Upload review files to R2 for resilience against container restarts
      let reviewR2Keys: ReviewR2Keys | undefined;
      if (convexOrgId && convexProjectId) {
        try {
          const reviewStateKey = await uploadReviewFile(
            convexOrgId, convexProjectId, runId, path.join(outputDir, 'crosstab-review-state.json'), 'crosstab-review-state.json'
          );
          const summaryKey = await uploadReviewFile(
            convexOrgId, convexProjectId, runId, path.join(outputDir, 'pipeline-summary.json'), 'pipeline-summary.json'
          );
          reviewR2Keys = {
            reviewState: reviewStateKey,
            pipelineSummary: summaryKey,
            spssInput: savedPaths.r2Keys?.spss,
          };

          // Upload V3 artifacts needed for post-review compute (container restart recovery)
          // All artifacts are guaranteed available since canonical is fully complete.
          const v3ArtifactUploads: Array<{ field: keyof ReviewR2Keys; localPath: string; filename: string }> = [
            { field: 'v3QuestionIdFinal', localPath: path.join(outputDir, 'enrichment', '12-questionid-final.json'), filename: 'enrichment/12-questionid-final.json' },
            { field: 'v3CrosstabPlan', localPath: path.join(outputDir, 'planning', '21-crosstab-plan.json'), filename: 'planning/21-crosstab-plan.json' },
            { field: 'v3TableEnriched', localPath: path.join(outputDir, 'tables', '13e-table-enriched.json'), filename: 'tables/13e-table-enriched.json' },
            { field: 'v3TableJson', localPath: path.join(outputDir, 'tables', '13d-table-canonical.json'), filename: 'tables/13d-table-canonical.json' },
            { field: 'v3Checkpoint', localPath: path.join(outputDir, 'checkpoint.json'), filename: 'checkpoint.json' },
            { field: 'dataFileSav', localPath: path.join(outputDir, 'dataFile.sav'), filename: 'dataFile.sav' },
          ];
          for (const { field, localPath, filename } of v3ArtifactUploads) {
            try {
              await fs.access(localPath);
              const key = await uploadReviewFile(convexOrgId, convexProjectId, runId, localPath, filename);
              (reviewR2Keys as Record<string, string | undefined>)[field] = key;
            } catch {
              console.warn(`[R2] V3 artifact not available for upload: ${filename} (non-fatal)`);
            }
          }

          console.log('Review state files + V3 artifacts uploaded to R2');
        } catch (r2Err) {
          console.warn('Failed to upload review state to R2 (non-fatal):', r2Err);
        }
      }

      const reviewUrl = convexProjectId
        ? `/projects/${encodeURIComponent(convexProjectId)}/review`
        : `/projects/${encodeURIComponent(pipelineId)}/review`;
      const pendingReviewResult: RunResultShape = {
        formatVersion: 3,
        pipelineId,
        outputDir,
        reviewUrl,
        flaggedColumnCount: flaggedCrosstabColumns.length,
        v3Checkpoint: mergedCheckpoint,
        ...(reviewR2Keys && { reviewR2Keys }),
      };

      await updateRunStatus(runId, {
        status: 'pending_review',
        stage: 'crosstab_review_required',
        progress: 50,
        message: `Review required - ${flaggedCrosstabColumns.length} columns pending confirmation`,
        result: pendingReviewResult,
      });

      await updatePipelineSummary(outputDir, {
        status: 'pending_review',
        currentStage: 'crosstab_review',
        review: {
          flaggedColumnCount: flaggedCrosstabColumns.length,
          reviewUrl
        },
        v3Checkpoint: mergedCheckpoint,
      });

      await updatePendingReviewMetadata(runId, reviewState, {
        totalCanonicalTables: canonicalResult.tables.length,
        v3Checkpoint: mergedCheckpoint,
      });

      console.log('Pipeline paused for human review.');
      console.log(`Resume via POST /api/runs/${runId}/review`);

      // Notify the user that review is needed (fire-and-forget)
      sendPipelineNotification({
        runId,
        status: 'review_required',
        launchedBy,
        convexProjectId,
        convexOrgId,
        flaggedColumnCount: flaggedCrosstabColumns.length,
        reviewUrl,
      }).catch(() => { /* fire-and-forget */ });

      metricsCollector.unbindWideEvent();
      wideEvent.finish('partial', 'Paused for HITL review');
      return;
    }

    const canonicalResult = await canonicalPromise;

    // Merge parallel checkpoints and persist
    mergedCheckpoint = mergeParallelCheckpoints(
      v3QidCheckpoint,
      canonicalResult.checkpoint,
      planningResult.checkpoint,
    );
    await writeCheckpoint(outputDir, mergedCheckpoint);

    const forkDuration = Date.now() - forkStart;
    wideEvent.recordStage('v3_fork_join', 'ok', forkDuration);
    console.log(
      `[V3] JOIN: Both chains complete (${forkDuration}ms). ` +
      `Tables: ${canonicalResult.tables.length}, ` +
      `Banner groups: ${planningResult.crosstabPlan.crosstabPlan.bannerCuts.length}`,
    );

    // -----------------------------------------------------------------------
    // No Review Needed — Continue to Compute and Post-Processing
    // -----------------------------------------------------------------------

    // Demo mode: truncate tables to cap before compute
    if (wizardConfig?.maxTables && canonicalResult.tables.length > wizardConfig.maxTables) {
      const originalCount = canonicalResult.tables.length;
      canonicalResult.tables = canonicalResult.tables.slice(0, wizardConfig.maxTables);
      console.log(`[Demo] Truncated tables from ${originalCount} to ${wizardConfig.maxTables}`);
    }

    if (wizardConfig?.demoMode) {
      console.log(`[Demo] Running in demo mode — skipping review, ${canonicalResult.tables.length} tables`);
      // Write marker file so cleanup script can identify demo directories
      try { await fs.writeFile(path.join(outputDir, '.demo-run'), '', 'utf-8'); } catch { /* non-fatal */ }
    } else {
      console.log('No crosstab columns available for review - continuing pipeline');
    }

    // Resolve loop semantics policy if loops exist
    let loopSemanticsPolicy: LoopSemanticsPolicy | undefined;
    if (resolvedLoopMappings.length > 0) {
      await updateRunStatus(runId, {
        status: 'in_progress',
        stage: 'loop_semantics',
        progress: 55,
        message: 'Classifying loop semantics...',
      });
      console.log('[V3] Resolving loop semantics policy...');

      const cutsSpec = buildCutsSpec(planningResult.crosstabPlan.crosstabPlan);
      try {
        loopSemanticsPolicy = await runLoopSemanticsPolicyAgent({
          loopSummary: buildEnrichedLoopSummary(resolvedLoopMappings, v3QuestionIdResult.entries),
          bannerGroups: cutsSpec.groups.map(g => ({
            groupName: g.groupName,
            columns: g.cuts.map(c => ({ name: c.name, original: c.name })),
          })),
          cuts: cutsSpec.cuts.map(c => ({
            name: c.name,
            groupName: c.groupName,
            rExpression: c.rExpression,
          })),
          datamapExcerpt: buildLoopSemanticsExcerpt(v3QuestionIdResult.entries, cutsSpec.cuts),
          loopMappings: resolvedLoopMappings,
          outputDir,
          abortSignal,
        });

        const entityGroups = loopSemanticsPolicy.bannerGroups.filter(g => g.anchorType === 'entity');
        console.log(
          `[V3] Loop semantics: ${entityGroups.length} entity-anchored, ` +
          `${loopSemanticsPolicy.bannerGroups.length - entityGroups.length} respondent-anchored`,
        );
      } catch (lspError) {
        const fallbackReason = lspError instanceof Error ? lspError.message : String(lspError);
        console.warn(`LoopSemanticsPolicyAgent failed — using respondent-anchored fallback: ${fallbackReason}`);
        loopSemanticsPolicy = createRespondentAnchoredFallbackPolicy(
          buildCutsSpec(planningResult.crosstabPlan.crosstabPlan).groups.map(g => g.groupName),
          fallbackReason,
        );
      }

      // Write loop semantics policy
      if (loopSemanticsPolicy) {
        try {
          const loopPolicyDir = path.join(outputDir, 'agents', 'loop-semantics');
          await fs.mkdir(loopPolicyDir, { recursive: true });
          await fs.writeFile(
            path.join(loopPolicyDir, 'loop-semantics-policy.json'),
            JSON.stringify(loopSemanticsPolicy, null, 2),
            'utf-8'
          );
        } catch {
          // non-blocking
        }
      }
    }

    await assertNotCancelled();

    // -----------------------------------------------------------------------
    // Compile Loop Contract (if loop policy exists)
    // -----------------------------------------------------------------------
    let compiledLoopContract: import('@/schemas/compiledLoopContractSchema').CompiledLoopContract | undefined;
    if (loopSemanticsPolicy && resolvedLoopMappings.length > 0) {
      const { compileLoopContract } = await import('@/lib/v3/runtime/compileLoopContract');
      const cutsSpec = buildCutsSpec(planningResult.crosstabPlan.crosstabPlan);
      const knownColumns = new Set<string>();
      if (v3QuestionIdResult?.entries) {
        for (const entry of v3QuestionIdResult.entries) {
          if (entry.items) {
            for (const item of entry.items) {
              if (item.column) knownColumns.add(item.column);
            }
          }
        }
      }

      compiledLoopContract = compileLoopContract({
        policy: loopSemanticsPolicy,
        cuts: cutsSpec.cuts.map(c => ({ name: c.name, groupName: c.groupName, rExpression: c.rExpression })),
        loopMappings: resolvedLoopMappings,
        knownColumns,
      });

      try {
        const loopPolicyDir = path.join(outputDir, 'agents', 'loop-semantics');
        await fs.mkdir(loopPolicyDir, { recursive: true });
        await fs.writeFile(
          path.join(loopPolicyDir, 'compiled-loop-contract.json'),
          JSON.stringify(compiledLoopContract, null, 2),
          'utf-8',
        );
      } catch {
        // non-blocking
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: V3 Compute Chain (stages 22-14)
    // -----------------------------------------------------------------------
    await updateRunStatus(runId, {
      status: 'in_progress',
      stage: 'v3_compute',
      progress: 60,
      message: 'Running compute chain...',
    });
    console.log('[V3] Running compute chain (stages 22-14)...');
    const computeStart = Date.now();

    const computeResult = await runComputePipeline({
      tables: canonicalToComputeTables(canonicalResult.tables),
      crosstabPlan: planningResult.crosstabPlan.crosstabPlan,
      outputDir,
      pipelineId,
      dataset: datasetName,
      abortSignal,
      checkpoint: mergedCheckpoint,
      statTestingConfig: resolvedStatConfig,
      wizardStatTesting: wizardConfig?.statTesting
        ? { thresholds: wizardConfig.statTesting.thresholds, minBase: wizardConfig.statTesting.minBase }
        : null,
      loopMappings: resolvedLoopMappings.length > 0 ? resolvedLoopMappings : undefined,
      loopSemanticsPolicy,
      compiledLoopContract,
      loopStatTestingMode: loopStatTestingMode as 'suppress' | 'complement' | undefined,
      weightVariable: wizardConfig?.weightVariable,
      maxRespondents: wizardConfig?.maxRespondents,
    });

    mergedCheckpoint = computeResult.checkpoint;
    await writeCheckpoint(outputDir, mergedCheckpoint);

    console.log(`[V3] Compute chain complete. Cuts: ${computeResult.rScriptInput.cuts.length}`);
    wideEvent.recordStage('v3_compute', 'ok', Date.now() - computeStart);

    await assertNotCancelled();

    // -----------------------------------------------------------------------
    // Step 6: Post-V3 Processing (R script → R execution → Excel)
    // -----------------------------------------------------------------------
    await updateRunStatus(runId, {
      status: 'in_progress',
      stage: 'executing_r',
      progress: 75,
      message: 'Generating and executing R script...',
    });
    console.log('[V3] Running post-V3 processing (R + Excel)...');

    const postResult = await runPostV3Processing({
      compute: computeResult,
      outputDir,
      dataFilePath: 'dataFile.sav',
      pipelineId,
      dataset: datasetName,
      format: wizardConfig?.format ?? 'standard',
      displayMode: wizardConfig?.displayMode ?? 'frequency',
      separateWorkbooks: wizardConfig?.separateWorkbooks ?? false,
      theme: wizardConfig?.theme,
      abortSignal,
      log: (msg: string) => console.log(msg),
    });

    if (postResult.rSuccess) {
      wideEvent.recordStage('rExecution', 'ok', postResult.rDurationMs);
    }
    if (postResult.excelSuccess) {
      wideEvent.recordStage('excelExport', 'ok', postResult.excelDurationMs);
    }

    let exportArtifacts: ExportArtifactRefs | undefined;
    let exportReadiness: ExportArtifactRefs['readiness'] | undefined;
    const exportErrors: Array<{
      format: 'shared';
      stage: 'contract_build' | 'r2_finalize';
      message: string;
      retryable: boolean;
      timestamp: string;
    }> = [];

    try {
      const copiedWideSav = await ensureWideSavFallback(outputDir, 'dataFile.sav');
      if (copiedWideSav) {
        console.log('[ExportData] Copied export/data/wide.sav fallback from runtime dataFile.sav');
      }

      const resultFiles: string[] = await fs.readdir(path.join(outputDir, 'results')).catch((): string[] => []);
      const hasDualWeightOutputs =
        resultFiles.includes('tables-weighted.json') &&
        resultFiles.includes('tables-unweighted.json');

      await persistPhase0Artifacts({
        outputDir,
        tablesWithLoopFrame: computeResult.rScriptInput.tables as unknown as import('@/schemas/verificationAgentSchema').TableWithLoopFrame[],
        loopMappings: resolvedLoopMappings,
        loopSemanticsPolicy,
        compiledLoopContract,
        weightVariable: wizardConfig?.weightVariable ?? null,
        hasDualWeightOutputs,
        sourceSavUploadedName: path.basename(spssPath),
        sourceSavRuntimeName: 'dataFile.sav',
        convexRefs: {
          runId,
          projectId: convexProjectId,
          orgId: convexOrgId,
          pipelineId,
        },
      });

      const phase1Manifest = await buildPhase1Manifest(outputDir);
      exportArtifacts = buildExportArtifactRefs(phase1Manifest.metadata);
      exportReadiness = phase1Manifest.metadata.readiness;
      console.log('[ExportData] Shared export contract persisted');
    } catch (exportErr) {
      const message = exportErr instanceof Error ? exportErr.message : String(exportErr);
      console.warn('[ExportData] Failed to build shared export contract (non-fatal):', exportErr);
      exportErrors.push({
        format: 'shared',
        stage: 'contract_build',
        message,
        retryable: true,
        timestamp: new Date().toISOString(),
      });
    }

    // -----------------------------------------------------------------------
    // Cleanup temporary files
    // -----------------------------------------------------------------------
    console.log('Cleaning up temporary files...');
    try {
      await fs.rm(path.join(outputDir, 'banner-images'), { recursive: true });
    } catch { /* Folder may not exist */ }
    try {
      const allFiles = await fs.readdir(outputDir);
      for (const file of allFiles) {
        if (file.endsWith('.html') || (file.endsWith('.png') && file.includes('_html_'))) {
          await fs.unlink(path.join(outputDir, file));
        }
      }
    } catch { /* Ignore cleanup errors */ }

    // -----------------------------------------------------------------------
    // Step 7: Pipeline Summary and Completion
    // -----------------------------------------------------------------------
    if (abortSignal?.aborted) {
      console.log('Pipeline cancelled - not writing final summary');
      metricsCollector.unbindWideEvent();
      wideEvent.finish('cancelled', 'Cancelled before completion');
      await handleCancellation(outputDir, runId, 'Cancelled before completion');
      return;
    }

    const totalDuration = Date.now() - processingStartTime;
    const durationSec = (totalDuration / 1000).toFixed(1);
    const durationHuman = formatDurationHuman(totalDuration);

    // Build V3-native pipeline summary
    const v3Result: V3PipelineResult = {
      questionId: v3QuestionIdResult,
      canonical: canonicalResult,
      planning: planningResult,
      compute: computeResult,
      checkpoint: mergedCheckpoint,
    };

    const v3Summary = await buildPipelineSummary({
      v3Result,
      postResult,
      files: {
        name: datasetName,
        spss: spssPath,
        banner: bannerPlanPath || null,
        survey: surveyPath || null,
        datamap: null,
      },
      totalDurationMs: totalDuration,
      outputDir,
      pipelineId,
      statTestingConfig: resolvedStatConfig,
      setupStageTiming: {},
      weightDetection: validationResult.weightDetection ?? undefined,
    });

    // Also write as V3-native format
    await fs.writeFile(
      path.join(outputDir, 'pipeline-summary-v3.json'),
      JSON.stringify(v3Summary, null, 2)
    );

    // Determine terminal status
    const excelGenerated = postResult.excelSuccess;
    const rExecutionSuccess = postResult.rSuccess;
    const terminalStatus: RunStatus = excelGenerated ? 'success'
      : (rExecutionSuccess ? 'partial' : 'error');

    // Adapt V3 summary to legacy PipelineSummary shape for Convex
    const pipelineSummary = adaptV3SummaryToLegacy(
      v3Summary,
      pipelineId,
      datasetName,
      fileNames,
      terminalStatus,
      mergedCheckpoint,
    );

    let errorRead: Awaited<ReturnType<typeof readPipelineErrors>> | undefined;
    // Attach error persistence summary
    try {
      errorRead = await readPipelineErrors(outputDir);
      const errorSummary = summarizePipelineErrors(errorRead.records);
      pipelineSummary.errors = { ...errorSummary, invalidLines: errorRead.invalidLines.length };
    } catch {
      // ignore
    }

    const pipelineDecisions = buildPipelineDecisions({
      config: wizardConfig,
      questionId: {
        entries: v3QuestionIdResult.entries,
        metadata: v3QuestionIdResult.metadata,
      },
      checkpoint: mergedCheckpoint,
      tables: {
        canonicalTablesPlanned: canonicalResult.tablePlan.summary.plannedTables,
        canonicalTables: canonicalResult.tables,
        finalTableCount: computeResult.rScriptInput.tables.length,
      },
      banners: {
        source: planningResult.bannerPlan.routeMetadata.routeUsed === 'banner_agent' ? 'uploaded' : 'auto_generated',
        bannerGroupCount: planningResult.crosstabPlan.crosstabPlan.bannerCuts.length,
        totalCuts: computeResult.rScriptInput.cuts.length,
        flaggedForReview: flaggedCrosstabColumns.length,
      },
      weights: {
        detection: validationResult.weightDetection,
        variableUsed: wizardConfig?.weightVariable ?? null,
      },
      errors: {
        records: errorRead?.records,
        validationWarningCount: validationResult.warnings.length,
      },
      timing: {
        postRMs: postResult.rDurationMs,
        excelMs: postResult.excelDurationMs,
        totalMs: totalDuration,
      },
    });
    const decisionsSummary = buildDecisionsSummary(pipelineDecisions);

    // Check if already cancelled before writing
    const summaryPath = path.join(outputDir, 'pipeline-summary.json');
    try {
      const existing = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
      if (existing.status === 'cancelled') {
        console.log('Pipeline was cancelled - not overwriting summary');
        metricsCollector.unbindWideEvent();
        wideEvent.finish('cancelled', 'Pipeline already cancelled');
        return;
      }
    } catch {
      // File doesn't exist, proceed
    }

    await fs.writeFile(
      summaryPath,
      JSON.stringify({
        ...pipelineSummary,
        pipelineDecisions,
        decisionsSummary,
      }, null, 2),
    );
    console.log(`Pipeline completed in ${durationSec}s - summary saved`);

    // Generate human-readable table report
    await writeTableReport({
      dataset: datasetName,
      outputDir,
      canonical: canonicalResult,
      pipelineTimingMs: totalDuration,
    });

    const costSummaryText = await getPipelineCostSummary();
    console.log(costSummaryText);

    // Finish observability — enrich with error context for failed/degraded runs
    const costMetrics = await metricsCollector.getSummary();
    metricsCollector.unbindWideEvent();
    wideEvent.set('tableCount', computeResult.rScriptInput.tables.length);
    wideEvent.set('finalStage', excelGenerated ? 'excelExport' : (rExecutionSuccess ? 'excelExport' : 'rExecution'));
    if (terminalStatus !== 'success' && errorRead?.records.length) {
      const errSummary = summarizePipelineErrors(errorRead.records);
      wideEvent.set('errorSummary', errSummary);
      const topErr = errorRead.records.find(r => r.severity === 'fatal')
        || errorRead.records.find(r => r.severity === 'error')
        || errorRead.records[0];
      if (topErr) {
        wideEvent.set('topError', topErr.message || topErr.stageName || 'Unknown');
      }
    }
    wideEvent.finish(excelGenerated ? 'success' : (rExecutionSuccess ? 'partial' : 'error'));

    // Upload outputs to R2 (skip for demo mode — outputs are ephemeral)
    let r2Manifest: R2FileManifest | undefined;
    let r2UploadFailed = false;
    if (convexOrgId && convexProjectId && !wizardConfig?.demoMode) {
      try {
        const runTimestamp = pipelineId.replace('pipeline-', '').replace(/-(\d{3}Z)$/, '.$1');
        r2Manifest = await uploadPipelineOutputs(
          convexOrgId,
          convexProjectId,
          runId,
          outputDir,
          { projectName, runTimestamp }
        );
        r2UploadFailed = r2Manifest.uploadReport.failed.length > 0;
        console.log(`Uploaded ${Object.keys(r2Manifest.outputs).length} output files to R2`);
        if (r2UploadFailed) {
          console.warn(
            `[R2] ${r2Manifest.uploadReport.failed.length} artifact upload(s) failed for run ${runId}`,
          );
          Sentry.captureMessage('R2 artifact upload partially failed after retries', {
            level: 'warning',
            tags: { run_id: runId, pipeline_id: pipelineId },
            extra: {
              failedCount: r2Manifest.uploadReport.failed.length,
              failedArtifacts: r2Manifest.uploadReport.failed.map(f => f.relativePath),
              successCount: Object.keys(r2Manifest.outputs).length,
            },
          });
        }
      } catch (r2Error) {
        r2UploadFailed = true;
        console.error('R2 output upload failed — downloads will be unavailable:', r2Error);
        Sentry.captureException(r2Error, {
          tags: { run_id: runId, pipeline_id: pipelineId },
          extra: { context: 'R2 pipeline output upload failed completely after retries' },
        });
      }
    }

    if (r2Manifest?.outputs && convexOrgId && convexProjectId) {
      try {
        await finalizeExportMetadataWithR2Refs(outputDir, r2Manifest.outputs);
        const refreshedManifest = await buildPhase1Manifest(outputDir);
        const refreshedMetadataBuffer = await fs.readFile(path.join(outputDir, 'export/export-metadata.json'));
        r2Manifest.outputs['export/export-metadata.json'] = await uploadRunOutputArtifact({
          orgId: convexOrgId,
          projectId: convexProjectId,
          runId,
          relativePath: 'export/export-metadata.json',
          body: refreshedMetadataBuffer,
          contentType: 'application/json',
          existingOutputs: r2Manifest.outputs,
        });
        exportArtifacts = buildExportArtifactRefs(refreshedManifest.metadata);
        exportReadiness = refreshedManifest.metadata.readiness;
      } catch (exportFinalizeErr) {
        const message = exportFinalizeErr instanceof Error ? exportFinalizeErr.message : String(exportFinalizeErr);
        console.warn('[ExportData] Failed to finalize export metadata with R2 refs (non-fatal):', exportFinalizeErr);
        exportErrors.push({
          format: 'shared',
          stage: 'r2_finalize',
          message,
          retryable: true,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Downgrade to 'partial' if Excel was generated but R2 upload failed
    const finalStatus: RunStatus = excelGenerated
      ? (r2UploadFailed ? 'partial' : 'success')
      : (rExecutionSuccess ? 'partial' : 'error');
    const tableCount = computeResult.rScriptInput.tables.length;
    const cutCount = computeResult.rScriptInput.cuts.length;
    const bannerGroupCount = planningResult.crosstabPlan.crosstabPlan.bannerCuts.length;

    const finalMessage = excelGenerated
      ? r2UploadFailed
        ? `Generated ${tableCount} tables but file upload failed — contact support.`
        : `Complete! Generated ${tableCount} crosstab tables in ${durationSec}s`
      : rExecutionSuccess
        ? 'R execution complete but Excel generation failed.'
        : 'R scripts generated. Execution failed - check R installation.';

    // Quality evaluation
    const qualityEval = await evaluateAndPersistRunQuality({
      runId,
      outputDir,
      orgId: convexOrgId,
      projectId: convexProjectId,
      datasetKeyHint: datasetName,
    });
    if (!qualityEval.evaluated) {
      console.log(`[RunQuality] Skipped evaluation: ${qualityEval.reason ?? 'unknown'}`);
    } else {
      console.log(
        `[RunQuality] score=${qualityEval.quality?.score ?? '-'} grade=${qualityEval.quality?.grade ?? '-'} divergence=${qualityEval.quality?.divergenceLevel ?? '-'}`
      );
    }

    // Update Convex run status
    const terminalResult: RunResultShape = {
      formatVersion: 3,
      pipelineId,
      outputDir,
      downloadUrl: excelGenerated
        ? `/api/runs/${encodeURIComponent(runId)}/download/crosstabs.xlsx`
        : undefined,
      dataset: datasetName,
      v3Checkpoint: mergedCheckpoint,
      r2Files: r2Manifest ? { inputs: r2Manifest.inputs, outputs: r2Manifest.outputs } : undefined,
      summary: {
        tables: tableCount,
        cuts: cutCount,
        bannerGroups: bannerGroupCount,
        durationMs: totalDuration,
      },
      pipelineDecisions,
      decisionsSummary,
      quality: qualityEval.quality as RunResultShape['quality'],
      ...(exportArtifacts ? { exportArtifacts: exportArtifacts as unknown as RunResultShape['exportArtifacts'] } : {}),
      ...(exportReadiness ? { exportReadiness: exportReadiness as RunResultShape['exportReadiness'] } : {}),
      ...(exportErrors.length > 0 ? { exportErrors } : {}),
      costSummary: {
        totalCostUsd: costMetrics.totals.estimatedCostUsd,
        totalTokens: costMetrics.totals.totalTokens,
        totalCalls: costMetrics.totals.calls,
        byAgent: costMetrics.byAgent.map(a => ({
          agent: a.agentName,
          model: a.model,
          calls: a.calls,
          tokens: a.totalInputTokens + a.totalOutputTokens,
          costUsd: a.estimatedCostUsd,
        })),
      },
    };

    await updateRunStatus(runId, {
      status: finalStatus,
      stage: 'complete',
      progress: 100,
      message: finalMessage,
      result: terminalResult,
    });
    cleanupAbort(runId);

    // Record billing usage on first successful run for this project (skip for demo)
    if ((finalStatus === 'success' || finalStatus === 'partial') && !wizardConfig?.demoMode) {
      try {
        const { recordProjectUsage } = await import('@/lib/billing/recordProjectUsage');
        await recordProjectUsage({
          projectId: String(convexProjectId),
          orgId: String(convexOrgId),
        });
      } catch (err) {
        console.warn('[Pipeline] Billing usage recording failed (non-blocking):', err);
      }
    }

    // Demo mode: generate Q/WinCross export files locally before email delivery
    if (wizardConfig?.demoMode && (finalStatus === 'success' || finalStatus === 'partial')) {
      try {
        const { generateLocalQAndWinCrossExports } = await import('@/lib/exportData/localExports');
        const localExportResult = await generateLocalQAndWinCrossExports(outputDir);
        const successes = [
          localExportResult.q.success ? 'Q' : null,
          localExportResult.wincross.success ? 'WinCross' : null,
        ].filter(Boolean);
        if (successes.length > 0) {
          console.log(`[Demo] Local exports generated: ${successes.join(', ')}`);
        }
        if (localExportResult.errors.length > 0) {
          console.warn(`[Demo] Local export errors (non-fatal):`, localExportResult.errors.map(e => e.message));
        }
      } catch (exportErr) {
        console.warn('[Demo] Local export generation failed (non-fatal):', exportErr);
      }
    }

    // Demo mode: update demoRun status and send output email if verified
    if (wizardConfig?.demoMode && runId) {
      try {
        const demoRun = await queryInternal(internal.demoRuns.getByRunId, {
          convexRunId: runId as Id<"runs">,
        });

        if (demoRun) {
          await mutateInternal(internal.demoRuns.updatePipelineStatus, {
            demoRunId: demoRun._id,
            pipelineStatus: finalStatus === 'success' ? 'success' : finalStatus === 'partial' ? 'partial' : 'error',
            outputTempDir: outputDir,
            completedAt: Date.now(),
          });

          // If email is already verified and pipeline succeeded, send output immediately
          if (demoRun.emailVerified && (finalStatus === 'success' || finalStatus === 'partial')) {
            const { deliverDemoOutputIfReady } = await import('@/lib/demo/delivery');
            const delivery = await deliverDemoOutputIfReady(demoRun._id, {
              tableCount: wizardConfig.maxTables ?? 25,
              durationFormatted: durationHuman,
            });
            if (delivery.sent) {
              console.log(`[Demo] Output email sent to ${demoRun.email}`);
            }
          } else if (!demoRun.emailVerified) {
            console.log(`[Demo] Pipeline complete but email not verified — output waits for verification`);
          }
        }
      } catch (demoErr) {
        console.warn('[Demo] Demo completion handler failed (non-blocking):', demoErr);
      }
    }

    // Track pipeline completion (PostHog)
    const posthog = getPostHogClient();
    const agentCosts: Record<string, number> = {};
    const agentDurations: Record<string, number> = {};
    const agentCalls: Record<string, number> = {};
    const agentTokens: Record<string, { input: number; output: number }> = {};

    for (const agent of costMetrics.byAgent) {
      const key = agent.agentName;
      agentCosts[key] = (agentCosts[key] || 0) + agent.estimatedCostUsd;
      agentDurations[key] = (agentDurations[key] || 0) + agent.totalDurationMs / 1000;
      agentCalls[key] = (agentCalls[key] || 0) + agent.calls;
      agentTokens[key] = {
        input: (agentTokens[key]?.input || 0) + agent.totalInputTokens,
        output: (agentTokens[key]?.output || 0) + agent.totalOutputTokens,
      };
    }

    posthog.capture({
      distinctId: convexOrgId || 'anonymous',
      event: 'pipeline_completed',
      properties: {
        run_id: runId,
        pipeline_id: pipelineId,
        status: finalStatus,
        table_count: tableCount,
        cut_count: cutCount,
        duration_sec: durationSec,
        excel_generated: excelGenerated,
        r2_upload_failed: r2UploadFailed,
        total_cost_usd: costMetrics.totals.estimatedCostUsd,
        total_tokens: costMetrics.totals.totalTokens,
        total_input_tokens: costMetrics.totals.inputTokens,
        total_output_tokens: costMetrics.totals.outputTokens,
        total_agent_calls: costMetrics.totals.calls,
        agent_costs: agentCosts,
        agent_durations_sec: agentDurations,
        agent_call_counts: agentCalls,
        agent_tokens: agentTokens,
        has_loops: resolvedLoopMappings.length > 0,
        loop_count: resolvedLoopMappings.length,
        variable_count: verboseDataMap.length,
        project_type: wizardConfig?.projectSubType || 'standard',
        banner_mode: wizardConfig?.bannerMode || 'upload',
        weighted: !!wizardConfig?.weightVariable,
        quality_evaluated: qualityEval.evaluated,
        quality_score: qualityEval.quality?.score,
        quality_grade: qualityEval.quality?.grade,
        quality_divergence: qualityEval.quality?.divergenceLevel,
        quality_baseline_version: qualityEval.quality?.baselineVersion,
        quality_skip_reason: qualityEval.reason,
      },
    });

    // Send email notification (fire-and-forget)
    sendPipelineNotification({
      runId,
      status: finalStatus as 'success' | 'partial' | 'error',
      launchedBy,
      convexProjectId,
      convexOrgId,
      tableCount,
      durationFormatted: durationHuman,
    }).catch(() => { /* swallowed */ });

    // Clean up temp session files
    try { await cleanupSession(sessionId); } catch { /* best-effort */ }

  } catch (processingError) {
    if (isAbortError(processingError)) {
      console.log('Pipeline processing was cancelled');
      metricsCollector.unbindWideEvent();
      wideEvent.finish('cancelled', 'Pipeline cancelled');
      await handleCancellation(outputDir, runId, 'Pipeline cancelled');
      try { await cleanupSession(sessionId); } catch { /* best-effort */ }
      return;
    }

    const procErrorMsg = processingError instanceof Error ? processingError.message : 'Unknown error';
    metricsCollector.unbindWideEvent();
    wideEvent.set('topError', procErrorMsg);
    wideEvent.set('finalStage', 'pipeline_error');
    // Try to read persisted pipeline errors for summary context
    try {
      const catchErrorRead = await readPipelineErrors(outputDir);
      if (catchErrorRead.records.length > 0) {
        wideEvent.set('errorSummary', summarizePipelineErrors(catchErrorRead.records));
      }
    } catch { /* best-effort */ }
    wideEvent.finish('error', procErrorMsg);
    console.error('Pipeline error:', processingError);
    try {
      await persistSystemError({
        outputDir: outputDir || getGlobalSystemOutputDir(),
        dataset: datasetName || '',
        pipelineId: pipelineId || '',
        stageNumber: 0,
        stageName: 'API',
        severity: 'fatal',
        actionTaken: 'failed_pipeline',
        error: processingError,
        meta: { runId },
      });
    } catch {
      // ignore
    }
    await updateRunStatus(runId, {
      status: 'error',
      stage: 'error',
      progress: 100,
      message: 'Processing error',
      error: processingError instanceof Error ? processingError.message : 'Unknown error',
    });
    if (wizardConfig?.demoMode && runId) {
      try {
        const demoRun = await queryInternal(internal.demoRuns.getByRunId, {
          convexRunId: runId as Id<"runs">,
        });
        if (demoRun) {
          await mutateInternal(internal.demoRuns.updatePipelineStatus, {
            demoRunId: demoRun._id,
            pipelineStatus: 'error',
            completedAt: Date.now(),
          });
        }
      } catch (demoErr) {
        console.warn('[Demo] Failed to persist demo error status:', demoErr);
      }
    }
    cleanupAbort(runId);

    // Track pipeline failure (PostHog)
    const posthog = getPostHogClient();
    const partialCostMetrics = await metricsCollector.getSummary();
    const failureDurationMs = Date.now() - processingStartTime;

    posthog.capture({
      distinctId: convexOrgId || 'anonymous',
      event: 'pipeline_failed',
      properties: {
        run_id: runId,
        pipeline_id: pipelineId || '',
        error_class: processingError instanceof Error ? processingError.constructor.name : 'NonError',
        partial_cost_usd: partialCostMetrics.totals.estimatedCostUsd,
        partial_tokens: partialCostMetrics.totals.totalTokens,
        partial_agent_calls: partialCostMetrics.totals.calls,
        duration_before_failure_sec: (failureDurationMs / 1000).toFixed(1),
        project_type: wizardConfig?.projectSubType || 'standard',
        banner_mode: wizardConfig?.bannerMode || 'upload',
      },
    });

    // Send error email notification (fire-and-forget)
    sendPipelineNotification({
      runId,
      status: 'error',
      launchedBy,
      convexProjectId,
      convexOrgId,
      errorMessage: procErrorMsg,
    }).catch(() => { /* swallowed */ });

    // Clean up temp session files on error too
    try { await cleanupSession(sessionId); } catch { /* best-effort */ }
  } finally {
    stopHeartbeat();
    await consoleCapture.stop();
  }
  }); // end consoleCapture.run
  }); // end runWithMetricsCollector
    },
  );
}
