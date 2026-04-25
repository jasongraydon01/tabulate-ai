/**
 * Shared review completion logic.
 *
 * Phase 6c: V3-only post-review pipeline. Legacy agents (VerificationAgent,
 * TablePostProcessor, CutExpressionValidator, R validation, etc.) are removed.
 * The pipeline flow after review is:
 *
 *   Apply decisions → Diff report → Load V3 artifacts →
 *   Derive loop mappings → Loop semantics → Compute chain (22-14) →
 *   PostV3Processing (R script → R execution → Excel)
 */
import * as Sentry from '@sentry/nextjs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { sanitizeRExpression } from '@/lib/r/sanitizeRExpression';
import { processGroup } from '@/agents/CrosstabAgent';
import { processGroupV2 } from '@/agents/CrosstabAgentV2';
import { isQuestionCentricEnabled } from '@/lib/env';
import { buildQuestionContextFromVerboseDataMap, extractAllColumns } from '@/lib/questionContext';
import { runLoopSemanticsPolicyAgent, buildEnrichedLoopSummary } from '@/agents/LoopSemanticsPolicyAgent';
import { buildLoopSemanticsExcerpt } from '@/lib/questionContext';
import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import { resolveStatConfig } from '@/lib/v3/runtime/compute/resolveStatConfig';
import { runComputePipeline } from '@/lib/v3/runtime/compute/runComputePipeline';
import { canonicalToComputeTables } from '@/lib/v3/runtime/compute/canonicalToComputeTables';
import { assessPostV3Processing, runPostV3Processing } from '@/lib/v3/runtime/postV3Processing';
import { buildDecisionsSummary, buildPipelineDecisions, type PipelineDecisions } from '@/lib/v3/runtime/pipelineDecisions';
import { writeTableReport } from '@/lib/v3/runtime/tableReport';
import { persistSystemError, readPipelineErrors, summarizePipelineErrors } from '@/lib/errors/ErrorPersistence';
import { AgentMetricsCollector, runWithMetricsCollector, WideEvent } from '@/lib/observability';
import { formatDuration } from '@/lib/utils/formatDuration';
import {
  buildExportArtifactRefs,
  buildPhase1Manifest,
  ensureWideSavFallback,
  finalizeExportMetadataWithR2Refs,
  type ExportArtifactRefs,
  persistPhase0Artifacts,
} from '@/lib/exportData';
import { startHeartbeatInterval } from './heartbeat';
import { getConvexClient } from '@/lib/convex';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { createRespondentAnchoredFallbackPolicy, type LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';
import { registerPipelineCleanup, runWithPipelineContext } from '@/lib/pipeline/PipelineContext';
import { ConsoleCapture } from '@/lib/logging/ConsoleCapture';
import type { ValidationResultType, ValidatedGroupType, ExpressionType } from '@/schemas/agentOutputSchema';
import type { V3PipelineStage } from '@/schemas/pipelineStageSchema';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type {
  PipelineSummary,
  FlaggedCrosstabColumn,
  AgentDataMapItem,
  PathBResult,
  CrosstabReviewState,
} from './types';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
// DEFAULT_STAT_TESTING_CONFIG removed — use resolveStatConfig({}) for env-aware defaults
import { loadCheckpoint, loadArtifact } from '@/lib/v3/runtime/persistence';
import { deriveLoopMappings } from '@/lib/v3/runtime/loopMappingsFromQuestionId';
import type { CanonicalTableOutput, CanonicalTable, TablePlanOutput } from '@/lib/v3/runtime/canonical/types';
import type { QuestionIdEntry, WrappedQuestionIdOutput } from '@/lib/v3/runtime/questionId/types';
import {
  deleteReviewFiles,
  type ReviewR2Keys,
  uploadPipelineOutputs,
  uploadRunOutputArtifact,
} from '@/lib/r2/R2FileManager';
import { sendPipelineNotification } from '@/lib/notifications/email';
import { evaluateAndPersistRunQuality } from '@/lib/evaluation/runEvaluationService';
import { parseRunResult, type RunResultPostProcessing, type RunResultShape } from '@/schemas/runResultSchema';

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

import type { CrosstabDecision, GroupHint } from '@/schemas/crosstabDecisionSchema';
export type { CrosstabDecision };

/**
 * Dispatch helper: routes to V1 processGroup or V2 processGroupV2 based on
 * the USE_QUESTION_CENTRIC feature flag. This avoids modifying every call site.
 *
 * TODO: Wire this up for hint re-runs. Currently all hint re-run calls in
 * applyDecisions() call processGroup (V1) directly, bypassing this dispatcher.
 * Once applyDecisions receives verboseDataMap (or questions are loaded from
 * the V3 checkpoint), these calls should route through here so hint re-runs
 * use V2 when question-centric mode is enabled. The review context feature
 * is implemented in both V1 and V2 as a bridge, but V1 support should be
 * removed once this migration is done.
 */
async function _dispatchProcessGroup(
  agentDataMap: AgentDataMapItem[],
  group: import('@/schemas/bannerPlanSchema').BannerGroupType,
  options: Parameters<typeof processGroup>[2],
  verboseDataMap?: import('@/lib/processors/DataMapProcessor').VerboseDataMap[],
): ReturnType<typeof processGroup> {
  if (isQuestionCentricEnabled() && verboseDataMap) {
    const questions = buildQuestionContextFromVerboseDataMap(verboseDataMap);
    const allColumns = extractAllColumns(questions);
    return processGroupV2(questions, allColumns, group, options as Parameters<typeof processGroupV2>[3]);
  }
  return processGroup(agentDataMap, group, options);
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) return error.message.includes('AbortError') || error.message.includes('aborted');
  return false;
}

async function assertRunNotCancelled(runId?: string, abortSignal?: AbortSignal, orgId?: string): Promise<void> {
  if (abortSignal?.aborted) {
    throw new DOMException('Pipeline cancelled', 'AbortError');
  }
  if (!runId || !orgId) return;

  try {
    const run = await getConvexClient().query(api.runs.get, {
      runId: runId as Id<'runs'>,
      orgId: orgId as Id<'organizations'>,
    });
    if (run?.cancelRequested || run?.status === 'cancelled') {
      throw new DOMException('Pipeline cancelled', 'AbortError');
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    // Non-fatal probe failure: continue.
  }
}


// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

async function updatePipelineSummary(
  outputDir: string,
  updates: Partial<PipelineSummary>
): Promise<void> {
  const summaryPath = path.join(outputDir, 'pipeline-summary.json');
  try {
    const existing = JSON.parse(await fs.readFile(summaryPath, 'utf-8')) as PipelineSummary;
    const updated = { ...existing, ...updates };
    await fs.writeFile(summaryPath, JSON.stringify(updated, null, 2));
  } catch {
    console.warn('[ReviewCompletion] Could not update pipeline summary');
  }
}

async function updateReviewRunStatus(runId: string | undefined, updates: {
  status: string;
  stage?: V3PipelineStage;
  progress?: number;
  message?: string;
  result?: Record<string, unknown>;
  error?: string;
}): Promise<void> {
  if (!runId) return;
  try {
    const { internal } = await import('../../../convex/_generated/api');
    const { mutateInternal } = await import('@/lib/convex');
    await mutateInternal(internal.runs.updateStatus, {
      runId: runId as import('../../../convex/_generated/dataModel').Id<"runs">,
      status: updates.status as "in_progress" | "pending_review" | "resuming" | "success" | "partial" | "error" | "cancelled",
      ...(updates.stage !== undefined && { stage: updates.stage }),
      ...(updates.progress !== undefined && { progress: updates.progress }),
      ...(updates.message !== undefined && { message: updates.message }),
      ...(updates.result !== undefined && { result: updates.result }),
      ...(updates.error !== undefined && { error: updates.error }),
    });
  } catch (err) {
    console.warn('[ReviewCompletion] Failed to update Convex status:', err);
  }
}

/**
 * Find a pipeline directory by pipelineId across all datasets.
 */
export async function findPipelineDir(pipelineId: string): Promise<{ path: string; dataset: string } | null> {
  // Validate pipelineId — only allow alphanumeric, hyphens, underscores, dots (no path separators)
  if (!/^[a-zA-Z0-9_.-]+$/.test(pipelineId)) {
    return null;
  }

  const outputsDir = path.join(process.cwd(), 'outputs');

  try {
    await fs.access(outputsDir);
  } catch {
    return null;
  }

  const datasetDirs = await fs.readdir(outputsDir);
  for (const dataset of datasetDirs) {
    const datasetPath = path.join(outputsDir, dataset);
    const stat = await fs.stat(datasetPath);
    if (!stat.isDirectory()) continue;

    const pipelinePath = path.join(datasetPath, pipelineId);
    try {
      const pipelineStat = await fs.stat(pipelinePath);
      if (pipelineStat.isDirectory()) {
        return { path: pipelinePath, dataset };
      }
    } catch {
      // Not in this dataset, continue
    }
  }

  return null;
}

// -------------------------------------------------------------------------
// Apply Decisions
// -------------------------------------------------------------------------

export interface ApplyDecisionsResult {
  modifiedResult: ValidationResultType;
  hintErrors: Array<{ groupName: string; columnName: string; error: string }>;
}

export class InvalidReviewDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReviewDecisionError';
  }
}

export function assertSelectableAlternatives(
  decisions: CrosstabDecision[],
  flaggedColumns: FlaggedCrosstabColumn[],
): void {
  const flaggedMap = new Map<string, FlaggedCrosstabColumn>();
  for (const flagged of flaggedColumns) {
    flaggedMap.set(`${flagged.groupName}::${flagged.columnName}`, flagged);
  }

  for (const decision of decisions) {
    if (decision.action !== 'select_alternative' || decision.selectedAlternative === undefined) {
      continue;
    }

    const key = `${decision.groupName}::${decision.columnName}`;
    const flagged = flaggedMap.get(key);
    if (!flagged) {
      throw new InvalidReviewDecisionError(`Cannot select an alternative for ${key} because it is not in the review payload.`);
    }

    const alternative = flagged.alternatives[decision.selectedAlternative];
    if (!alternative) {
      throw new InvalidReviewDecisionError(`Alternative ${decision.selectedAlternative} is not available for ${key}.`);
    }

    if (!alternative.selectable) {
      throw new InvalidReviewDecisionError(
        alternative.nonSelectableReason
          ? `Alternative ${decision.selectedAlternative} for ${key} cannot be selected: ${alternative.nonSelectableReason}`
          : `Alternative ${decision.selectedAlternative} for ${key} cannot be selected.`,
      );
    }
  }
}

/**
 * Apply review decisions to crosstab result.
 * Returns modified ValidationResultType with user's decisions applied,
 * plus any hint errors for the diff report.
 */
export async function applyDecisions(
  crosstabResult: ValidationResultType,
  flaggedColumns: FlaggedCrosstabColumn[],
  decisions: CrosstabDecision[],
  agentDataMap: AgentDataMapItem[],
  outputDir: string,
  crosstabScratchpadByGroup?: Record<string, Array<{ timestamp: string; action: string; content: string }>>,
  abortSignal?: AbortSignal,
  runId?: string,
  groupHints?: Array<{ groupName: string; hint: string }>,
  orgId?: string,
): Promise<ApplyDecisionsResult> {
  assertSelectableAlternatives(decisions, flaggedColumns);

  const toExpressionType = (value: string | undefined): ExpressionType => {
    const allowed: ExpressionType[] = [
      'direct_variable',
      'conceptual_filter',
      'from_list',
      'placeholder',
      'comparison',
      'total',
    ];
    return allowed.includes(value as ExpressionType) ? (value as ExpressionType) : 'direct_variable';
  };

  const decisionMap = new Map<string, CrosstabDecision>();
  for (const d of decisions) {
    decisionMap.set(`${d.groupName}::${d.columnName}`, d);
  }

  const flaggedMap = new Map<string, FlaggedCrosstabColumn>();
  for (const f of flaggedColumns) {
    flaggedMap.set(`${f.groupName}::${f.columnName}`, f);
  }

  // Build group hint map
  const groupHintMap = new Map<string, string>();
  for (const gh of (groupHints ?? [])) {
    groupHintMap.set(gh.groupName, gh.hint);
  }

  const hintErrors: Array<{ groupName: string; columnName: string; error: string }> = [];
  const modifiedGroups: ValidatedGroupType[] = [];

  for (const group of crosstabResult.bannerCuts) {
    // Group-level hint: re-run ALL columns without explicit non-approve actions in one call
    const groupHint = groupHintMap.get(group.groupName);
    if (groupHint) {
      // Collect columns eligible for group hint (no explicit per-column action or just 'approve')
      const groupHintColumns: typeof group.columns = [];
      const explicitColumns: typeof group.columns = [];
      for (const col of group.columns) {
        const key = `${group.groupName}::${col.name}`;
        const decision = decisionMap.get(key);
        if (!decision || decision.action === 'approve') {
          groupHintColumns.push(col);
        } else {
          explicitColumns.push(col);
        }
      }

      if (groupHintColumns.length > 0) {
        console.log(`[Review] Re-running group "${group.groupName}" with group hint (${groupHintColumns.length} columns)`);
        try {
          await assertRunNotCancelled(runId, abortSignal, orgId);
          const previousScratchpadEntries = (crosstabScratchpadByGroup?.[group.groupName] || []).map((entry) => ({
            timestamp: entry.timestamp,
            action: entry.action,
            content: entry.content,
          }));

          const rerunResult = await processGroup(
            agentDataMap,
            {
              groupName: group.groupName,
              columns: groupHintColumns.map(col => {
                const flagged = flaggedMap.get(`${group.groupName}::${col.name}`);
                return { name: col.name, original: flagged?.original || col.adjusted || col.name };
              }),
            },
            {
              hint: groupHint,
              outputDir,
              abortSignal,
              previousResult: { groupName: group.groupName, columns: groupHintColumns },
              previousAttemptContext: {
                mode: 'hint_retry' as const,
                priorColumns: groupHintColumns.map(col => {
                  const flagged = flaggedMap.get(`${group.groupName}::${col.name}`);
                  return {
                    name: col.name,
                    original: flagged?.original || col.adjusted,
                    adjusted: col.adjusted,
                    reasoning: col.reasoning,
                    alternatives: col.alternatives || [],
                    uncertainties: col.uncertainties || [],
                  };
                }),
                priorScratchpadEntries: previousScratchpadEntries,
              },
            }
          );

          // Merge group-hinted columns with explicit columns
          const groupHintedResult = new Map<string, typeof group.columns[number]>();
          for (const rerunCol of rerunResult.columns) {
            groupHintedResult.set(rerunCol.name, {
              ...rerunCol,
              reasoning: `Group hint "${groupHint}": ${rerunCol.reasoning}`,
            });
          }

          const modifiedColumns = [];
          for (const col of groupHintColumns) {
            const hinted = groupHintedResult.get(col.name);
            if (hinted) {
              modifiedColumns.push({
                ...hinted,
                confidence: hinted.confidence > 0.9 ? 1.0 : hinted.confidence,
                humanReviewRequired: false,
              });
            } else {
              modifiedColumns.push({ ...col, humanReviewRequired: false });
            }
          }

          // Process explicit columns individually
          for (const col of explicitColumns) {
            const key = `${group.groupName}::${col.name}`;
            const decision = decisionMap.get(key)!;
            const flagged = flaggedMap.get(key);

            if (decision.action === 'skip') {
              continue;
            }

            if (decision.action === 'select_alternative' && decision.selectedAlternative !== undefined && flagged) {
              const alt = flagged.alternatives[decision.selectedAlternative];
              if (alt) {
                modifiedColumns.push({ ...col, adjusted: alt.expression, confidence: 1.0, humanReviewRequired: false });
                continue;
              }
            }

            if (decision.action === 'edit' && decision.editedExpression) {
              const sanitizeResult = sanitizeRExpression(decision.editedExpression);
              if (sanitizeResult.safe) {
                modifiedColumns.push({ ...col, adjusted: decision.editedExpression, confidence: 1.0, humanReviewRequired: false });
                continue;
              }
            }

            if (decision.action === 'provide_hint' && decision.hint && flagged) {
              try {
                // Build review context from already-resolved columns (group-hinted + explicit)
                const explicitReviewContext: Array<{ columnName: string; action: 'approved' | 'alternative_selected' | 'user_edited'; finalExpression: string }> = [];
                for (const resolved of modifiedColumns) {
                  const rKey = `${group.groupName}::${resolved.name}`;
                  const rDecision = decisionMap.get(rKey);
                  if (!rDecision || rDecision.action === 'approve') {
                    explicitReviewContext.push({ columnName: resolved.name, action: 'approved', finalExpression: resolved.adjusted });
                  } else if (rDecision.action === 'select_alternative') {
                    explicitReviewContext.push({ columnName: resolved.name, action: 'alternative_selected', finalExpression: resolved.adjusted });
                  } else if (rDecision.action === 'edit') {
                    explicitReviewContext.push({ columnName: resolved.name, action: 'user_edited', finalExpression: resolved.adjusted });
                  }
                }

                // TODO: Route through _dispatchProcessGroup. See TODO on that function.
                const singleRerun = await processGroup(
                  agentDataMap,
                  { groupName: group.groupName, columns: [{ name: col.name, original: flagged.original }] },
                  {
                    hint: decision.hint,
                    outputDir,
                    abortSignal,
                    previousResult: { groupName: group.groupName, columns: [col] },
                    reviewContext: explicitReviewContext.length > 0 ? explicitReviewContext : undefined,
                    previousAttemptContext: {
                      mode: 'hint_retry' as const,
                      priorColumns: [{
                        name: col.name, original: flagged.original, adjusted: col.adjusted,
                        reasoning: col.reasoning, alternatives: flagged.alternatives || [],
                        uncertainties: flagged.uncertainties || [],
                      }],
                      priorScratchpadEntries: previousScratchpadEntries,
                    },
                  }
                );
                if (singleRerun.columns.length > 0) {
                  const rerunCol = singleRerun.columns[0];
                  modifiedColumns.push({
                    ...rerunCol,
                    confidence: rerunCol.confidence > 0.9 ? 1.0 : rerunCol.confidence,
                    reasoning: `Re-run with hint "${decision.hint}": ${rerunCol.reasoning}`,
                  });
                  continue;
                }
              } catch (rerunError) {
                const errorMsg = rerunError instanceof Error ? rerunError.message : String(rerunError);
                hintErrors.push({ groupName: group.groupName, columnName: col.name, error: errorMsg });
              }
            }

            // Default: approve
            modifiedColumns.push({ ...col, confidence: 1.0, humanReviewRequired: false });
          }

          if (modifiedColumns.length > 0) {
            modifiedGroups.push({ groupName: group.groupName, columns: modifiedColumns });
          }
          continue; // Skip the per-column loop below for this group
        } catch (groupRerunError) {
          const errorMsg = groupRerunError instanceof Error ? groupRerunError.message : String(groupRerunError);
          console.error(`[Review] Group hint re-run failed for "${group.groupName}":`, groupRerunError);
          for (const col of groupHintColumns) {
            hintErrors.push({ groupName: group.groupName, columnName: col.name, error: errorMsg });
          }
          // Fall through to per-column processing
        }
      }
    }
    await assertRunNotCancelled(runId, abortSignal, orgId);
    const modifiedColumns = [];

    for (const col of group.columns) {
      await assertRunNotCancelled(runId, abortSignal, orgId);
      const key = `${group.groupName}::${col.name}`;
      const decision = decisionMap.get(key);
      const flagged = flaggedMap.get(key);

      if (decision?.action === 'skip') {
        console.log(`[Review] Skipping column: ${key}`);
        continue;
      }

      if (decision?.action === 'select_alternative' && decision.selectedAlternative !== undefined && flagged) {
        const alt = flagged.alternatives[decision.selectedAlternative];
        if (alt) {
          console.log(`[Review] Using alternative ${decision.selectedAlternative} for: ${key}`);
          modifiedColumns.push({
            ...col,
            adjusted: alt.expression,
            confidence: 1.0,
            reason: `User selected alternative: ${alt.userSummary}`,
            humanReviewRequired: false
          });
          continue;
        }
      }

      if (decision?.action === 'edit' && decision.editedExpression) {
        const sanitizeResult = sanitizeRExpression(decision.editedExpression);
        if (!sanitizeResult.safe) {
          console.warn(`[Review] Rejected unsafe edited expression for ${key}: ${sanitizeResult.error}`);
        } else {
          console.log(`[Review] Using edited expression for: ${key}`);
          modifiedColumns.push({
            ...col,
            adjusted: decision.editedExpression,
            confidence: 1.0,
            reason: 'User edited expression directly',
            humanReviewRequired: false
          });
          continue;
        }
      }

      if (decision?.action === 'provide_hint' && decision.hint && flagged) {
        console.log(`[Review] Re-running with hint for: ${key}`);
        try {
          const previousResult: ValidatedGroupType = {
            groupName: group.groupName,
            columns: [
              {
                name: col.name,
                adjusted: flagged.proposed,
                confidence: flagged.confidence,
                reasoning: flagged.reasoning,
                userSummary: flagged.userSummary,
                alternatives: flagged.alternatives || [],
                uncertainties: flagged.uncertainties || [],
                expressionType: toExpressionType(flagged.expressionType),
              },
            ],
          };

          const previousScratchpadEntries = (crosstabScratchpadByGroup?.[group.groupName] || []).map((entry) => ({
            timestamp: entry.timestamp,
            action: entry.action,
            content: entry.content,
          }));

          // Build review context from already-resolved columns in this group.
          // This lets the agent see patterns the reviewer has established
          // (e.g., consistently choosing OR-joined iteration variables).
          // TODO: Once hint re-runs are migrated to _dispatchProcessGroup (V2),
          // this review context building can stay — just remove the V1-specific
          // ReviewContextEntry import and use the V2 type exclusively.
          const reviewContext: Array<{ columnName: string; action: 'approved' | 'alternative_selected' | 'user_edited'; finalExpression: string }> = [];
          for (const resolved of modifiedColumns) {
            const resolvedKey = `${group.groupName}::${resolved.name}`;
            const resolvedDecision = decisionMap.get(resolvedKey);
            if (resolvedDecision?.action === 'approve' || !resolvedDecision) {
              reviewContext.push({ columnName: resolved.name, action: 'approved', finalExpression: resolved.adjusted });
            } else if (resolvedDecision?.action === 'select_alternative') {
              reviewContext.push({ columnName: resolved.name, action: 'alternative_selected', finalExpression: resolved.adjusted });
            } else if (resolvedDecision?.action === 'edit') {
              reviewContext.push({ columnName: resolved.name, action: 'user_edited', finalExpression: resolved.adjusted });
            }
          }

          // TODO: This calls processGroup (V1) directly. Should route through
          // _dispatchProcessGroup to use V2 when question-centric mode is on.
          // See TODO on _dispatchProcessGroup for the migration plan.
          const rerunResult = await processGroup(
            agentDataMap,
            {
              groupName: group.groupName,
              columns: [{ name: col.name, original: flagged.original }]
            },
            {
              hint: decision.hint,
              outputDir,
              abortSignal,
              previousResult,
              reviewContext: reviewContext.length > 0 ? reviewContext : undefined,
              previousAttemptContext: {
                mode: 'hint_retry',
                priorColumns: [
                  {
                    name: col.name,
                    original: flagged.original,
                    adjusted: flagged.proposed,
                    reasoning: flagged.reasoning,
                    alternatives: flagged.alternatives || [],
                    uncertainties: flagged.uncertainties || [],
                  },
                ],
                priorScratchpadEntries: previousScratchpadEntries,
              },
            }
          );

          if (rerunResult.columns.length > 0) {
            const rerunCol = rerunResult.columns[0];
            if (rerunCol.confidence > 0.9) {
              console.log(`[Review] Re-run successful with confidence ${rerunCol.confidence} - auto-approving`);
              modifiedColumns.push({
                ...rerunCol,
                confidence: 1.0,
                reasoning: `Re-run with hint "${decision.hint}": ${rerunCol.reasoning}`,
              });
            } else {
              console.log(`[Review] Re-run had confidence ${rerunCol.confidence} - using anyway`);
              modifiedColumns.push({
                ...rerunCol,
                reasoning: `Re-run with hint "${decision.hint}": ${rerunCol.reasoning}`,
              });
            }
            continue;
          }
        } catch (rerunError) {
          const errorMsg = rerunError instanceof Error ? rerunError.message : String(rerunError);
          console.error(`[Review] Re-run failed for ${key}:`, rerunError);
          hintErrors.push({ groupName: group.groupName, columnName: col.name, error: errorMsg });
          // Fall through to approve as-is
        }
      }

      // Default: approve as-is
      if (decision?.action === 'approve' || !decision) {
        modifiedColumns.push({
          ...col,
          confidence: decision ? 1.0 : col.confidence,
          humanReviewRequired: false
        });
      }
    }

    if (modifiedColumns.length > 0) {
      modifiedGroups.push({
        groupName: group.groupName,
        columns: modifiedColumns
      });
    }
  }

  // Tag all columns with provenance
  for (const group of modifiedGroups) {
    for (const col of group.columns) {
      const key = `${group.groupName}::${col.name}`;
      const decision = decisionMap.get(key);
      const groupHint = groupHintMap.get(group.groupName);
      const originalCol = crosstabResult.bannerCuts
        .find(g => g.groupName === group.groupName)?.columns
        .find(c => c.name === col.name);
      const preReviewExpr = originalCol?.adjusted || '';

      let reviewAction: string = 'ai_original';
      let reviewHint = '';

      if (decision?.action === 'provide_hint' && decision.hint) {
        reviewAction = 'hint_applied';
        reviewHint = decision.hint;
      } else if (decision?.action === 'select_alternative') {
        reviewAction = 'alternative_selected';
      } else if (decision?.action === 'edit') {
        reviewAction = 'user_edited';
      } else if (decision?.action === 'approve') {
        reviewAction = 'approved';
      } else if (!decision && groupHint) {
        reviewAction = 'hint_applied';
        reviewHint = groupHint;
      }

      (col as Record<string, unknown>).reviewAction = reviewAction;
      (col as Record<string, unknown>).reviewHint = reviewHint;
      (col as Record<string, unknown>).preReviewExpression = preReviewExpr;
    }
  }

  return { modifiedResult: { bannerCuts: modifiedGroups }, hintErrors };
}

// -------------------------------------------------------------------------
// Review Diff Report
// -------------------------------------------------------------------------

import type {
  ReviewDiffEntry,
  ReviewDiffReport,
  ReviewDiffSummary,
} from './types';

function buildReviewDiffReport(
  pipelineId: string,
  originalResult: ValidationResultType,
  modifiedResult: ValidationResultType,
  decisions: CrosstabDecision[],
  flaggedColumns: FlaggedCrosstabColumn[],
  hintErrors: Array<{ groupName: string; columnName: string; error: string }>,
): ReviewDiffReport {
  const decisionMap = new Map<string, CrosstabDecision>();
  for (const d of decisions) {
    decisionMap.set(`${d.groupName}::${d.columnName}`, d);
  }

  const flaggedMap = new Map<string, FlaggedCrosstabColumn>();
  for (const f of flaggedColumns) {
    flaggedMap.set(`${f.groupName}::${f.columnName}`, f);
  }

  const hintErrorMap = new Map<string, string>();
  for (const e of hintErrors) {
    hintErrorMap.set(`${e.groupName}::${e.columnName}`, e.error);
  }

  const modifiedLookup = new Map<string, { expression: string; confidence: number }>();
  for (const group of modifiedResult.bannerCuts) {
    for (const col of group.columns) {
      modifiedLookup.set(`${group.groupName}::${col.name}`, {
        expression: col.adjusted,
        confidence: col.confidence,
      });
    }
  }

  const entries: ReviewDiffEntry[] = [];

  for (const group of originalResult.bannerCuts) {
    for (const col of group.columns) {
      const key = `${group.groupName}::${col.name}`;
      const decision = decisionMap.get(key);
      const _flagged = flaggedMap.get(key);
      const hintError = hintErrorMap.get(key);
      const modified = modifiedLookup.get(key);

      const action = decision?.action ?? 'approve';
      const before = { expression: col.adjusted, confidence: col.confidence };
      const after = modified ?? before;
      const expressionChanged = before.expression !== after.expression;

      let status: 'applied' | 'error' | 'fallback' = 'applied';
      let error: string | undefined;

      if (action === 'provide_hint' && hintError) {
        status = 'fallback';
        error = hintError;
      } else if (action === 'skip' && !modified) {
        status = 'applied';
      }

      entries.push({
        groupName: group.groupName,
        columnName: col.name,
        action: action as ReviewDiffEntry['action'],
        ...(action === 'provide_hint' && decision?.hint ? { hint: decision.hint } : {}),
        ...(action === 'select_alternative' && decision?.selectedAlternative !== undefined
          ? { selectedAlternativeIndex: decision.selectedAlternative }
          : {}),
        before,
        after,
        expressionChanged,
        status,
        ...(error ? { error } : {}),
      });
    }
  }

  const summary: ReviewDiffSummary = {
    totalColumns: entries.length,
    approved: entries.filter(e => e.action === 'approve').length,
    hinted: entries.filter(e => e.action === 'provide_hint').length,
    alternativesSelected: entries.filter(e => e.action === 'select_alternative').length,
    edited: entries.filter(e => e.action === 'edit').length,
    skipped: entries.filter(e => e.action === 'skip').length,
    expressionsChanged: entries.filter(e => e.expressionChanged).length,
    expressionsUnchanged: entries.filter(e => !e.expressionChanged).length,
    errors: entries.filter(e => e.status === 'error' || e.status === 'fallback').length,
  };

  return {
    pipelineId,
    reviewedAt: new Date().toISOString(),
    entries,
    summary,
  };
}

// -------------------------------------------------------------------------
// Complete Pipeline (V3-only Post-Review Pipeline)
// -------------------------------------------------------------------------

export interface CompletePipelineResult {
  success: boolean;
  status: 'success' | 'partial' | 'error';
  message: string;
  outputDir: string;
  postProcessing?: RunResultPostProcessing;
  exportArtifacts?: ExportArtifactRefs;
  exportReadiness?: ExportArtifactRefs['readiness'];
  exportErrors?: Array<{
    format: 'shared';
    stage: 'contract_build';
    message: string;
    retryable: boolean;
    timestamp: string;
  }>;
  tableCount?: number;
  cutCount?: number;
  bannerGroups?: number;
  durationMs?: number;
  reviewDiff?: ReviewDiffReport;
  pipelineDecisions?: PipelineDecisions;
  decisionsSummary?: string;
}

/**
 * Complete the pipeline after review decisions are applied.
 *
 * V3-only flow:
 *   Load V3 checkpoint → Apply decisions → Diff report →
 *   Load V3 artifacts (questionid-final, canonical tables) →
 *   Derive loop mappings → Loop semantics → Compute chain (22-14) →
 *   PostV3Processing (R script → R execution → Excel)
 */
export async function completePipeline(
  outputDir: string,
  pipelineId: string,
  originalCrosstabResult: ValidationResultType,
  _pathBResult: PathBResult | null,
  reviewState: CrosstabReviewState,
  decisions: CrosstabDecision[],
  runId?: string,
  abortSignal?: AbortSignal,
  groupHints?: GroupHint[],
  projectId?: string,
  orgId?: string,
  workerId?: string,
): Promise<CompletePipelineResult> {
  return runWithPipelineContext(
    {
      pipelineId,
      runId: runId || pipelineId,
      source: 'reviewCompletion',
    },
    async () => {
  // For recovered dirs (outputs/_recovered/{runId}), fall back to pipelineId for observability
  const rawDatasetName = path.basename(path.dirname(outputDir));
  const datasetName = rawDatasetName === '_recovered' ? pipelineId : rawDatasetName;
  const metricsCollector = new AgentMetricsCollector();
  const wideEvent = new WideEvent({
    pipelineId,
    dataset: datasetName,
    orgId: orgId,
    userId: runId || pipelineId,
    projectId: projectId,
  });
  metricsCollector.bindWideEvent(wideEvent);

  // Start console capture: appends to logs/pipeline.log (continues the orchestrator's log)
  const projectName = reviewState.projectName || datasetName;
  const consoleCapture = new ConsoleCapture(outputDir, {
    projectName,
    runId: pipelineId,
  });
  await consoleCapture.start();
  registerPipelineCleanup(async () => {
    await consoleCapture.stop();
  });

  return consoleCapture.run(() => runWithMetricsCollector(metricsCollector, async () => {
  // -------------------------------------------------------------------------
  // V3 Checkpoint — Load from disk
  // -------------------------------------------------------------------------
  const v3Checkpoint = await loadCheckpoint(outputDir)
    ?? reviewState.v3Checkpoint;

  if (!v3Checkpoint) {
    throw new Error(
      '[ReviewCompletion] V3 checkpoint not found. ' +
      'Legacy pipeline path has been removed (Phase 6c). ' +
      'This run must be restarted with the V3 runtime.',
    );
  }

  console.log(`[V3] Loaded stage checkpoint (last completed: ${v3Checkpoint.lastCompletedStage ?? 'none'})`);

  const stopHeartbeat = runId ? startHeartbeatInterval(runId, 30_000, workerId) : () => {};
  try {
    await assertRunNotCancelled(runId, abortSignal, orgId);

    const wizardConfig = reviewState.wizardConfig;
    const loopStatTestingMode = reviewState.loopStatTestingMode;
    const verboseDataMap = reviewState.verboseDataMap as VerboseDataMapType[];
    console.log(`[ReviewCompletion] wizardConfig restored: present=${wizardConfig !== undefined}, displayMode=${wizardConfig?.displayMode ?? 'undefined'}, separateWorkbooks=${wizardConfig?.separateWorkbooks ?? 'undefined'}`);

    // -----------------------------------------------------------------------
    // Step 1: Apply review decisions
    // -----------------------------------------------------------------------
    await updateReviewRunStatus(runId, {
      status: 'resuming', stage: 'applying_review', progress: 55,
      message: 'Applying review decisions...',
    });

    const applyResult = await applyDecisions(
      originalCrosstabResult,
      reviewState.flaggedColumns,
      decisions,
      reviewState.agentDataMap,
      outputDir,
      reviewState.crosstabScratchpadByGroup,
      abortSignal,
      runId,
      groupHints,
      orgId,
    );
    const modifiedCrosstabResult = applyResult.modifiedResult;

    // Build and persist review diff report
    const diffReport = buildReviewDiffReport(
      pipelineId, originalCrosstabResult, modifiedCrosstabResult,
      decisions, reviewState.flaggedColumns, applyResult.hintErrors,
    );
    const reviewDir = path.join(outputDir, 'agents', 'crosstab', 'review');
    await fs.mkdir(reviewDir, { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(reviewDir, 'review-diff.json'),
        JSON.stringify(diffReport, null, 2),
      ),
      fs.writeFile(
        path.join(reviewDir, 'crosstab-output-post-review.json'),
        JSON.stringify(modifiedCrosstabResult, null, 2),
      ),
    ]);
    console.log(`[ReviewCompletion] Review diff: ${diffReport.summary.expressionsChanged} changed, ${diffReport.summary.errors} errors`);

    // Store diff summary in Convex for reactive UI
    try {
      const { internal: convexInternal } = await import('../../../convex/_generated/api');
      const { mutateInternal: convexMutate } = await import('@/lib/convex');
      await convexMutate(convexInternal.runs.mergeReviewDiff, {
        runId: runId as import('../../../convex/_generated/dataModel').Id<"runs">,
        reviewDiff: diffReport.summary,
      });
    } catch (convexErr) {
      console.warn('[ReviewCompletion] Failed to store review diff in Convex:', convexErr);
    }

    await assertRunNotCancelled(runId, abortSignal, orgId);

    // -----------------------------------------------------------------------
    // Step 2: Load V3 artifacts from disk
    // -----------------------------------------------------------------------
    await updateReviewRunStatus(runId, {
      status: 'resuming', stage: 'loading_v3_artifacts', progress: 60,
      message: 'Loading enrichment and table artifacts...',
    });

    // Load question-id entries from stage 12
    const rawArtifact12 = await loadArtifact<WrappedQuestionIdOutput | QuestionIdEntry[]>(
      outputDir, '12',
    );
    if (!rawArtifact12) {
      throw new Error('V3 artifact not found: questionid-final.json (stage 12)');
    }
    const wrapped12 = !Array.isArray(rawArtifact12) && Array.isArray((rawArtifact12 as WrappedQuestionIdOutput).questionIds)
      ? (rawArtifact12 as WrappedQuestionIdOutput)
      : null;
    const entries: QuestionIdEntry[] = (wrapped12?.questionIds ?? rawArtifact12) as QuestionIdEntry[];
    if (!Array.isArray(entries)) {
      throw new Error('V3 artifact has invalid shape: questionid-final.json');
    }
    console.log(`[ReviewCompletion] Loaded ${entries.length} question-id entries from stage 12`);

    // Load canonical tables from stage 13e (NET-enriched) or fall back to 13d.
    // The orchestrator now awaits canonical completion before pausing for review,
    // so 13e should always be available. The 13d fallback is a safety net only
    // (e.g., R2 recovery where only 13d was uploaded).
    let canonicalOutput = await loadArtifact<CanonicalTableOutput>(outputDir, '13e');

    if (!canonicalOutput?.tables) {
      console.warn('[ReviewCompletion] Stage 13e not found — falling back to stage 13d (tables without NET enrichment).');
      canonicalOutput = await loadArtifact<CanonicalTableOutput>(outputDir, '13d');
    }

    if (!canonicalOutput?.tables) {
      throw new Error('V3 artifact not found: table-enriched.json (stage 13e) or table.json (stage 13d)');
    }
    const canonicalTables: CanonicalTable[] = canonicalOutput.tables;
    const tablePlan = await loadArtifact<TablePlanOutput>(outputDir, '13b');
    console.log(`[ReviewCompletion] Loaded ${canonicalTables.length} canonical tables from stage 13e/13d`);

    // -----------------------------------------------------------------------
    // Step 3: Derive loop mappings from V3 entries
    // -----------------------------------------------------------------------
    let loopMappings: LoopGroupMapping[] = reviewState.loopMappings || [];

    if (loopMappings.length === 0) {
      const loopDerivation = deriveLoopMappings(entries);
      if (loopDerivation.hasLoops) {
        loopMappings = loopDerivation.loopMappings;
        console.log(`[ReviewCompletion] Loop mappings derived from V3 entries: ${loopDerivation.summary}`);
      }
    } else {
      console.log(`[ReviewCompletion] Loop mappings from review state: ${loopMappings.length} groups`);
    }

    // -----------------------------------------------------------------------
    // Step 4: Loop semantics resolution
    // -----------------------------------------------------------------------
    let loopSemanticsPolicy: LoopSemanticsPolicy | undefined;

    if (loopMappings.length > 0) {
      await updateReviewRunStatus(runId, {
        status: 'resuming', stage: 'loop_semantics', progress: 65,
        message: 'Classifying loop semantics...',
      });
      await assertRunNotCancelled(runId, abortSignal, orgId);

      if (process.env.SKIP_HEALTH_CHECK !== 'true') {
        const {
          formatHealthCheckFailure,
          getHealthCheckProviderLabel,
          runHealthCheckForAgentModels,
        } = await import('@/lib/pipeline/HealthCheck');
        const { getEnvironmentConfig } = await import('@/lib/env');
        const config = getEnvironmentConfig();
        const providerLabel = getHealthCheckProviderLabel();
        console.log('[ReviewCompletion] Pre-flight: checking LoopSemanticsAgent deployment...');
        const health = await runHealthCheckForAgentModels(
          [{ agent: 'LoopSemanticsAgent', model: config.loopSemanticsModel }],
          abortSignal,
        );
        if (!health.success) {
          throw new Error(`${providerLabel} health check failed: ${formatHealthCheckFailure(health)}`);
        }
        console.log(
          `[ReviewCompletion] Pre-flight: loop semantics deployment healthy (${health.durationMs}ms)`,
        );
      }

      console.log('[ReviewCompletion] Running LoopSemanticsPolicyAgent...');

      const cutsSpecForPolicy = buildCutsSpec(modifiedCrosstabResult);
      try {
        loopSemanticsPolicy = await runLoopSemanticsPolicyAgent({
          loopSummary: buildEnrichedLoopSummary(loopMappings, entries),
          bannerGroups: cutsSpecForPolicy.groups.map(g => ({
            groupName: g.groupName,
            columns: g.cuts.map(c => ({ name: c.name, original: c.name })),
          })),
          cuts: cutsSpecForPolicy.cuts.map(c => ({
            name: c.name,
            groupName: c.groupName,
            rExpression: c.rExpression,
          })),
          datamapExcerpt: buildLoopSemanticsExcerpt(entries, cutsSpecForPolicy.cuts),
          loopMappings,
          outputDir,
          abortSignal,
        });
        console.log(`[ReviewCompletion] LoopSemantics: ${loopSemanticsPolicy.bannerGroups.length} groups classified`);
      } catch (lspError) {
        const fallbackReason = lspError instanceof Error ? lspError.message : String(lspError);
        console.warn(`[ReviewCompletion] LoopSemantics failed — using fallback: ${fallbackReason}`);
        loopSemanticsPolicy = createRespondentAnchoredFallbackPolicy(
          cutsSpecForPolicy.groups.map(g => g.groupName),
          fallbackReason,
        );
        try {
          await persistSystemError({
            outputDir,
            dataset: datasetName,
            pipelineId,
            stageNumber: 8,
            stageName: 'LoopSemanticsPolicyAgent',
            severity: 'warning',
            actionTaken: 'continued',
            error: lspError,
            meta: { action: 'fallback_to_respondent_anchored' },
          });
        } catch { /* ignore */ }
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Compute chain (stages 22-14)
    // -----------------------------------------------------------------------
    await updateReviewRunStatus(runId, {
      status: 'resuming', stage: 'compute', progress: 70,
      message: `Running compute chain for ${canonicalTables.length} tables...`,
    });
    await assertRunNotCancelled(runId, abortSignal, orgId);
    console.log('[ReviewCompletion] Running compute chain (stages 22-14)...');

    const resolvedStatConfig = wizardConfig?.statTesting
      ? resolveStatConfig({
          wizard: {
            thresholds: wizardConfig.statTesting.thresholds,
            minBase: wizardConfig.statTesting.minBase,
          },
        })
      : resolveStatConfig({});

    // Compile loop contract if loop policy exists
    let compiledLoopContract: import('@/schemas/compiledLoopContractSchema').CompiledLoopContract | undefined;
    if (loopSemanticsPolicy && loopMappings.length > 0) {
      const { compileLoopContract } = await import('@/lib/v3/runtime/compileLoopContract');
      const cutsSpec = buildCutsSpec(modifiedCrosstabResult);
      const knownColumns = new Set<string>();
      if (entries) {
        for (const entry of entries) {
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
        loopMappings,
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

    const computeResult = await runComputePipeline({
      tables: canonicalToComputeTables(canonicalTables),
      crosstabPlan: modifiedCrosstabResult,
      outputDir,
      pipelineId,
      dataset: datasetName,
      abortSignal,
      checkpoint: v3Checkpoint,
      statTestingConfig: resolvedStatConfig,
      loopMappings: loopMappings.length > 0 ? loopMappings : undefined,
      loopSemanticsPolicy,
      compiledLoopContract,
      loopStatTestingMode,
      weightVariable: wizardConfig?.weightVariable,
    });

    console.log(`[ReviewCompletion] Compute chain complete: ${computeResult.rScriptInput.tables.length} tables, ${computeResult.rScriptInput.cuts.length} cuts`);

    // -----------------------------------------------------------------------
    // Step 6: Ensure SPSS file is in outputDir for R execution
    // -----------------------------------------------------------------------
    const spssDestPath = path.join(outputDir, 'dataFile.sav');
    try {
      await fs.access(spssDestPath);
    } catch {
      // Not present — try copying from inputs/
      const inputsDir = path.join(outputDir, 'inputs');
      try {
        const inputFiles = await fs.readdir(inputsDir);
        const spssFile = inputFiles.find(f => f.endsWith('.sav'));
        if (spssFile) {
          await fs.copyFile(path.join(inputsDir, spssFile), spssDestPath);
          console.log('[ReviewCompletion] Copied SPSS file from inputs/');
        }
      } catch {
        console.warn('[ReviewCompletion] Could not copy SPSS file — R execution may fail');
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: PostV3Processing (R script → R execution → Excel)
    // -----------------------------------------------------------------------
    await updateReviewRunStatus(runId, {
      status: 'resuming', stage: 'executing_r', progress: 80,
      message: 'Generating R script and executing...',
    });
    await assertRunNotCancelled(runId, abortSignal, orgId);

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
      onFinalTableStageStart: async () => {
        await updateReviewRunStatus(runId, {
          status: 'resuming',
          stage: 'finalizing_tables',
          progress: 84,
          message: 'Finalizing table outputs...',
        });
      },
    });

    const postProcessingAssessment = assessPostV3Processing(postResult);
    console.log(
      `[ReviewCompletion] PostV3: R ${postResult.rExecution.success ? 'succeeded' : 'failed'} (${postResult.rExecution.durationMs}ms), ` +
      `final tables ${postResult.finalTableContract.success ? 'succeeded' : 'failed'} (${postResult.finalTableContract.durationMs}ms), ` +
      `Excel ${postResult.excelExport.success ? 'succeeded' : 'failed'} (${postResult.excelExport.durationMs}ms)`,
    );

    let exportArtifacts: ExportArtifactRefs | undefined;
    let exportReadiness: ExportArtifactRefs['readiness'] | undefined;
    const exportErrors: Array<{
      format: 'shared';
      stage: 'contract_build';
      message: string;
      retryable: boolean;
      timestamp: string;
    }> = [];

    if (postResult.finalTableContract.success) {
      await updateReviewRunStatus(runId, {
        status: 'resuming',
        stage: 'contract_build',
        progress: 88,
        message: 'Building export contract...',
      });

      try {
        const copiedWideSav = await ensureWideSavFallback(outputDir, 'dataFile.sav');
        if (copiedWideSav) {
          console.log('[ReviewCompletion][ExportData] Copied export/data/wide.sav fallback from runtime dataFile.sav');
        }

        const resultFiles: string[] = await fs.readdir(path.join(outputDir, 'results')).catch((): string[] => []);
        const hasDualWeightOutputs =
          resultFiles.includes('tables-weighted.json') &&
          resultFiles.includes('tables-unweighted.json');

        await persistPhase0Artifacts({
          outputDir,
          tablesWithLoopFrame: computeResult.rScriptInput.tables as unknown as import('@/schemas/verificationAgentSchema').TableWithLoopFrame[],
          loopMappings,
          loopSemanticsPolicy,
          weightVariable: wizardConfig?.weightVariable ?? null,
          hasDualWeightOutputs,
          sourceSavUploadedName: path.basename(reviewState.spssPath || 'dataFile.sav'),
          sourceSavRuntimeName: 'dataFile.sav',
          convexRefs: {
            runId,
            pipelineId,
          },
        });
        const phase1Manifest = await buildPhase1Manifest(outputDir);
        exportArtifacts = buildExportArtifactRefs(phase1Manifest.metadata);
        exportReadiness = phase1Manifest.metadata.readiness;
      } catch (exportErr) {
        const message = exportErr instanceof Error ? exportErr.message : String(exportErr);
        console.warn('[ReviewCompletion][ExportData] Failed to build shared export contract (non-fatal):', exportErr);
        exportErrors.push({
          format: 'shared',
          stage: 'contract_build',
          message,
          retryable: true,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      console.log('[ReviewCompletion][ExportData] Skipping export contract build because final table contract materialization failed');
    }

    // -----------------------------------------------------------------------
    // Step 8: Update pipeline summary
    // -----------------------------------------------------------------------
    const completionTime = new Date();
    let totalDurationMs = 0;
    try {
      const summaryPath = path.join(outputDir, 'pipeline-summary.json');
      const existingSummary = JSON.parse(await fs.readFile(summaryPath, 'utf-8')) as PipelineSummary;
      if (existingSummary.timestamp) {
        const startTime = new Date(existingSummary.timestamp).getTime();
        totalDurationMs = completionTime.getTime() - startTime;
      }
    } catch {
      console.warn('[ReviewCompletion] Could not read summary for duration calculation');
    }

    const cutsSpec = buildCutsSpec(modifiedCrosstabResult);
    const finalStatus = postProcessingAssessment.status;
    const errorRead = await readPipelineErrors(outputDir);
    const pipelineDecisions = buildPipelineDecisions({
      config: wizardConfig,
      questionId: {
        entries,
        metadata: wrapped12?.metadata,
      },
      checkpoint: computeResult.checkpoint,
      tables: {
        canonicalTablesPlanned: tablePlan?.summary.plannedTables ?? canonicalTables.length,
        canonicalTables: canonicalTables,
        finalTableCount: computeResult.rScriptInput.tables.length,
      },
      banners: {
        source: wizardConfig?.bannerMode === 'auto_generate' ? 'auto_generated' : 'uploaded',
        bannerGroupCount: modifiedCrosstabResult.bannerCuts.length,
        totalCuts: cutsSpec.cuts.length,
        flaggedForReview: reviewState.flaggedColumns.length,
      },
      weights: {
        variableUsed: wizardConfig?.weightVariable ?? null,
      },
      errors: {
        records: errorRead.records,
      },
      timing: {
        postRMs: postResult.rExecution.durationMs + postResult.finalTableContract.durationMs,
        excelMs: postResult.excelExport.durationMs,
        totalMs: totalDurationMs,
      },
    });
    const decisionsSummary = buildDecisionsSummary(pipelineDecisions);

    await updatePipelineSummary(outputDir, {
      status: finalStatus,
      currentStage: undefined,
      duration: totalDurationMs > 0 ? {
        ms: totalDurationMs,
        formatted: formatDuration(totalDurationMs)
      } : undefined,
      review: {
        flaggedColumnCount: reviewState.flaggedColumns.length,
        reviewUrl: projectId
          ? `/projects/${encodeURIComponent(projectId)}/review`
          : `/projects/${encodeURIComponent(pipelineId)}/review`,
        ...(diffReport ? {
          provenance: {
            totalCuts: cutsSpec.cuts.length,
            aiOriginal: cutsSpec.cuts.filter(c => c.reviewAction === 'ai_original').length,
            approved: cutsSpec.cuts.filter(c => c.reviewAction === 'approved').length,
            hintApplied: cutsSpec.cuts.filter(c => c.reviewAction === 'hint_applied').length,
            alternativeSelected: cutsSpec.cuts.filter(c => c.reviewAction === 'alternative_selected').length,
            userEdited: cutsSpec.cuts.filter(c => c.reviewAction === 'user_edited').length,
            expressionsChanged: diffReport.summary.expressionsChanged,
          },
        } : {}),
      },
      outputs: {
        variables: verboseDataMap.length,
        tableGeneratorTables: canonicalTables.length,
        verifiedTables: computeResult.rScriptInput.tables.length,
        validatedTables: computeResult.rScriptInput.tables.length,
        excludedTables: 0,
        totalTablesInR: computeResult.rScriptInput.tables.length,
        cuts: cutsSpec.cuts.length,
        bannerGroups: modifiedCrosstabResult.bannerCuts.length,
        sorting: {
          screeners: 0,
          main: computeResult.rScriptInput.tables.length,
          other: 0
        },
      },
      v3Checkpoint: computeResult.checkpoint,
      postProcessing: postResult as PipelineSummary['postProcessing'],
      pipelineDecisions,
      decisionsSummary,
    });

    console.log(`[ReviewCompletion] Pipeline completed in ${formatDuration(totalDurationMs)}`);

    // Generate human-readable table report
    await writeTableReport({
      dataset: datasetName,
      outputDir,
      tables: canonicalTables,
      pipelineTimingMs: totalDurationMs,
    });

    metricsCollector.unbindWideEvent();
    wideEvent.set('tableCount', computeResult.rScriptInput.tables.length);
    wideEvent.set('finalStage', postProcessingAssessment.finalStage);
    if (finalStatus !== 'success' && errorRead.records.length > 0) {
      wideEvent.set('errorSummary', summarizePipelineErrors(errorRead.records));
      const topErr = errorRead.records.find(r => r.severity === 'fatal')
        || errorRead.records.find(r => r.severity === 'error')
        || errorRead.records[0];
      if (topErr) {
        wideEvent.set('topError', topErr.message || topErr.stageName || 'Unknown');
      }
    }
    wideEvent.finish(finalStatus === 'success' ? 'success' : finalStatus === 'error' ? 'error' : 'partial');

    return {
      success: true,
      status: finalStatus as 'success' | 'partial' | 'error',
      message: postProcessingAssessment.message,
      outputDir,
      postProcessing: postResult as unknown as Record<string, unknown>,
      tableCount: computeResult.rScriptInput.tables.length,
      cutCount: cutsSpec.cuts.length,
      bannerGroups: modifiedCrosstabResult.bannerCuts.length,
      durationMs: totalDurationMs,
      reviewDiff: diffReport,
      pipelineDecisions,
      decisionsSummary,
      ...(exportArtifacts ? { exportArtifacts } : {}),
      ...(exportReadiness ? { exportReadiness } : {}),
      ...(exportErrors.length > 0 ? { exportErrors } : {}),
    };
  } catch (error) {
    if (isAbortError(error)) {
      metricsCollector.unbindWideEvent();
      wideEvent.finish('cancelled', 'Pipeline cancelled');
      throw error;
    }
    console.error('[ReviewCompletion] Background completion failed:', error);
    metricsCollector.unbindWideEvent();
    const rcErrorMsg = error instanceof Error ? error.message : 'Background completion failed';
    wideEvent.set('topError', rcErrorMsg);
    wideEvent.set('finalStage', 'pipeline_error');
    try {
      const catchErrorRead = await readPipelineErrors(outputDir);
      if (catchErrorRead.records.length > 0) {
        wideEvent.set('errorSummary', summarizePipelineErrors(catchErrorRead.records));
      }
    } catch { /* best-effort */ }
    wideEvent.finish('error', rcErrorMsg);
    try {
      await persistSystemError({
        outputDir,
        dataset: datasetName,
        pipelineId,
        stageNumber: 0,
        stageName: 'ReviewCompletion',
        severity: 'fatal',
        actionTaken: 'failed_pipeline',
        error,
        meta: { phase: 'complete_pipeline' },
      });
    } catch { /* ignore */ }
    await updatePipelineSummary(outputDir, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Background completion failed'
    });

    return {
      success: false,
      status: 'error',
      message: error instanceof Error ? error.message : 'Background completion failed',
      outputDir,
    };
  } finally {
    stopHeartbeat();
    await consoleCapture.stop();
  }
  })); // end consoleCapture.run + runWithMetricsCollector
    },
  );
}

export function getApprovedReviewSubmission(reviewState: CrosstabReviewState): {
  decisions: CrosstabDecision[];
  groupHints: GroupHint[];
} {
  if (reviewState.status !== 'approved') {
    throw new Error(`Review resume requires approved state, got ${reviewState.status}`);
  }

  if (!Array.isArray(reviewState.decisions) || reviewState.decisions.length === 0) {
    throw new Error('Review resume is missing persisted reviewer decisions.');
  }

  return {
    decisions: reviewState.decisions as CrosstabDecision[],
    groupHints: Array.isArray(reviewState.groupHints) ? reviewState.groupHints : [],
  };
}

export async function runQueuedReviewResume(params: {
  runId: string;
  workerId: string;
  outputDir: string;
  pipelineId: string;
  projectId: string;
  orgId: string;
  abortSignal?: AbortSignal;
}): Promise<CompletePipelineResult> {
  const run = await getConvexClient().query(api.runs.get, {
    runId: params.runId as Id<'runs'>,
    orgId: params.orgId as Id<'organizations'>,
  });

  if (!run) {
    throw new Error(`Run ${params.runId} not found for queued review resume.`);
  }

  const runResult = parseRunResult(run.result);
  const reviewR2Keys = runResult?.reviewR2Keys as ReviewR2Keys | undefined;
  const reviewState = JSON.parse(
    await fs.readFile(path.join(params.outputDir, 'crosstab-review-state.json'), 'utf-8'),
  ) as CrosstabReviewState;
  const { decisions, groupHints } = getApprovedReviewSubmission(reviewState);

  const result = await completePipeline(
    params.outputDir,
    params.pipelineId,
    reviewState.crosstabResult,
    null,
    reviewState,
    decisions,
    params.runId,
    params.abortSignal,
    groupHints,
    params.projectId,
    params.orgId,
    params.workerId,
  );

  await updateReviewRunStatus(params.runId, {
    status: 'resuming',
    stage: 'r2_finalize',
    progress: 90,
    message: 'Finalizing run artifacts...',
  });

  let r2Outputs: Record<string, string> | undefined;
  let r2UploadFailed = false;
  try {
    const manifest = await uploadPipelineOutputs(
      params.orgId,
      params.projectId,
      params.runId,
      params.outputDir,
    );
    r2Outputs = manifest.outputs;
    r2UploadFailed = manifest.uploadReport.failed.length > 0;
    if (r2UploadFailed) {
      Sentry.captureMessage('R2 artifact upload partially failed after retries (review worker path)', {
        level: 'warning',
        tags: { run_id: params.runId, pipeline_id: params.pipelineId },
        extra: {
          failedCount: manifest.uploadReport.failed.length,
          failedArtifacts: manifest.uploadReport.failed.map((entry) => entry.relativePath),
          successCount: Object.keys(r2Outputs).length,
        },
      });
    }
  } catch (r2Error) {
    r2UploadFailed = true;
    Sentry.captureException(r2Error, {
      tags: { run_id: params.runId, pipeline_id: params.pipelineId },
      extra: { context: 'R2 pipeline output upload failed completely after retries (review worker path)' },
    });
  }

  if (reviewR2Keys) {
    try {
      await deleteReviewFiles(reviewR2Keys);
    } catch (cleanupErr) {
      console.warn('[ReviewCompletion] R2 review file cleanup failed (non-fatal):', cleanupErr);
    }
  }

  const terminalStatus = result.status === 'success' && r2UploadFailed ? 'partial' : result.status;
  const terminalMessage = result.status === 'success' && r2UploadFailed
    ? `Generated ${result.tableCount ?? 0} tables but file upload failed — contact support.`
    : result.message;

  let exportArtifacts = result.exportArtifacts;
  let exportReadiness = result.exportReadiness;
  const exportErrors = [...(result.exportErrors ?? [])];

  if (r2Outputs && result.postProcessing?.finalTableContract && result.postProcessing.finalTableContract.success === true) {
    try {
      const metadataPath = path.join(params.outputDir, 'export', 'export-metadata.json');
      try {
        await fs.access(metadataPath);
        await finalizeExportMetadataWithR2Refs(params.outputDir, r2Outputs);
        const refreshedManifest = await buildPhase1Manifest(params.outputDir);
        const refreshedMetadataBuffer = await fs.readFile(metadataPath);
        r2Outputs['export/export-metadata.json'] = await uploadRunOutputArtifact({
          orgId: params.orgId,
          projectId: params.projectId,
          runId: params.runId,
          relativePath: 'export/export-metadata.json',
          body: refreshedMetadataBuffer,
          contentType: 'application/json',
          existingOutputs: r2Outputs,
        });
        exportArtifacts = buildExportArtifactRefs(refreshedManifest.metadata);
        exportReadiness = refreshedManifest.metadata.readiness;
      } catch {
        // export metadata is optional here
      }
    } catch (exportFinalizeErr) {
      exportErrors.push({
        format: 'shared',
        stage: 'contract_build',
        message: exportFinalizeErr instanceof Error ? exportFinalizeErr.message : String(exportFinalizeErr),
        retryable: true,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const qualityEval = await evaluateAndPersistRunQuality({
    runId: params.runId,
    outputDir: params.outputDir,
    orgId: params.orgId,
    projectId: params.projectId,
  });
  const finalCheckpoint = await loadCheckpoint(params.outputDir);

  const terminalResult: RunResultShape = {
    ...(runResult ?? {}),
    formatVersion: 3,
    pipelineId: params.pipelineId,
    outputDir: params.outputDir,
    ...(finalCheckpoint ? { v3Checkpoint: finalCheckpoint } : {}),
    downloadUrl: terminalStatus === 'success'
      ? `/api/runs/${encodeURIComponent(params.runId)}/download/crosstabs.xlsx`
      : undefined,
    r2Files: r2Outputs
      ? {
          inputs: runResult?.r2Files?.inputs ?? {},
          outputs: r2Outputs,
        }
      : runResult?.r2Files,
    reviewState: undefined,
    summary: {
      tables: result.tableCount ?? 0,
      cuts: result.cutCount ?? 0,
      bannerGroups: result.bannerGroups ?? 0,
      durationMs: result.durationMs ?? 0,
    },
    pipelineDecisions: result.pipelineDecisions,
    decisionsSummary: result.decisionsSummary,
    ...(result.postProcessing ? { postProcessing: result.postProcessing as RunResultShape['postProcessing'] } : {}),
    ...(exportArtifacts ? { exportArtifacts: exportArtifacts as unknown as RunResultShape['exportArtifacts'] } : {}),
    ...(exportReadiness ? { exportReadiness: exportReadiness as unknown as RunResultShape['exportReadiness'] } : {}),
    ...(exportErrors.length > 0 ? { exportErrors } : {}),
    quality: qualityEval.quality as RunResultShape['quality'],
  };

  await updateReviewRunStatus(params.runId, {
    status: terminalStatus,
    stage: 'complete',
    progress: 100,
    message: terminalMessage,
    result: terminalResult,
    ...(terminalStatus === 'error' ? { error: terminalMessage } : {}),
  });

  if (terminalStatus === 'success' || terminalStatus === 'partial') {
    try {
      const { recordProjectUsage } = await import('@/lib/billing/recordProjectUsage');
      await recordProjectUsage({
        projectId: params.projectId,
        orgId: params.orgId,
      });
    } catch (err) {
      console.warn('[ReviewCompletion] Billing usage recording failed (non-blocking):', err);
    }
  }

  sendPipelineNotification({
    runId: params.runId,
    status: terminalStatus as 'success' | 'partial' | 'error',
    launchedBy: (run as Record<string, unknown>).launchedBy as string | undefined,
    convexProjectId: params.projectId,
    convexOrgId: params.orgId,
    tableCount: result.tableCount,
    durationFormatted: result.durationMs ? formatDuration(result.durationMs) : undefined,
    errorMessage: terminalStatus === 'error' ? terminalMessage : undefined,
  }).catch(() => { /* fire-and-forget */ });

  return {
    ...result,
    status: terminalStatus,
    message: terminalMessage,
    ...(result.postProcessing ? { postProcessing: result.postProcessing } : {}),
    ...(exportArtifacts ? { exportArtifacts } : {}),
    ...(exportReadiness ? { exportReadiness } : {}),
    ...(exportErrors.length > 0 ? { exportErrors } : {}),
  };
}

/**
 * Wait for background chains and then finish the pipeline.
 *
 * V3: review may open as soon as planning completes. Canonical artifacts are
 * loaded from disk by completePipeline and may still require a short wait if
 * the reviewer submits before stage 13e finishes. Kept for backward compat
 * with the review route.
 */
export async function waitAndCompletePipeline(
  outputDir: string,
  pipelineId: string,
  originalCrosstabResult: ValidationResultType,
  reviewState: CrosstabReviewState,
  decisions: CrosstabDecision[],
  runId?: string,
  abortSignal?: AbortSignal,
  groupHints?: GroupHint[],
  projectId?: string,
): Promise<CompletePipelineResult> {
  // V3: both chains complete before review, call completePipeline directly
  return completePipeline(
    outputDir,
    pipelineId,
    originalCrosstabResult,
    null, // no pathBResult in V3
    reviewState,
    decisions,
    runId,
    abortSignal,
    groupHints,
    projectId,
  );
}
