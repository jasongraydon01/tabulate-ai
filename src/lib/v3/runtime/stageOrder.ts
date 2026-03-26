/**
 * V3 Runtime Stage Order — Single Source of Truth
 *
 * This file defines the canonical execution order for the full V3 pipeline.
 * Every active stage from the enrichment chain (00–12), table chain (13b–13d),
 * banner chain (20–21), compute handoff (22), and post-R QC (14) is listed
 * here in execution order.
 *
 * No runtime code should hardcode stage sequences. Import from here.
 *
 * See also:
 *   - docs/v3-runtime-architecture-refactor-plan.md (phased migration plan)
 *   - docs/v3-script-targets.md (script chain reference)
 *   - src/lib/v3/runtime/contracts.ts (typed artifact contracts per boundary)
 */

/**
 * All active V3 stage IDs in execution order.
 *
 * Stages:
 *   00    – question-id-enricher (.sav → questionid.json)
 *   03    – base-enricher
 *   08a   – survey-parser
 *   08b   – survey-cleanup (AI triple-agent consensus)
 *   09d   – message-label-matcher
 *   10a   – loop-gate (binary loop classification)
 *   10    – ai-gate-triage
 *   11    – ai-gate-validate
 *   12    – reconciliation-repass → questionid-final.json
 *   13b   – table-planner
 *   13c1  – subtype-gate
 *   13c2  – structure-gate
 *   13d   – canonical-table-assembly → table.json
 *   13e   – table-metadata-prefill + triage (deterministic enrichment + AI review flagging)
 *   20    – banner-plan
 *   21    – crosstab-plan
 *   22    – r-compute-input → compute package
 *   14    – post-r-validation-qc
 */
export const V3_STAGE_ORDER = [
  '00',
  '03',
  '08a',
  '08b',
  '09d',
  '10a',
  '10',
  '11',
  '12',
  '13b',
  '13c1',
  '13c2',
  '13d',
  '13e',
  '20',
  '21',
  '22',
  '14',
] as const;

/** Union type of all active V3 stage IDs. */
export type V3StageId = (typeof V3_STAGE_ORDER)[number];

/** Total number of active V3 stages. */
export const V3_STAGE_COUNT = V3_STAGE_ORDER.length;

/**
 * Human-readable stage names keyed by V3StageId.
 * Used for logging, telemetry, and checkpoint descriptions.
 */
export const V3_STAGE_NAMES: Record<V3StageId, string> = {
  '00':   'question-id-enricher',
  '03':   'base-enricher',
  '08a':  'survey-parser',
  '08b':  'survey-cleanup',
  '09d':  'message-label-matcher',
  '10a':  'loop-gate',
  '10':   'ai-gate-triage',
  '11':   'ai-gate-validate',
  '12':   'reconciliation-repass',
  '13b':  'table-planner',
  '13c1': 'subtype-gate',
  '13c2': 'structure-gate',
  '13d':  'canonical-table-assembly',
  '13e':  'table-metadata-prefill-and-triage',
  '20':   'banner-plan',
  '21':   'crosstab-plan',
  '22':   'r-compute-input',
  '14':   'post-r-validation-qc',
};

/**
 * Logical pipeline phases that group related stages.
 * Useful for progress reporting and checkpoint reasoning.
 */
export const V3_STAGE_PHASES: Record<V3StageId, string> = {
  '00':   'question-id-chain',
  '03':   'question-id-chain',
  '08a':  'question-id-chain',
  '08b':  'question-id-chain',
  '09d':  'question-id-chain',
  '10a':  'question-id-chain',
  '10':   'question-id-chain',
  '11':   'question-id-chain',
  '12':   'question-id-chain',
  '13b':  'table-chain',
  '13c1': 'table-chain',
  '13c2': 'table-chain',
  '13d':  'table-chain',
  '13e':  'table-chain',
  '20':   'banner-chain',
  '21':   'banner-chain',
  '22':   'compute',
  '14':   'compute',
};

/**
 * Returns the 0-based index of a stage in the execution order.
 * Throws if stageId is not a valid V3 stage.
 */
export function getStageIndex(stageId: V3StageId): number {
  const idx = V3_STAGE_ORDER.indexOf(stageId);
  if (idx === -1) {
    throw new Error(`Unknown V3 stage ID: ${stageId}`);
  }
  return idx;
}

/**
 * Returns the next stage after the given one, or null if it's the last stage.
 */
export function getNextStage(stageId: V3StageId): V3StageId | null {
  const idx = getStageIndex(stageId);
  return idx < V3_STAGE_ORDER.length - 1 ? V3_STAGE_ORDER[idx + 1] : null;
}

/**
 * Returns true if `a` executes before `b` in the V3 pipeline.
 */
export function isBefore(a: V3StageId, b: V3StageId): boolean {
  return getStageIndex(a) < getStageIndex(b);
}

/**
 * Returns the subset of stages from `from` (inclusive) to `to` (inclusive).
 */
export function getStageRange(from: V3StageId, to: V3StageId): V3StageId[] {
  const fromIdx = getStageIndex(from);
  const toIdx = getStageIndex(to);
  if (fromIdx > toIdx) {
    throw new Error(`Stage ${from} comes after ${to} — invalid range`);
  }
  return V3_STAGE_ORDER.slice(fromIdx, toIdx + 1) as unknown as V3StageId[];
}

/**
 * Type guard: checks if a string is a valid V3StageId.
 */
export function isV3StageId(value: string): value is V3StageId {
  return (V3_STAGE_ORDER as readonly string[]).includes(value);
}
