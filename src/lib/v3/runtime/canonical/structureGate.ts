/**
 * V3 Runtime — Structure Gate (Stage 13c2)
 *
 * Reviews questions flagged for borderline structural interpretations in the
 * table plan: grid decompositions, scale classification modes, and base policies.
 * Runs AFTER the subtype gate (13c1) with the subtype already locked in.
 *
 * Port of: scripts/v3-enrichment/13c-structure-gate.ts
 *
 * Pipeline position:
 *   ... → 13b (table planner) → 13c1 (subtype gate) → THIS → 13d (block assembly)
 *
 * Non-fatal: If the AI agent call fails, logs a warning and returns pass-through
 * (all confirmed, existing confidences preserved). Matches Phase 1's non-fatal posture.
 */

import type {
  QuestionIdEntry,
  SurveyMetadata,
  PlannedTable,
  PlannerAmbiguity,
  QuestionDiagnostic,
  TablePlanOutput,
  ValidatedPlanOutput,
  StructureReview,
  ParsedSurveyQuestion,
} from './types';
import { buildContext, planEntryTables, classifyScale } from './plan';
import {
  reviewStructureInterpretations,
  type StructureGateTriageSignal,
  type StructureGateBatchInput,
} from '@/agents/StructureGateAgent';
import { validateStructureGateCorrection } from '@/schemas/structureGateSchema';
import { persistStageAgentTrace } from '../agentTraces';

// =============================================================================
// Input / Output Interfaces
// =============================================================================

export interface StructureGateInput {
  validatedPlan: ValidatedPlanOutput;
  tablePlan: TablePlanOutput;
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  surveyParsed: ParsedSurveyQuestion[];
  dataset: string;
  outputDir: string;
  abortSignal?: AbortSignal;
}

export interface StructureGateResult {
  validatedPlan: ValidatedPlanOutput;
  structureReviews: StructureReview[];
}

// =============================================================================
// Constants
// =============================================================================

/** Materiality threshold for base policy borderline detection */
const BASE_BORDERLINE_LOW = 0.03;
const BASE_BORDERLINE_HIGH = 0.07;
const GENUINE_SPLIT_THRESHOLD = 0.05;

/** Structure-relevant ambiguity codes from the planner */
const STRUCTURE_AMBIGUITY_CODES = new Set([
  'scale_admin_artifact',
  'scale_unknown_labels',
  'ranking_detail_missing',
  'allocation_across_cols_grid_not_detected',
  'allocation_unknown_axis_value',
  'ranking_artifact_ambiguous',
]);

// =============================================================================
// Table block indexing
// =============================================================================

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
// Triage signal computation
// =============================================================================

/**
 * Compute triage signals for a single question's structural interpretation.
 * Returns an array of StructureGateTriageSignal; empty array means no review needed.
 *
 * Seven signals:
 * 1. conceptual-grid-detected: gridDims ends with '*'
 * 2. 2d-grid-both-dimensions: structural grid with both row and col detail
 * 3. scale-classification-edge: scale with edge-case classification mode
 * 4. base-policy-borderline: genuine variable bases near the 5% threshold
 * 5. planner-ambiguity: structure-relevant ambiguity codes from the planner
 * 6. stimuli-set-segmentation: stimuli set detected but detection is ambiguous
 * 7. binary-split-applied: binary selected/unselected dual-view was created
 */
function triageQuestionForStructureReview(
  questionId: string,
  tablePlanBlock: PlannedTable[],
  diagnostic: QuestionDiagnostic,
  entry: QuestionIdEntry,
  ambiguities: PlannerAmbiguity[],
): StructureGateTriageSignal[] {
  const signals: StructureGateTriageSignal[] = [];

  // 1. conceptual-grid-detected: gridDims ends with '*' (conceptual grid marker)
  if (diagnostic.gridDims && diagnostic.gridDims.endsWith('*')) {
    signals.push({
      signal: 'conceptual-grid-detected',
      detail: `Conceptual grid detected: ${diagnostic.gridDims}`,
      evidence: {
        gridDims: diagnostic.gridDims,
        itemCount: diagnostic.itemCount,
        tableKinds: diagnostic.tableKinds,
      },
    });
  }

  // 2. 2d-grid-both-dimensions: structural grid (no asterisk) with both row and col detail
  if (diagnostic.gridDims && !diagnostic.gridDims.endsWith('*')) {
    const hasRowDetail = tablePlanBlock.some(t => t.tableKind === 'grid_row_detail');
    const hasColDetail = tablePlanBlock.some(t => t.tableKind === 'grid_col_detail');
    if (hasRowDetail && hasColDetail) {
      const rowCount = tablePlanBlock.filter(t => t.tableKind === 'grid_row_detail').length;
      const colCount = tablePlanBlock.filter(t => t.tableKind === 'grid_col_detail').length;
      signals.push({
        signal: '2d-grid-both-dimensions',
        detail: `Both grid dimensions present: ${rowCount} row detail + ${colCount} col detail tables`,
        evidence: {
          gridDims: diagnostic.gridDims,
          rowDetailCount: rowCount,
          colDetailCount: colCount,
        },
      });
    }
  }

  // 3. scale-classification-edge: scale subtype with edge-case classification
  if (entry.analyticalSubtype === 'scale') {
    const items = entry.items || [];
    const classification = classifyScale(entry, items as unknown as import('./types').QuestionItem[]);
    if (
      classification.mode === 'unknown' ||
      classification.mode === 'admin_artifact' ||
      classification.mode === 'treat_as_standard'
    ) {
      signals.push({
        signal: 'scale-classification-edge',
        detail: `Scale classification edge case: mode=${classification.mode}`,
        evidence: {
          scaleMode: classification.mode,
          pointCount: classification.pointCount,
          tableKinds: diagnostic.tableKinds,
        },
      });
    }
  }

  // 4. base-policy-borderline: genuine variable bases near the 5% threshold
  if (entry.hasVariableItemBases && entry.variableBaseReason === 'genuine') {
    const livingBases = (entry.items || [])
      .map(it => it.itemBase)
      .filter((b): b is number => b != null && b > 0);

    if (livingBases.length >= 2) {
      const minBase = Math.min(...livingBases);
      const maxBase = Math.max(...livingBases);
      if (maxBase > 0) {
        const relativeSpread = (maxBase - minBase) / maxBase;
        if (relativeSpread >= BASE_BORDERLINE_LOW && relativeSpread <= BASE_BORDERLINE_HIGH) {
          signals.push({
            signal: 'base-policy-borderline',
            detail: `Base spread ${(relativeSpread * 100).toFixed(1)}% is near ${(GENUINE_SPLIT_THRESHOLD * 100)}% threshold`,
            evidence: {
              relativeSpread,
              minBase,
              maxBase,
              currentBasePolicy: tablePlanBlock[0]?.basePolicy || 'unknown',
            },
          });
        }
      }
    }
  }

  // 5. planner-ambiguity: structure-relevant ambiguity codes
  const relevantAmbiguities = ambiguities.filter(
    a => a.questionId === questionId && STRUCTURE_AMBIGUITY_CODES.has(a.code),
  );
  if (relevantAmbiguities.length > 0) {
    signals.push({
      signal: 'planner-ambiguity',
      detail: `Planner ambiguities: ${relevantAmbiguities.map(a => a.code).join(', ')}`,
      evidence: {
        ambiguities: relevantAmbiguities.map(a => ({ code: a.code, detail: a.detail })),
      },
    });
  }

  // 6. stimuli-set-segmentation: stimuli set detected but detection is ambiguous
  if (entry.stimuliSets?.detected && diagnostic.stimuliSetResolution?.ambiguous) {
    signals.push({
      signal: 'stimuli-set-segmentation',
      detail: `Stimuli set detection is ambiguous: ${diagnostic.stimuliSetResolution.setCount} sets via ${diagnostic.stimuliSetResolution.matchMethod} (avg score: ${diagnostic.stimuliSetResolution.averageScore.toFixed(2)})`,
      evidence: {
        setCount: diagnostic.stimuliSetResolution.setCount,
        matchMethod: diagnostic.stimuliSetResolution.matchMethod,
        averageScore: diagnostic.stimuliSetResolution.averageScore,
        familySource: entry.stimuliSets.familySource,
        binarySplitApplied: diagnostic.stimuliSetResolution.binarySplitApplied,
      },
    });
  }

  // 7. binary-split-applied: binary selected/unselected dual-view was created
  if (tablePlanBlock.some(t => t.binarySide != null)) {
    const selectedCount = tablePlanBlock.filter(t => t.binarySide === 'selected').length;
    const unselectedCount = tablePlanBlock.filter(t => t.binarySide === 'unselected').length;
    signals.push({
      signal: 'binary-split-applied',
      detail: `Binary dual-view applied: ${selectedCount} selected + ${unselectedCount} unselected tables`,
      evidence: {
        selectedCount,
        unselectedCount,
        normalizedType: entry.normalizedType,
        hasMessageMatches: entry.hasMessageMatches,
      },
    });
  }

  return signals;
}

// =============================================================================
// Correction application functions
// =============================================================================

function applyCorrectionSuppressGridDimension(
  block: PlannedTable[],
  dimensionToSuppress: string,
): { tables: PlannedTable[]; removed: number } {
  const filtered = block.filter(t => t.tableKind !== dimensionToSuppress);
  if (filtered.length === 0) {
    console.warn(`  [suppress_grid_dimension] Would remove all tables -- skipping correction`);
    return { tables: block, removed: 0 };
  }
  return { tables: filtered, removed: block.length - filtered.length };
}

function applyCorrectionInvalidateConceptualGrid(
  dataset: string,
  entry: QuestionIdEntry,
  allReportable: QuestionIdEntry[],
  metadata: SurveyMetadata,
  ambiguities: PlannerAmbiguity[],
): PlannedTable[] {
  const correctedEntry: QuestionIdEntry = { ...entry };
  const reportableMap = new Map<string, QuestionIdEntry>(
    allReportable.map(e => [e.questionId, e]),
  );
  reportableMap.set(correctedEntry.questionId, correctedEntry);

  const ctx = buildContext(dataset, correctedEntry, reportableMap, metadata);
  return planEntryTables(ctx, ambiguities, { skipConceptualGrid: true });
}

function applyCorrectionAdjustScaleClassification(
  dataset: string,
  entry: QuestionIdEntry,
  allReportable: QuestionIdEntry[],
  metadata: SurveyMetadata,
  ambiguities: PlannerAmbiguity[],
  forceScaleMode: string,
): PlannedTable[] {
  const correctedEntry: QuestionIdEntry = { ...entry };
  const reportableMap = new Map<string, QuestionIdEntry>(
    allReportable.map(e => [e.questionId, e]),
  );
  reportableMap.set(correctedEntry.questionId, correctedEntry);

  const ctx = buildContext(dataset, correctedEntry, reportableMap, metadata);
  return planEntryTables(ctx, ambiguities, { forceScaleMode });
}

function applyCorrectionAdjustBasePolicy(
  block: PlannedTable[],
  newBasePolicy: string,
): PlannedTable[] {
  const baseSourceMap: Record<string, string> = {
    'question_base_shared': 'questionBase',
    'item_base': 'items[].itemBase',
    'cluster_base': 'cluster_base',
  };
  const newBaseSource = baseSourceMap[newBasePolicy] || newBasePolicy;

  return block.map(t => ({
    ...t,
    basePolicy: newBasePolicy,
    baseSource: newBaseSource,
  }));
}

function applyCorrectionInvalidateBinarySplit(
  dataset: string,
  entry: QuestionIdEntry,
  allReportable: QuestionIdEntry[],
  metadata: SurveyMetadata,
  ambiguities: PlannerAmbiguity[],
): PlannedTable[] {
  const correctedEntry: QuestionIdEntry = { ...entry };
  const reportableMap = new Map<string, QuestionIdEntry>(
    allReportable.map(e => [e.questionId, e]),
  );
  reportableMap.set(correctedEntry.questionId, correctedEntry);

  const ctx = buildContext(dataset, correctedEntry, reportableMap, metadata);
  return planEntryTables(ctx, ambiguities, { skipBinarySplit: true });
}

function applyCorrectionInvalidateStimuliSets(
  dataset: string,
  entry: QuestionIdEntry,
  allReportable: QuestionIdEntry[],
  metadata: SurveyMetadata,
  ambiguities: PlannerAmbiguity[],
): PlannedTable[] {
  const correctedEntry: QuestionIdEntry = { ...entry };
  const reportableMap = new Map<string, QuestionIdEntry>(
    allReportable.map(e => [e.questionId, e]),
  );
  reportableMap.set(correctedEntry.questionId, correctedEntry);

  const ctx = buildContext(dataset, correctedEntry, reportableMap, metadata);
  return planEntryTables(ctx, ambiguities, { skipStimuliSets: true });
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Run the structure gate (stage 13c2).
 *
 * Computes triage signals deterministically for all reportable questions,
 * sends flagged questions to the StructureGateAgent, applies corrections
 * per type with validation, and updates block confidences.
 *
 * Non-fatal: if the AI agent call fails, returns pass-through with existing
 * validated plan and no structure reviews.
 */
export async function runStructureGate(input: StructureGateInput): Promise<StructureGateResult> {
  const {
    validatedPlan,
    tablePlan,
    entries,
    metadata,
    surveyParsed,
    dataset,
    outputDir,
    abortSignal,
  } = input;

  const reportable = entries.filter(e => e.disposition === 'reportable');
  const reportableByQid = new Map(reportable.map(e => [e.questionId, e]));

  // Build table block index from the validated plan (post-subtype-gate)
  const tableBlockIndex = buildTableBlockIndex(validatedPlan.plannedTables);
  const totalTablesOriginal = validatedPlan.plannedTables.length;

  // Build survey question index
  const surveyByQid = new Map<string, Record<string, unknown>>();
  for (const sq of surveyParsed) {
    if (sq.questionId) {
      surveyByQid.set(sq.questionId, sq as unknown as Record<string, unknown>);
    }
  }

  // Get diagnostics and ambiguities from the 13b table plan
  const diagnostics = tablePlan.summary?.questionDiagnostics || [];
  const diagnosticByQid = new Map(diagnostics.map(d => [d.questionId, d]));
  const ambiguities = tablePlan.ambiguities || [];

  // Triage all reportable questions for structural signals
  const triagedQuestions: Array<{
    questionId: string;
    signals: StructureGateTriageSignal[];
    entry: QuestionIdEntry;
    tablePlanBlock: PlannedTable[];
    diagnostic: QuestionDiagnostic;
  }> = [];

  for (const entry of reportable) {
    const block = tableBlockIndex.get(entry.questionId) || [];
    if (block.length === 0) continue;

    const diag = diagnosticByQid.get(entry.questionId);
    if (!diag) continue;

    const signals = triageQuestionForStructureReview(
      entry.questionId,
      block,
      diag,
      entry,
      ambiguities,
    );

    if (signals.length > 0) {
      triagedQuestions.push({
        questionId: entry.questionId,
        signals,
        entry,
        tablePlanBlock: block,
        diagnostic: diag,
      });
    }
  }

  console.log(
    `[V3:13c2] ${reportable.length} reportable, ${triagedQuestions.length} triaged for structure review`,
  );

  const structureReviews: StructureReview[] = [];
  let workingTables = [...validatedPlan.plannedTables];

  // Preserve existing block confidences, update structure-reviewed ones
  const existingConfidences = new Map(
    (validatedPlan.blockConfidence || []).map(bc => [bc.questionId, bc]),
  );

  // -----------------------------------------------------------------------
  // No triaged questions -- pass-through
  // -----------------------------------------------------------------------
  if (triagedQuestions.length === 0) {
    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '13c2',
        agentName: 'StructureGateAgent',
        status: 'skipped',
        reportFilename: '13c2-structure-gate-report.json',
        scratchpadFilename: '13c2-structure-gate-scratchpad.md',
        summary: {
          triagedCount: 0,
          reportableCount: reportable.length,
          reason: 'no_structure_triage_signals',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:13c2] Failed to persist planning trace (non-fatal): ${msg}`);
    }

    const result: ValidatedPlanOutput = {
      metadata: {
        ...validatedPlan.metadata,
        structureGateValidatedAt: new Date().toISOString(),
        originalTableCount: totalTablesOriginal,
        validatedTableCount: totalTablesOriginal,
      },
      plannedTables: validatedPlan.plannedTables,
      subtypeReviews: validatedPlan.subtypeReviews,
      structureReviews: [],
      blockConfidence: validatedPlan.blockConfidence,
    };

    return { validatedPlan: result, structureReviews: [] };
  }

  // -----------------------------------------------------------------------
  // Triaged questions -- call StructureGateAgent
  // -----------------------------------------------------------------------
  try {
    const flaggedBatchEntries = triagedQuestions.map(tq => ({
      entry: tq.entry as unknown as Record<string, unknown>,
      triageSignals: tq.signals,
      tablePlanBlock: tq.tablePlanBlock as unknown as Record<string, unknown>[],
      questionDiagnostic: tq.diagnostic as unknown as Record<string, unknown>,
      surveyQuestion: surveyByQid.get(tq.questionId) || null,
      questionId: tq.questionId,
    }));

    const batchResult = await reviewStructureInterpretations({
      flaggedEntries: flaggedBatchEntries,
      surveyMetadata: metadata as unknown as StructureGateBatchInput['surveyMetadata'],
      outputDir,
      abortSignal,
    });

    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '13c2',
        agentName: 'StructureGateAgent',
        status: 'written',
        reportFilename: '13c2-structure-gate-report.json',
        scratchpadFilename: '13c2-structure-gate-scratchpad.md',
        scratchpadMarkdown: batchResult.scratchpadMarkdown,
        summary: {
          triagedCount: triagedQuestions.length,
          reportableCount: reportable.length,
          ...batchResult.summary,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:13c2] Failed to persist planning trace (non-fatal): ${msg}`);
    }

    // Process results
    let totalCorrectionsApplied = 0;

    for (const result of batchResult.results) {
      const originalEntry = reportableByQid.get(result.questionId);
      if (!originalEntry) continue;

      const originalBlock = tableBlockIndex.get(result.questionId) || [];
      const triagedQ = triagedQuestions.find(tq => tq.questionId === result.questionId);
      const signalNames = triagedQ?.signals.map(s => s.signal) || [];

      const reviewCorrections: StructureReview['corrections'] = [];

      if (result.reviewOutcome === 'corrected' && result.corrections.length > 0) {
        let currentBlock = [...originalBlock];

        for (const correction of result.corrections) {
          // Validate correction
          const validation = validateStructureGateCorrection(correction);
          if (!validation.valid) {
            console.warn(
              `[V3:13c2:${result.questionId}] Skipping invalid correction: ${(validation as { reason: string }).reason}`,
            );
            reviewCorrections.push({
              correctionType: correction.correctionType,
              newValue: correction.newValue,
              oldValue: correction.oldValue,
              reasoning: correction.reasoning,
              applied: false,
            });
            continue;
          }

          // Apply correction by type
          if (correction.correctionType === 'suppress_grid_dimension') {
            const { tables, removed } = applyCorrectionSuppressGridDimension(
              currentBlock,
              correction.newValue,
            );
            if (removed > 0) {
              workingTables = workingTables.filter(t => t.sourceQuestionId !== result.questionId);
              workingTables.push(...tables);
              currentBlock = tables;
              totalCorrectionsApplied++;
              reviewCorrections.push({
                correctionType: correction.correctionType,
                newValue: correction.newValue,
                oldValue: correction.oldValue,
                reasoning: correction.reasoning,
                applied: true,
                tablesRemoved: removed,
                tablesAfter: tables.length,
              });
            } else {
              reviewCorrections.push({
                correctionType: correction.correctionType,
                newValue: correction.newValue,
                oldValue: correction.oldValue,
                reasoning: correction.reasoning,
                applied: false,
              });
            }
          } else if (correction.correctionType === 'invalidate_conceptual_grid') {
            const newBlock = applyCorrectionInvalidateConceptualGrid(
              dataset,
              originalEntry,
              reportable,
              metadata,
              [],
            );
            workingTables = workingTables.filter(t => t.sourceQuestionId !== result.questionId);
            workingTables.push(...newBlock);
            currentBlock = newBlock;
            totalCorrectionsApplied++;
            reviewCorrections.push({
              correctionType: correction.correctionType,
              newValue: correction.newValue,
              oldValue: correction.oldValue,
              reasoning: correction.reasoning,
              applied: true,
              tablesRemoved: originalBlock.length,
              tablesAfter: newBlock.length,
            });
          } else if (correction.correctionType === 'adjust_scale_classification') {
            const newBlock = applyCorrectionAdjustScaleClassification(
              dataset,
              originalEntry,
              reportable,
              metadata,
              [],
              correction.newValue,
            );
            workingTables = workingTables.filter(t => t.sourceQuestionId !== result.questionId);
            workingTables.push(...newBlock);
            currentBlock = newBlock;
            totalCorrectionsApplied++;
            reviewCorrections.push({
              correctionType: correction.correctionType,
              newValue: correction.newValue,
              oldValue: correction.oldValue,
              reasoning: correction.reasoning,
              applied: true,
              tablesRemoved: originalBlock.length,
              tablesAfter: newBlock.length,
            });
          } else if (correction.correctionType === 'adjust_base_policy') {
            const patchedBlock = applyCorrectionAdjustBasePolicy(
              currentBlock,
              correction.newValue,
            );
            workingTables = workingTables.filter(t => t.sourceQuestionId !== result.questionId);
            workingTables.push(...patchedBlock);
            currentBlock = patchedBlock;
            totalCorrectionsApplied++;
            reviewCorrections.push({
              correctionType: correction.correctionType,
              newValue: correction.newValue,
              oldValue: correction.oldValue,
              reasoning: correction.reasoning,
              applied: true,
            });
          } else if (correction.correctionType === 'invalidate_binary_split') {
            const newBlock = applyCorrectionInvalidateBinarySplit(
              dataset,
              originalEntry,
              reportable,
              metadata,
              [],
            );
            workingTables = workingTables.filter(t => t.sourceQuestionId !== result.questionId);
            workingTables.push(...newBlock);
            currentBlock = newBlock;
            totalCorrectionsApplied++;
            reviewCorrections.push({
              correctionType: correction.correctionType,
              newValue: correction.newValue,
              oldValue: correction.oldValue,
              reasoning: correction.reasoning,
              applied: true,
              tablesRemoved: originalBlock.length,
              tablesAfter: newBlock.length,
            });
          } else if (correction.correctionType === 'invalidate_stimuli_sets') {
            const newBlock = applyCorrectionInvalidateStimuliSets(
              dataset,
              originalEntry,
              reportable,
              metadata,
              [],
            );
            workingTables = workingTables.filter(t => t.sourceQuestionId !== result.questionId);
            workingTables.push(...newBlock);
            currentBlock = newBlock;
            totalCorrectionsApplied++;
            reviewCorrections.push({
              correctionType: correction.correctionType,
              newValue: correction.newValue,
              oldValue: correction.oldValue,
              reasoning: correction.reasoning,
              applied: true,
              tablesRemoved: originalBlock.length,
              tablesAfter: newBlock.length,
            });
          }
        }
      }

      structureReviews.push({
        questionId: result.questionId,
        reviewOutcome: result.reviewOutcome,
        confidence: result.confidence,
        triageSignals: signalNames,
        corrections: reviewCorrections,
        reasoning: result.reasoning,
      });

      // Update block confidence for structure-reviewed entries
      existingConfidences.set(result.questionId, {
        questionId: result.questionId,
        confidence: result.confidence,
        source: 'ai_review_structure',
      });
    }

    console.log(
      `[V3:13c2] ${batchResult.summary.confirmed} confirmed, ${batchResult.summary.corrected} corrected, ` +
      `${batchResult.summary.flaggedForHuman} flagged (${totalCorrectionsApplied} corrections applied, ` +
      `tables: ${totalTablesOriginal} -> ${workingTables.length})`,
    );
  } catch (error) {
    // Non-fatal fallback: if AI agent call fails, return pass-through
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[V3:13c2] StructureGateAgent failed (non-fatal), returning pass-through: ${errMsg}`);

    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '13c2',
        agentName: 'StructureGateAgent',
        status: 'error',
        reportFilename: '13c2-structure-gate-report.json',
        scratchpadFilename: '13c2-structure-gate-scratchpad.md',
        summary: {
          triagedCount: triagedQuestions.length,
          reportableCount: reportable.length,
          error: errMsg,
        },
        note: 'Agent failed; pass-through validated plan applied',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:13c2] Failed to persist planning trace (non-fatal): ${msg}`);
    }
  }

  const updatedBlockConfidences = [...existingConfidences.values()];

  const updatedValidatedPlan: ValidatedPlanOutput = {
    metadata: {
      ...validatedPlan.metadata,
      structureGateValidatedAt: new Date().toISOString(),
      originalTableCount: totalTablesOriginal,
      validatedTableCount: workingTables.length,
    },
    plannedTables: workingTables,
    subtypeReviews: validatedPlan.subtypeReviews,
    structureReviews,
    blockConfidence: updatedBlockConfidences,
  };

  return {
    validatedPlan: updatedValidatedPlan,
    structureReviews,
  };
}
