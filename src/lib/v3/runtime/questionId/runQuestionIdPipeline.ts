/**
 * V3 Runtime — Question ID Pipeline Orchestrator
 *
 * Executes stages 00 → 03 → 08a → 08b → 09d → 10a → 10 → 11 → 12 in order.
 * At each boundary: writes artifact to `stages/<artifactName>`, records checkpoint.
 * Reads checkpoint on start; if resuming, skips completed stages and loads last artifact.
 *
 * Uses `getStageRange('00', '12')` from stageOrder.ts — never hardcodes order.
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
  loadArtifact as loadPipelineArtifact,
  getSubDir,
} from '../persistence';
import { persistStageAgentTrace } from '../agentTraces';

import type {
  QuestionIdChainInput,
  QuestionIdChainResult,
  QuestionIdEntry,
  SurveyMetadata,
  ParsedSurveyQuestion,
  TriagedEntry,
} from './types';
import { unwrapQuestionIdArtifact } from './types';

// Stage modules
import { runEnricher } from './enricher';
import { runBaseEnricher } from './enrich/baseEnricher';
import { runSurveyParser } from './enrich/surveyParser';
import { runMessageLabelMatcher } from './enrich/messageLabelMatcher';
import { detectStimuliSets } from './enrich/stimuliSetDetector';
import { runLoopGate } from './gates/loopGate';
import { runTriage } from './gates/triage';
import { runValidate } from './gates/validate';
import { runReconcile } from './reconcile';
import { runSurveyCleanup } from './enrich/surveyCleanupOrchestrator';

async function loadArtifact(
  outputDir: string,
  stageId: V3StageId,
): Promise<{ metadata: SurveyMetadata | null; entries: QuestionIdEntry[] } | null> {
  const raw = await loadPipelineArtifact<unknown>(outputDir, stageId);
  return raw ? unwrapQuestionIdArtifact(raw) : null;
}

// =============================================================================
// Stage Execution Map
// =============================================================================

/** Per-stage accumulated state carried through the chain. */
interface ChainState {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  surveyParsed: ParsedSurveyQuestion[];
  surveyMarkdown: string | null;
  _flagged: TriagedEntry[] | null;
}

type StageRunner = (
  state: ChainState,
  input: QuestionIdChainInput,
) => Promise<ChainState>;

function getStageRunner(stageId: V3StageId): StageRunner {
  switch (stageId) {
    case '00':
      return async (_state, input) => {
        const result = await runEnricher({
          savPath: input.savPath,
          datasetPath: input.datasetPath,
          dataset: input.dataset,
          intakeConfig: input.intakeConfig,
          maxRespondents: input.maxRespondents,
        });
        return {
          entries: result.entries,
          metadata: result.metadata,
          surveyParsed: [],
          surveyMarkdown: null,
          _flagged: null,
        };
      };

    case '03':
      return async (state, input) => {
        const result = await runBaseEnricher({
          entries: state.entries,
          metadata: state.metadata,
          savPath: input.savPath,
        });
        return { ...state, entries: result.entries, metadata: result.metadata };
      };

    case '08a':
      return async (state, input) => {
        const result = await runSurveyParser({
          entries: state.entries,
          metadata: state.metadata,
          datasetPath: input.datasetPath,
        });
        return {
          entries: result.entries,
          metadata: result.metadata,
          surveyParsed: result.surveyParsed,
          surveyMarkdown: result.surveyMarkdown,
          _flagged: state._flagged,
        };
      };

    case '08b':
      return async (state, input) => {
        if (state.surveyParsed.length === 0) {
          // No survey was parsed in 08a (no survey doc), skip cleanup
          await persistStageAgentTrace({
            outputDir: input.outputDir,
            stageId: '08b',
            agentName: 'SurveyCleanupAgent',
            status: 'skipped',
            reportFilename: '08b-survey-cleanup-report.json',
            summary: { reason: 'no_survey_parsed' },
            note: 'No parsed survey questions from 08a; cleanup skipped.',
          });
          return state;
        }
        const cleanupResult = await runSurveyCleanup({
          surveyParsed: state.surveyParsed,
          surveyMarkdown: state.surveyMarkdown,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
        });

        // Persist the cleaned surveyParsed alongside the standard artifact
        const enrichDir = getSubDir(input.outputDir, 'enrichment');
        await fs.mkdir(enrichDir, { recursive: true });
        await fs.writeFile(
          path.join(enrichDir, '08b-survey-parsed-cleanup.json'),
          JSON.stringify({
            metadata: state.metadata,
            stats: cleanupResult.stats,
            surveyParsed: cleanupResult.surveyParsed,
          }, null, 2),
          'utf-8',
        );

        return {
          ...state,
          surveyParsed: cleanupResult.surveyParsed,
        };
      };

    case '09d':
      return async (state, input) => {
        const result = await runMessageLabelMatcher({
          entries: state.entries,
          metadata: state.metadata,
          datasetPath: input.datasetPath,
        });
        return { ...state, entries: result.entries, metadata: result.metadata };
      };

    case '10a':
      return async (state, input) => {
        const result = await runLoopGate({
          entries: state.entries,
          metadata: state.metadata,
          surveyParsed: state.surveyParsed,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
        });
        const entries = detectStimuliSets({
          entries: result.entries,
          clearedFamilies: result.clearedFamilies,
          metadata: result.metadata,
        });
        return { ...state, entries, metadata: result.metadata };
      };

    case '10':
      return async (state) => {
        // Triage is deterministic — no AI calls
        const triageResult = runTriage(state.entries, state.metadata);
        return { ...state, entries: state.entries, _flagged: triageResult.flagged };
      };

    case '11':
      return async (state, input) => {
        // Prefer stage-10 side-channel. If resuming from stage >= 10, rebuild
        // triage deterministically from current entries.
        const flagged = state._flagged ?? runTriage(state.entries, state.metadata).flagged;
        if (flagged.length === 0) {
          return state;
        }

        const result = await runValidate({
          allEntries: state.entries,
          flagged: flagged as Parameters<typeof runValidate>[0]['flagged'],
          metadata: state.metadata,
          surveyParsed: state.surveyParsed,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
        });
        return { ...state, entries: result.entries, metadata: result.metadata, _flagged: flagged };
      };

    case '12':
      return async (state) => {
        const result = runReconcile({
          entries: state.entries,
          metadata: state.metadata,
          surveyParsed: state.surveyParsed,
        });
        return { ...state, entries: result.entries, metadata: result.metadata };
      };

    default:
      throw new Error(`No stage runner for question-id chain stage: ${stageId}`);
  }
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Run the question-id enrichment pipeline (stages 00-12).
 *
 * - Executes stages sequentially in stageOrder.ts order
 * - Persists artifacts at each boundary
 * - Records checkpoint after each stage
 * - Supports resume from existing checkpoint
 *
 * @returns Final entries, metadata, checkpoint, and parsed survey
 */
export async function runQuestionIdPipeline(
  input: QuestionIdChainInput,
): Promise<QuestionIdChainResult> {
  const { outputDir, pipelineId, dataset } = input;
  const stages = getStageRange('00', '12');

  // Load or create checkpoint
  let checkpoint = input.checkpoint ?? await loadCheckpoint(outputDir);
  if (!checkpoint) {
    checkpoint = createPipelineCheckpoint(pipelineId, dataset);
  }

  // Determine resume point
  let state: ChainState = {
    entries: [],
      metadata: {
        dataset,
        generatedAt: new Date().toISOString(),
        scriptVersion: 'v3-runtime',
        isMessageTestingSurvey: input.intakeConfig?.isMessageTesting ?? false,
        isConceptTestingSurvey: input.intakeConfig?.isConceptTesting ?? false,
        hasMaxDiff: input.intakeConfig?.hasMaxDiff ?? null,
        hasAnchoredScores: input.intakeConfig?.hasAnchoredScores ?? null,
        messageTemplatePath: input.intakeConfig?.messageTemplatePath ?? null,
      isDemandSurvey: input.intakeConfig?.isDemandSurvey ?? false,
      hasChoiceModelExercise: input.intakeConfig?.hasChoiceModelExercise ?? null,
    },
    surveyParsed: [],
    surveyMarkdown: null,
    _flagged: null,
  };

  // If resuming, load the last completed artifact and skip those stages
  const lastCompleted = checkpoint.lastCompletedStage;
  let startIndex = 0;

  if (lastCompleted) {
    const completedIdx = stages.indexOf(lastCompleted as V3StageId);
    if (completedIdx >= 0) {
      startIndex = completedIdx + 1;

      // Load the artifact from the last completed stage
      const loaded = await loadArtifact(outputDir, lastCompleted as V3StageId);
      if (loaded) {
        state.entries = loaded.entries;
        if (loaded.metadata) state.metadata = loaded.metadata;
        console.log(`[V3] Resuming from stage ${lastCompleted} (${V3_STAGE_NAMES[lastCompleted as V3StageId]}), skipping ${startIndex} stage(s)`);

        // questionid artifacts only persist entries/metadata. When resuming
        // after stage 08a, repopulate surveyParsed for downstream AI stages.
        if (startIndex > stages.indexOf('08a')) {
          try {
            // Re-run 08a to hydrate surveyParsed
            const surveyResult = await runSurveyParser({
              entries: state.entries,
              metadata: state.metadata,
              datasetPath: input.datasetPath,
            });
            state.entries = surveyResult.entries;
            state.metadata = surveyResult.metadata;
            state.surveyParsed = surveyResult.surveyParsed;
            state.surveyMarkdown = surveyResult.surveyMarkdown;

            // If resuming past 08b, also re-run cleanup to get cleaned surveyParsed
            const stage08bIdx = stages.indexOf('08b' as V3StageId);
            if (stage08bIdx >= 0 && startIndex > stage08bIdx && state.surveyParsed.length > 0) {
              const cleanupResult = await runSurveyCleanup({
                surveyParsed: state.surveyParsed,
                surveyMarkdown: state.surveyMarkdown,
                outputDir: input.outputDir,
                abortSignal: input.abortSignal,
              });
              state.surveyParsed = cleanupResult.surveyParsed;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[V3] Failed to hydrate surveyParsed during resume (non-fatal): ${msg}`);
          }
        }
      } else {
        // Can't load artifact — restart from beginning
        console.warn(`[V3] Could not load artifact for stage ${lastCompleted}, restarting from 00`);
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

    // Persist artifact
    const artifactPath = await writeArtifact(outputDir, stageId, {
      metadata: state.metadata,
      questionIds: state.entries,
    });

    // Record checkpoint
    checkpoint = recordStageCompletion(
      checkpoint,
      stageId,
      durationMs,
      artifactPath,
    );
    await writeCheckpoint(outputDir, checkpoint);

    console.log(`[V3] Stage ${stageId} complete (${durationMs}ms, ${state.entries.length} entries)`);
  }

  return {
    entries: state.entries,
    metadata: state.metadata,
    checkpoint,
    surveyParsed: state.surveyParsed,
  };
}
