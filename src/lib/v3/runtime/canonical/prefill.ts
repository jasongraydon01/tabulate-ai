/**
 * V3 Runtime — Stage 13e Table Metadata Pre-fill
 *
 * Deterministic post-processing pass over 13d's canonical tables.
 * Fills presentation fields (tableSubtitle, userNote, baseText) using
 * signals already available in the enriched QuestionIdEntry data.
 *
 * No AI calls, no file I/O — pure transformation.
 *
 * These values are defaults. The downstream AI gate (Pass A) will
 * refine them for flagged tables where context is genuinely ambiguous.
 *
 * See also:
 *   - ./assemble.ts (stage 13d — produces the input)
 *   - ./types.ts for CanonicalTableOutput, QuestionIdEntry
 */

import type {
  CanonicalTableOutput,
  CanonicalTable,
  QuestionIdEntry,
  SurveyMetadata,
  TableKind,
} from './types';
import { isNonSubstantiveTail } from './nonSubstantive';
import {
  buildBaseNoteParts,
  resolveDisplayBaseText,
} from './baseDisclosurePresentation';
import type { TablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';
import {
  getBottomBoxLabel,
  getRankLabel,
  getTopBoxLabel,
  resolveTablePresentationConfig,
} from '@/lib/tablePresentation/labelVocabulary';

// =============================================================================
// Public interface
// =============================================================================

export interface TableMetadataPrefillInput {
  canonicalOutput: CanonicalTableOutput;
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  tablePresentation?: TablePresentationConfig;
}

/**
 * Main entry point: enriches canonical tables with deterministic
 * tableSubtitle, userNote, and baseText values.
 *
 * Returns a new CanonicalTableOutput (immutable — does not mutate input).
 */
export function runTableMetadataPrefill(
  input: TableMetadataPrefillInput,
): CanonicalTableOutput {
  const { canonicalOutput, entries } = input;
  const tablePresentation = resolveTablePresentationConfig(input.tablePresentation);

  // Build entry lookups for O(1) access.
  // Primary key is raw questionId; secondary key is displayQuestionId for
  // canonical tables that render with display overrides (e.g., B500_1 -> B500).
  const entryByQuestionId = new Map<string, QuestionIdEntry>();
  const entriesByDisplayQuestionId = new Map<string, QuestionIdEntry[]>();
  const representativeByLoopQuestionId = new Map<string, QuestionIdEntry>();
  for (const e of entries) {
    entryByQuestionId.set(e.questionId, e);
    if (e.displayQuestionId) {
      const existing = entriesByDisplayQuestionId.get(e.displayQuestionId) ?? [];
      existing.push(e);
      entriesByDisplayQuestionId.set(e.displayQuestionId, existing);
    }
    if (e.loop?.detected && e.loopQuestionId) {
      const current = representativeByLoopQuestionId.get(e.loopQuestionId);
      const currentIndex = current?.loop?.iterationIndex ?? Number.MAX_SAFE_INTEGER;
      const nextIndex = e.loop.iterationIndex ?? Number.MAX_SAFE_INTEGER;
      if (!current || nextIndex < currentIndex) {
        representativeByLoopQuestionId.set(e.loopQuestionId, e);
      }
    }
  }

  const enrichedTables = canonicalOutput.tables.map((table) => {
    const entry = resolveEntryForTable(
      table,
      entryByQuestionId,
      entriesByDisplayQuestionId,
      representativeByLoopQuestionId,
    );
    let modified = false;

    // 1. tableSubtitle — only fill if currently empty
    let tableSubtitle = table.tableSubtitle;
    if (tableSubtitle === '') {
      const newSubtitle = buildSubtitle(table, tablePresentation);
      if (newSubtitle !== '') {
        tableSubtitle = newSubtitle;
        modified = true;
      }
    }

    // 1b. Compound subtitle for ranking tables with stimuli-set labels.
    //     Assembly sets subtitle to "Set N" but loses the rank/topK context.
    //     Compose: "Ranked 1st Summary — Set 1" or "Top 3 Summary — Set 1".
    if (tableSubtitle !== '' && isRankingSetSubtitle(table, tableSubtitle)) {
      const rankPart = buildRankingSubtitlePart(table, tablePresentation);
      if (rankPart) {
        tableSubtitle = `${rankPart} — ${tableSubtitle}`;
        modified = true;
      }
    }

    // 2. userNote — only fill if currently empty
    let userNote = table.userNote;
    if (userNote === '' && entry) {
      const newNote = buildUserNote(table, entry);
      if (newNote !== '') {
        userNote = newNote;
        modified = true;
      }
    }

    // 3. baseText — always refine (strip n=, apply semantic mapping)
    const newBaseText = refineBaseText(table, entry);
    if (newBaseText !== table.baseText) {
      modified = true;
    }

    if (!modified) return table;

    return {
      ...table,
      tableSubtitle,
      userNote,
      baseText: newBaseText,
      lastModifiedBy: 'TableMetadataPrefill',
    };
  });

  return {
    ...canonicalOutput,
    tables: enrichedTables,
  };
}

function resolveEntryForTable(
  table: CanonicalTable,
  entryByQuestionId: Map<string, QuestionIdEntry>,
  entriesByDisplayQuestionId: Map<string, QuestionIdEntry[]>,
  representativeByLoopQuestionId: Map<string, QuestionIdEntry>,
): QuestionIdEntry | undefined {
  // Canonical questionId may be a raw entry.questionId OR displayQuestionId.
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

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const tableIdLower = table.tableId.toLowerCase();
  const byLineage = candidates
    .filter(e => tableIdLower.includes(e.questionId.toLowerCase()))
    .sort((a, b) => b.questionId.length - a.questionId.length)[0];
  if (byLineage) return byLineage;

  if (table.appliesToItem) {
    const byItem = candidates.find(
      e => e.items?.some(item => item.column === table.appliesToItem),
    );
    if (byItem) return byItem;
  }

  if (table.questionBase != null) {
    const byBase = candidates.find(
      e => e.questionBase != null && e.questionBase === table.questionBase,
    );
    if (byBase) return byBase;
  }

  if (direct && direct.questionId === table.questionId) {
    return direct;
  }

  // Deterministic fallback when multiple entries share a displayQuestionId.
  return candidates[0];
}

// =============================================================================
// 1. tableSubtitle Rules
// =============================================================================

const SUBTITLE_BY_KIND: Partial<Record<TableKind, string>> = {
  scale_overview_rollup_mean: 'Mean Summary',
  scale_overview_rollup_combined: 'Combined Summary',
  scale_overview_rollup_nps: 'Net Promoter Score Summary',
  scale_overview_full: 'Full Distribution',
  scale_dimension_compare: 'Dimension Comparison',
  numeric_overview_mean: 'Mean Summary',
  maxdiff_api: 'Anchored Probability Index',
  maxdiff_ap: 'Average Positioning',
  maxdiff_sharpref: 'Sharp Reference',
  // standard_overview and allocation_overview intentionally omitted (stay blank)
};

function buildSubtitle(
  table: CanonicalTable,
  tablePresentation: TablePresentationConfig,
): string {
  const kind = table.tableKind;

  // Box rollups — derive label from first row's rollupConfig
  if (
    kind === 'scale_overview_rollup_t2b' ||
    kind === 'scale_overview_rollup_b2b' ||
    kind === 'scale_overview_rollup_middle'
  ) {
    return buildBoxRollupSubtitle(table, tablePresentation);
  }

  // Ranking tables — derive from first row's rankLevel / topKLevel
  if (kind === 'ranking_overview_rank') {
    const rankLevel = table.rows[0]?.rankLevel;
    if (rankLevel != null) {
      return appendRankingFamilySetSuffix(
        table,
        `${getRankLabel(rankLevel, tablePresentation.labelVocabulary)} Summary`,
      );
    }
    return appendRankingFamilySetSuffix(table, 'Rank Summary');
  }

  if (kind === 'ranking_overview_topk') {
    const topKLevel = table.rows[0]?.topKLevel;
    if (topKLevel != null) {
      return appendRankingFamilySetSuffix(table, `Top ${topKLevel} Summary`);
    }
    return appendRankingFamilySetSuffix(table, 'Top K Summary');
  }

  // Static subtitles by kind
  return SUBTITLE_BY_KIND[kind] ?? '';
}

/**
 * Check if a table is a ranking table whose current subtitle was set by a
 * stimuli-set slice (e.g., "Set 1") and needs the rank/topK context prepended.
 * Uses the current (possibly prefill-updated) subtitle, not the table's original.
 */
function isRankingSetSubtitle(table: CanonicalTable, currentSubtitle: string): boolean {
  const kind = table.tableKind;
  if (kind !== 'ranking_overview_rank' && kind !== 'ranking_overview_topk') return false;

  // The subtitle was set by stimuliSetSlice in assembly — it won't contain
  // rank vocabulary. A simple heuristic: if the current subtitle doesn't already
  // contain "Summary" or "Rank" (from step 1 prefill), it needs composition.
  const sub = currentSubtitle.toLowerCase();
  return !sub.includes('summary') && !sub.includes('rank') && !sub.includes('top ');
}

/**
 * Build just the ranking part of a compound subtitle (e.g., "Ranked 1st Summary"
 * or "Top 3 Summary") from the table's row data.
 */
function buildRankingSubtitlePart(
  table: CanonicalTable,
  tablePresentation: TablePresentationConfig,
): string {
  if (table.tableKind === 'ranking_overview_rank') {
    const rankLevel = table.rows[0]?.rankLevel;
    if (rankLevel != null) {
      return `${getRankLabel(rankLevel, tablePresentation.labelVocabulary)} Summary`;
    }
    return 'Rank Summary';
  }

  if (table.tableKind === 'ranking_overview_topk') {
    const topKLevel = table.rows[0]?.topKLevel;
    if (topKLevel != null) {
      return `Top ${topKLevel} Summary`;
    }
    return 'Top K Summary';
  }

  return '';
}

function appendRankingFamilySetSuffix(
  table: CanonicalTable,
  subtitle: string,
): string {
  if (table.stimuliSetSlice) return subtitle;

  const setIndex = extractIterationSetIndex(table);
  if (setIndex == null) return subtitle;

  const lower = subtitle.toLowerCase();
  if (lower.includes('set ')) return subtitle;

  return `${subtitle} - Set ${setIndex}`;
}

function extractIterationSetIndex(table: CanonicalTable): number | null {
  const familyRoot = table.familyRoot?.trim();
  const questionId = table.questionId?.trim();
  if (!familyRoot || !questionId) return null;

  const escapedQuestionId = escapeRegExp(questionId);
  const match = familyRoot.match(new RegExp(`^${escapedQuestionId}_(\\d+)$`, 'i'));
  if (!match) return null;

  const setIndex = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(setIndex) && setIndex > 0 ? setIndex : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBoxRollupSubtitle(
  table: CanonicalTable,
  tablePresentation: TablePresentationConfig,
): string {
  const fallback = getFallbackRollupSubtitle(table.tableKind, tablePresentation);
  const rollup = table.rows[0]?.rollupConfig;
  if (!rollup) {
    // Fallback labels when no rollupConfig
    return fallback;
  }

  const width = Number(rollup.boxWidth);
  const position = rollup.boxPosition;

  if (position === 'top') {
    const safeWidth = Number.isFinite(width) && width > 0 ? Math.trunc(width) : 2;
    return `${getTopBoxLabel(safeWidth, tablePresentation.labelVocabulary)} Summary`;
  }
  if (position === 'bottom') {
    const safeWidth = Number.isFinite(width) && width > 0 ? Math.trunc(width) : 2;
    return `${getBottomBoxLabel(safeWidth, tablePresentation.labelVocabulary)} Summary`;
  }
  if (position === 'middle') return `${tablePresentation.labelVocabulary.middleBoxLabel} Box Summary`;
  return fallback;
}

function getFallbackRollupSubtitle(
  tableKind: TableKind,
  tablePresentation: TablePresentationConfig,
): string {
  if (tableKind === 'scale_overview_rollup_t2b') {
    return `${getTopBoxLabel(2, tablePresentation.labelVocabulary)} Summary`;
  }
  if (tableKind === 'scale_overview_rollup_b2b') {
    return `${getBottomBoxLabel(2, tablePresentation.labelVocabulary)} Summary`;
  }
  return `${tablePresentation.labelVocabulary.middleBoxLabel} Box Summary`;
}

// =============================================================================
// 2. userNote Rules
// =============================================================================

const MAX_NOTES = 3;
const NOTE_SEPARATOR = '; ';

function buildUserNote(table: CanonicalTable, entry: QuestionIdEntry): string {
  const notes: string[] = [];

  // Priority 1: Ranking detail
  if (entry.analyticalSubtype === 'ranking' && entry.rankingDetail) {
    notes.push(`Ranked top ${entry.rankingDetail.K} of ${entry.rankingDetail.N} items`);
  }

  // Priority 2: Binary flag (multi-select)
  if (entry.normalizedType === 'binary_flag') {
    notes.push('Multiple answers accepted');
  }

  // Priority 3: Scale anchors
  if (entry.analyticalSubtype === 'scale' && notes.length < MAX_NOTES) {
    const scaleNote = buildScaleAnchorNote(entry);
    if (scaleNote) notes.push(scaleNote);
  }

  // Priority 4: Allocation sum constraint
  if (
    entry.analyticalSubtype === 'allocation' &&
    entry.sumConstraint?.detected &&
    entry.sumConstraint.constraintValue != null &&
    notes.length < MAX_NOTES
  ) {
    notes.push(`Allocations sum to ${entry.sumConstraint.constraintValue}%`);
  }

  // Priority 5: Rebased
  const baseNotes = buildBaseDisclosureNotes(table, entry);
  for (const note of baseNotes) {
    if (notes.length >= MAX_NOTES) break;
    notes.push(note);
  }

  return notes.slice(0, MAX_NOTES).join(NOTE_SEPARATOR);
}

function buildScaleAnchorNote(entry: QuestionIdEntry): string | null {
  // Find the first item that has scaleLabels
  const itemWithScale = entry.items?.find(
    (item) => item.scaleLabels && item.scaleLabels.length >= 2,
  );
  if (!itemWithScale?.scaleLabels) return null;

  // Filter out non-substantive codes (e.g., 98=Don't Know, 99=Refused)
  // before extracting the scale endpoints
  const substantiveLabels = itemWithScale.scaleLabels.filter(
    (sl) => !isNonSubstantiveTail(sl.label),
  );
  if (substantiveLabels.length < 2) return null;

  const first = substantiveLabels[0];
  const last = substantiveLabels[substantiveLabels.length - 1];

  if (first && last) {
    return `Scale: ${first.value} = ${first.label} to ${last.value} = ${last.label}`;
  }

  return null;
}

// =============================================================================
// 3. baseText Refinement
// =============================================================================

/** Strip (n=XXX) or (n=varies) suffix from base text */
const N_SUFFIX_REGEX = /\s*\(n=[^)]*\)\s*$/;

function refineBaseText(
  table: CanonicalTable,
  entry: QuestionIdEntry | undefined,
): string {
  const displayBaseText = resolveDisplayBaseText({
    baseDisclosure: table.baseDisclosure,
    baseText: table.baseText,
    basePolicy: table.basePolicy,
  });
  if (table.baseDisclosure?.defaultBaseText) {
    // Trust the planner-provided disclosure text. The contract may intentionally
    // surface filtered/item-specific wording even when the comparable base equals totalN.
    return table.baseDisclosure.defaultBaseText;
  }

  let text = displayBaseText ?? table.baseText;

  // Step 1: Strip (n=XXX) suffix — the table already shows the N
  text = text.replace(N_SUFFIX_REGEX, '');

  // Step 2: Semantic mapping
  if (table.basePolicy.includes('rebased')) {
    // Already descriptive from 13d (e.g. "All respondents excluding non-substantive (rebased)")
    // After stripping (n=...), just return as-is
    return text;
  }

  // Cluster base: strip was already applied, return cleaned text.
  // Keep this before full-sample mapping so cluster semantics are preserved.
  if (table.basePolicy.includes('cluster_base')) {
    return text;
  }

  const effectiveBaseFallback = table.itemBase ?? table.questionBase;
  if (entry && effectiveBaseFallback != null && entry.totalN != null && effectiveBaseFallback === entry.totalN) {
    return 'Total respondents';
  }

  if (entry?.isFiltered) {
    // Use the parent questionId for readability, not the raw SPSS column
    return `Those who were shown ${table.questionId}`;
  }

  return text;
}

function buildBaseDisclosureNotes(
  table: CanonicalTable,
  entry: QuestionIdEntry | undefined,
): string[] {
  const notes = buildBaseNoteParts({
    baseDisclosure: table.baseDisclosure,
    basePolicy: table.basePolicy,
  });

  if (notes.length > 0 || table.baseDisclosure) {
    return notes;
  }

  if (entry?.hasVariableItemBases === true) {
    return ['Base varies by item'];
  }

  return [];
}
