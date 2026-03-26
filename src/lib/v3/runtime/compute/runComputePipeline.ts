/**
 * V3 Runtime — Compute Chain Pipeline Orchestrator (Stages 22 + 14)
 *
 * Executes stages 22 -> 14 in order.
 * At each boundary: writes artifact to `stages/<artifactName>`, records checkpoint.
 * Reads checkpoint on start; if resuming, skips completed stages and loads last artifact.
 *
 * Uses `getStageRange('22', '14')` from stageOrder.ts — never hardcodes order.
 *
 * Follows the Phase 2/3 pattern established by runCanonicalPipeline.ts and
 * runPlanningPipeline.ts:
 *   - Sequential stage execution via getStageRunner dispatch
 *   - Artifact persistence at each boundary
 *   - Checkpoint after each stage for resume support
 *   - AbortSignal checked before each stage
 *
 * Stage 22 emits `r-script-input.json` as its artifact.
 * Stage 14 is a validation-only stage — produces no chained artifact (null).
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

import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import { resolveStatConfig } from './resolveStatConfig';
import { buildComputePackage } from './buildComputePackage';
import { runPostRQc } from './postRQc';
import { tagLoopDataFrames } from './tagLoopDataFrames';

import type {
  ComputeChainInput,
  ComputeChainResult,
  ComputePackageOutput,
  PostRQcResult,
} from './types';

// =============================================================================
// Per-Stage State
// =============================================================================

interface ComputeChainState {
  computePackage: ComputePackageOutput | null;
  postRQcResult: PostRQcResult | null;
}

// =============================================================================
// Supplementary Artifact Writers
// =============================================================================

const COMPUTE_PACKAGE_FILENAME = 'compute-package.json';
const CUTS_SPEC_FILENAME = 'cuts-spec.json';
const STAT_CONFIG_FILENAME = 'stat-testing-config.json';
const ROUTE_METADATA_FILENAME = 'compute-route-metadata.json';
const POST_R_QC_FILENAME = 'post-r-qc-report.json';

/**
 * Write supplementary debug/diagnostic artifacts alongside canonical stage artifacts.
 */
async function writeSupplementaryArtifacts(
  outputDir: string,
  stageId: V3StageId,
  state: ComputeChainState,
  statTestingConfig: import('@/lib/env').StatTestingConfig,
): Promise<void> {
  const computeDir = getSubDir(outputDir, 'compute');
  await fs.mkdir(computeDir, { recursive: true });

  if (stageId === '22' && state.computePackage) {
    const { cutsSpec, routeMetadata, rScriptInput } = state.computePackage;

    // compute-package.json — full package with metadata (script parity)
    await fs.writeFile(
      path.join(computeDir, COMPUTE_PACKAGE_FILENAME),
      JSON.stringify({
        metadata: routeMetadata,
        tables: rScriptInput.tables,
        cutsSpec,
        statTestingConfig,
      }, null, 2),
      'utf-8',
    );

    // cuts-spec.json
    await fs.writeFile(
      path.join(computeDir, CUTS_SPEC_FILENAME),
      JSON.stringify(cutsSpec, null, 2),
      'utf-8',
    );

    // stat-testing-config.json
    await fs.writeFile(
      path.join(computeDir, STAT_CONFIG_FILENAME),
      JSON.stringify(statTestingConfig, null, 2),
      'utf-8',
    );

    // compute-route-metadata.json
    await fs.writeFile(
      path.join(computeDir, ROUTE_METADATA_FILENAME),
      JSON.stringify(routeMetadata, null, 2),
      'utf-8',
    );
  }

  if (stageId === '14' && state.postRQcResult) {
    await fs.writeFile(
      path.join(computeDir, POST_R_QC_FILENAME),
      JSON.stringify(state.postRQcResult, null, 2),
      'utf-8',
    );
  }
}

// =============================================================================
// Stage Runner Dispatch
// =============================================================================

type StageRunner = (
  state: ComputeChainState,
  input: ComputeChainInput,
  statTestingConfig: import('@/lib/env').StatTestingConfig,
) => Promise<ComputeChainState>;

function getStageRunner(stageId: V3StageId): StageRunner {
  switch (stageId) {
    case '22':
      return async (_state, input, statTestingConfig) => {
        const cutsSpec = buildCutsSpec(input.crosstabPlan);
        const loopAwareTables = tagLoopDataFrames(input.tables, input.loopMappings);

        const computePackage = buildComputePackage({
          tables: loopAwareTables,
          cutsSpec,
          statTestingConfig,
          loopMappings: input.loopMappings,
          loopSemanticsPolicy: input.loopSemanticsPolicy,
          compiledLoopContract: input.compiledLoopContract,
          loopStatTestingMode: input.loopStatTestingMode,
          weightVariable: input.weightVariable,
          maxRespondents: input.maxRespondents,
        });

        return {
          computePackage,
          postRQcResult: null,
        };
      };

    case '14':
      return async (state, input) => {
        if (!state.computePackage) {
          throw new Error('Cannot run stage 14 (post-R QC) without compute package from stage 22');
        }

        const postRQcResult = runPostRQc({
          rScriptInput: state.computePackage.rScriptInput,
          cutsSpec: state.computePackage.cutsSpec,
          outputDir: input.outputDir,
        });

        return {
          ...state,
          postRQcResult,
        };
      };

    default:
      throw new Error(`No stage runner for compute chain stage: ${stageId}`);
  }
}

/**
 * Get the canonical artifact data to write for a given stage.
 */
function getArtifactData(stageId: V3StageId, state: ComputeChainState): unknown {
  switch (stageId) {
    case '22':
      return state.computePackage?.rScriptInput ?? null;
    case '14':
      return null; // Stage 14 produces no chained artifact
    default:
      return null;
  }
}

// =============================================================================
// Resume — Restore State from Artifact
// =============================================================================

async function restoreStateFromArtifact(
  outputDir: string,
  lastCompletedStage: V3StageId,
): Promise<ComputeChainState | null> {
  const state: ComputeChainState = {
    computePackage: null,
    postRQcResult: null,
  };

  switch (lastCompletedStage) {
    case '22': {
      // Load the r-script-input.json artifact
      const rScriptInput = await loadArtifact<ComputePackageOutput['rScriptInput']>(outputDir, '22');
      if (!rScriptInput) return null;

      // Try to load supplementary artifacts for full state restoration
      let cutsSpec = null;
      let routeMetadata = null;
      const computeDir = getSubDir(outputDir, 'compute');
      try {
        cutsSpec = JSON.parse(await fs.readFile(path.join(computeDir, CUTS_SPEC_FILENAME), 'utf-8'));
      } catch {
        // Fallback: try legacy stages/ path
        try {
          cutsSpec = JSON.parse(await fs.readFile(path.join(outputDir, 'stages', CUTS_SPEC_FILENAME), 'utf-8'));
        } catch { /* supplementary — best effort */ }
      }

      try {
        routeMetadata = JSON.parse(await fs.readFile(path.join(computeDir, ROUTE_METADATA_FILENAME), 'utf-8'));
      } catch {
        // Fallback: try legacy stages/ path
        try {
          routeMetadata = JSON.parse(await fs.readFile(path.join(outputDir, 'stages', ROUTE_METADATA_FILENAME), 'utf-8'));
        } catch { /* supplementary — best effort */ }
      }

      // If cutsSpec not available from supplementary, derive from rScriptInput
      if (!cutsSpec) {
        cutsSpec = {
          cuts: rScriptInput.cuts,
          groups: rScriptInput.cutGroups ?? [],
          totalCut: rScriptInput.cuts.find((c: { name: string }) => c.name === 'Total') ?? null,
        };
      }

      state.computePackage = {
        rScriptInput,
        cutsSpec,
        routeMetadata: routeMetadata ?? {
          generatedAt: 'resumed',
          tableCount: rScriptInput.tables?.length ?? 0,
          cutCount: rScriptInput.cuts?.length ?? 0,
          cutGroupCount: rScriptInput.cutGroups?.length ?? 0,
          totalStatLetter: cutsSpec.totalCut?.statLetter ?? null,
        },
      };

      return state;
    }

    case '14': {
      // Both stages complete. Load stage 22 artifact for result construction.
      const restored22 = await restoreStateFromArtifact(outputDir, '22');
      if (!restored22) return null;

      // Try to load post-R QC report
      try {
        const qcPath = path.join(getSubDir(outputDir, 'compute'), POST_R_QC_FILENAME);
        const qcResult = JSON.parse(await fs.readFile(qcPath, 'utf-8'));
        restored22.postRQcResult = qcResult;
      } catch {
        // QC report is supplementary — use a success placeholder
        restored22.postRQcResult = { valid: true, warnings: [], errors: [] };
      }

      return restored22;
    }

    default:
      return null;
  }
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Run the compute chain pipeline (stages 22–14).
 *
 * - Executes stages sequentially in stageOrder.ts order
 * - Persists artifacts at each boundary
 * - Records checkpoint after each stage
 * - Supports resume from existing checkpoint
 *
 * Stage 22 assembles the R script input from canonical tables + crosstab plan.
 * Stage 14 validates the compute output (non-artifact stage).
 *
 * @returns Compute package, stat config, cutsSpec, and updated checkpoint.
 */
export async function runComputePipeline(
  input: ComputeChainInput,
): Promise<ComputeChainResult> {
  const { outputDir, pipelineId, dataset } = input;
  const stages = getStageRange('22', '14');

  // Resolve stat config once for the entire chain
  const statTestingConfig = resolveStatConfig({
    explicit: input.statTestingConfig,
    wizard: input.wizardStatTesting,
  });

  // Load or create checkpoint
  let checkpoint = input.checkpoint ?? await loadCheckpoint(outputDir);
  if (!checkpoint) {
    checkpoint = createPipelineCheckpoint(pipelineId, dataset);
  }

  // Initialize state
  let state: ComputeChainState = {
    computePackage: null,
    postRQcResult: null,
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
          `[V3] Resuming compute chain from stage ${lastCompleted} ` +
          `(${V3_STAGE_NAMES[lastCompleted as V3StageId]}), skipping ${startIndex} stage(s)`,
        );
      } else {
        console.warn(
          `[V3] Could not load artifact for stage ${lastCompleted}, restarting compute chain from 22`,
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
    state = await runner(state, input, statTestingConfig);

    const durationMs = Date.now() - stageStart;

    // Persist canonical artifact
    const artifactData = getArtifactData(stageId, state);
    const artifactPath = artifactData
      ? await writeArtifact(outputDir, stageId, artifactData)
      : outputDir;

    // Persist supplementary artifacts (non-blocking, best-effort)
    try {
      await writeSupplementaryArtifacts(outputDir, stageId, state, statTestingConfig);
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
  if (!state.computePackage) {
    throw new Error('Compute pipeline incomplete: compute package (stage 22) was not produced.');
  }

  return {
    rScriptInput: state.computePackage.rScriptInput,
    cutsSpec: state.computePackage.cutsSpec,
    statTestingConfig,
    routeMetadata: state.computePackage.routeMetadata,
    checkpoint,
  };
}
