/**
 * V3 Runtime — Step 10a: Loop Gate
 *
 * Reviews all detected loop families with full survey context and resolves
 * whether each is genuine respondent-level iteration or a false positive.
 * Propagates ONLY the loop field (and loopQuestionId) to siblings.
 *
 * Thin wrapper around LoopGateAgent — the agent does the actual review.
 *
 * Ported from: scripts/v3-enrichment/10a-loop-gate.ts
 */

import { reviewLoopFamilies, type LoopGateBatchResult } from '@/agents/LoopGateAgent';
import type { LoopGateEntryResult } from '@/schemas/loopGateSchema';
import { persistStageAgentTrace } from '../../agentTraces';

import type {
  QuestionIdEntry,
  SurveyMetadata,
  ParsedSurveyQuestion,
} from '../types';

// =============================================================================
// Loop Family Grouping
// =============================================================================

export interface LoopFamily {
  familyBase: string;
  members: QuestionIdEntry[];
  representative: QuestionIdEntry;
}

/**
 * Group all entries with loop.detected=true by familyBase.
 * Select the lowest iterationIndex as the representative per family.
 */
export function groupLoopFamilies(entries: QuestionIdEntry[]): LoopFamily[] {
  const byFamily = new Map<string, QuestionIdEntry[]>();

  for (const entry of entries) {
    if (!entry.loop?.detected) continue;
    const familyBase = entry.loop.familyBase;
    if (!familyBase) continue;

    const members = byFamily.get(familyBase) || [];
    members.push(entry);
    byFamily.set(familyBase, members);
  }

  const families: LoopFamily[] = [];
  for (const [familyBase, members] of byFamily) {
    const sorted = [...members].sort((a, b) => {
      const ai = a.loop?.iterationIndex ?? 0;
      const bi = b.loop?.iterationIndex ?? 0;
      return ai - bi;
    });
    families.push({ familyBase, members, representative: sorted[0] });
  }

  return families;
}

// =============================================================================
// Loop Resolution
// =============================================================================

/**
 * Apply loop gate results to the full entry list.
 * ONLY the loop and loopQuestionId fields are modified.
 *
 * - 'cleared': set loop=null, loopQuestionId=null on representative + siblings
 * - 'confirmed'/'flagged_for_human': no changes
 */
export function applyLoopResolution(
  allEntries: QuestionIdEntry[],
  loopFamilies: LoopFamily[],
  results: LoopGateEntryResult[],
): QuestionIdEntry[] {
  const resultsByRepQid = new Map<string, LoopGateEntryResult>();
  for (const result of results) {
    resultsByRepQid.set(result.questionId, result);
  }

  const familyByRepQid = new Map<string, LoopFamily>();
  for (const family of loopFamilies) {
    familyByRepQid.set(family.representative.questionId, family);
  }

  // Build set of QIDs that need loop cleared
  const qidsToClear = new Set<string>();

  for (const [repQid, result] of resultsByRepQid) {
    if (result.reviewOutcome !== 'cleared') continue;
    const family = familyByRepQid.get(repQid);
    if (!family) continue;

    qidsToClear.add(repQid);
    for (const member of family.members) {
      qidsToClear.add(member.questionId);
    }
  }

  if (qidsToClear.size === 0) return allEntries;

  return allEntries.map(entry => {
    if (!qidsToClear.has(entry.questionId)) return entry;
    return {
      ...entry,
      loop: null,
      loopQuestionId: null,
    };
  });
}

// =============================================================================
// Main Entry Point
// =============================================================================

export interface LoopGateInput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  surveyParsed: ParsedSurveyQuestion[];
  outputDir: string;
  abortSignal?: AbortSignal;
}

export interface LoopGateResult {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  /** Number of families reviewed */
  familiesReviewed: number;
  /** Cleared loop families, retained for downstream deterministic enrichment */
  clearedFamilies: LoopFamily[];
  /** Agent batch result (for scratchpad/telemetry) */
  batchResult: LoopGateBatchResult | null;
}

/**
 * Run the loop gate (step 10a).
 * If no loop families exist, returns entries unchanged.
 */
export async function runLoopGate(input: LoopGateInput): Promise<LoopGateResult> {
  const { entries, metadata, surveyParsed, outputDir, abortSignal } = input;

  const loopFamilies = groupLoopFamilies(entries);

  if (loopFamilies.length === 0) {
    try {
      await persistStageAgentTrace({
        outputDir,
        stageId: '10a',
        agentName: 'LoopGateAgent',
        status: 'skipped',
        reportFilename: '10a-loop-gate-report.json',
        scratchpadFilename: '10a-loop-gate-scratchpad.md',
        summary: {
          familiesReviewed: 0,
          totalEntries: entries.length,
          reason: 'no_loop_families',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[V3:10a] Failed to persist planning trace (non-fatal): ${msg}`);
    }

    return {
      entries,
      metadata,
      familiesReviewed: 0,
      clearedFamilies: [],
      batchResult: null,
    };
  }

  // Build batch input for LoopGateAgent
  const batchResult = await reviewLoopFamilies({
    loopFamilyRepresentatives: loopFamilies.map(f => ({
      entry: f.representative as Record<string, unknown>,
      familyBase: f.familyBase,
      siblingCount: f.members.length,
      questionId: f.representative.questionId,
    })),
    surveyParsed: surveyParsed as unknown[],
    surveyMetadata: metadata as unknown as Parameters<typeof reviewLoopFamilies>[0]['surveyMetadata'],
    outputDir,
    abortSignal,
  });

  // Apply resolution
  const resolvedEntries = applyLoopResolution(entries, loopFamilies, batchResult.results);
  const clearedFamilies = loopFamilies.filter(family => {
    const result = batchResult.results.find(
      candidate => candidate.questionId === family.representative.questionId,
    );
    return result?.reviewOutcome === 'cleared';
  });

  try {
    await persistStageAgentTrace({
      outputDir,
      stageId: '10a',
      agentName: 'LoopGateAgent',
      status: 'written',
      reportFilename: '10a-loop-gate-report.json',
      scratchpadFilename: '10a-loop-gate-scratchpad.md',
      scratchpadMarkdown: batchResult.scratchpadMarkdown,
      summary: {
        familiesReviewed: loopFamilies.length,
        totalEntries: entries.length,
        ...batchResult.summary,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[V3:10a] Failed to persist planning trace (non-fatal): ${msg}`);
  }

  return {
    entries: resolvedEntries,
    metadata,
    familiesReviewed: loopFamilies.length,
    clearedFamilies,
    batchResult,
  };
}
