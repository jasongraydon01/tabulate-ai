/**
 * V3 Runtime — Step 11: AI Gate Validation
 *
 * Reviews triaged entries from step 10 with full survey context.
 * Proposes targeted mutations to structural classifications before table gen.
 *
 * Thin wrapper around AIGateAgent — handles loop sibling deduplication,
 * result propagation, and mutation application.
 *
 * Ported from: scripts/v3-enrichment/11-ai-gate-validate.ts
 */

import { reviewFlaggedEntries, type AIGateBatchResult } from '@/agents/AIGateAgent';
import type { AIGateEntryResult } from '@/schemas/aiGateSchema';
import { persistStageAgentTrace } from '../../agentTraces';

import type {
  QuestionIdEntry,
  SurveyMetadata,
  TriagedEntry,
  ParsedSurveyQuestion,
} from '../types';

// =============================================================================
// Loop Sibling Deduplication
// =============================================================================

/**
 * For confirmed loop families (loop.detected === true), collapse flagged siblings
 * to one representative per family before sending to the AI.
 *
 * Representative = lowest iterationIndex (consistent with step 10a's choice).
 * Merges triage reasons from all siblings so the AI sees the full picture.
 */
export function deduplicateLoopSiblings(flagged: TriagedEntry[]): {
  dedupedFlagged: TriagedEntry[];
  siblingMap: Map<string, TriagedEntry[]>;
} {
  const familyGroups = new Map<string, TriagedEntry[]>();
  const dedupedFlagged: TriagedEntry[] = [];

  for (const entry of flagged) {
    const loop = entry.entry.loop as { detected?: boolean; familyBase?: string } | null;
    if (loop?.detected && loop.familyBase) {
      const group = familyGroups.get(loop.familyBase) ?? [];
      group.push(entry);
      familyGroups.set(loop.familyBase, group);
    } else {
      dedupedFlagged.push(entry);
    }
  }

  const siblingMap = new Map<string, TriagedEntry[]>();

  for (const [, members] of familyGroups) {
    members.sort((a, b) => {
      const aIdx = (a.entry.loop as { iterationIndex?: number } | null)?.iterationIndex ?? 0;
      const bIdx = (b.entry.loop as { iterationIndex?: number } | null)?.iterationIndex ?? 0;
      return aIdx - bIdx;
    });

    const representative = members[0];

    // Merge triage reasons from all siblings
    const seenRules = new Set(representative.triageReasons.map(r => r.rule));
    const mergedReasons = [...representative.triageReasons];
    for (const sibling of members.slice(1)) {
      for (const reason of sibling.triageReasons) {
        if (!seenRules.has(reason.rule)) {
          mergedReasons.push(reason);
          seenRules.add(reason.rule);
        }
      }
    }

    dedupedFlagged.push({ ...representative, triageReasons: mergedReasons });
    siblingMap.set(representative.questionId, members);
  }

  return { dedupedFlagged, siblingMap };
}

// =============================================================================
// Result Propagation
// =============================================================================

/**
 * After AI review, expand each representative's result to all loop siblings.
 */
export function propagateToSiblings(
  results: AIGateEntryResult[],
  siblingMap: Map<string, TriagedEntry[]>,
): { results: AIGateEntryResult[]; propagatedFrom: Map<string, string> } {
  const propagatedFrom = new Map<string, string>();
  const expanded: AIGateEntryResult[] = [...results];

  const resultsByQid = new Map<string, AIGateEntryResult>();
  for (const r of results) {
    resultsByQid.set(r.questionId, r);
  }

  for (const [repQid, siblings] of siblingMap) {
    const repResult = resultsByQid.get(repQid);
    if (!repResult) continue;

    for (const sibling of siblings) {
      if (sibling.questionId === repQid) continue;

      expanded.push({
        ...repResult,
        questionId: sibling.questionId,
        mutations: repResult.mutations.map(m => ({
          ...m,
          oldValue: JSON.stringify((sibling.entry as Record<string, unknown>)[m.field] ?? null),
        })),
      });
      propagatedFrom.set(sibling.questionId, repQid);
    }
  }

  return { results: expanded, propagatedFrom };
}

// =============================================================================
// Mutation Application
// =============================================================================

/**
 * Apply AI gate mutations to the full questionid list.
 * Returns a new array with mutations applied and _aiGateReview provenance added.
 */
export function applyMutations(
  fullEntries: QuestionIdEntry[],
  reviewResults: AIGateEntryResult[],
  propagatedFrom?: Map<string, string>,
): QuestionIdEntry[] {
  const resultsByQid = new Map<string, AIGateEntryResult>();
  for (const result of reviewResults) {
    resultsByQid.set(result.questionId, result);
  }

  return fullEntries.map(entry => {
    const qid = entry.questionId;
    const result = resultsByQid.get(qid);

    if (!result) return entry;

    const patched = { ...entry };

    if (result.reviewOutcome === 'corrected' && result.mutations.length > 0) {
      for (const mutation of result.mutations) {
        try {
          const newValue = JSON.parse(mutation.newValue);
          (patched as Record<string, unknown>)[mutation.field] = newValue;
        } catch {
          console.warn(`[v3-validate] Failed to parse newValue for ${qid}.${mutation.field}: ${mutation.newValue}`);
        }
      }
    }

    const repQid = propagatedFrom?.get(qid);
    patched._aiGateReview = {
      reviewOutcome: result.reviewOutcome,
      confidence: result.confidence,
      mutationCount: result.mutations.length,
      reasoning: result.reasoning,
      reviewedAt: new Date().toISOString(),
      propagatedFrom: repQid ?? null,
    };

    return patched;
  });
}

// =============================================================================
// Main Entry Point
// =============================================================================

export interface ValidateInput {
  /** All entries from step 10a */
  allEntries: QuestionIdEntry[];
  /** Flagged entries from step 10 triage */
  flagged: TriagedEntry[];
  metadata: SurveyMetadata;
  surveyParsed: ParsedSurveyQuestion[];
  outputDir: string;
  abortSignal?: AbortSignal;
}

export interface ValidateResult {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  /** Agent batch result (for scratchpad/telemetry) */
  batchResult: AIGateBatchResult | null;
}

/**
 * Run the AI gate validation (step 11).
 * If no entries are flagged, returns entries unchanged.
 */
export async function runValidate(input: ValidateInput): Promise<ValidateResult> {
  const { allEntries, flagged, metadata, surveyParsed, outputDir, abortSignal } = input;

  if (flagged.length === 0) {
    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '11',
        agentName: 'AIGateAgent',
        status: 'skipped',
        reportFilename: '11-ai-gate-report.json',
        scratchpadFilename: '11-ai-gate-scratchpad.md',
        summary: {
          flaggedCount: 0,
          reason: 'no_flagged_entries',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:11] Failed to persist planning trace (non-fatal): ${msg}`);
    }

    return { entries: allEntries, metadata, batchResult: null };
  }

  // Deduplicate loop siblings (send representative only)
  const { dedupedFlagged, siblingMap } = deduplicateLoopSiblings(flagged);

  // Call AIGateAgent
  const batchResult = await reviewFlaggedEntries({
    flaggedEntries: dedupedFlagged.map(f => ({
      entry: f.entry as Record<string, unknown>,
      triageReasons: f.triageReasons,
      questionId: f.questionId,
    })),
    surveyParsed: surveyParsed as unknown[],
    surveyMetadata: metadata as unknown as Parameters<typeof reviewFlaggedEntries>[0]['surveyMetadata'],
    outputDir,
    abortSignal,
  });

  // Propagate results to loop siblings
  const { results: expandedResults, propagatedFrom } = propagateToSiblings(
    batchResult.results,
    siblingMap,
  );

  // Apply mutations to full entry list
  const validatedEntries = applyMutations(allEntries, expandedResults, propagatedFrom);

  try {
    await persistStageAgentTrace({
      outputDir,
      stageId: '11',
      agentName: 'AIGateAgent',
      status: 'written',
      reportFilename: '11-ai-gate-report.json',
      scratchpadFilename: '11-ai-gate-scratchpad.md',
      scratchpadMarkdown: batchResult.scratchpadMarkdown,
      summary: {
        flaggedCount: flagged.length,
        dedupedCount: dedupedFlagged.length,
        propagatedSiblingCount: propagatedFrom.size,
        ...batchResult.summary,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[V3:11] Failed to persist planning trace (non-fatal): ${msg}`);
  }

  return {
    entries: validatedEntries,
    metadata,
    batchResult,
  };
}
