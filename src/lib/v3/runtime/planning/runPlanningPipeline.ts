/**
 * V3 Runtime — Planning Chain Pipeline Orchestrator (Stages 20–21)
 *
 * Executes stages 20 -> 21 in order.
 * At each boundary: writes artifact to `stages/<artifactName>`, records checkpoint.
 * Reads checkpoint on start; if resuming, skips completed stages and loads last artifact.
 *
 * Uses `getStageRange('20', '21')` from stageOrder.ts — never hardcodes order.
 *
 * Follows the Phase 2 pattern established by runCanonicalPipeline.ts:
 *   - Sequential stage execution via getStageRunner dispatch
 *   - Artifact persistence at each boundary
 *   - Checkpoint after each stage for resume support
 *   - AbortSignal checked before each stage
 *   - Non-fatal handling posture aligned with existing runtime chain behavior
 *
 * Stage 21a (banner diagnostic) is optional and non-blocking.
 * It is NOT a pipeline stage — call runBannerDiagnostic() separately when needed.
 */

import fs from 'fs/promises';
import path from 'path';

import {
  getStageRange,
  V3_STAGE_NAMES,
  type V3StageId,
} from '../stageOrder';
import {
  recordStageCompletion,
  createPipelineCheckpoint,
} from '../contracts';
import {
  writeArtifact,
  writeCheckpoint,
  loadCheckpoint,
  loadArtifact,
  getSubDir,
} from '../persistence';

import type {
  PlanningChainInput,
  PlanningChainResult,
  BannerPlanResult,
  CrosstabPlanResult,
  BannerPlanInputType,
  BannerRouteMetadata,
} from './types';

// Stage modules
import { runBannerPlan } from './bannerPlan';
import { runCrosstabPlan } from './crosstabPlan';

// =============================================================================
// Per-Stage State
// =============================================================================

interface PlanningChainState {
  bannerPlanResult: BannerPlanResult | null;
  crosstabPlanResult: CrosstabPlanResult | null;
}

// =============================================================================
// Stage Runner Dispatch
// =============================================================================

type StageRunner = (
  state: PlanningChainState,
  input: PlanningChainInput,
) => Promise<PlanningChainState>;

function getStageRunner(stageId: V3StageId): StageRunner {
  switch (stageId) {
    case '20':
      return async (_state, input) => {
        const result = await runBannerPlan({
          entries: input.entries,
          metadata: input.metadata,
          savPath: input.savPath,
          datasetPath: input.datasetPath,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
          maxRespondents: input.maxRespondents,
          researchObjectives: input.researchObjectives,
          cutSuggestions: input.cutSuggestions,
          projectType: input.projectType,
        });

        return {
          bannerPlanResult: result,
          crosstabPlanResult: null,
        };
      };

    case '21':
      return async (state, input) => {
        if (!state.bannerPlanResult) {
          throw new Error('Cannot run stage 21 (crosstab-plan) without banner plan from stage 20');
        }

        const result = await runCrosstabPlan({
          entries: input.entries,
          metadata: input.metadata,
          bannerPlan: state.bannerPlanResult.bannerPlan,
          savPath: input.savPath,
          datasetPath: input.datasetPath,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
          maxRespondents: input.maxRespondents,
          researchObjectives: input.researchObjectives,
          cutSuggestions: input.cutSuggestions,
          projectType: input.projectType,
        });

        return {
          ...state,
          crosstabPlanResult: result,
        };
      };

    default:
      throw new Error(`No stage runner for planning chain stage: ${stageId}`);
  }
}

/**
 * Get the artifact data to write for a given stage from the current state.
 */
function getArtifactData(stageId: V3StageId, state: PlanningChainState): unknown {
  switch (stageId) {
    case '20':
      return state.bannerPlanResult?.bannerPlan ?? null;
    case '21':
      return state.crosstabPlanResult?.crosstabPlan ?? null;
    default:
      return null;
  }
}

// =============================================================================
// Resume — Restore State from Artifact
// =============================================================================

const BANNER_ROUTE_METADATA_FILENAME = 'banner-route-metadata.json';
const CROSSTAB_ROUTE_METADATA_FILENAME = 'crosstab-route-metadata.json';

/**
 * Load the supplementary banner route metadata written alongside banner-plan.json.
 * Returns the real metadata if available, otherwise a minimal placeholder.
 */
async function loadBannerRouteMetadata(
  outputDir: string,
  bannerPlan: BannerPlanInputType,
): Promise<BannerRouteMetadata> {
  // Try new planning/ path first, then legacy stages/ path
  for (const dir of [getSubDir(outputDir, 'planning'), path.join(outputDir, 'stages')]) {
    try {
      const metaPath = path.join(dir, BANNER_ROUTE_METADATA_FILENAME);
      const raw = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(raw) as BannerRouteMetadata;
    } catch { /* try next */ }
  }

  // Supplementary file missing — derive what we can from the canonical artifact
  return {
    routeUsed: 'banner_agent',
    bannerFile: null,
    generatedAt: 'resumed',
    groupCount: bannerPlan.bannerCuts.length,
    columnCount: bannerPlan.bannerCuts.reduce(
      (sum, g) => sum + g.columns.length, 0,
    ),
    sourceConfidence: 0,
    usedFallbackFromBannerAgent: false,
    bannerGenerateInputSource: null,
  };
}

/**
 * Load the supplementary crosstab route metadata written alongside crosstab-plan.json.
 */
async function loadCrosstabRouteMetadata(
  outputDir: string,
): Promise<Record<string, unknown> | null> {
  // Try new planning/ path first, then legacy stages/ path
  for (const dir of [getSubDir(outputDir, 'planning'), path.join(outputDir, 'stages')]) {
    try {
      const metaPath = path.join(dir, CROSSTAB_ROUTE_METADATA_FILENAME);
      const raw = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { /* try next */ }
  }
  return null;
}

async function restoreStateFromArtifact(
  outputDir: string,
  lastCompletedStage: V3StageId,
): Promise<PlanningChainState | null> {
  const state: PlanningChainState = {
    bannerPlanResult: null,
    crosstabPlanResult: null,
  };

  switch (lastCompletedStage) {
    case '20': {
      const bannerPlan = await loadArtifact<BannerPlanInputType>(outputDir, '20');
      if (!bannerPlan) return null;

      const routeMetadata = await loadBannerRouteMetadata(outputDir, bannerPlan);
      state.bannerPlanResult = { bannerPlan, routeMetadata };
      return state;
    }

    case '21': {
      // Both stages complete — load both artifacts for result construction
      const bannerPlan = await loadArtifact<BannerPlanInputType>(outputDir, '20');
      const crosstabPlan = await loadArtifact<import('@/schemas/agentOutputSchema').ValidationResultType>(outputDir, '21');

      if (!bannerPlan || !crosstabPlan) return null;

      const routeMetadata = await loadBannerRouteMetadata(outputDir, bannerPlan);
      state.bannerPlanResult = { bannerPlan, routeMetadata };
      const crosstabMeta = await loadCrosstabRouteMetadata(outputDir);
      state.crosstabPlanResult = {
        crosstabPlan,
        resolvedBannerPlan: bannerPlan,
        resolvedBannerPlanInfo: (crosstabMeta?.resolvedBannerPlanInfo as CrosstabPlanResult['resolvedBannerPlanInfo']) ?? {
          source: 'step20',
          fallbackUsed: false,
          fallbackReason: null,
          originalGroupCount: bannerPlan.bannerCuts.length,
          originalColumnCount: bannerPlan.bannerCuts.reduce(
            (sum, g) => sum + g.columns.length, 0,
          ),
          finalGroupCount: bannerPlan.bannerCuts.length,
          finalColumnCount: bannerPlan.bannerCuts.reduce(
            (sum, g) => sum + g.columns.length, 0,
          ),
        },
        questions: [],
        loopIterationCount: (crosstabMeta?.loopIterationCount as number) ?? 0,
        questionCount: (crosstabMeta?.questionCount as number) ?? 0,
        variableCount: (crosstabMeta?.variableCount as number) ?? 0,
        averageConfidence: (crosstabMeta?.averageConfidence as number) ?? 0,
      };

      return state;
    }

    default:
      return null;
  }
}

// =============================================================================
// Supplementary Artifact Writers
// =============================================================================

/**
 * Write supplementary metadata artifacts alongside the canonical stage artifacts.
 * These don't affect checkpoint progression but provide debugging context.
 */
async function writeSupplementaryArtifacts(
  outputDir: string,
  stageId: V3StageId,
  state: PlanningChainState,
): Promise<void> {
  const planningDir = getSubDir(outputDir, 'planning');
  await fs.mkdir(planningDir, { recursive: true });

  if (stageId === '20' && state.bannerPlanResult) {
    await fs.writeFile(
      path.join(planningDir, 'banner-route-metadata.json'),
      JSON.stringify(state.bannerPlanResult.routeMetadata, null, 2),
      'utf-8',
    );
  }

  if (stageId === '21' && state.crosstabPlanResult) {
    await fs.writeFile(
      path.join(planningDir, 'crosstab-route-metadata.json'),
      JSON.stringify({
        resolvedBannerPlanInfo: state.crosstabPlanResult.resolvedBannerPlanInfo,
        questionCount: state.crosstabPlanResult.questionCount,
        variableCount: state.crosstabPlanResult.variableCount,
        loopIterationCount: state.crosstabPlanResult.loopIterationCount,
        averageConfidence: state.crosstabPlanResult.averageConfidence,
      }, null, 2),
      'utf-8',
    );
  }
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Run the planning chain pipeline (stages 20–21).
 *
 * - Executes stages sequentially in stageOrder.ts order
 * - Persists artifacts at each boundary
 * - Records checkpoint after each stage
 * - Supports resume from existing checkpoint
 *
 * Stage 21a (banner diagnostic) is NOT executed here.
 * Call runBannerDiagnostic() separately if needed.
 *
 * @returns Banner plan, crosstab plan, and updated checkpoint.
 */
export async function runPlanningPipeline(
  input: PlanningChainInput,
): Promise<PlanningChainResult> {
  const { outputDir, pipelineId, dataset } = input;
  const stages = getStageRange('20', '21');

  // Load or create checkpoint
  let checkpoint = input.checkpoint ?? await loadCheckpoint(outputDir);
  if (!checkpoint) {
    checkpoint = createPipelineCheckpoint(pipelineId, dataset);
  }

  // Initialize state
  let state: PlanningChainState = {
    bannerPlanResult: null,
    crosstabPlanResult: null,
  };

  let startIndex = 0;

  // If resuming, load the last completed artifact and skip those stages
  const lastCompleted = checkpoint.lastCompletedStage;
  if (lastCompleted) {
    const completedIdx = stages.indexOf(lastCompleted as V3StageId);
    if (completedIdx >= 0) {
      startIndex = completedIdx + 1;

      const restored = await restoreStateFromArtifact(
        outputDir,
        lastCompleted as V3StageId,
      );
      if (restored) {
        state = restored;
        console.log(
          `[V3] Resuming planning chain from stage ${lastCompleted} ` +
          `(${V3_STAGE_NAMES[lastCompleted as V3StageId]}), skipping ${startIndex} stage(s)`,
        );
      } else {
        // Can't load artifact — restart from beginning
        console.warn(
          `[V3] Could not load artifact for stage ${lastCompleted}, restarting planning chain from 20`,
        );
        startIndex = 0;
        checkpoint = createPipelineCheckpoint(pipelineId, dataset);
      }
    }
  }

  // Execute remaining stages
  for (let i = startIndex; i < stages.length; i++) {
    const stageId = stages[i];
    const stageName = V3_STAGE_NAMES[stageId];

    // Check for abort
    if (input.abortSignal?.aborted) {
      console.log(`[V3] Aborted before stage ${stageId} (${stageName})`);
      break;
    }

    console.log(`[V3] Running stage ${stageId}: ${stageName}`);
    const stageStart = Date.now();

    const runner = getStageRunner(stageId);
    state = await runner(state, input);

    const durationMs = Date.now() - stageStart;

    // Persist canonical artifact
    const artifactData = getArtifactData(stageId, state);
    const artifactPath = artifactData
      ? await writeArtifact(outputDir, stageId, artifactData)
      : outputDir;

    // Persist supplementary metadata (non-blocking, best-effort)
    try {
      await writeSupplementaryArtifacts(outputDir, stageId, state);
    } catch {
      // Supplementary artifacts are informational — don't fail the pipeline
    }

    // Record checkpoint
    checkpoint = recordStageCompletion(
      checkpoint,
      stageId,
      durationMs,
      artifactPath,
    );
    await writeCheckpoint(outputDir, checkpoint);

    console.log(`[V3] Stage ${stageId} complete (${durationMs}ms)`);
  }

  // Build result
  // If pipeline was aborted mid-way, some fields may be null.
  if (!state.bannerPlanResult) {
    throw new Error('Planning pipeline incomplete: banner plan (stage 20) was not produced.');
  }
  if (!state.crosstabPlanResult) {
    throw new Error('Planning pipeline incomplete: crosstab plan (stage 21) was not produced.');
  }

  return {
    bannerPlan: state.bannerPlanResult,
    crosstabPlan: state.crosstabPlanResult,
    checkpoint,
  };
}
