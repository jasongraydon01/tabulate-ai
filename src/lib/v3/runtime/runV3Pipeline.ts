/**
 * V3 Runtime — Top-Level Pipeline Orchestrator
 *
 * Orchestrates the full V3 pipeline with explicit fork/join semantics:
 *
 *   1. Question-ID chain (stages 00-12) — sequential
 *   2. FORK after stage 12:
 *      - Canonical chain (13b-13d) — table planning + validation + assembly
 *      - Planning chain (20-21) — banner + crosstab planning (includes HITL review checkpoint)
 *   3. JOIN — stage 22 waits for both chains to complete
 *   4. Compute chain (22-14) — R compute input assembly + post-R QC
 *
 * Parallelism rationale: Both the canonical and planning chains consume only
 * `questionid-final.json` from stage 12. They have no data dependency on each
 * other. The HITL reviewer at stage 21 can work while tables are still being
 * assembled (13c/13d). Wall-clock time is reduced by the shorter chain.
 *
 * See: docs/v3-runtime-architecture-refactor-plan.md (Phase 5)
 */

import type { V3PipelineCheckpoint } from './contracts';
import type { TablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';
import { createPipelineCheckpoint } from './contracts';
import { loadCheckpoint, writeCheckpoint } from './persistence';
import { isBefore } from './stageOrder';

import { runQuestionIdPipeline } from './questionId/runQuestionIdPipeline';
import { runSurveyParser } from './questionId/enrich/surveyParser';
import { runTriage } from './questionId/gates/triage';
import type {
  QuestionIdChainInput,
  QuestionIdChainResult,
  ParsedSurveyQuestion,
  SurveyMetadata,
  WrappedQuestionIdOutput,
} from './questionId/types';

import { runCanonicalPipeline } from './canonical/runCanonicalPipeline';
import type { CanonicalChainInput, CanonicalChainResult, PlannerConfig } from './canonical/types';

import { runPlanningPipeline } from './planning/runPlanningPipeline';
import type { PlanningChainInput, PlanningChainResult } from './planning/types';

import { runComputePipeline } from './compute/runComputePipeline';
import type { ComputeChainInput, ComputeChainResult } from './compute/types';
import { canonicalToComputeTables } from './compute/canonicalToComputeTables';
import { writeAgentTracesIndex } from './agentTraces';
import { writeStagesManifest } from './stagesManifest';
import {
  deriveLoopMappings,
  persistLoopSummaryArtifact,
} from './loopMappingsFromQuestionId';

import type { StatTestingConfig } from '@/lib/env';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type { LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';
import { createRespondentAnchoredFallbackPolicy } from '@/schemas/loopSemanticsPolicySchema';
import type { CompiledLoopContract } from '@/schemas/compiledLoopContractSchema';
import { compileLoopContract } from './compileLoopContract';
import type { WizardStatTestingOverrides } from './compute/types';
import type { DeterministicResolverResult } from '@/lib/validation/LoopContextResolver';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';

// =============================================================================
// Types
// =============================================================================

/**
 * Unified input for the full V3 pipeline.
 * Combines question-id, canonical, planning, and compute chain inputs.
 */
export interface V3PipelineInput {
  // --- Question-ID chain inputs ---
  /** Path to the .sav data file */
  savPath: string;
  /** Path to the dataset directory (contains inputs/, etc.) */
  datasetPath: string;
  /** Output directory for artifacts and checkpoint */
  outputDir: string;
  /** Pipeline run identifier */
  pipelineId: string;
  /** Dataset name */
  dataset: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Existing checkpoint for resume */
  checkpoint?: V3PipelineCheckpoint | null;

  // --- Question-ID chain intake config ---
  /** Dataset intake configuration (mirrors UI intake form: message testing, MaxDiff, demand survey, etc.) */
  intakeConfig?: import('./questionId/types').DatasetIntakeConfig;

  // --- Canonical chain config ---
  /** Planner configuration (low-base suppression, etc.) */
  plannerConfig?: PlannerConfig;
  /** Table label vocabulary and presentation preferences. */
  tablePresentationConfig?: TablePresentationConfig;

  // --- Planning chain inputs ---
  /** Optional research objectives for BannerGenerateAgent */
  researchObjectives?: string;
  /** Optional cut suggestions for BannerGenerateAgent */
  cutSuggestions?: string;
  /** Optional project type for BannerGenerateAgent */
  projectType?: string;

  // --- Compute chain inputs ---
  /** Pre-resolved stat testing config */
  statTestingConfig?: StatTestingConfig;
  /** Wizard UI stat testing overrides */
  wizardStatTesting?: WizardStatTestingOverrides | null;
  /** Loop stacking mappings */
  loopMappings?: LoopGroupMapping[];
  /** Per-banner-group loop semantics */
  loopSemanticsPolicy?: LoopSemanticsPolicy;
  /** Loop stat testing mode */
  loopStatTestingMode?: 'suppress' | 'complement';
  /** Weight variable column name */
  weightVariable?: string;

  // --- Loop semantics resolution inputs (used at join point) ---
  /** Deterministic resolver findings for loop-linked variables */
  deterministicFindings?: DeterministicResolverResult;
  /** Verbose datamap for building datamap excerpt for LoopSemanticsPolicyAgent */
  verboseDataMap?: VerboseDataMapType[];

}

/**
 * Result of the full V3 pipeline.
 */
export interface V3PipelineResult {
  /** Question-ID chain result (stages 00-12) */
  questionId: QuestionIdChainResult;
  /** Canonical chain result (stages 13b-13d) */
  canonical: CanonicalChainResult;
  /** Planning chain result (stages 20-21) */
  planning: PlanningChainResult;
  /** Compute chain result (stages 22-14) */
  compute: ComputeChainResult;
  /** Final pipeline checkpoint */
  checkpoint: V3PipelineCheckpoint;
}


// =============================================================================
// Fork/Join Helpers
// =============================================================================

/**
 * Determine the resume phase based on the last completed stage.
 * Returns which phase to start from:
 *   'questionId' — start from scratch or resume within 00-12
 *   'forkJoin'   — question-id complete, resume fork/join (13b-13d ∥ 20-21)
 *   'compute'    — table + banner chains complete, resume compute (22-14)
 *   'complete'   — all stages done
 */
export function getResumePhase(
  checkpoint: V3PipelineCheckpoint | null,
): 'questionId' | 'forkJoin' | 'compute' | 'complete' {
  if (!checkpoint?.lastCompletedStage) return 'questionId';

  const last = checkpoint.lastCompletedStage;

  // Pipeline complete
  if (last === '14') return 'complete';

  // Compute chain in progress or about to start
  if (last === '22') return 'compute';

  // Check if both chains (canonical + planning) are complete
  const completedIds = new Set(
    checkpoint.completedStages.map(s => s.completedStage),
  );
  const canonicalDone = completedIds.has('13e');
  const planningDone = completedIds.has('21');

  if (canonicalDone && planningDone) return 'compute';

  // Check if question-id chain is complete
  if (completedIds.has('12') || isBefore('12', last)) return 'forkJoin';

  return 'questionId';
}

/**
 * Check whether a specific chain is complete in the checkpoint.
 */
function isChainComplete(
  checkpoint: V3PipelineCheckpoint,
  lastStage: '13e' | '21' | '14',
): boolean {
  return checkpoint.completedStages.some(s => s.completedStage === lastStage);
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Run the full V3 pipeline with fork/join parallelism.
 *
 * After stage 12 (questionid-final), the canonical chain (13b-13d) and
 * planning chain (20-21) run concurrently via Promise.all. Stage 22
 * (compute input assembly) waits for both chains to complete.
 *
 */
export async function runV3Pipeline(
  input: V3PipelineInput,
): Promise<V3PipelineResult> {
  const { outputDir, pipelineId, dataset } = input;

  // Load or create checkpoint
  let checkpoint = input.checkpoint ?? await loadCheckpoint(outputDir);
  if (!checkpoint) {
    checkpoint = createPipelineCheckpoint(pipelineId, dataset);
  }

  const resumePhase = getResumePhase(checkpoint);

  // -------------------------------------------------------------------------
  // Phase 1: Question-ID Chain (stages 00-12)
  // -------------------------------------------------------------------------
  let qidResult: QuestionIdChainResult;

  if (resumePhase === 'questionId') {
    console.log('[V3] Running question-id enrichment chain (stages 00-12)...');
    qidResult = await runQuestionIdPipeline({
      savPath: input.savPath,
      datasetPath: input.datasetPath,
      outputDir,
      pipelineId,
      dataset,
      abortSignal: input.abortSignal,
      checkpoint,
      intakeConfig: input.intakeConfig,
    } satisfies QuestionIdChainInput);

    checkpoint = qidResult.checkpoint;
    console.log(`[V3] Question-ID chain complete: ${qidResult.entries.length} entries`);
  } else {
    // Resume: load question-id artifacts from disk
    console.log('[V3] Question-ID chain already complete, loading artifacts...');
    qidResult = await loadQuestionIdResult(input);
  }

  if (input.abortSignal?.aborted) {
    throw new DOMException('Pipeline aborted after question-ID chain', 'AbortError');
  }

  let resolvedLoopMappings = input.loopMappings;
  if (!resolvedLoopMappings || resolvedLoopMappings.length === 0) {
    const loopDerivation = deriveLoopMappings(qidResult.entries);
    if (loopDerivation.hasLoops) {
      resolvedLoopMappings = loopDerivation.loopMappings;
      console.log(`[V3] Loop mappings derived from V3 entries: ${loopDerivation.summary}`);
      await persistLoopSummaryArtifact(outputDir, loopDerivation);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: FORK — Canonical + Planning chains in parallel
  // -------------------------------------------------------------------------
  let canonicalResult: CanonicalChainResult;
  let planningResult: PlanningChainResult;

  if (resumePhase === 'questionId' || resumePhase === 'forkJoin') {
    // Recompute triage deterministically for subtype gate input (13c1).
    const triageFlagged = runTriage(qidResult.entries, qidResult.metadata).flagged;

    const canonicalInput: CanonicalChainInput = {
      entries: qidResult.entries,
      loopMappings: resolvedLoopMappings,
      metadata: qidResult.metadata,
      triageFlagged,
      surveyParsed: qidResult.surveyParsed,
      outputDir,
      pipelineId,
      dataset,
      abortSignal: input.abortSignal,
      checkpoint: isChainComplete(checkpoint, '13e') ? checkpoint : undefined,
      plannerConfig: input.plannerConfig,
      tablePresentationConfig: input.tablePresentationConfig,
    };

    const planningInput: PlanningChainInput = {
      entries: qidResult.entries,
      metadata: qidResult.metadata,
      savPath: input.savPath,
      datasetPath: input.datasetPath,
      outputDir,
      pipelineId,
      dataset,
      abortSignal: input.abortSignal,
      checkpoint: isChainComplete(checkpoint, '21') ? checkpoint : undefined,
      researchObjectives: input.researchObjectives,
      cutSuggestions: input.cutSuggestions,
      projectType: input.projectType,
    };

    // Check if either chain is already complete (partial resume)
    const canonicalAlreadyDone = isChainComplete(checkpoint, '13e');
    const planningAlreadyDone = isChainComplete(checkpoint, '21');

    if (canonicalAlreadyDone && planningAlreadyDone) {
      console.log('[V3] Both canonical and planning chains already complete, loading...');
      [canonicalResult, planningResult] = await Promise.all([
        runCanonicalPipeline(canonicalInput),
        runPlanningPipeline(planningInput),
      ]);
    } else {
      // Run both chains in parallel, wait for both to complete
      console.log('[V3] FORK: Running canonical + planning chains in parallel...');
      const forkStart = Date.now();

      [canonicalResult, planningResult] = await Promise.all([
        runCanonicalPipeline(canonicalInput),
        runPlanningPipeline(planningInput),
      ]);

      const forkDuration = Date.now() - forkStart;
      console.log(
        `[V3] JOIN: Both chains complete (${forkDuration}ms). ` +
        `Tables: ${canonicalResult.tables.length}, ` +
        `Banner groups: ${planningResult.crosstabPlan.crosstabPlan.bannerCuts.length}`,
      );
    }

    // Merge checkpoints from both chains
    checkpoint = mergeParallelCheckpoints(
      checkpoint,
      canonicalResult.checkpoint,
      planningResult.checkpoint,
    );
    await writeCheckpoint(outputDir, checkpoint);
  } else {
    // Resume from compute phase — load chain results from artifacts
    console.log('[V3] Canonical + planning chains already complete, loading artifacts...');
    [canonicalResult, planningResult] = await Promise.all([
      loadCanonicalResultFromArtifacts(input, qidResult),
      loadPlanningResultFromArtifacts(input, qidResult),
    ]);
  }

  if (input.abortSignal?.aborted) {
    throw new DOMException('Pipeline aborted after fork/join phase', 'AbortError');
  }

  let resolvedLoopPolicy = input.loopSemanticsPolicy;

  if (resolvedLoopMappings && resolvedLoopMappings.length > 0 && !resolvedLoopPolicy) {
    // Override input.loopMappings with derived mappings for resolveLoopSemantics
    const inputWithDerivedLoops = { ...input, loopMappings: resolvedLoopMappings };
    resolvedLoopPolicy = await resolveLoopSemantics(
      inputWithDerivedLoops,
      planningResult,
      outputDir,
      qidResult.entries,
    );
  }

  // -------------------------------------------------------------------------
  // Compile Loop Contract (if loop policy exists)
  // -------------------------------------------------------------------------
  let compiledContract: CompiledLoopContract | undefined;
  if (resolvedLoopPolicy && resolvedLoopMappings && resolvedLoopMappings.length > 0) {
    const cutsSpec = buildCutsSpec(planningResult.crosstabPlan.crosstabPlan);
    const knownColumns = new Set<string>();
    if (qidResult.entries) {
      for (const entry of qidResult.entries) {
        if (entry.items) {
          for (const item of entry.items) {
            if (item.column) knownColumns.add(item.column);
          }
        }
      }
    }

    compiledContract = compileLoopContract({
      policy: resolvedLoopPolicy,
      cuts: cutsSpec.cuts.map(c => ({ name: c.name, groupName: c.groupName, rExpression: c.rExpression })),
      loopMappings: resolvedLoopMappings,
      knownColumns,
    });

    // Persist compiled contract
    const fs = await import('fs/promises');
    const path = await import('path');
    const loopPolicyDir = path.join(outputDir, 'agents', 'loop-semantics');
    await fs.mkdir(loopPolicyDir, { recursive: true });
    await fs.writeFile(
      path.join(loopPolicyDir, 'compiled-loop-contract.json'),
      JSON.stringify(compiledContract, null, 2),
      'utf-8',
    );

    const entityCount = compiledContract.groups.filter(g => g.anchorType === 'entity').length;
    console.log(
      `[V3] Compiled loop contract: ${entityCount} entity, ` +
      `${compiledContract.groups.length - entityCount} respondent` +
      (compiledContract.hasFallbacks ? ' (includes fallbacks)' : ''),
    );
  }

  // -------------------------------------------------------------------------
  // Phase 3: Compute Chain (stages 22-14)
  // -------------------------------------------------------------------------
  console.log('[V3] Running compute chain (stages 22-14)...');
  const computeInput: ComputeChainInput = {
    tables: canonicalToComputeTables(canonicalResult.tables),
    crosstabPlan: planningResult.crosstabPlan.crosstabPlan,
    outputDir,
    pipelineId,
    dataset,
    abortSignal: input.abortSignal,
    checkpoint,
    statTestingConfig: input.statTestingConfig,
    wizardStatTesting: input.wizardStatTesting,
    loopMappings: resolvedLoopMappings,
    loopSemanticsPolicy: resolvedLoopPolicy,
    compiledLoopContract: compiledContract,
    loopStatTestingMode: input.loopStatTestingMode,
    weightVariable: input.weightVariable,
  };

  const computeResult = await runComputePipeline(computeInput);
  checkpoint = computeResult.checkpoint;

  try {
    await writeAgentTracesIndex(outputDir);
    await writeStagesManifest(outputDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[V3] Failed to write agent trace index / stages manifest (non-fatal): ${msg}`);
  }

  console.log(
    `[V3] Pipeline complete. ` +
    `Tables: ${canonicalResult.tables.length}, ` +
    `Cuts: ${computeResult.rScriptInput.cuts.length}, ` +
    `QC: ${computeResult.routeMetadata.tableCount} tables validated`,
  );

  return {
    questionId: qidResult,
    canonical: canonicalResult,
    planning: planningResult,
    compute: computeResult,
    checkpoint,
  };
}

// =============================================================================
// Resume After HITL Review
// =============================================================================

// =============================================================================
// Checkpoint Merging
// =============================================================================

/**
 * Merge checkpoints from two parallel chains into a single checkpoint.
 *
 * Since canonical (13b-13d) and planning (20-21) run in parallel, they each
 * produce independent checkpoints. This function combines them, deduplicating
 * stage completions and computing the correct nextStage.
 */
export function mergeParallelCheckpoints(
  base: V3PipelineCheckpoint,
  canonical: V3PipelineCheckpoint,
  planning: V3PipelineCheckpoint,
): V3PipelineCheckpoint {
  const baseStageIds = new Set(base.completedStages.map(s => s.completedStage));

  // Collect all completed stages, deduplicating by stage ID
  const seen = new Set<string>();
  const sourceByStage = new Map<string, 'base' | 'canonical' | 'planning'>();
  const mergedStages: V3PipelineCheckpoint['completedStages'] = [];

  const addStages = (
    stages: V3PipelineCheckpoint['completedStages'],
    source: 'base' | 'canonical' | 'planning',
  ) => {
    for (const s of stages) {
      const stageId = s.completedStage;
      if (!seen.has(stageId)) {
        seen.add(stageId);
        sourceByStage.set(stageId, source);
        mergedStages.push(s);
        continue;
      }

      const priorSource = sourceByStage.get(stageId);
      const isBaseStage = baseStageIds.has(stageId);

      // Defensive assertion: canonical/planning should not both produce
      // the same non-base stage in a single fork/join pass.
      if (!isBaseStage && priorSource && priorSource !== 'base' && source !== 'base' && priorSource !== source) {
        throw new Error(
          `[V3] Invalid parallel checkpoint merge: stage ${stageId} recorded by both ${priorSource} and ${source}`,
        );
      }
    }
  };

  // Add base stages first (question-id chain)
  addStages(base.completedStages, 'base');

  // Add canonical chain stages
  addStages(canonical.completedStages, 'canonical');

  // Add planning chain stages
  addStages(planning.completedStages, 'planning');

  // Determine last completed and next stage
  const canonicalDone = seen.has('13e');
  const planningDone = seen.has('21');
  const lastCompleted = canonicalDone && planningDone
    ? '21' as const  // Both done — next is compute (22)
    : (canonical.lastCompletedStage ?? planning.lastCompletedStage ?? base.lastCompletedStage);

  const nextStage = canonicalDone && planningDone
    ? '22' as const
    : null;  // Still in progress — caller handles

  return {
    ...base,
    completedStages: mergedStages,
    lastCompletedStage: lastCompleted,
    nextStage,
    updatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Loop Semantics Resolution (at join point)
// =============================================================================

import { runLoopSemanticsPolicyAgent, buildEnrichedLoopSummary } from '@/agents/LoopSemanticsPolicyAgent';
import { buildLoopSemanticsExcerpt } from '@/lib/questionContext';
import type { QuestionIdEntry } from '@/lib/questionContext';
import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import { persistSystemError } from '@/lib/errors/ErrorPersistence';

/**
 * Resolve loop semantics policy at the fork/join point.
 * Called when loops exist but no policy was pre-provided.
 * Uses planning result (cuts/banner groups) + enriched questionid entries.
 */
async function resolveLoopSemantics(
  input: V3PipelineInput,
  planningResult: PlanningChainResult,
  outputDir: string,
  questionIdEntries?: QuestionIdEntry[],
): Promise<LoopSemanticsPolicy | undefined> {
  const loopMappings = input.loopMappings!;
  const cutsSpec = buildCutsSpec(planningResult.crosstabPlan.crosstabPlan);

  console.log('[V3] Resolving loop semantics policy...');

  try {
    const policy = await runLoopSemanticsPolicyAgent({
      loopSummary: buildEnrichedLoopSummary(loopMappings, questionIdEntries),
      bannerGroups: cutsSpec.groups.map(g => ({
        groupName: g.groupName,
        columns: g.cuts.map(c => ({ name: c.name, original: c.name })),
      })),
      cuts: cutsSpec.cuts.map(c => ({
        name: c.name,
        groupName: c.groupName,
        rExpression: c.rExpression,
      })),
      datamapExcerpt: questionIdEntries
        ? buildLoopSemanticsExcerpt(questionIdEntries, cutsSpec.cuts)
        : [],
      loopMappings,
      outputDir,
      abortSignal: input.abortSignal,
    });

    // Save policy artifact
    const fs = await import('fs/promises');
    const path = await import('path');
    const loopPolicyDir = path.join(outputDir, 'agents', 'loop-semantics');
    await fs.mkdir(loopPolicyDir, { recursive: true });
    await fs.writeFile(
      path.join(loopPolicyDir, 'loop-semantics-policy.json'),
      JSON.stringify(policy, null, 2),
      'utf-8',
    );

    const entityGroups = policy.bannerGroups.filter(g => g.anchorType === 'entity');
    console.log(
      `[V3] Loop semantics: ${entityGroups.length} entity-anchored, ` +
      `${policy.bannerGroups.length - entityGroups.length} respondent-anchored`,
    );

    return policy;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[V3] LoopSemanticsPolicyAgent failed: ${errMsg}`);
    console.warn('[V3] Using fallback: all groups respondent-anchored');

    const fallbackReason = `LoopSemanticsPolicyAgent failed: ${errMsg.substring(0, 200)}; all groups defaulted to respondent-anchored`;
    const policy = createRespondentAnchoredFallbackPolicy(
      cutsSpec.groups.map(g => g.groupName),
      fallbackReason,
    );

    // Save fallback policy
    const fs = await import('fs/promises');
    const path = await import('path');
    const loopPolicyDir = path.join(outputDir, 'agents', 'loop-semantics');
    await fs.mkdir(loopPolicyDir, { recursive: true });
    await fs.writeFile(
      path.join(loopPolicyDir, 'loop-semantics-policy.json'),
      JSON.stringify(policy, null, 2),
      'utf-8',
    );

    try {
      await persistSystemError({
        outputDir,
        dataset: input.dataset,
        pipelineId: input.pipelineId,
        stageNumber: 8,
        stageName: 'LoopSemanticsPolicy',
        severity: 'error',
        actionTaken: 'fallback_used',
        error: err,
        meta: { action: 'respondent_anchored_fallback', fallbackApplied: true, fallbackReason },
      });
    } catch {
      // ignore
    }

    return policy;
  }
}

// =============================================================================
// Artifact Loaders (for resume)
// =============================================================================

import { loadArtifact } from './persistence';

/**
 * Load question-id chain results from disk artifacts.
 * Used when resuming from a checkpoint where stages 00-12 are already complete.
 */
async function loadQuestionIdResult(
  input: V3PipelineInput,
): Promise<QuestionIdChainResult> {
  const { outputDir, pipelineId, dataset } = input;

  const rawArtifact = await loadArtifact<WrappedQuestionIdOutput | QuestionIdChainResult['entries']>(
    outputDir,
    '12',
  );
  if (!rawArtifact) {
    throw new Error('Cannot resume: questionid-final.json (stage 12) not found');
  }

  const wrapped = !Array.isArray(rawArtifact) && Array.isArray(rawArtifact.questionIds)
    ? rawArtifact
    : null;
  const entries = wrapped?.questionIds ?? rawArtifact;
  if (!Array.isArray(entries)) {
    throw new Error('Cannot resume: questionid-final.json has invalid shape');
  }

  const metadata: SurveyMetadata = wrapped?.metadata ?? {
    dataset,
    generatedAt: 'resumed',
    scriptVersion: 'v3-runtime',
    isMessageTestingSurvey: false,
    isConceptTestingSurvey: false,
    hasMaxDiff: null,
    hasAnchoredScores: null,
    messageTemplatePath: null,
    isDemandSurvey: false,
    hasChoiceModelExercise: null,
  };

  // Load checkpoint
  const checkpoint = await loadCheckpoint(outputDir) ??
    createPipelineCheckpoint(pipelineId, dataset);

  // Survey parsed cannot be loaded from artifact — re-derive deterministically.
  let surveyParsed: ParsedSurveyQuestion[] = [];
  let hydratedEntries = entries;
  let hydratedMetadata = metadata;
  try {
    const surveyResult = await runSurveyParser({
      entries,
      metadata,
      datasetPath: input.datasetPath,
    });
    hydratedEntries = surveyResult.entries;
    hydratedMetadata = surveyResult.metadata;
    surveyParsed = surveyResult.surveyParsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[V3] Failed to hydrate surveyParsed during resume (non-fatal): ${msg}`);
  }

  return {
    entries: hydratedEntries,
    metadata: hydratedMetadata,
    checkpoint,
    surveyParsed,
  };
}

/**
 * Load canonical chain result from disk artifacts for resume.
 */
async function loadCanonicalResultFromArtifacts(
  input: V3PipelineInput,
  qidResult: QuestionIdChainResult,
): Promise<CanonicalChainResult> {
  // runCanonicalPipeline handles its own resume via checkpoint
  return runCanonicalPipeline({
    entries: qidResult.entries,
    loopMappings: input.loopMappings,
    metadata: qidResult.metadata,
    triageFlagged: runTriage(qidResult.entries, qidResult.metadata).flagged,
    surveyParsed: qidResult.surveyParsed,
    outputDir: input.outputDir,
    pipelineId: input.pipelineId,
    dataset: input.dataset,
    abortSignal: input.abortSignal,
    plannerConfig: input.plannerConfig,
    tablePresentationConfig: input.tablePresentationConfig,
  });
}

/**
 * Load planning chain result from disk artifacts for resume.
 */
async function loadPlanningResultFromArtifacts(
  input: V3PipelineInput,
  qidResult: QuestionIdChainResult,
): Promise<PlanningChainResult> {
  // runPlanningPipeline handles its own resume via checkpoint
  return runPlanningPipeline({
    entries: qidResult.entries,
    metadata: qidResult.metadata,
    savPath: input.savPath,
    datasetPath: input.datasetPath,
    outputDir: input.outputDir,
    pipelineId: input.pipelineId,
    dataset: input.dataset,
    abortSignal: input.abortSignal,
    researchObjectives: input.researchObjectives,
    cutSuggestions: input.cutSuggestions,
    projectType: input.projectType,
  });
}
