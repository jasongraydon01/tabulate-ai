/**
 * V3 Runtime — Subtype Confirmation Gate (Stage 13c1)
 *
 * Reviews questions flagged for low subtype confidence at step 10 triage,
 * now in the context of the actual table plan from 13b. If the AI corrects
 * a subtype, re-derives that question's table block using the planner's own
 * logic. Splices corrected blocks into the plan, replacing original tables
 * for that question.
 *
 * Port of: scripts/v3-enrichment/13c-subtype-gate.ts
 *
 * Pipeline position:
 *   ... → 12 (reconciliation) → 13b (table planner) → THIS → 13c2 (structure gate)
 *
 * Non-fatal: If the AI agent call fails, logs a warning and returns pass-through
 * (all confirmed, deterministic confidence). This matches Phase 1's non-fatal posture.
 */

import type {
  QuestionIdEntry,
  SurveyMetadata,
  PlannedTable,
  PlannerAmbiguity,
  TablePlanOutput,
  SubtypeReview,
  BlockConfidence,
  ValidatedPlanOutput,
  TriagedEntry,
} from './types';
import { buildContext, planEntryTables } from './plan';
import {
  reviewSubtypeClassifications,
  type SubtypeGateBatchInput,
} from '@/agents/SubtypeGateAgent';
import { persistStageAgentTrace } from '../agentTraces';

// =============================================================================
// Input / Output Interfaces
// =============================================================================

export interface SubtypeGateInput {
  tablePlan: TablePlanOutput;
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  triageFlagged: TriagedEntry[];
  dataset: string;
  outputDir: string;
  abortSignal?: AbortSignal;
}

export interface SubtypeGateResult {
  validatedPlan: ValidatedPlanOutput;
  subtypeReviews: SubtypeReview[];
  blockConfidences: BlockConfidence[];
  correctedEntries: QuestionIdEntry[];
}

// =============================================================================
// Table block indexing
// =============================================================================

/**
 * Build a map from sourceQuestionId to PlannedTable[] for quick lookup.
 */
function buildTableBlockIndex(tables: PlannedTable[]): Map<string, PlannedTable[]> {
  const index = new Map<string, PlannedTable[]>();
  for (const table of tables) {
    const qid = table.sourceQuestionId;
    if (!qid) continue;
    const block = index.get(qid) || [];
    block.push(table);
    index.set(qid, block);
  }
  return index;
}

// =============================================================================
// Deterministic confidence assignment
// =============================================================================

/**
 * Assign deterministic confidence to unflagged questions.
 * Questions with high subtypeConfidence get 0.95; others get a proportional score.
 * Standard subtype always gets 0.95 (safe fallback, never wrong).
 */
function deterministicConfidence(entry: QuestionIdEntry): number {
  if (entry.analyticalSubtype === 'standard' || entry.analyticalSubtype === null) {
    return 0.95;
  }
  if ((entry.subtypeConfidence ?? 0) >= 0.9) {
    return 0.95;
  }
  // Proportional: map [0.8, 0.9) -> [0.80, 0.90)
  return Math.max(0.70, entry.subtypeConfidence ?? 0.70);
}

// =============================================================================
// Re-derivation
// =============================================================================

/**
 * Re-derive table block for a question after subtype correction.
 * Uses the exact same logic as 13b -- buildContext + planEntryTables.
 */
function rederiveTableBlock(
  dataset: string,
  entry: QuestionIdEntry,
  newSubtype: string,
  allReportable: QuestionIdEntry[],
  metadata: SurveyMetadata,
): PlannedTable[] {
  // Create a copy of the entry with the corrected subtype
  const correctedEntry: QuestionIdEntry = {
    ...entry,
    analyticalSubtype: newSubtype as QuestionIdEntry['analyticalSubtype'],
  };

  // Build a reportable map for context resolution
  const reportableMap = new Map<string, QuestionIdEntry>(
    allReportable.map(e => [e.questionId, e]),
  );
  // Replace with corrected entry
  reportableMap.set(correctedEntry.questionId, correctedEntry);

  const ctx = buildContext(dataset, correctedEntry, reportableMap, metadata);
  const ambiguities: PlannerAmbiguity[] = [];
  return planEntryTables(ctx, ambiguities);
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Run the subtype confirmation gate (stage 13c1).
 *
 * Filters triage-flagged entries to those with 'low-subtype-confidence' rule,
 * reviews them via the SubtypeGateAgent, re-derives table blocks on correction,
 * and assigns deterministic confidence to unflagged questions.
 *
 * Non-fatal: if the AI agent call fails, returns pass-through with all entries
 * confirmed at deterministic confidence.
 */
export async function runSubtypeGate(input: SubtypeGateInput): Promise<SubtypeGateResult> {
  const {
    tablePlan,
    entries,
    metadata,
    triageFlagged,
    dataset,
    outputDir,
    abortSignal,
  } = input;

  const reportable = entries.filter(e => e.disposition === 'reportable');
  const reportableByQid = new Map(reportable.map(e => [e.questionId, e]));
  const tableBlockIndex = buildTableBlockIndex(tablePlan.plannedTables);

  // Filter triage flagged entries to those with 'low-subtype-confidence' rule
  const subtypeFlagged = triageFlagged.filter(f =>
    f.triageReasons.some(r => r.rule === 'low-subtype-confidence'),
  );

  console.log(
    `[V3:13c1] ${reportable.length} reportable, ${subtypeFlagged.length} flagged for subtype review`,
  );

  const subtypeReviews: SubtypeReview[] = [];
  const blockConfidences: BlockConfidence[] = [];
  let workingTables = [...tablePlan.plannedTables];
  let correctedEntries = [...entries];

  // -----------------------------------------------------------------------
  // No flagged questions -- assign deterministic confidence to all
  // -----------------------------------------------------------------------
  if (subtypeFlagged.length === 0) {
    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '13c1',
        agentName: 'SubtypeGateAgent',
        status: 'skipped',
        reportFilename: '13c1-subtype-gate-report.json',
        scratchpadFilename: '13c1-subtype-gate-scratchpad.md',
        summary: {
          flaggedCount: 0,
          reportableCount: reportable.length,
          reason: 'no_low_subtype_confidence_flags',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:13c1] Failed to persist planning trace (non-fatal): ${msg}`);
    }

    for (const entry of reportable) {
      blockConfidences.push({
        questionId: entry.questionId,
        confidence: deterministicConfidence(entry),
        source: 'deterministic',
      });
    }

    const validatedPlan: ValidatedPlanOutput = {
      metadata: {
        ...metadata,
        subtypeGateValidatedAt: new Date().toISOString(),
        originalTableCount: tablePlan.plannedTables.length,
        validatedTableCount: workingTables.length,
      },
      plannedTables: workingTables,
      subtypeReviews: [],
      blockConfidence: blockConfidences,
    };

    return {
      validatedPlan,
      subtypeReviews: [],
      blockConfidences,
      correctedEntries,
    };
  }

  // -----------------------------------------------------------------------
  // Flagged questions -- call SubtypeGateAgent
  // -----------------------------------------------------------------------

  // Build batch input for SubtypeGateAgent.
  // Use the CURRENT entry from questionid-final.json (step 12), not the stale
  // triage snapshot (step 10). The triage reasons tell us WHY it was flagged;
  // the current entry tells us what the agent should actually evaluate.
  const flaggedBatchEntries = subtypeFlagged
    .map(f => {
      const currentEntry = reportableByQid.get(f.questionId);
      if (!currentEntry) return null;
      return {
        entry: currentEntry as unknown as Record<string, unknown>,
        triageReasons: f.triageReasons.filter(r => r.rule === 'low-subtype-confidence'),
        tablePlanBlock: (tableBlockIndex.get(f.questionId) || []) as unknown as Record<string, unknown>[],
        questionId: f.questionId,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  try {
    const batchResult = await reviewSubtypeClassifications({
      flaggedEntries: flaggedBatchEntries,
      surveyMetadata: metadata as unknown as SubtypeGateBatchInput['surveyMetadata'],
      outputDir,
      abortSignal,
    });

    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '13c1',
        agentName: 'SubtypeGateAgent',
        status: 'written',
        reportFilename: '13c1-subtype-gate-report.json',
        scratchpadFilename: '13c1-subtype-gate-scratchpad.md',
        scratchpadMarkdown: batchResult.scratchpadMarkdown,
        summary: {
          flaggedCount: subtypeFlagged.length,
          reportableCount: reportable.length,
          ...batchResult.summary,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:13c1] Failed to persist planning trace (non-fatal): ${msg}`);
    }

    // Process results
    const flaggedQids = new Set(subtypeFlagged.map(f => f.questionId));

    for (const result of batchResult.results) {
      const originalEntry = reportableByQid.get(result.questionId);
      if (!originalEntry) continue;

      const originalBlock = tableBlockIndex.get(result.questionId) || [];
      let tablesAfter = originalBlock.length;
      let newSubtype: string | null = null;
      let plannerOverrodeCorrection = false;

      if (result.reviewOutcome === 'corrected' && result.mutations.length > 0) {
        const mutation = result.mutations[0];
        newSubtype = mutation.newValue;

        // Re-derive table block with corrected subtype
        const newBlock = rederiveTableBlock(dataset, originalEntry, newSubtype, reportable, metadata);
        tablesAfter = newBlock.length;

        // Detect planner override: AI corrected to a non-standard subtype but
        // the planner's own guards produced only standard frequency tables
        // (e.g., scale with 3-4 points -> treat_as_standard).
        if (newSubtype !== 'standard' && newBlock.length > 0) {
          const allStandard = newBlock.every(t =>
            t.tableKind.startsWith('standard_') || t.tableKind.startsWith('numeric_'),
          );
          if (allStandard) {
            plannerOverrodeCorrection = true;
          }
        }

        // Splice: remove original tables for this question, insert new ones
        workingTables = workingTables.filter(t => t.sourceQuestionId !== result.questionId);
        workingTables.push(...newBlock);
      }

      const reasoningSuffix = plannerOverrodeCorrection
        ? ` [NOTE: Planner produced standard frequency tables despite ${newSubtype} correction -- subtype was overridden by planner guards (e.g., scale with <=4 points). Functionally correct.]`
        : '';

      subtypeReviews.push({
        questionId: result.questionId,
        reviewOutcome: result.reviewOutcome,
        confidence: result.confidence,
        oldSubtype: originalEntry.analyticalSubtype || 'standard',
        newSubtype,
        reasoning: result.reasoning + reasoningSuffix,
        tablesReplaced: originalBlock.length,
        tablesAfter,
        plannerOverrodeCorrection,
      });

      blockConfidences.push({
        questionId: result.questionId,
        confidence: result.confidence,
        source: 'ai_review',
      });
    }

    // Assign deterministic confidence to unflagged questions
    for (const entry of reportable) {
      if (!flaggedQids.has(entry.questionId)) {
        blockConfidences.push({
          questionId: entry.questionId,
          confidence: deterministicConfidence(entry),
          source: 'deterministic',
        });
      }
    }

    // Build corrected entry list -- apply subtype mutations to enrichment data
    const correctionsByQid = new Map<string, string>();
    for (const sr of subtypeReviews) {
      if (sr.reviewOutcome === 'corrected' && sr.newSubtype) {
        correctionsByQid.set(sr.questionId, sr.newSubtype);
      }
    }

    correctedEntries = entries.map(entry => {
      const correctedSubtype = correctionsByQid.get(entry.questionId);
      if (correctedSubtype) {
        return {
          ...entry,
          analyticalSubtype: correctedSubtype as QuestionIdEntry['analyticalSubtype'],
          subtypeSource: `subtypeGate:${entry.subtypeSource}`,
          subtypeConfidence: subtypeReviews.find(r => r.questionId === entry.questionId)?.confidence ?? entry.subtypeConfidence,
        };
      }
      return entry;
    });
  } catch (error) {
    // Non-fatal fallback: if AI agent call fails, return pass-through
    // (all confirmed, deterministic confidence)
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[V3:13c1] SubtypeGateAgent failed (non-fatal), returning pass-through: ${errMsg}`);

    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '13c1',
        agentName: 'SubtypeGateAgent',
        status: 'error',
        reportFilename: '13c1-subtype-gate-report.json',
        scratchpadFilename: '13c1-subtype-gate-scratchpad.md',
        summary: {
          flaggedCount: subtypeFlagged.length,
          reportableCount: reportable.length,
          error: errMsg,
        },
        note: 'Agent failed; deterministic pass-through applied',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:13c1] Failed to persist planning trace (non-fatal): ${msg}`);
    }

    for (const entry of reportable) {
      blockConfidences.push({
        questionId: entry.questionId,
        confidence: deterministicConfidence(entry),
        source: 'deterministic',
      });
    }
  }

  const validatedPlan: ValidatedPlanOutput = {
    metadata: {
      ...metadata,
      subtypeGateValidatedAt: new Date().toISOString(),
      originalTableCount: tablePlan.plannedTables.length,
      validatedTableCount: workingTables.length,
    },
    plannedTables: workingTables,
    subtypeReviews,
    blockConfidence: blockConfidences,
  };

  return {
    validatedPlan,
    subtypeReviews,
    blockConfidences,
    correctedEntries,
  };
}
