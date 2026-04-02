/**
 * V3 Runtime — Canonical Chain Pipeline Orchestrator (Stages 13b-13e)
 *
 * Executes stages 13b -> 13c1 -> 13c2 -> 13d -> 13e in order.
 * At each boundary: writes artifact, records checkpoint.
 * Reads checkpoint on start; if resuming, skips completed stages and loads last artifact.
 *
 * Uses `getStageRange('13b', '13e')` from stageOrder.ts -- never hardcodes order.
 *
 * Stage 13e has six sub-steps:
 *   1. Deterministic prefill (tableSubtitle, userNote, baseText)
 *   2. Triage filter (flags tables for AI context review)
 *   3. AI call via TableContextAgent on flagged tables (refines presentation metadata)
 *   4. NET triage (deterministic filter for NET enrichment candidates)
 *   5. AI call via NETEnrichmentAgent on NET-flagged tables (proposes NET groupings)
 *   6. NET apply (builds companion tables with NET rows)
 * The triage output is persisted as a companion artifact (tables/13e-triage.json).
 * The NET triage output is persisted as tables/13e-net-triage.json.
 *
 * Follows the Phase 1 pattern established by runQuestionIdPipeline.ts:
 *   - Sequential stage execution via getStageRunner dispatch
 *   - Artifact persistence at each boundary
 *   - Checkpoint after each stage for resume support
 *   - AbortSignal checked before each stage
 *   - Non-fatal fallback: if a 13c stage throws, log warning and continue with
 *     previous state (same as Phase 1 posture)
 */

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
} from '../persistence';

import type {
  CanonicalChainInput,
  CanonicalChainResult,
  TablePlanOutput,
  ValidatedPlanOutput,
  CanonicalTableOutput,
  QuestionIdEntry,
} from './types';

// Stage modules
import { runTablePlanner } from './plan';
import { runSubtypeGate } from './subtypeGate';
import { runStructureGate } from './structureGate';
import { runCanonicalAssembly } from './assemble';
import { resolveCanonicalBaseContract } from './resolveBaseContract';
import { runTableMetadataPrefill } from './prefill';
import {
  runTableContextTriage,
  type TableTriageReason,
  buildEntryResolutionLookups,
  resolveTableEntryContext,
  buildBinaryPairLookup,
} from './triage';
import { resolveTablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';
import { reviewTableContextBatch } from '../../../../agents/TableContextAgent';
import { applyTableContextResults } from './applyTableContext';
import { runNetTriage } from './netTriage';
import { reviewNetEnrichmentBatch, type NetEnrichmentContext } from '../../../../agents/NETEnrichmentAgent';
import { applyNetEnrichmentResults } from './applyNetEnrichment';
import { persistStageAgentTrace } from '../agentTraces';
import type { TableContextGroup } from './tableContextRenderer';

import fs from 'fs/promises';
import path from 'path';

// =============================================================================
// Per-Stage State
// =============================================================================

/**
 * Accumulated state carried through the canonical chain.
 * Each stage populates or mutates specific fields.
 */
interface CanonicalChainState {
  tablePlan: TablePlanOutput | null;
  validatedPlan: ValidatedPlanOutput | null;
  canonicalOutput: CanonicalTableOutput | null;
  correctedEntries: QuestionIdEntry[];
}

// =============================================================================
// Stage Runner Dispatch
// =============================================================================

type StageRunner = (
  state: CanonicalChainState,
  input: CanonicalChainInput,
) => Promise<CanonicalChainState>;

function getStageRunner(stageId: V3StageId): StageRunner {
  switch (stageId) {
    case '13b':
      return async (_state, input) => {
        const tablePlan = await runTablePlanner({
          entries: input.entries,
          metadata: input.metadata,
          dataset: input.dataset,
          config: input.plannerConfig,
        });
        return {
          tablePlan,
          validatedPlan: null,
          canonicalOutput: null,
          correctedEntries: input.entries,
        };
      };

    case '13c1':
      return async (state, input) => {
        if (!state.tablePlan) {
          throw new Error('Cannot run 13c1 (subtype gate) without table plan from 13b');
        }

        try {
          const result = await runSubtypeGate({
            tablePlan: state.tablePlan,
            entries: state.correctedEntries,
            metadata: input.metadata,
            triageFlagged: input.triageFlagged,
            dataset: input.dataset,
            outputDir: input.outputDir,
            abortSignal: input.abortSignal,
          });

          return {
            ...state,
            validatedPlan: result.validatedPlan,
            correctedEntries: result.correctedEntries,
          };
        } catch (error) {
          // Non-fatal fallback: if subtype gate throws, pass through the plan
          // with no reviews and deterministic confidence.
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.warn(
            `[V3:13c1] Stage failed (non-fatal), passing through table plan: ${errMsg}`,
          );

          const passThrough: ValidatedPlanOutput = {
            metadata: {
              ...input.metadata,
              subtypeGateValidatedAt: new Date().toISOString(),
              subtypeGateError: errMsg,
              originalTableCount: state.tablePlan.plannedTables.length,
              validatedTableCount: state.tablePlan.plannedTables.length,
            },
            plannedTables: state.tablePlan.plannedTables,
            subtypeReviews: [],
            blockConfidence: [],
          };

          return {
            ...state,
            validatedPlan: passThrough,
          };
        }
      };

    case '13c2':
      return async (state, input) => {
        if (!state.validatedPlan) {
          throw new Error('Cannot run 13c2 (structure gate) without validated plan from 13c1');
        }
        if (!state.tablePlan) {
          throw new Error('Cannot run 13c2 (structure gate) without table plan from 13b');
        }

        try {
          const result = await runStructureGate({
            validatedPlan: state.validatedPlan,
            tablePlan: state.tablePlan,
            entries: state.correctedEntries,
            metadata: input.metadata,
            surveyParsed: input.surveyParsed,
            dataset: input.dataset,
            outputDir: input.outputDir,
            abortSignal: input.abortSignal,
          });

          return {
            ...state,
            validatedPlan: result.validatedPlan,
          };
        } catch (error) {
          // Non-fatal fallback: if structure gate throws, keep the existing
          // validated plan from 13c1. Structure reviews will be empty.
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.warn(
            `[V3:13c2] Stage failed (non-fatal), keeping 13c1 validated plan: ${errMsg}`,
          );

          const passThrough: ValidatedPlanOutput = {
            ...state.validatedPlan,
            metadata: {
              ...state.validatedPlan.metadata,
              structureGateValidatedAt: new Date().toISOString(),
              structureGateError: errMsg,
            },
            structureReviews: [],
          };

          return {
            ...state,
            validatedPlan: passThrough,
          };
        }
      };

    case '13d':
      return async (state, input) => {
        if (!state.validatedPlan) {
          throw new Error('Cannot run 13d (canonical assembly) without validated plan from 13c');
        }

        const assembledOutput = await runCanonicalAssembly({
          validatedPlan: state.validatedPlan,
          entries: state.correctedEntries,
          loopMappings: input.loopMappings,
          metadata: input.metadata,
          dataset: input.dataset,
          tablePresentation: resolveTablePresentationConfig(input.tablePresentationConfig),
        });
        const canonicalOutput = resolveCanonicalBaseContract(assembledOutput);

        return {
          ...state,
          canonicalOutput,
        };
      };

    case '13e':
      return async (state, input) => {
        if (!state.canonicalOutput) {
          throw new Error('Cannot run 13e (table metadata prefill) without canonical output from 13d');
        }

        // Sub-step 1: Deterministic prefill (tableSubtitle, userNote, baseText)
        const enrichedOutput = runTableMetadataPrefill({
          canonicalOutput: state.canonicalOutput,
          entries: state.correctedEntries,
          metadata: input.metadata,
          tablePresentation: resolveTablePresentationConfig(input.tablePresentationConfig),
        });

        // Sub-step 2: Triage — flag tables that need AI context review
        const triageOutput = runTableContextTriage({
          canonicalOutput: enrichedOutput,
          entries: state.correctedEntries,
          metadata: input.metadata,
          questionDiagnostics: state.tablePlan?.summary?.questionDiagnostics,
        });

        // Persist triage as a companion artifact (separate from the canonical output)
        const triagePath = path.join(input.outputDir, 'tables', '13e-triage.json');
        await fs.mkdir(path.dirname(triagePath), { recursive: true });
        await fs.writeFile(triagePath, JSON.stringify(triageOutput, null, 2), 'utf-8');

        console.log(
          `[V3:13e] Triage: ${triageOutput.summary.flaggedTables}/${triageOutput.summary.totalTables} tables flagged for AI review`,
        );

        // Sub-step 3: AI call on flagged tables (TableContextAgent)
        // Use `let` so NET enrichment sub-steps can build on top
        let tableContextOutput = enrichedOutput;
        const flaggedDecisions = triageOutput.decisions.filter(d => d.flagged);

        if (flaggedDecisions.length > 0 && !input.abortSignal?.aborted) {
          try {
            // Build lookups
            const entryLookups = buildEntryResolutionLookups(state.correctedEntries);
            const surveyByQuestionId = new Map(
              (input.surveyParsed ?? []).map(sq => [sq.questionId, sq]),
            );

            // Build triage reasons lookup: tableId → reasons
            const triageReasonsByTableId = new Map<string, TableTriageReason[]>();
            for (const decision of flaggedDecisions) {
              triageReasonsByTableId.set(decision.tableId, decision.reasons);
            }

            // Group flagged tables by resolved entry questionId
            const flaggedTableIds = new Set(flaggedDecisions.map(d => d.tableId));

            // Phase F: ensure unflagged binary pair partners are pulled into AI review
            const binaryPairs = buildBinaryPairLookup(enrichedOutput.tables.filter(t => !t.exclude));
            for (const tableId of [...flaggedTableIds]) {
              const partnerId = binaryPairs.get(tableId);
              if (partnerId && !flaggedTableIds.has(partnerId)) {
                flaggedTableIds.add(partnerId);
              }
            }

            const flaggedTables = enrichedOutput.tables.filter(t => flaggedTableIds.has(t.tableId));

            const groupsByQuestionId = new Map<string, {
              entry: QuestionIdEntry;
              tables: typeof flaggedTables;
            }>();
            for (const table of flaggedTables) {
              const entryContext = resolveTableEntryContext(table, entryLookups);
              if (!entryContext.entry) {
                console.warn(
                  `[V3:13e] No entry found for table "${table.tableId}" (questionId="${table.questionId}") — keeping prefill defaults`,
                );
                continue;
              }

              const resolvedQuestionId = entryContext.entry.questionId;
              const existingGroup = groupsByQuestionId.get(resolvedQuestionId);
              if (existingGroup) {
                existingGroup.tables.push(table);
              } else {
                groupsByQuestionId.set(resolvedQuestionId, {
                  entry: entryContext.entry,
                  tables: [table],
                });
              }
            }

            // Build TableContextGroup[] — resolve entry using same logic as triage
            const groups: TableContextGroup[] = [];
            for (const [questionId, groupData] of groupsByQuestionId.entries()) {
              const { entry, tables } = groupData;
              // Build per-table triage reasons map
              const tableTriageReasons = new Map<string, TableTriageReason[]>();
              for (const table of tables) {
                const reasons = triageReasonsByTableId.get(table.tableId);
                if (reasons) {
                  tableTriageReasons.set(table.tableId, reasons);
                }
              }

              groups.push({
                questionId,
                entry,
                tables,
                triageReasons: tableTriageReasons,
                surveyQuestion:
                  surveyByQuestionId.get(entry.questionId) ??
                  surveyByQuestionId.get(questionId),
              });
            }

            if (groups.length > 0) {
              // Call AI batch review
              const batchResult = await reviewTableContextBatch(
                groups,
                input.outputDir,
                input.abortSignal,
              );

              // Persist agent trace
              await persistStageAgentTrace({
                outputDir: input.outputDir,
                stageId: '13e',
                agentName: 'TableContextAgent',
                status: 'written',
                reportFilename: '13e-table-context-report.json',
                summary: batchResult.summary as unknown as Record<string, unknown>,
                scratchpadMarkdown: batchResult.scratchpadMarkdown,
                scratchpadFilename: '13e-table-context-scratchpad.md',
              });

              // Apply results to canonical output
              tableContextOutput = applyTableContextResults(
                enrichedOutput,
                batchResult.results,
              );

              console.log(
                `[V3:13e] AI review: ${batchResult.summary.tablesChanged} changed, ` +
                `${batchResult.summary.tablesUnchanged} unchanged, ` +
                `${batchResult.summary.rowLabelsOverridden} row labels overridden`,
              );
            }
          } catch (error) {
            // Non-fatal: keep enrichedOutput (prefill defaults)
            console.warn(
              `[V3:13e] AI review failed, keeping prefill defaults: ${error instanceof Error ? error.message.substring(0, 150) : 'Unknown error'}`,
            );
          }
        }

        const writeNetArtifactsToTables = async (
          status: 'written' | 'skipped' | 'error',
          summary: Record<string, unknown>,
          results: unknown[],
          scratchpadMarkdown: string,
          note?: string,
        ) => {
          const tablesDir = path.join(input.outputDir, 'tables');
          await fs.mkdir(tablesDir, { recursive: true });

          const reportPath = path.join(tablesDir, '13e-net-enrichment-report.json');
          const scratchpadPath = path.join(tablesDir, '13e-net-enrichment-scratchpad.md');

          await fs.writeFile(
            reportPath,
            JSON.stringify({
              stageId: '13e',
              agentName: 'NETEnrichmentAgent',
              status,
              generatedAt: new Date().toISOString(),
              summary,
              results,
              note: note ?? null,
            }, null, 2),
            'utf-8',
          );
          await fs.writeFile(scratchpadPath, scratchpadMarkdown, 'utf-8');
        };

        // Sub-steps 4-6 are non-fatal as a group: triage -> AI -> apply
        try {
          // Sub-step 4: NET Triage — flag tables for NET enrichment
          const netTriageOutput = runNetTriage({
            tables: tableContextOutput.tables,
            entries: state.correctedEntries,
          });

          const netTriagePath = path.join(input.outputDir, 'tables', '13e-net-triage.json');
          await fs.mkdir(path.dirname(netTriagePath), { recursive: true });
          await fs.writeFile(netTriagePath, JSON.stringify(netTriageOutput, null, 2), 'utf-8');

          console.log(
            `[V3:13e] NET triage: ${netTriageOutput.summary.flaggedCount}/${netTriageOutput.summary.totalTables} tables flagged for NET review`,
          );

          let traceStatus: 'written' | 'skipped' = 'skipped';
          let traceNote: string | undefined = 'No tables flagged for NET review';
          let traceSummary: Record<string, unknown> = {
            ...netTriageOutput.summary,
            flaggedContexts: 0,
            netsProposed: 0,
            tablesWithNets: 0,
            tablesSkipped: 0,
            durationMs: 0,
          };
          let traceResults: unknown[] = [];
          let traceScratchpad = '';

          // Sub-step 5 & 6: NET AI call + apply (if flagged tables exist)
          if (netTriageOutput.flagged.length > 0 && !input.abortSignal?.aborted) {
            // Build lookups for entry resolution
            const netEntryLookups = buildEntryResolutionLookups(state.correctedEntries);
            const netSurveyByQuestionId = new Map(
              (input.surveyParsed ?? []).map(sq => [sq.questionId, sq]),
            );
            const tableByTableId = new Map(
              tableContextOutput.tables.map(t => [t.tableId, t]),
            );

            // Build contexts for flagged tables
            const netContexts: NetEnrichmentContext[] = [];
            for (const flagged of netTriageOutput.flagged) {
              const table = tableByTableId.get(flagged.tableId);
              if (!table) continue;

              const entryContext = resolveTableEntryContext(table, netEntryLookups);
              if (!entryContext.entry) {
                console.warn(`[V3:13e] No entry for NET table "${flagged.tableId}" — skipping`);
                continue;
              }

              netContexts.push({
                table,
                entry: entryContext.entry,
                surveyQuestion:
                  netSurveyByQuestionId.get(entryContext.entry.questionId) ??
                  netSurveyByQuestionId.get(table.questionId),
                triageReasons: flagged.reasons,
              });
            }

            if (netContexts.length > 0) {
              // Sub-step 5: NET AI call
              const netBatchResult = await reviewNetEnrichmentBatch(
                netContexts,
                input.outputDir,
                input.abortSignal,
              );

              // Sub-step 6: Apply NET results (build companion tables)
              tableContextOutput = applyNetEnrichmentResults(
                tableContextOutput,
                netBatchResult.results,
              );

              console.log(
                `[V3:13e] NET enrichment: ${netBatchResult.summary.tablesWithNets} tables got companion NET tables, ` +
                `${netBatchResult.summary.netsProposed} NETs proposed`,
              );

              traceStatus = 'written';
              traceNote = undefined;
              traceSummary = {
                ...(netBatchResult.summary as unknown as Record<string, unknown>),
                triageFlaggedCount: netTriageOutput.summary.flaggedCount,
              };
              traceResults = netBatchResult.results;
              traceScratchpad = netBatchResult.scratchpadMarkdown;
            } else {
              traceNote = 'No resolvable entry context for flagged NET tables';
              traceSummary = {
                ...traceSummary,
                flaggedContexts: 0,
              };
            }
          } else if (input.abortSignal?.aborted) {
            traceNote = 'NET enrichment skipped because pipeline was aborted';
          }

          await writeNetArtifactsToTables(
            traceStatus,
            traceSummary,
            traceResults,
            traceScratchpad,
            traceNote,
          );

          // Persist NET agent trace index artifact (planning/traces)
          await persistStageAgentTrace({
            outputDir: input.outputDir,
            stageId: '13e',
            agentName: 'NETEnrichmentAgent',
            status: traceStatus,
            reportFilename: '13e-net-enrichment-report.json',
            summary: traceSummary,
            scratchpadMarkdown: traceScratchpad,
            scratchpadFilename: '13e-net-enrichment-scratchpad.md',
            note: traceNote,
          });
        } catch (error) {
          const errMessage = error instanceof Error
            ? error.message.substring(0, 150)
            : 'Unknown error';

          // Non-fatal: keep tableContextOutput without NET enrichment
          console.warn(
            `[V3:13e] NET enrichment failed, continuing without NET tables: ${errMessage}`,
          );

          const errorSummary: Record<string, unknown> = {
            totalTables: tableContextOutput.tables.length,
            error: errMessage,
          };

          await writeNetArtifactsToTables(
            'error',
            errorSummary,
            [],
            '',
            errMessage,
          );

          await persistStageAgentTrace({
            outputDir: input.outputDir,
            stageId: '13e',
            agentName: 'NETEnrichmentAgent',
            status: 'error',
            reportFilename: '13e-net-enrichment-report.json',
            summary: errorSummary,
            scratchpadMarkdown: '',
            scratchpadFilename: '13e-net-enrichment-scratchpad.md',
            note: errMessage,
          });
        }

        return {
          ...state,
          canonicalOutput: tableContextOutput,
        };
      };

    default:
      throw new Error(`No stage runner for canonical chain stage: ${stageId}`);
  }
}

/**
 * Get the artifact data to write for a given stage from the current state.
 */
function getArtifactData(stageId: V3StageId, state: CanonicalChainState): unknown {
  switch (stageId) {
    case '13b':
      return state.tablePlan;
    case '13c1':
    case '13c2':
      return state.validatedPlan;
    case '13d':
    case '13e':
      return state.canonicalOutput;
    default:
      return null;
  }
}

// =============================================================================
// Resume — Restore State from Artifact
// =============================================================================

/**
 * Restore chain state from the last completed stage's artifact.
 * The artifact format differs by stage:
 *   - After 13b:     load table-plan.json as TablePlanOutput
 *   - After 13c1/c2: load table-plan-validated.json as ValidatedPlanOutput
 *   - After 13d:     load table.json as CanonicalTableOutput
 */
async function restoreStateFromArtifact(
  outputDir: string,
  lastCompletedStage: V3StageId,
  entries: QuestionIdEntry[],
): Promise<CanonicalChainState | null> {
  const state: CanonicalChainState = {
    tablePlan: null,
    validatedPlan: null,
    canonicalOutput: null,
    correctedEntries: entries,
  };

  switch (lastCompletedStage) {
    case '13b': {
      const plan = await loadArtifact<TablePlanOutput>(outputDir, '13b');
      if (!plan) return null;
      state.tablePlan = plan;
      return state;
    }

    case '13c1':
    case '13c2': {
      // 13c1 and 13c2 both write to table-plan-validated.json.
      // Also try to load table-plan.json since 13c2 needs it.
      const validated = await loadArtifact<ValidatedPlanOutput>(outputDir, lastCompletedStage);
      if (!validated) return null;
      state.validatedPlan = validated;
      // Try to load the table plan too (needed if resuming into 13c2 or 13d)
      const tablePlan = await loadArtifact<TablePlanOutput>(outputDir, '13b');
      state.tablePlan = tablePlan;
      return state;
    }

    case '13d':
    case '13e': {
      // 13e writes the same shape as 13d (CanonicalTableOutput), just enriched
      const canonical = await loadArtifact<CanonicalTableOutput>(
        outputDir,
        lastCompletedStage,
      );
      if (!canonical) return null;
      state.canonicalOutput = canonical;
      // Also restore intermediate artifacts for result construction
      const validated = await loadArtifact<ValidatedPlanOutput>(outputDir, '13c2');
      state.validatedPlan = validated;
      const tablePlan = await loadArtifact<TablePlanOutput>(outputDir, '13b');
      state.tablePlan = tablePlan;
      return state;
    }

    default:
      return null;
  }
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Run the canonical chain pipeline (stages 13b-13d).
 *
 * - Executes stages sequentially in stageOrder.ts order
 * - Persists artifacts at each boundary
 * - Records checkpoint after each stage
 * - Supports resume from existing checkpoint
 * - Non-fatal fallback: 13c stages log warning and continue on failure
 *
 * @returns Canonical tables, validated plan, table plan, and updated checkpoint
 */
export async function runCanonicalPipeline(
  input: CanonicalChainInput,
): Promise<CanonicalChainResult> {
  const { outputDir, pipelineId, dataset } = input;
  const stages = getStageRange('13b', '13e');

  // Load or create checkpoint
  let checkpoint = input.checkpoint ?? await loadCheckpoint(outputDir);
  if (!checkpoint) {
    checkpoint = createPipelineCheckpoint(pipelineId, dataset);
  }

  // Determine resume point
  let state: CanonicalChainState = {
    tablePlan: null,
    validatedPlan: null,
    canonicalOutput: null,
    correctedEntries: input.entries,
  };

  let startIndex = 0;

  // If resuming, load the last completed artifact and skip those stages
  const lastCompleted = checkpoint.lastCompletedStage;
  if (lastCompleted) {
    const completedIdx = stages.indexOf(lastCompleted as V3StageId);
    if (completedIdx >= 0) {
      startIndex = completedIdx + 1;

      // Load the artifact from the last completed stage
      const restored = await restoreStateFromArtifact(
        outputDir,
        lastCompleted as V3StageId,
        input.entries,
      );
      if (restored) {
        state = restored;
        console.log(
          `[V3] Resuming canonical chain from stage ${lastCompleted} ` +
          `(${V3_STAGE_NAMES[lastCompleted as V3StageId]}), skipping ${startIndex} stage(s)`,
        );
      } else {
        // Can't load artifact -- restart from beginning
        console.warn(
          `[V3] Could not load artifact for stage ${lastCompleted}, restarting canonical chain from 13b`,
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

    // Persist artifact
    const artifactData = getArtifactData(stageId, state);
    const artifactPath = artifactData
      ? await writeArtifact(outputDir, stageId, artifactData)
      : outputDir;

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

  // Build result -- ensure we have the required fields.
  // If pipeline was aborted mid-way, some fields may be null.
  // The caller should check for completeness.
  return {
    tables: state.canonicalOutput?.tables ?? [],
    validatedPlan: state.validatedPlan ?? {
      metadata: {},
      plannedTables: [],
      subtypeReviews: [],
      blockConfidence: [],
    },
    tablePlan: state.tablePlan ?? {
      metadata: {
        generatedAt: new Date().toISOString(),
        plannerVersion: 'v3-runtime',
        dataset,
        suppressionPolicy: {
          minItemCount: 0,
          minZeroItemPct: 0,
          minOverlapJaccard: 0,
          minOverlapItems: 0,
          linkedMessageMinItemCount: 0,
          linkedMessageMinCoveragePct: 0,
          linkedParentMaxItems: 0,
          linkedMessageRequiresMaxDiff: false,
          linkedMessageMinLabelAlignPct: 0,
          linkedMessageLabelTokenJaccardMin: 0,
          parentLinkedMaxItems: 0,
          parentLinkedRequireAllLinkedHidden: false,
          choiceModelMinIterationCount: 0,
        },
      },
      summary: {
        dataset,
        reportableQuestions: 0,
        plannedTables: 0,
        byKind: {},
        bySubtype: {},
        maxdiffDetectedFamilies: [],
        siblingDimensionGroups: [],
        questionDiagnostics: [],
        suppressedQuestions: 0,
        suppressedPlannedTables: 0,
        suppressionDecisions: [],
      },
      ambiguities: [],
      plannedTables: [],
    },
    checkpoint,
  };
}
