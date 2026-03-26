/**
 * V3 Runtime — Stage 13e Table Context Triage
 *
 * Deterministic triage pass that examines each canonical table (post-prefill)
 * and flags which ones need an AI review pass for context enrichment
 * (tableSubtitle, baseText, userNote, row labels).
 *
 * No AI calls, no file I/O — pure transformation.
 *
 * Triage signals:
 *   1. filtered-base      — base is not "Total respondents" → AI refines base description
 *   2. grid-structure      — grid_row_detail or grid_col_detail → labels/subtitles may need context
 *   3. conceptual-grid     — conceptual grid question → even more ambiguous labeling
 *   4. label-divergence    — item or scale savLabel vs surveyLabel diverge significantly → AI reviews labels
 *   5. rebased-base        — basePolicy includes 'rebased' → AI clarifies exclusions
 *   6. weighted-effective-base — weighted effective base → AI reviews wording
 *   7. stimuli-set-slice   — table belongs to a stimuli set slice → subtitle/base refinement
 *   8. stimuli-set-ambiguous — stimuli set resolution is low confidence → AI validates
 *   9. binary-pair         — paired selected/unselected binary views → AI ensures parallel wording
 *  10. borderline-materiality — anchor view kept despite near-threshold base variation → hedging language
 *
 * See also:
 *   - ./prefill.ts (step 2 — runs before this)
 *   - docs/phase4-implementation-plan.md (Pass A architecture)
 */

import type {
  CanonicalTable,
  CanonicalTableOutput,
  QuestionIdEntry,
  SurveyMetadata,
  QuestionDiagnostic,
  PlannerBaseSignal,
  ComputeRiskSignal,
} from './types';
import { charLevenshtein } from '../questionId/enrich/surveyCleanupMerge';

// =============================================================================
// Public Types
// =============================================================================

/** A single triage reason flagging a table for AI review. */
export interface TableTriageReason {
  /** Machine-readable signal identifier */
  signal: TableTriageSignal;
  /** Human-readable explanation */
  detail: string;
  /** Severity guides prioritization — high means AI should definitely review */
  severity: 'high' | 'medium' | 'low';
}

/** All known triage signal identifiers. */
export type TableTriageSignal =
  | 'filtered-base'
  | 'weighted-effective-base'
  | 'grid-structure'
  | 'conceptual-grid'
  | 'label-divergence'
  | 'rebased-base'
  | 'stimuli-set-slice'
  | 'stimuli-set-ambiguous'
  | 'binary-pair'
  | 'borderline-materiality';

/** Per-table triage decision. */
export interface TableTriageDecision {
  tableId: string;
  questionId: string;
  /** Whether this table is flagged for AI review */
  flagged: boolean;
  /** AI-review reasons retained for compatibility */
  reasons: TableTriageReason[];
  /** Structural base signals preserved for audit; do not trigger AI review */
  structuralBaseSignals: PlannerBaseSignal[];
  /** AI-reviewable presentation reasons */
  presentationReasons: TableTriageReason[];
  /** Compute-risk signals preserved for later compute phases */
  computeRiskSignals: ComputeRiskSignal[];
}

/** Full triage output for the dataset. */
export interface TableTriageOutput {
  /** Per-table decisions */
  decisions: TableTriageDecision[];
  /** Summary stats */
  summary: {
    totalTables: number;
    flaggedTables: number;
    skippedTables: number;
    bySignal: Record<string, number>;
    byStructuralBaseSignal: Record<string, number>;
    byComputeRiskSignal: Record<string, number>;
  };
}

// =============================================================================
// Input Interface
// =============================================================================

export interface TableTriageInput {
  /** Canonical tables post-prefill */
  canonicalOutput: CanonicalTableOutput;
  /** Enriched question-id entries (from stage 12) */
  entries: QuestionIdEntry[];
  /** Survey-level metadata */
  metadata: SurveyMetadata;
  /** Question diagnostics from table planner (optional — for conceptual grid detection) */
  questionDiagnostics?: QuestionDiagnostic[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Label divergence threshold: if normalized Levenshtein distance exceeds this
 * ratio, the labels are considered meaningfully different.
 *
 * 0.3 means >30% of characters differ relative to the longer string.
 * This filters out trivial differences (capitalization normalization, minor
 * punctuation) while catching genuine content changes.
 */
export const LABEL_DIVERGENCE_THRESHOLD = 0.3;

/**
 * Borderline materiality range: if relative base spread falls within this
 * range, the planner kept the anchor view but the variation is close to
 * the split threshold. Matches constants in plan.ts.
 */
const BORDERLINE_MATERIALITY_LOW = 0.04;
const BORDERLINE_MATERIALITY_HIGH = 0.06;

/** Table kinds that represent grid structures. */
const GRID_TABLE_KINDS = new Set(['grid_row_detail', 'grid_col_detail']);
const STRUCTURAL_BASE_SIGNAL_SET = new Set<PlannerBaseSignal>([
  'varying-item-bases',
  'ranking-artifact-ambiguous',
  'validity-constrained-base',
  'zero-respondents',
  'dead-items-removed',
  'model-derived-base',
  'low-base',
]);

interface ResolvedEntryContext {
  entry: QuestionIdEntry | undefined;
  candidateQuestionIds: string[];
}

export interface EntryResolutionLookups {
  entryByQuestionId: Map<string, QuestionIdEntry>;
  entriesByDisplayQuestionId: Map<string, QuestionIdEntry[]>;
  representativeByLoopQuestionId: Map<string, QuestionIdEntry>;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Run table context triage on post-prefill canonical tables.
 *
 * Returns per-table decisions indicating which tables need AI review
 * and why. Pure function — no side effects.
 */
export function runTableContextTriage(input: TableTriageInput): TableTriageOutput {
  const {
    canonicalOutput,
    entries,
    questionDiagnostics,
  } = input;
  const tables = canonicalOutput.tables;

  // Build lookups
  const {
    entryByQuestionId,
    entriesByDisplayQuestionId,
    representativeByLoopQuestionId,
  } = buildEntryResolutionLookups(entries);

  const diagnosticByQid = new Map(
    (questionDiagnostics ?? []).map(d => [d.questionId, d]),
  );

  // Build binary pair lookup for cross-table pair detection (Signal 9)
  const nonExcluded = tables.filter(t => !t.exclude);
  const binaryPairLookup = buildBinaryPairLookup(nonExcluded);

  // Triage each table
  const decisions: TableTriageDecision[] = nonExcluded
    .map(table => {
      const entryContext = resolveEntryContext(
        table,
        entryByQuestionId,
        entriesByDisplayQuestionId,
        representativeByLoopQuestionId,
      );
      const structuralBaseSignals = collectStructuralBaseSignals(table);
      const presentationReasons = triageTable(
        table,
        entryContext,
        diagnosticByQid,
        binaryPairLookup,
      );
      const computeRiskSignals = Array.from(new Set(table.computeRiskSignals ?? []));

      return {
        tableId: table.tableId,
        questionId: table.questionId,
        flagged: presentationReasons.length > 0,
        reasons: presentationReasons,
        structuralBaseSignals,
        presentationReasons,
        computeRiskSignals,
      };
    });

  // Build summary
  const bySignal: Record<string, number> = {};
  const byStructuralBaseSignal: Record<string, number> = {};
  const byComputeRiskSignal: Record<string, number> = {};
  let flaggedCount = 0;
  for (const d of decisions) {
    if (d.flagged) flaggedCount++;
    for (const r of d.reasons) {
      bySignal[r.signal] = (bySignal[r.signal] ?? 0) + 1;
    }
    for (const signal of d.structuralBaseSignals) {
      byStructuralBaseSignal[signal] = (byStructuralBaseSignal[signal] ?? 0) + 1;
    }
    for (const signal of d.computeRiskSignals) {
      byComputeRiskSignal[signal] = (byComputeRiskSignal[signal] ?? 0) + 1;
    }
  }

  return {
    decisions,
    summary: {
      totalTables: decisions.length,
      flaggedTables: flaggedCount,
      skippedTables: decisions.length - flaggedCount,
      bySignal,
      byStructuralBaseSignal,
      byComputeRiskSignal,
    },
  };
}

// =============================================================================
// Per-Table Triage Logic
// =============================================================================

function triageTable(
  table: CanonicalTable,
  entryContext: ResolvedEntryContext,
  diagnosticByQid: Map<string, QuestionDiagnostic>,
  binaryPairLookup: Map<string, string>,
): TableTriageReason[] {
  const reasons: TableTriageReason[] = [];

  // Signal 1: Filtered base
  checkFilteredBase(table, entryContext.entry, reasons);

  // Signal 2: Grid structure
  checkGridStructure(table, reasons);

  // Signal 3: Conceptual grid
  checkConceptualGrid(entryContext.candidateQuestionIds, diagnosticByQid, reasons);

  // Signal 4: Label divergence
  checkLabelDivergence(entryContext.entry, reasons);

  // Signal 5: Rebased base
  checkRebasedBase(table, reasons);

  // Signal 6: Weighted effective base
  checkWeightedEffectiveBase(table, reasons);

  // Signal 7: Stimuli set slice
  checkStimuliSetSlice(table, reasons);

  // Signal 8: Stimuli set ambiguous
  checkStimuliSetAmbiguous(table, entryContext.candidateQuestionIds, diagnosticByQid, reasons);

  // Signal 9: Binary pair
  checkBinaryPair(table, binaryPairLookup, reasons);

  // Signal 10: Borderline materiality
  checkBorderlineMateriality(entryContext.candidateQuestionIds, diagnosticByQid, reasons);

  return reasons;
}

// =============================================================================
// Individual Signal Checks
// =============================================================================

/**
 * Signal 1: filtered-base
 * Fires whenever the table's base is NOT "Total respondents" — meaning some
 * filtering, routing, or item-level subsetting applies. AI should refine the
 * base description to be reader-friendly and descriptive of WHO is in the base.
 *
 * The deterministic planner provides an accurate-but-generic default (e.g.,
 * "Respondents shown Patient care", "Those who were shown S8"). The AI's job
 * is to make this more meaningful using survey context.
 *
 * Tables grouped by questionId are sent to the AI together, so expanding
 * this signal adds more tables per group but rarely adds more AI calls.
 */
function checkFilteredBase(
  table: CanonicalTable,
  _entry: QuestionIdEntry | undefined,
  reasons: TableTriageReason[],
): void {
  const hasFilteredBaseSignal =
    table.plannerBaseSignals?.includes('filtered-base')
    || table.baseContract.signals.includes('filtered-base');
  if (!hasFilteredBaseSignal) return;

  const comparableBase = resolveComparableBase(table);
  const detail = comparableBase
    ? `${comparableBase.label} (${comparableBase.value}) is below the total sample — AI should describe WHO is in this base`
    : 'Non-total base requires descriptive wording review';
  reasons.push({
    signal: 'filtered-base',
    detail,
    severity: 'medium',
  });
}

/**
 * Signal 2: grid-structure
 * Grid row/column detail tables where labels and subtitles may need
 * contextual framing from the survey text.
 */
function checkGridStructure(
  table: CanonicalTable,
  reasons: TableTriageReason[],
): void {
  if (!GRID_TABLE_KINDS.has(table.tableKind)) return;

  reasons.push({
    signal: 'grid-structure',
    detail: `Grid table (${table.tableKind}) — row/column labels may need contextual framing`,
    severity: 'high',
  });
}

/**
 * Signal 3: conceptual-grid
 * The parent question was identified as a conceptual grid (gridDims ending
 * in '*'). These are structurally ambiguous and labels need careful review.
 */
function checkConceptualGrid(
  candidateQuestionIds: string[],
  diagnosticByQid: Map<string, QuestionDiagnostic>,
  reasons: TableTriageReason[],
): void {
  const diagnostic = findDiagnosticForQuestionIds(candidateQuestionIds, diagnosticByQid);
  if (!diagnostic) return;
  if (!diagnostic.gridDims || !diagnostic.gridDims.endsWith('*')) return;

  // Don't double-count if already flagged as grid-structure
  reasons.push({
    signal: 'conceptual-grid',
    detail: `Conceptual grid (${diagnostic.gridDims}) — labeling is structurally ambiguous`,
    severity: 'high',
  });
}

/**
 * Signal 4: label-divergence
 * When savLabel and surveyLabel differ significantly on any item in the
 * parent entry, AI should review which label is more appropriate.
 *
 * Uses normalized Levenshtein distance: editDistance / max(len(a), len(b)).
 */
function checkLabelDivergence(
  entry: QuestionIdEntry | undefined,
  reasons: TableTriageReason[],
): void {
  if (!entry?.items || entry.items.length === 0) return;

  let divergentItemCount = 0;
  let divergentScaleLabelCount = 0;
  let maxDivergence = 0;
  const seenScalePairs = new Set<string>();

  const questionText = entry.questionText;

  for (const item of entry.items) {
    const itemDivergence = computeNormalizedDivergence(item.savLabel, item.surveyLabel, questionText);
    if (itemDivergence != null && itemDivergence > LABEL_DIVERGENCE_THRESHOLD) {
      divergentItemCount++;
      maxDivergence = Math.max(maxDivergence, itemDivergence);
    }

    for (const scaleLabel of item.scaleLabels ?? []) {
      const key = `${String(scaleLabel.value)}|${scaleLabel.savLabel ?? ''}|${scaleLabel.surveyLabel ?? ''}`;
      if (seenScalePairs.has(key)) continue;
      seenScalePairs.add(key);

      const scaleDivergence = computeNormalizedDivergence(
        scaleLabel.savLabel,
        scaleLabel.surveyLabel,
        questionText,
      );
      if (scaleDivergence != null && scaleDivergence > LABEL_DIVERGENCE_THRESHOLD) {
        divergentScaleLabelCount++;
        maxDivergence = Math.max(maxDivergence, scaleDivergence);
      }
    }
  }

  const totalDivergences = divergentItemCount + divergentScaleLabelCount;
  if (totalDivergences === 0) return;

  const detailParts: string[] = [];
  if (divergentItemCount > 0) detailParts.push(`${divergentItemCount} item label(s)`);
  if (divergentScaleLabelCount > 0) detailParts.push(`${divergentScaleLabelCount} scale label(s)`);

  reasons.push({
    signal: 'label-divergence',
    detail: `${detailParts.join(' + ')} have significant divergence (max: ${(maxDivergence * 100).toFixed(0)}%) between .sav and survey labels`,
    severity: totalDivergences >= 3 ? 'high' : 'medium',
  });
}

/**
 * Signal 5: rebased-base
 * Table uses a rebased base policy, meaning some responses were excluded.
 * AI should clarify what was excluded in the base description.
 *
 * Phase B: trusts planner signals and contract — no legacy basePolicy string check.
 */
function checkRebasedBase(
  table: CanonicalTable,
  reasons: TableTriageReason[],
): void {
  if (
    !table.plannerBaseSignals?.includes('rebased-base')
    && !table.baseContract.signals.includes('rebased-base')
    && table.baseContract.policy.rebasePolicy === 'none'
  ) return;

  reasons.push({
    signal: 'rebased-base',
    detail: `Rebased base requires wording review so exclusions are described consistently`,
    severity: 'low',
  });
}

function checkWeightedEffectiveBase(
  table: CanonicalTable,
  reasons: TableTriageReason[],
): void {
  if (
    !table.plannerBaseSignals?.includes('weighted-effective-base')
    && !table.baseContract.signals.includes('weighted-effective-base')
  ) return;

  reasons.push({
    signal: 'weighted-effective-base',
    detail: 'Weighted effective base requires wording review when surfaced in later output phases',
    severity: 'low',
  });
}

/**
 * Signal 7: stimuli-set-slice
 * Table belongs to a stimuli set slice. AI should refine the subtitle
 * (e.g., "Set 1 — Efficacy Messages" rather than just "Set 1") and verify
 * the base text makes sense for the subset.
 */
function checkStimuliSetSlice(
  table: CanonicalTable,
  reasons: TableTriageReason[],
): void {
  if (!table.stimuliSetSlice) return;

  const binarySuffix = table.binarySide
    ? ` (${table.binarySide} view)`
    : '';
  reasons.push({
    signal: 'stimuli-set-slice',
    detail: `Stimuli set slice (${table.stimuliSetSlice.setLabel}, family ${table.stimuliSetSlice.familySource})${binarySuffix} — subtitle and base text may need context-aware refinement`,
    severity: 'medium',
  });
}

/**
 * Signal 8: stimuli-set-ambiguous
 * The stimuli set resolution for this question had low confidence or
 * competing registries. Route to AI review for validation.
 */
function checkStimuliSetAmbiguous(
  table: CanonicalTable,
  candidateQuestionIds: string[],
  diagnosticByQid: Map<string, QuestionDiagnostic>,
  reasons: TableTriageReason[],
): void {
  if (!table.stimuliSetSlice) return;

  const diagnostic = findDiagnosticForQuestionIds(candidateQuestionIds, diagnosticByQid);
  if (!diagnostic?.stimuliSetResolution?.ambiguous) return;

  const { matchMethod, averageScore } = diagnostic.stimuliSetResolution;
  reasons.push({
    signal: 'stimuli-set-ambiguous',
    detail: `Stimuli set resolution is ambiguous (method: ${matchMethod}, avg score: ${averageScore.toFixed(1)}) — AI should validate set assignment`,
    severity: 'high',
  });
}

/**
 * Signal 9: binary-pair
 * Table is part of a selected/unselected binary pair (message testing).
 * AI should produce complementary, parallel wording for subtitle and base text.
 * Solo binary tables (e.g., coded open-ends with only the "yes" side) do not fire.
 */
function checkBinaryPair(
  table: CanonicalTable,
  binaryPairLookup: Map<string, string>,
  reasons: TableTriageReason[],
): void {
  if (!table.binarySide) return;

  const pairedTableId = binaryPairLookup.get(table.tableId);
  if (!pairedTableId) return;

  reasons.push({
    signal: 'binary-pair',
    detail: `Binary pair (${table.binarySide} view) — paired with ${pairedTableId}. Subtitles and base text should be complementary and parallel.`,
    severity: 'medium',
  });
}

/**
 * Signal 10: borderline-materiality
 * The planner kept the anchor view (no precision split) even though base
 * variation is near the materiality threshold (4–6% relative spread).
 * AI should add hedging language acknowledging the slight variation.
 */
function checkBorderlineMateriality(
  candidateQuestionIds: string[],
  diagnosticByQid: Map<string, QuestionDiagnostic>,
  reasons: TableTriageReason[],
): void {
  const diagnostic = findDiagnosticForQuestionIds(candidateQuestionIds, diagnosticByQid);
  if (!diagnostic) return;
  if (diagnostic.baseComparability !== 'varying_but_acceptable') return;

  const spread = diagnostic.relativeSpread;
  if (spread == null) return;
  if (spread < BORDERLINE_MATERIALITY_LOW || spread > BORDERLINE_MATERIALITY_HIGH) return;

  reasons.push({
    signal: 'borderline-materiality',
    detail: `Base variation (${(spread * 100).toFixed(1)}%) is near the materiality threshold — anchor view kept but hedging language recommended`,
    severity: 'low',
  });
}

// =============================================================================
// Binary Pair Lookup
// =============================================================================

/**
 * Build a bidirectional lookup from tableId → counterpart tableId for
 * binary pairs (selected ↔ unselected) within the same stimuli set slice.
 *
 * Match key: questionId + stimuliSetSlice.familySource + stimuliSetSlice.setIndex
 * A pair exists when exactly one 'selected' and one 'unselected' table share
 * the same match key.
 */
export function buildBinaryPairLookup(
  tables: CanonicalTable[],
): Map<string, string> {
  const lookup = new Map<string, string>();

  // Group by composite key
  const groups = new Map<string, { selected: string[]; unselected: string[] }>();
  for (const table of tables) {
    if (!table.binarySide || !table.stimuliSetSlice) continue;

    const key = `${table.questionId}||${table.stimuliSetSlice.familySource}||${table.stimuliSetSlice.setIndex}`;
    let group = groups.get(key);
    if (!group) {
      group = { selected: [], unselected: [] };
      groups.set(key, group);
    }
    group[table.binarySide].push(table.tableId);
  }

  // Create bidirectional mappings for valid pairs
  for (const group of groups.values()) {
    if (group.selected.length === 1 && group.unselected.length === 1) {
      lookup.set(group.selected[0], group.unselected[0]);
      lookup.set(group.unselected[0], group.selected[0]);
    }
  }

  return lookup;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Resolve table→entry context for triage.
 * Mirrors prefill.ts resolution logic so both sub-steps target the same parent entry.
 */
function resolveEntryContext(
  table: CanonicalTable,
  entryByQuestionId: Map<string, QuestionIdEntry>,
  entriesByDisplayQuestionId: Map<string, QuestionIdEntry[]>,
  representativeByLoopQuestionId: Map<string, QuestionIdEntry>,
): ResolvedEntryContext {
  const direct = entryByQuestionId.get(table.questionId);
  const displayMatches = entriesByDisplayQuestionId.get(table.questionId) ?? [];
  const familyRepresentative = representativeByLoopQuestionId.get(table.questionId);

  const candidates: QuestionIdEntry[] = [];
  if (direct) candidates.push(direct);
  for (const e of displayMatches) {
    if (!candidates.some(c => c.questionId === e.questionId)) {
      candidates.push(e);
    }
  }
  if (familyRepresentative && !candidates.some(c => c.questionId === familyRepresentative.questionId)) {
    candidates.push(familyRepresentative);
  }

  const candidateQuestionIds = Array.from(
    new Set([table.questionId, ...candidates.map(c => c.questionId)]),
  );

  if (candidates.length === 0) {
    return { entry: undefined, candidateQuestionIds };
  }
  if (candidates.length === 1) {
    return { entry: candidates[0], candidateQuestionIds };
  }

  const tableIdLower = table.tableId.toLowerCase();
  const byLineage = candidates
    .filter(e => tableIdLower.includes(e.questionId.toLowerCase()))
    .sort((a, b) => b.questionId.length - a.questionId.length)[0];
  if (byLineage) return { entry: byLineage, candidateQuestionIds };

  if (table.appliesToItem) {
    const byItem = candidates.find(
      e => e.items?.some(item => item.column === table.appliesToItem),
    );
    if (byItem) return { entry: byItem, candidateQuestionIds };
  }

  if (table.questionBase != null) {
    const byQuestionBase = candidates.find(
      e => e.questionBase != null && e.questionBase === table.questionBase,
    );
    if (byQuestionBase) return { entry: byQuestionBase, candidateQuestionIds };
  }

  if (table.itemBase != null) {
    const byItemBase = candidates.find(
      e => e.items?.some(item => item.itemBase != null && item.itemBase === table.itemBase),
    );
    if (byItemBase) return { entry: byItemBase, candidateQuestionIds };
  }

  if (direct && direct.questionId === table.questionId) {
    return { entry: direct, candidateQuestionIds };
  }

  return { entry: candidates[0], candidateQuestionIds };
}

export function buildEntryResolutionLookups(
  entries: QuestionIdEntry[],
): EntryResolutionLookups {
  const entryByQuestionId = new Map<string, QuestionIdEntry>();
  const entriesByDisplayQuestionId = new Map<string, QuestionIdEntry[]>();
  const representativeByLoopQuestionId = new Map<string, QuestionIdEntry>();

  for (const entry of entries) {
    entryByQuestionId.set(entry.questionId, entry);
    if (entry.displayQuestionId) {
      const list = entriesByDisplayQuestionId.get(entry.displayQuestionId) ?? [];
      list.push(entry);
      entriesByDisplayQuestionId.set(entry.displayQuestionId, list);
    }
    if (entry.loop?.detected && entry.loopQuestionId) {
      const current = representativeByLoopQuestionId.get(entry.loopQuestionId);
      const currentIndex = current?.loop?.iterationIndex ?? Number.MAX_SAFE_INTEGER;
      const nextIndex = entry.loop.iterationIndex ?? Number.MAX_SAFE_INTEGER;
      if (!current || nextIndex < currentIndex) {
        representativeByLoopQuestionId.set(entry.loopQuestionId, entry);
      }
    }
  }

  return {
    entryByQuestionId,
    entriesByDisplayQuestionId,
    representativeByLoopQuestionId,
  };
}

export function resolveTableEntryContext(
  table: CanonicalTable,
  lookups: EntryResolutionLookups,
): ResolvedEntryContext {
  return resolveEntryContext(
    table,
    lookups.entryByQuestionId,
    lookups.entriesByDisplayQuestionId,
    lookups.representativeByLoopQuestionId,
  );
}

function collectStructuralBaseSignals(
  table: CanonicalTable,
): PlannerBaseSignal[] {
  const signals = [
    ...(table.plannerBaseSignals ?? []),
    ...table.baseContract.signals,
  ].filter((signal): signal is PlannerBaseSignal => STRUCTURAL_BASE_SIGNAL_SET.has(signal));

  return Array.from(new Set(signals));
}

function resolveComparableBase(
  table: CanonicalTable,
): { value: number; label: string } | null {
  if (table.questionBase != null) {
    return { value: table.questionBase, label: 'Question base' };
  }
  if (table.itemBase != null) {
    return { value: table.itemBase, label: 'Item base' };
  }
  return null;
}

/**
 * Compute normalized divergence between two labels, filtering out
 * SPSS question-text concatenation patterns.
 *
 * SPSS often concatenates the variable name + question text into the value
 * label (e.g., "A6r4: Start statin first... - Again, please assume...").
 * The survey parse correctly strips this to just the answer option text
 * (e.g., "Start statin first..."). This is not genuine divergence — it's
 * the survey parse doing its job.
 *
 * We detect this by stripping the question text from the .sav label before
 * comparing. If the stripped version matches the survey label, the
 * divergence was just SPSS concatenation. Only genuine content differences
 * (e.g., "Original Allocation" vs "(alirocumab)") produce a divergence
 * score.
 *
 * @param questionText — The parent question's questionText, used to detect
 *   and strip SPSS question-text concatenation from the .sav label.
 */
export function computeNormalizedDivergence(
  savLabel: string | undefined,
  surveyLabel: string | undefined,
  questionText?: string,
): number | null {
  const sav = savLabel?.trim();
  const survey = surveyLabel?.trim();
  if (!sav || !survey) return null;
  if (sav === survey) return 0;

  // Strip SPSS concatenation artifacts from the .sav label before comparing.
  // The cleaned .sav label is what the programmer intended as the item label.
  const cleanedSav = stripSpssArtifacts(sav, questionText);

  // After stripping, if the labels match, the divergence was just SPSS junk.
  if (cleanedSav === survey) return 0;

  // Case-insensitive match after stripping
  if (cleanedSav.toLowerCase() === survey.toLowerCase()) return 0;

  const distance = charLevenshtein(cleanedSav, survey);
  const maxLen = Math.max(cleanedSav.length, survey.length);
  return maxLen > 0 ? distance / maxLen : 0;
}

/**
 * Strip common SPSS concatenation artifacts from a .sav value label:
 *
 * 1. Variable name prefix: "A6r4: " or "S14r15c1: " at the start
 * 2. Question text suffix: " - <questionText>" appended after the item label
 *
 * The SPSS convention is: "VarName: ItemLabel - QuestionText"
 * We want to extract just "ItemLabel".
 *
 * If questionText is provided and found in the label (preceded by " - "),
 * we strip it. We also strip trailing truncation artifacts from SPSS's
 * character limit.
 */
export function stripSpssArtifacts(
  savLabel: string,
  questionText?: string,
): string {
  let cleaned = savLabel;

  // Step 1: Strip variable name prefix (e.g., "A6r4: ", "S14r15c1: ")
  // Pattern: alphanumeric + optional underscore/digits at start, followed by ": "
  cleaned = cleaned.replace(/^[A-Za-z0-9_]+:\s+/, '');

  // Step 2: Strip question text suffix if provided.
  // SPSS concatenates with " - " as separator.
  if (questionText) {
    const qt = questionText.trim();
    if (qt.length > 0) {
      // Try to find " - <start of questionText>" in the label.
      // The question text may be truncated in the .sav due to SPSS char limits,
      // so we match a significant prefix (first 30 chars or full text).
      const qtPrefix = qt.slice(0, Math.min(30, qt.length)).toLowerCase();
      const separator = ' - ';
      const labelLower = cleaned.toLowerCase();
      const sepIdx = labelLower.indexOf(separator + qtPrefix);

      if (sepIdx >= 0) {
        // Everything after the separator is question text — strip it
        cleaned = cleaned.slice(0, sepIdx);
      }
    }
  }

  return cleaned.trim();
}

function findDiagnosticForQuestionIds(
  candidateQuestionIds: string[],
  diagnosticByQid: Map<string, QuestionDiagnostic>,
): QuestionDiagnostic | undefined {
  for (const qid of candidateQuestionIds) {
    const diagnostic = diagnosticByQid.get(qid);
    if (diagnostic) return diagnostic;
  }
  return undefined;
}
