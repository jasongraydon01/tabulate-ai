/**
 * V3 Runtime — 13b Table Planner
 *
 * Deterministic table planning module. Takes enriched question-id entries
 * (from the stage 12 reconciliation output) and produces a normalized table
 * plan artifact. This does NOT compute final table values and does NOT
 * render output tables — it only plans table families/variants deterministically.
 *
 * Ported from: scripts/v3-enrichment/13b-table-planner.ts
 *
 * Exports:
 *   - runTablePlanner(input)       — main entry for a single dataset
 *   - buildContext(dataset, entry, reportableMap) — build planning context
 *   - planEntryTables(ctx, ambiguities, overrides?) — plan tables for one entry
 *   - classifyScale(entry, items)  — scale mode classification
 */

import type {
  QuestionIdEntry,
  SurveyMetadata,
  PlannedTable,
  TableKind,
  PlannerAmbiguity,
  QuestionDiagnostic,
  HiddenSuppressionDecision,
  SuppressionReasonCode,
  DatasetPlanSummary,
  TablePlanOutput,
  ScaleClassification,
  // ScaleMode re-exported via ScaleClassification['mode']
  PlannerOverrides,
  EntryContext,
  QuestionItem,
  BaseCluster,
  ClusterAnalysis,
  EntryStimuliSetSlice,
  PlannerBaseComparability,
  PlannerBaseSignal,
  ComputeRiskSignal,
  PrecisionRoutingDecision,
  PlannedTableBaseViewRole,
  PlannerConfig,
  BaseDecision,
  CanonicalBaseDisclosure,
  CanonicalBaseNoteToken,
  StimuliSetResolutionDiagnostic,
  StimuliSetMatchMethod,
} from './types';
import { makeEmptyBaseContract, projectTableBaseContract } from '../baseContract';
import {
  getNonSubstantiveLabels,
  getTrailingNonSubstantiveLabels,
} from './nonSubstantive';

// Re-export SuppressionReasonCode for external consumers
export type { SuppressionReasonCode };

// =============================================================================
// Public input interface
// =============================================================================

export interface TablePlannerInput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  dataset: string;
  config?: PlannerConfig;
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  lowBaseSuppression: { enabled: false, threshold: 30 },
};

// =============================================================================
// Constants — suppression thresholds
// =============================================================================

const HIDDEN_SUPPRESS_MIN_ITEM_COUNT = 20;
const HIDDEN_SUPPRESS_MIN_ZERO_ITEM_PCT = 0.60;
const HIDDEN_SUPPRESS_MIN_OVERLAP_JACCARD = 0.95;
const HIDDEN_SUPPRESS_MIN_OVERLAP_ITEMS = 20;
const HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_ITEM_COUNT = 20;
const HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_COVERAGE_PCT = 0.80;
const HIDDEN_SUPPRESS_LINKED_PARENT_MAX_ITEMS = 3;
const HIDDEN_SUPPRESS_LINKED_MESSAGE_REQUIRES_MAXDIFF = true;
const HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_LABEL_ALIGN_PCT = 0.80;
const HIDDEN_SUPPRESS_LINKED_MESSAGE_LABEL_TOKEN_JACCARD_MIN = 0.25;
const MAXDIFF_PARENT_LINKED_MAX_ITEMS = 3;
const MAXDIFF_PARENT_LINKED_REQUIRE_ALL_LINKED_HIDDEN = true;
const HIDDEN_RANKING_DERIVATIVE_MIN_LABEL_MATCH_PCT = 0.60;
const CHOICE_MODEL_MIN_ITERATION_COUNT = 6;
const GENUINE_SPLIT_MATERIALITY_PCT = 0.05;
const GENUINE_SPLIT_MATERIALITY_ABS = 20;
const LOW_BASE_THRESHOLD = 30;
const GENUINE_SPLIT_BORDERLINE_LOW = 0.04;
const GENUINE_SPLIT_BORDERLINE_HIGH = 0.06;
const MAX_POPULATION_CLUSTERS = 3;
const CROSS_BLOCK_SCORE_MARGIN = 0.25;

const SCALE_POSITIVE_TERMS = ['agree', 'positive', 'favorable', 'satisfied', 'likely', 'good', 'excellent', 'strongly'];
const SCALE_NEGATIVE_TERMS = ['disagree', 'negative', 'unfavorable', 'dissatisfied', 'unlikely', 'bad', 'poor', 'weakly'];

function formatQuotedLabelList(labels: string[]): string {
  if (labels.length === 0) return 'non-substantive responses';
  if (labels.length === 1) return `"${labels[0]}"`;
  if (labels.length === 2) return `"${labels[0]}" and "${labels[1]}"`;
  return `${labels.slice(0, -1).map(label => `"${label}"`).join(', ')}, and "${labels[labels.length - 1]}"`;
}

function getExcludedResponseLabelsFromEntry(entry: QuestionIdEntry | undefined): string[] {
  if (!entry?.items?.length) return [];

  const labels: string[] = [];
  const seen = new Set<string>();

  for (const item of entry.items) {
    for (const label of getNonSubstantiveLabels(item.scaleLabels ?? [])) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }

  return labels;
}

// =============================================================================
// Internal interfaces (not exported)
// =============================================================================

interface MaxDiffExerciseFamilyIndex {
  familyRoots: Set<string>;
  artifactQuestionIds: Set<string>;
  unresolvedArtifactQuestionIds: string[];
}

interface MaxDiffDetection {
  publishableFamilies: Array<'api' | 'ap' | 'sharpref'>;
  allFamiliesDetected: Record<string, number>;
  referenceQuestionIds: string[];
}

interface GridCoord {
  row: number;
  col: number;
}

interface GridCell {
  item: QuestionItem;
  coord: GridCoord;
}

interface GridAnalysis {
  cells: GridCell[];
  rows: number[];
  cols: number[];
  rowCount: number;
  colCount: number;
  byRow: Map<number, GridCell[]>;
  byCol: Map<number, GridCell[]>;
}

interface ConceptualGridAnalysis {
  cols: number[];
  colCount: number;
  scaleLabels: Array<{ value: number | string; label: string }>;
  scaleCount: number;
  itemsByCol: Map<number, QuestionItem>;
}

interface SiblingDimensionMember {
  questionId: string;
  dimensionLabel: string;
  rowSuffix: string;
  messageKeys: string[];
  entry: QuestionIdEntry;
}

interface SiblingDimensionGroup {
  stem: string;
  members: SiblingDimensionMember[];
  itemCount: number;
  analyticalSubtype: string;
  messageKeys: string[];
}

interface StimuliSetFamilyRegistry {
  familySource: string;
  questionBlock: string;
  sets: Array<{
    setIndex: number;
    setLabel: string;
    sourceQuestionId: string;
    expectedCount: number;
    rawExpectedCount: number;
  }>;
  codeToSetIndexes: Map<string, Set<number>>;
  messageTextToSetIndexes: Map<string, Set<number>>;
  labelToSetIndexes: Map<string, Set<number>>;
  variablePatternToSetIndexes: Map<string, Set<number>>;
}

interface StimuliSetMatchResult {
  score: number;
  blockMatch: boolean;
  familySource: string;
  slices: EntryStimuliSetSlice[];
  setSizes: number[];
  /** Per-item scores used to derive match method and average */
  itemScores: number[];
}

interface StimuliSetDetectionResult {
  slices: EntryStimuliSetSlice[];
  resolution: StimuliSetResolutionDiagnostic | null;
}

type QuestionOrderCategory = 'screener' | 'main' | 'other';

interface ParsedQuestionOrderToken {
  category: QuestionOrderCategory;
  prefix: string;
  number: number;
  suffix: string;
  loopIteration: number;
}

// =============================================================================
// Helpers
// =============================================================================

function inc(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

function sanitizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'na';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseStructuredQuestionToken(value: string): ParsedQuestionOrderToken | null {
  const normalized = value
    .trim()
    .replace(/^h(?=[A-Za-z]+\d)/i, '')
    .replace(/_+$/g, '');
  const match = normalized.match(/^([A-Za-z]+)(\d+)([A-Za-z]*)(?:_([A-Za-z0-9]+))?$/);
  if (!match) return null;

  const [, prefixRaw, numberRaw, suffixRaw, loopTokenRaw] = match;
  const prefix = prefixRaw.toUpperCase();
  const number = Number.parseInt(numberRaw, 10);
  let suffix = suffixRaw.toLowerCase();
  let loopIteration = 0;

  if (loopTokenRaw) {
    const loopMatch = loopTokenRaw.match(/^(.*?)(\d+)$/);
    if (loopMatch) {
      const [, loopPrefix, loopValue] = loopMatch;
      if (loopPrefix) {
        suffix = `${suffix}_${loopPrefix.toLowerCase()}`;
      }
      loopIteration = Number.parseInt(loopValue, 10);
    } else {
      suffix = `${suffix}_${loopTokenRaw.toLowerCase()}`;
    }
  }

  const category: QuestionOrderCategory = prefix === 'S' ? 'screener' : 'main';
  return { category, prefix, number, suffix, loopIteration };
}

function compareReportableQuestionOrder(left: QuestionIdEntry, right: QuestionIdEntry): number {
  const leftSortable = (left.displayQuestionId?.trim() || left.questionId).trim();
  const rightSortable = (right.displayQuestionId?.trim() || right.questionId).trim();

  const leftParsed = parseStructuredQuestionToken(leftSortable);
  const rightParsed = parseStructuredQuestionToken(rightSortable);

  if (leftParsed && rightParsed) {
    const categoryOrder: Record<QuestionOrderCategory, number> = {
      screener: 0,
      main: 1,
      other: 2,
    };
    const categoryDiff = categoryOrder[leftParsed.category] - categoryOrder[rightParsed.category];
    if (categoryDiff !== 0) return categoryDiff;

    if (leftParsed.prefix !== rightParsed.prefix) {
      return leftParsed.prefix.localeCompare(rightParsed.prefix);
    }
    if (leftParsed.number !== rightParsed.number) {
      return leftParsed.number - rightParsed.number;
    }
    if (leftParsed.suffix !== rightParsed.suffix) {
      if (leftParsed.suffix === '') return -1;
      if (rightParsed.suffix === '') return 1;
      return leftParsed.suffix.localeCompare(rightParsed.suffix);
    }
    if (leftParsed.loopIteration !== rightParsed.loopIteration) {
      return leftParsed.loopIteration - rightParsed.loopIteration;
    }
  } else if (leftParsed || rightParsed) {
    return leftParsed ? -1 : 1;
  } else if (leftSortable !== rightSortable) {
    return leftSortable.localeCompare(rightSortable);
  }

  if (left.isHidden !== right.isHidden) {
    return left.isHidden ? 1 : -1;
  }

  return left.questionId.localeCompare(right.questionId);
}

function normalizeComparisonText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[''""]/g, '\'')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripVariablePrefix(value: string, column: string): string {
  const columnPrefix = new RegExp(`^${escapeRegExp(column)}\\s*[:\\-]\\s*`, 'i');
  return value.replace(columnPrefix, '').replace(/^[A-Za-z0-9_]+\s*[:\-]\s*/, '').trim();
}

function stripQuestionStemSuffix(value: string, questionText: string): string {
  if (!questionText || questionText.length < 10) return value.trim();

  const normalizedQuestion = normalizeComparisonText(questionText);
  const anchor = normalizedQuestion.split(/\s+/).slice(0, 6).join(' ').trim();
  if (anchor.length < 10) return value.trim();

  const normalizedValue = normalizeComparisonText(value);
  const anchorIdx = normalizedValue.lastIndexOf(anchor);
  if (anchorIdx <= 0) return value.trim();

  const leading = normalizedValue.slice(0, anchorIdx);
  if (!/[-:]\s*$/.test(leading)) return value.trim();

  return leading.replace(/[-:]\s*$/, '').trim();
}

function deriveComparableLabel(item: QuestionItem, questionText: string): string | null {
  const raw =
    item.messageText?.trim() ||
    item.surveyLabel?.trim() ||
    item.label?.trim() ||
    item.savLabel?.trim() ||
    '';
  if (!raw) return null;

  const withoutPrefix = stripVariablePrefix(raw, item.column);
  const withoutStem = item.messageText
    ? withoutPrefix
    : stripQuestionStemSuffix(withoutPrefix, questionText);
  const normalized = normalizeComparisonText(withoutStem);
  return normalized || null;
}

function normalizeMessageCode(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

function extractVariablePattern(column: string): string | null {
  const match = column.match(/r(\d)(\d{2,})$/i);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function extractQuestionBlock(questionId: string): string {
  const match = questionId.match(/^[A-Za-z]+/);
  return (match?.[0] || questionId).toUpperCase();
}

function addSetIndex(map: Map<string, Set<number>>, key: string | null, setIndex: number): void {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, new Set<number>());
  }
  map.get(key)!.add(setIndex);
}

function getUniqueSetIndex(map: Map<string, Set<number>>, key: string | null): number | null {
  if (!key) return null;
  const values = map.get(key);
  if (!values || values.size !== 1) return null;
  return [...values][0];
}

function buildStimuliSetRegistry(
  reportableMap: Map<string, QuestionIdEntry>,
  metadata?: SurveyMetadata,
): StimuliSetFamilyRegistry[] {
  if (!metadata?.isMessageTestingSurvey && !metadata?.isConceptTestingSurvey) {
    return [];
  }

  const registries: StimuliSetFamilyRegistry[] = [];
  const seenFamilies = new Set<string>();

  for (const entry of reportableMap.values()) {
    const stimuliSets = entry.stimuliSets;
    if (
      entry.disposition !== 'reportable' ||
      isHiddenEntry(entry) ||
      !stimuliSets?.detected ||
      stimuliSets.setCount < 2 ||
      seenFamilies.has(stimuliSets.familySource)
    ) {
      continue;
    }

    const registry: StimuliSetFamilyRegistry = {
      familySource: stimuliSets.familySource,
      questionBlock: extractQuestionBlock(stimuliSets.familySource),
      sets: [],
      codeToSetIndexes: new Map(),
      messageTextToSetIndexes: new Map(),
      labelToSetIndexes: new Map(),
      variablePatternToSetIndexes: new Map(),
    };

    let valid = true;

    for (const setDef of [...stimuliSets.sets].sort((a, b) => a.setIndex - b.setIndex)) {
      const sourceEntry = reportableMap.get(setDef.sourceQuestionId);
      if (!sourceEntry || sourceEntry.disposition !== 'reportable' || isHiddenEntry(sourceEntry)) {
        valid = false;
        break;
      }

      const expectedColumns = new Set(setDef.items);
      const sourceItemsRaw = castItems(sourceEntry)
        .filter(item => item.normalizedType !== 'text_open' && expectedColumns.has(item.column));

      if (sourceItemsRaw.length !== setDef.itemCount) {
        valid = false;
        break;
      }

      // Normalize source-set expectations through the same dead-column policy
      // used by downstream row planning. This prevents c1/c2 dead-column
      // artifacts from inflating expected set sizes and forcing avoidable
      // cross-family fallbacks.
      const sourceItems = stripDeadGridColumns(sourceItemsRaw);
      if (sourceItems.length === 0) {
        valid = false;
        break;
      }

      registry.sets.push({
        setIndex: setDef.setIndex,
        setLabel: `Set ${setDef.setIndex + 1}`,
        sourceQuestionId: setDef.sourceQuestionId,
        expectedCount: sourceItems.length,
        rawExpectedCount: setDef.itemCount,
      });

      for (const item of sourceItems) {
        addSetIndex(registry.codeToSetIndexes, normalizeMessageCode(item.messageCode), setDef.setIndex);
        addSetIndex(
          registry.messageTextToSetIndexes,
          normalizeComparisonText(item.messageText || ''),
          setDef.setIndex,
        );
        addSetIndex(
          registry.labelToSetIndexes,
          deriveComparableLabel(item, sourceEntry.questionText),
          setDef.setIndex,
        );
        addSetIndex(registry.variablePatternToSetIndexes, extractVariablePattern(item.column), setDef.setIndex);
      }
    }

    if (!valid || registry.sets.length !== stimuliSets.setCount) {
      continue;
    }

    registries.push(registry);
    seenFamilies.add(registry.familySource);
  }

  return registries.sort((a, b) => a.familySource.localeCompare(b.familySource));
}

function resolveStimuliSetForItem(
  item: QuestionItem,
  questionText: string,
  registry: StimuliSetFamilyRegistry,
): { setIndex: number; score: number } | null {
  const byCode = getUniqueSetIndex(registry.codeToSetIndexes, normalizeMessageCode(item.messageCode));
  if (byCode !== null) {
    return { setIndex: byCode, score: 4 };
  }

  const byMessageText = getUniqueSetIndex(
    registry.messageTextToSetIndexes,
    normalizeComparisonText(item.messageText || ''),
  );
  if (byMessageText !== null) {
    return { setIndex: byMessageText, score: 3 };
  }

  const byLabel = getUniqueSetIndex(
    registry.labelToSetIndexes,
    deriveComparableLabel(item, questionText),
  );
  if (byLabel !== null) {
    return { setIndex: byLabel, score: 2 };
  }

  const byPattern = getUniqueSetIndex(
    registry.variablePatternToSetIndexes,
    extractVariablePattern(item.column),
  );
  if (byPattern !== null) {
    return { setIndex: byPattern, score: 1 };
  }

  return null;
}

function detectStimuliSetSlices(
  entry: QuestionIdEntry,
  substantiveItems: QuestionItem[],
  registries: StimuliSetFamilyRegistry[],
  metadata?: SurveyMetadata,
): StimuliSetDetectionResult {
  if (
    entry.disposition !== 'reportable' ||
    isHiddenEntry(entry) ||
    substantiveItems.length === 0 ||
    (!metadata?.isMessageTestingSurvey && !metadata?.isConceptTestingSurvey)
  ) {
    return { slices: [], resolution: null };
  }

  const matches: StimuliSetMatchResult[] = [];
  const entryBlock = extractQuestionBlock(entry.questionId);

  for (const registry of registries) {
    const columnsBySet = new Map<number, string[]>();
    let totalScore = 0;
    let failed = false;
    const itemScores: number[] = [];

    for (const item of substantiveItems) {
      const resolved = resolveStimuliSetForItem(item, entry.questionText, registry);
      if (!resolved) {
        failed = true;
        break;
      }

      totalScore += resolved.score;
      itemScores.push(resolved.score);
      const columns = columnsBySet.get(resolved.setIndex) || [];
      columns.push(item.column);
      columnsBySet.set(resolved.setIndex, columns);
    }

    if (failed || columnsBySet.size !== registry.sets.length) {
      continue;
    }

    const slices: EntryStimuliSetSlice[] = [];
    for (const setMeta of registry.sets) {
      const columns = columnsBySet.get(setMeta.setIndex) || [];
      if (columns.length !== setMeta.expectedCount) {
        failed = true;
        break;
      }
      slices.push({
        familySource: registry.familySource,
        setIndex: setMeta.setIndex,
        setLabel: setMeta.setLabel,
        sourceQuestionId: setMeta.sourceQuestionId,
        columns,
      });
    }

    if (failed) {
      continue;
    }

    matches.push({
      score: totalScore,
      blockMatch: entryBlock === registry.questionBlock,
      familySource: registry.familySource,
      slices,
      setSizes: slices.map(slice => slice.columns.length),
      itemScores,
    });
  }

  const compareMatches = (a: StimuliSetMatchResult, b: StimuliSetMatchResult): number => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.blockMatch !== b.blockMatch) return a.blockMatch ? -1 : 1;
    return a.familySource.localeCompare(b.familySource);
  };
  matches.sort(compareMatches);

  const initialTopMatch = matches[0];
  if (!initialTopMatch) {
    return { slices: [], resolution: null };
  }
  const sameBlockTop = matches.find(match => match.blockMatch) ?? null;
  let selectedMatch = initialTopMatch;

  // Compatibility gate: avoid cross-block sourcing unless it clearly
  // outperforms the best same-block candidate.
  if (!selectedMatch.blockMatch && sameBlockTop) {
    const scoreGapRatio = selectedMatch.score > 0
      ? (selectedMatch.score - sameBlockTop.score) / selectedMatch.score
      : 0;
    if (scoreGapRatio <= CROSS_BLOCK_SCORE_MARGIN) {
      selectedMatch = sameBlockTop;
    }
  }

  const runnerUp = matches
    .filter(match => match !== selectedMatch)
    .sort(compareMatches)[0];

  const averageScore = selectedMatch.itemScores.length > 0
    ? selectedMatch.score / selectedMatch.itemScores.length
    : 0;

  // Ambiguity: low average score, close competition, or cross-block selection.
  const closeCompetitor = runnerUp != null
    && selectedMatch.score > 0
    && (selectedMatch.score - runnerUp.score) / selectedMatch.score < 0.2;
  const ambiguous = averageScore < 2.0 || closeCompetitor || !selectedMatch.blockMatch;
  const scoreGap = runnerUp != null ? selectedMatch.score - runnerUp.score : null;

  const resolution: StimuliSetResolutionDiagnostic = {
    detected: true,
    setCount: selectedMatch.slices.length,
    matchMethod: deriveStimuliSetMatchMethod(selectedMatch.itemScores),
    averageScore,
    ambiguous,
    binarySplitApplied: false, // caller sets this after planning
    familySource: selectedMatch.familySource,
    blockMatch: selectedMatch.blockMatch,
    candidateCount: matches.length,
    scoreGap,
    setSizes: selectedMatch.setSizes,
  };

  return { slices: selectedMatch.slices, resolution };
}

/**
 * Derive the dominant match method from per-item scores.
 * Score 4 = code, 3 = message_text, 2 = label, 1 = variable_pattern.
 * If all items matched via the same method, return that method; otherwise 'mixed'.
 */
function deriveStimuliSetMatchMethod(itemScores: number[]): StimuliSetMatchMethod {
  if (itemScores.length === 0) return 'mixed';
  const first = itemScores[0];
  if (itemScores.every(s => s === first)) {
    switch (first) {
      case 4: return 'code';
      case 3: return 'message_text';
      case 2: return 'label';
      case 1: return 'variable_pattern';
      default: return 'mixed';
    }
  }
  return 'mixed';
}

/**
 * Cast items from QuestionIdEntry (which uses QuestionIdItem with nullable
 * itemBase) to QuestionItem[] with non-nullable itemBase. The enrichment chain
 * guarantees itemBase is populated by step 03.
 */
function castItems(entry: QuestionIdEntry): QuestionItem[] {
  return (entry.items ?? []).map(item => ({
    column: item.column,
    label: item.label,
    savLabel: item.savLabel ?? undefined,
    surveyLabel: item.surveyLabel ?? undefined,
    normalizedType: item.normalizedType,
    itemBase: Number(item.itemBase ?? 0),
    scaleLabels: item.scaleLabels,
    messageCode: item.messageCode ?? null,
    messageText: item.messageText ?? null,
    altCode: item.altCode ?? null,
    altText: item.altText ?? null,
    matchMethod: item.matchMethod ?? null,
    matchConfidence: item.matchConfidence ?? 0,
    nUnique: item.nUnique ?? null,
    observedMin: item.observedMin ?? null,
    observedMax: item.observedMax ?? null,
    observedValues: item.observedValues ?? null,
  }));
}

function getSubstantiveItems(entry: QuestionIdEntry): QuestionItem[] {
  const allItems = castItems(entry);
  const substantive = allItems.filter(item => item.normalizedType !== 'text_open');
  const items = substantive.length > 0 ? substantive : allItems;
  return stripDeadGridColumns(items);
}

/**
 * Detect and remove items belonging to "dead" grid columns — columns where
 * every item has itemBase === 0. This handles piped/unfilled scenario columns
 * (e.g., C500_1 has c1=Scenario1 all zeros, c2=Scenario2 with real data).
 * Non-grid items (no column coordinate) are always kept.
 */
function stripDeadGridColumns(items: QuestionItem[]): QuestionItem[] {
  const cells = extractGridCells(items);
  // Only applies to grid-structured items (>= 80% parseable)
  if (cells.length < items.length * 0.8) return items;

  const colSet = new Set<number>();
  for (const cell of cells) colSet.add(cell.coord.col);
  if (colSet.size < 2) return items;

  // Find columns where every cell has itemBase === 0
  const deadCols = new Set<number>();
  for (const col of colSet) {
    const colCells = cells.filter(c => c.coord.col === col);
    if (colCells.every(c => Number(c.item.itemBase) === 0)) {
      deadCols.add(col);
    }
  }

  if (deadCols.size === 0) return items;

  // Don't strip ALL columns — at least one must survive
  if (deadCols.size === colSet.size) return items;

  // Build set of dead item columns for fast lookup
  const deadItemColumns = new Set<string>();
  for (const cell of cells) {
    if (deadCols.has(cell.coord.col)) {
      deadItemColumns.add(cell.item.column);
    }
  }

  const filtered = items.filter(item => !deadItemColumns.has(item.column));
  return filtered.length > 0 ? filtered : items;
}

function isHiddenEntry(entry: QuestionIdEntry): boolean {
  return entry.isHidden || /^h/i.test(entry.questionId);
}

function normalizeHiddenLink(entry: QuestionIdEntry): { linkedTo: string | null; linkMethod: string | null } | null {
  const raw = entry.hiddenLink as unknown;
  if (!raw) return null;

  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }

  if (!obj) return null;
  const linkedTo = typeof obj.linkedTo === 'string' && obj.linkedTo.trim()
    ? obj.linkedTo.trim()
    : null;
  const linkMethod = typeof obj.linkMethod === 'string' && obj.linkMethod.trim()
    ? obj.linkMethod.trim()
    : (typeof obj.method === 'string' && obj.method.trim() ? obj.method.trim() : null);

  if (!linkedTo && !linkMethod) return null;
  return { linkedTo, linkMethod };
}

function getLinkedParentQuestionId(entry: QuestionIdEntry): string | null {
  return normalizeHiddenLink(entry)?.linkedTo || null;
}

function canonicalFamilyRoot(entry: QuestionIdEntry): string {
  if (entry.loop?.detected && entry.loopQuestionId) return entry.loopQuestionId;
  return entry.questionId;
}

function inferFallbackBucket(entry: QuestionIdEntry, hasLinkedParent: boolean): string {
  if (entry.surveyMatch === 'exact' || entry.surveyMatch === 'suffix') return 'survey_anchored';
  if (hasLinkedParent) return 'linked_fallback_after_parent';
  if (/^(s|scr|screen)/i.test(entry.questionId)) return 'before_screener';
  return 'after_main';
}

function createTableIdCandidate(familyRoot: string, suffix: string): string {
  return `${sanitizeToken(familyRoot)}__${suffix}`;
}

// ---------------------------------------------------------------------------
// Base-planning resolution
// ---------------------------------------------------------------------------

function uniqueList<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeComparabilityStatus(entry: QuestionIdEntry): PlannerBaseComparability {
  const fromContract = entry.baseContract?.classification.comparabilityStatus;
  if (fromContract) return fromContract;

  if (!entry.hasVariableItemBases) return 'shared';
  if (entry.variableBaseReason === 'ranking-artifact') return 'varying_but_acceptable';
  return 'split_recommended';
}

function resolveEntryBasePlanning(
  entry: QuestionIdEntry,
  substantiveItems: QuestionItem[],
): EntryContext['basePlanning'] {
  const contract = entry.baseContract;
  const totalN = contract?.reference.totalN ?? entry.totalN ?? null;
  const questionBase = contract?.reference.questionBase ?? entry.questionBase ?? null;
  const itemBaseRange = contract?.reference.itemBaseRange ?? entry.itemBaseRange ?? null;
  const situation = contract?.classification.situation ?? null;
  const referenceUniverse = contract?.classification.referenceUniverse ?? null;
  const variationClass = contract?.classification.variationClass ?? null;
  const comparabilityStatus = normalizeComparabilityStatus(entry);
  const rebasePolicy = contract?.policy.rebasePolicy ?? 'none';
  const effectiveBaseMode = contract?.policy.effectiveBaseMode ?? null;
  const contractSignals = contract?.signals ?? [];
  const legacyMismatchReasons: string[] = [];

  const livingBases = substantiveItems
    .map(it => it.itemBase)
    .filter(b => b != null && b > 0);

  const minBase = itemBaseRange?.[0]
    ?? (livingBases.length > 0 ? Math.min(...livingBases) : null);
  const maxBase = itemBaseRange?.[1]
    ?? (livingBases.length > 0 ? Math.max(...livingBases) : null);
  const absoluteSpread = minBase != null && maxBase != null ? maxBase - minBase : null;
  const relativeSpread = absoluteSpread != null && maxBase != null && maxBase > 0
    ? absoluteSpread / maxBase
    : null;
  const hasVaryingItemBases = minBase != null && maxBase != null && minBase !== maxBase;
  const materialSplit = comparabilityStatus === 'split_recommended'
    && absoluteSpread != null
    && relativeSpread != null
    && absoluteSpread >= GENUINE_SPLIT_MATERIALITY_ABS
    && relativeSpread >= GENUINE_SPLIT_MATERIALITY_PCT;
  const borderlineMateriality = comparabilityStatus === 'split_recommended'
    && absoluteSpread != null
    && relativeSpread != null
    && absoluteSpread >= GENUINE_SPLIT_MATERIALITY_ABS
    && relativeSpread >= GENUINE_SPLIT_BORDERLINE_LOW
    && relativeSpread <= GENUINE_SPLIT_BORDERLINE_HIGH;
  const lowBaseCandidates = [questionBase, minBase, maxBase].filter((n): n is number => n != null && Number.isFinite(n));
  const lowBase = lowBaseCandidates.some(n => n < LOW_BASE_THRESHOLD);

  const plannerSignals: PlannerBaseSignal[] = [...contractSignals];
  if (lowBase) plannerSignals.push('low-base');
  if (effectiveBaseMode === 'table_mask_then_row_observed_n' && (
    referenceUniverse === 'question'
    || referenceUniverse === 'cluster'
    || rebasePolicy !== 'none'
    || plannerSignals.includes('filtered-base')
  )) {
    plannerSignals.push('compute-mask-required');
  }

  if ((entry.hasVariableItemBases ?? false) !== hasVaryingItemBases) {
    legacyMismatchReasons.push(
      `hasVariableItemBases legacy=${String(entry.hasVariableItemBases)} contract-derived=${String(hasVaryingItemBases)}`,
    );
  }
  if ((entry.variableBaseReason ?? null) === 'genuine' && variationClass && variationClass !== 'genuine') {
    legacyMismatchReasons.push(`variableBaseReason legacy=${entry.variableBaseReason} contract=${variationClass}`);
  }
  if ((entry.variableBaseReason ?? null) === 'ranking-artifact' && variationClass && variationClass !== 'ranking_artifact' && variationClass !== 'ranking_ambiguous') {
    legacyMismatchReasons.push(`variableBaseReason legacy=${entry.variableBaseReason} contract=${variationClass}`);
  }
  if (entry.itemBaseRange && itemBaseRange && (
    entry.itemBaseRange[0] !== itemBaseRange[0] || entry.itemBaseRange[1] !== itemBaseRange[1]
  )) {
    legacyMismatchReasons.push(
      `itemBaseRange legacy=${entry.itemBaseRange.join('-')} contract=${itemBaseRange.join('-')}`,
    );
  }

  return {
    totalN,
    questionBase,
    itemBaseRange,
    situation,
    referenceUniverse,
    variationClass,
    comparabilityStatus,
    rebasePolicy,
    effectiveBaseMode,
    signals: uniqueList(plannerSignals),
    minBase,
    maxBase,
    absoluteSpread,
    relativeSpread,
    materialSplit,
    borderlineMateriality,
    lowBase,
    hasVaryingItemBases,
    computeRiskSignals: uniqueList(
      effectiveBaseMode === 'table_mask_then_row_observed_n' && (
        referenceUniverse === 'question'
        || referenceUniverse === 'cluster'
        || rebasePolicy !== 'none'
        || contractSignals.includes('filtered-base')
      )
        ? ['compute-mask-required']
        : [],
    ),
    legacyMismatchReasons,
  };
}

function derivePrecisionRouting(
  entry: QuestionIdEntry,
  comparabilityStatus: PlannerBaseComparability,
  materialSplit: boolean,
  clusterAnalysis: ClusterAnalysis | null,
): PrecisionRoutingDecision {
  if (comparabilityStatus !== 'split_recommended' || !materialSplit) return 'none';
  if (entry.analyticalSubtype === 'standard' && clusterAnalysis?.routingType === 'population') return 'cluster';
  if (entry.analyticalSubtype === 'standard') return 'item_detail';
  return 'existing_subtype_detail';
}

function classifyBaseViewRole(
  tableKind: TableKind,
  tableRole: string,
): PlannedTableBaseViewRole {
  if (
    tableKind === 'standard_overview'
    || tableKind === 'numeric_overview_mean'
    || tableKind === 'allocation_overview'
    || tableKind === 'scale_overview_full'
    || tableKind === 'scale_overview_rollup_t2b'
    || tableKind === 'scale_overview_rollup_middle'
    || tableKind === 'scale_overview_rollup_b2b'
    || tableKind === 'scale_overview_rollup_nps'
    || tableKind === 'scale_overview_rollup_combined'
    || tableKind === 'scale_overview_rollup_mean'
    || tableKind === 'ranking_overview_rank'
    || tableKind === 'ranking_overview_topk'
    || tableKind === 'scale_dimension_compare'
    || tableKind === 'maxdiff_api'
    || tableKind === 'maxdiff_ap'
    || tableKind === 'maxdiff_sharpref'
  ) {
    return 'anchor';
  }

  if (tableRole.includes('overview')) return 'anchor';
  return 'precision';
}

// ---------------------------------------------------------------------------
// Base cluster detection
// ---------------------------------------------------------------------------

function detectBaseClusters(entry: QuestionIdEntry, substantiveItems: QuestionItem[]): ClusterAnalysis {
  const livingItems = substantiveItems.filter(it => it.itemBase > 0);

  // Group by base value
  const byBase = new Map<number, QuestionItem[]>();
  for (const item of livingItems) {
    if (!byBase.has(item.itemBase)) byBase.set(item.itemBase, []);
    byBase.get(item.itemBase)!.push(item);
  }

  const totalN = Number(entry.totalN ?? 0);
  const clusters: BaseCluster[] = [...byBase.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([base, items]) => ({
      base,
      items,
      isUniversal: base >= totalN,
    }));

  const distinctBases = clusters.length;
  const populationClusters = clusters.filter(c => !c.isUniversal);

  let routingType: ClusterAnalysis['routingType'];
  if (distinctBases <= 1 || populationClusters.length === 0) {
    routingType = 'none';
  } else if (distinctBases <= MAX_POPULATION_CLUSTERS) {
    routingType = 'population';
  } else {
    routingType = 'individual';
  }

  return { routingType, clusters, populationClusters };
}

// =============================================================================
// buildContext — EXPORTED
// =============================================================================

export function buildContext(
  dataset: string,
  entry: QuestionIdEntry,
  reportableMap: Map<string, QuestionIdEntry>,
  metadata?: SurveyMetadata,
  stimuliSetRegistry?: StimuliSetFamilyRegistry[],
): EntryContext {
  const familyRoot = canonicalFamilyRoot(entry);
  const linkedParentId = getLinkedParentQuestionId(entry);
  const linkedParent = linkedParentId ? reportableMap.get(linkedParentId) || null : null;
  const anchorRoot = linkedParent ? canonicalFamilyRoot(linkedParent) : familyRoot;
  const sortBlock = `${dataset}::${anchorRoot}`;
  const sortFamily = inferFallbackBucket(entry, Boolean(linkedParent));
  const substantiveItems = getSubstantiveItems(entry);
  const basePlanning = resolveEntryBasePlanning(entry, substantiveItems);
  const genuineSplit = substantiveItems.length > 1 && basePlanning.materialSplit;
  const rankingArtifactBases = basePlanning.variationClass === 'ranking_artifact';

  const clusterAnalysis = genuineSplit
    ? detectBaseClusters(entry, substantiveItems)
    : null;
  const precisionRouting = derivePrecisionRouting(
    entry,
    basePlanning.comparabilityStatus,
    basePlanning.materialSplit,
    clusterAnalysis,
  );
  const registries = stimuliSetRegistry ?? buildStimuliSetRegistry(reportableMap, metadata);
  const stimuliSetDetection = detectStimuliSetSlices(entry, substantiveItems, registries, metadata);
  const stimuliSetSlices = stimuliSetDetection.slices;
  const stimuliSetResolution = stimuliSetDetection.resolution;

  let splitReason: string | null = null;
  if (basePlanning.comparabilityStatus === 'ambiguous') splitReason = 'ambiguous_variable_item_bases';
  else if (genuineSplit) splitReason = 'genuine_variable_item_bases';
  else if (rankingArtifactBases) splitReason = 'ranking_artifact_variable_bases';
  else if (basePlanning.comparabilityStatus === 'varying_but_acceptable') splitReason = 'varying_item_bases_acceptable';
  else if (entry.analyticalSubtype === 'allocation' && entry.sumConstraint?.constraintAxis === 'across-cols') {
    splitReason = 'allocation_across_columns_structure';
  }

  return {
    dataset,
    entry,
    isMessageTestingSurvey: metadata?.isMessageTestingSurvey === true,
    isConceptTestingSurvey: metadata?.isConceptTestingSurvey === true,
    familyRoot,
    sortBlock,
    sortFamily,
    substantiveItems,
    basePlanning,
    splitReason,
    genuineSplit,
    rankingArtifactBases,
    clusterAnalysis,
    precisionRouting,
    stimuliSetSlices,
    stimuliSetResolution,
  };
}

// =============================================================================
// Kind counts
// =============================================================================

function buildKindCounts(tables: PlannedTable[]): Record<string, number> {
  const byKind: Record<string, number> = {};
  for (const table of tables) inc(byKind, table.tableKind);
  return byKind;
}

// =============================================================================
// Item key utilities (for overlap detection)
// =============================================================================

function canonicalItemKey(column: string): string {
  const token = String(column || '').trim();
  if (!token) return '';
  const tailMatch = token.match(/r\d+(?:c\d+)?$/i);
  if (tailMatch) return tailMatch[0].toLowerCase();
  const anyMatch = token.match(/r\d+(?:c\d+)?/i);
  if (anyMatch) return anyMatch[0].toLowerCase();
  return sanitizeToken(token.replace(/^h/i, ''));
}

function buildItemKeySet(items: QuestionItem[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    const key = canonicalItemKey(item.column);
    if (key) out.add(key);
  }
  return out;
}

function setIntersectionSize<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const item of small) {
    if (large.has(item)) n++;
  }
  return n;
}

// =============================================================================
// Token-based similarity
// =============================================================================

function tokenizeForMatch(text: string): Set<string> {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return new Set<string>();
  return new Set<string>(normalized.split(/\s+/).filter(tok => tok.length > 2));
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const tok of a) {
    if (b.has(tok)) inter++;
  }
  const union = a.size + b.size - inter;
  return inter / Math.max(union, 1);
}

function tokenContainment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let hits = 0;
  for (const tok of smaller) {
    if (larger.has(tok)) hits++;
  }
  return hits / smaller.size;
}

function labelAlignedToMessage(item: QuestionItem): boolean {
  const label = String(item.label || '').toLowerCase();
  if (!label) return false;

  const messageCode = String(item.messageCode || '').toLowerCase();
  const altCode = String(item.altCode || '').toLowerCase();
  if (messageCode && label.includes(messageCode)) return true;
  if (altCode && label.includes(altCode)) return true;

  const labelTokens = tokenizeForMatch(item.label || '');
  if (labelTokens.size === 0) return false;

  const messageJ = tokenJaccard(labelTokens, tokenizeForMatch(item.messageText || ''));
  const altJ = tokenJaccard(labelTokens, tokenizeForMatch(item.altText || ''));
  return Math.max(messageJ, altJ) >= HIDDEN_SUPPRESS_LINKED_MESSAGE_LABEL_TOKEN_JACCARD_MIN;
}

// =============================================================================
// Overlap detection
// =============================================================================

function findBestVisibleOverlap(
  entry: QuestionIdEntry,
  entryItems: QuestionItem[],
  visibleEntries: QuestionIdEntry[],
): {
  questionId: string;
  overlapIntersection: number;
  overlapContainment: number;
  overlapJaccard: number;
} | null {
  const hiddenSet = buildItemKeySet(entryItems);
  if (hiddenSet.size === 0) return null;

  let best: {
    questionId: string;
    overlapIntersection: number;
    overlapContainment: number;
    overlapJaccard: number;
  } | null = null;

  for (const candidate of visibleEntries) {
    if (candidate.analyticalSubtype !== entry.analyticalSubtype) continue;
    const candidateItems = getSubstantiveItems(candidate);
    const candidateSet = buildItemKeySet(candidateItems);
    if (candidateSet.size === 0) continue;

    const intersection = setIntersectionSize(hiddenSet, candidateSet);
    if (intersection === 0) continue;

    const minSize = Math.min(hiddenSet.size, candidateSet.size);
    const unionSize = hiddenSet.size + candidateSet.size - intersection;
    const containment = intersection / Math.max(minSize, 1);
    const jaccard = intersection / Math.max(unionSize, 1);

    if (
      !best
      || jaccard > best.overlapJaccard
      || (jaccard === best.overlapJaccard && intersection > best.overlapIntersection)
    ) {
      best = {
        questionId: candidate.questionId,
        overlapIntersection: intersection,
        overlapContainment: containment,
        overlapJaccard: jaccard,
      };
    }
  }

  return best;
}

// =============================================================================
// Suppression evaluation — Rule #1: hidden sparse overlap
// =============================================================================

function evaluateHiddenSparseOverlapSuppression(params: {
  dataset: string;
  entry: QuestionIdEntry;
  visibleEntries: QuestionIdEntry[];
  reportableMap: Map<string, QuestionIdEntry>;
}): Omit<HiddenSuppressionDecision, 'wouldHaveTableCount' | 'wouldHaveByKind'> | null {
  const { dataset, entry, visibleEntries, reportableMap } = params;
  if (!isHiddenEntry(entry)) return null;

  const substantiveItems = getSubstantiveItems(entry);
  const itemCount = substantiveItems.length;
  if (itemCount < HIDDEN_SUPPRESS_MIN_ITEM_COUNT) return null;

  const zeroItemCount = substantiveItems.filter(item => Number(item.itemBase) === 0).length;
  const zeroItemPct = zeroItemCount / Math.max(itemCount, 1);
  if (zeroItemPct < HIDDEN_SUPPRESS_MIN_ZERO_ITEM_PCT) return null;

  const overlap = findBestVisibleOverlap(entry, substantiveItems, visibleEntries);
  if (!overlap) return null;
  if (overlap.overlapJaccard < HIDDEN_SUPPRESS_MIN_OVERLAP_JACCARD) return null;
  if (overlap.overlapIntersection < HIDDEN_SUPPRESS_MIN_OVERLAP_ITEMS) return null;

  const linkedToQuestionId = getLinkedParentQuestionId(entry);
  const linkedParentResolved = Boolean(linkedToQuestionId && reportableMap.has(linkedToQuestionId));

  return {
    dataset,
    questionId: entry.questionId,
    analyticalSubtype: entry.analyticalSubtype || 'null',
    normalizedType: entry.normalizedType || 'unknown',
    itemCount,
    zeroItemCount,
    zeroItemPct,
    nonZeroItemCount: itemCount - zeroItemCount,
    linkedToQuestionId,
    linkedParentResolved,
    overlapQuestionId: overlap.questionId,
    overlapIntersection: overlap.overlapIntersection,
    overlapJaccard: overlap.overlapJaccard,
    overlapContainment: overlap.overlapContainment,
    reasonCode: 'hidden_sparse_high_overlap',
    detail: `Hidden + sparse (${(zeroItemPct * 100).toFixed(1)}% zero items) + high structural overlap with visible ${overlap.questionId} (jaccard ${(overlap.overlapJaccard * 100).toFixed(1)}%, overlap ${overlap.overlapIntersection} items).`,
  };
}

// =============================================================================
// Suppression evaluation — Rule #2: hidden linked message matrix
// =============================================================================

function evaluateHiddenLinkedMessageMatrixSuppression(params: {
  dataset: string;
  entry: QuestionIdEntry;
  reportableMap: Map<string, QuestionIdEntry>;
  hasMaxDiffSurvey: boolean;
}): Omit<HiddenSuppressionDecision, 'wouldHaveTableCount' | 'wouldHaveByKind'> | null {
  const { dataset, entry, reportableMap, hasMaxDiffSurvey } = params;
  if (!isHiddenEntry(entry)) return null;
  if (entry.normalizedType !== 'binary_flag') return null;
  if (HIDDEN_SUPPRESS_LINKED_MESSAGE_REQUIRES_MAXDIFF && !hasMaxDiffSurvey) return null;

  const substantiveItems = getSubstantiveItems(entry);
  const itemCount = substantiveItems.length;
  if (itemCount < HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_ITEM_COUNT) return null;

  const linkedToQuestionId = getLinkedParentQuestionId(entry);
  if (!linkedToQuestionId) return null;

  const linkedParent = reportableMap.get(linkedToQuestionId) || null;
  if (!linkedParent || linkedParent.disposition !== 'reportable') return null;
  if (linkedParent.normalizedType !== 'categorical_select') return null;

  const parentItems = getSubstantiveItems(linkedParent);
  if (parentItems.length === 0 || parentItems.length > HIDDEN_SUPPRESS_LINKED_PARENT_MAX_ITEMS) return null;

  const messageLinkedCount = substantiveItems.filter(item => Boolean(item.messageCode || item.altCode)).length;
  const messageCoveragePct = messageLinkedCount / Math.max(itemCount, 1);
  if (messageCoveragePct < HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_COVERAGE_PCT) return null;

  const labelAlignedCount = substantiveItems.filter(labelAlignedToMessage).length;
  const labelAlignPct = labelAlignedCount / Math.max(itemCount, 1);
  if (labelAlignPct < HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_LABEL_ALIGN_PCT) return null;

  const zeroItemCount = substantiveItems.filter(item => Number(item.itemBase) === 0).length;
  const zeroItemPct = zeroItemCount / Math.max(itemCount, 1);

  return {
    dataset,
    questionId: entry.questionId,
    analyticalSubtype: entry.analyticalSubtype || 'null',
    normalizedType: entry.normalizedType || 'unknown',
    itemCount,
    zeroItemCount,
    zeroItemPct,
    nonZeroItemCount: itemCount - zeroItemCount,
    linkedToQuestionId,
    linkedParentResolved: true,
    overlapQuestionId: linkedParent.questionId,
    overlapIntersection: labelAlignedCount,
    overlapJaccard: labelAlignPct,
    overlapContainment: messageCoveragePct,
    reasonCode: 'hidden_linked_message_matrix',
    detail:
      `Hidden binary message-matrix linked to ${linkedParent.questionId} ` +
      `(parent categorical_select items=${parentItems.length}; message-linked ${(messageCoveragePct * 100).toFixed(1)}%; label-aligned ${(labelAlignPct * 100).toFixed(1)}%).`,
  };
}

// =============================================================================
// Suppression evaluation — Rule #4: hidden ranking derivative
// =============================================================================

function evaluateHiddenRankingDerivativeSuppression(params: {
  dataset: string;
  entry: QuestionIdEntry;
  reportableMap: Map<string, QuestionIdEntry>;
}): Omit<HiddenSuppressionDecision, 'wouldHaveTableCount' | 'wouldHaveByKind'> | null {
  const { dataset, entry, reportableMap } = params;
  if (!isHiddenEntry(entry)) return null;

  const linkedToQuestionId = getLinkedParentQuestionId(entry);
  if (!linkedToQuestionId) return null;

  const linkedParent = reportableMap.get(linkedToQuestionId) || null;
  if (!linkedParent || linkedParent.disposition !== 'reportable') return null;
  if (linkedParent.analyticalSubtype !== 'ranking') return null;

  const parentItems = getSubstantiveItems(linkedParent);
  if (parentItems.length === 0) return null;

  const entryItems = getSubstantiveItems(entry);
  if (entryItems.length === 0) return null;

  // Collect value labels from the hidden entry's items
  const entryValueLabels = new Set<string>();
  for (const item of entryItems) {
    if (item.scaleLabels) {
      for (const sl of item.scaleLabels) {
        const label = String(sl.label || '').toLowerCase().trim();
        if (label) entryValueLabels.add(label);
      }
    }
  }
  if (entryValueLabels.size === 0) return null;

  // Collect item labels from the parent
  const parentItemLabels = new Set<string>();
  for (const item of parentItems) {
    const label = String(item.label || '').toLowerCase().trim();
    if (label) parentItemLabels.add(label);
  }
  if (parentItemLabels.size === 0) return null;

  // Match via token-level fuzzy comparison
  let matchCount = 0;
  for (const entryLabel of entryValueLabels) {
    const entryTokens = tokenizeForMatch(entryLabel);
    if (entryTokens.size === 0) continue;

    for (const parentLabel of parentItemLabels) {
      const parentTokens = tokenizeForMatch(parentLabel);
      if (parentTokens.size === 0) continue;

      const containment = tokenContainment(entryTokens, parentTokens);
      if (containment >= 0.60) {
        matchCount++;
        break;
      }
    }
  }

  const matchPct = matchCount / Math.max(entryValueLabels.size, 1);
  if (matchPct < HIDDEN_RANKING_DERIVATIVE_MIN_LABEL_MATCH_PCT) return null;

  const substantiveItems = getSubstantiveItems(entry);
  const itemCount = substantiveItems.length;
  const zeroItemCount = substantiveItems.filter(item => Number(item.itemBase) === 0).length;
  const zeroItemPct = zeroItemCount / Math.max(itemCount, 1);

  return {
    dataset,
    questionId: entry.questionId,
    analyticalSubtype: entry.analyticalSubtype || 'null',
    normalizedType: entry.normalizedType || 'unknown',
    itemCount,
    zeroItemCount,
    zeroItemPct,
    nonZeroItemCount: itemCount - zeroItemCount,
    linkedToQuestionId,
    linkedParentResolved: true,
    overlapQuestionId: linkedParent.questionId,
    overlapIntersection: matchCount,
    overlapJaccard: matchPct,
    overlapContainment: matchPct,
    reasonCode: 'hidden_ranking_derivative',
    detail:
      `Hidden ranking derivative of ${linkedParent.questionId} — ` +
      `value labels match ${matchCount}/${entryValueLabels.size} parent item labels ` +
      `(${(matchPct * 100).toFixed(1)}% match). Parent ranking tables already cover this view.`,
  };
}

// =============================================================================
// Suppression — MaxDiff linked hidden index
// =============================================================================

function pushMapArray(map: Map<string, string[]>, key: string, value: string): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function buildMaxDiffLinkedHiddenIndex(params: {
  dataset: string;
  reportable: QuestionIdEntry[];
  reportableMap: Map<string, QuestionIdEntry>;
  hasMaxDiffSurvey: boolean;
}): {
  linkedHiddenAllByParent: Map<string, string[]>;
  linkedHiddenSuppressionEligibleByParent: Map<string, string[]>;
} {
  const { dataset, reportable, reportableMap, hasMaxDiffSurvey } = params;
  const linkedHiddenAllByParent = new Map<string, string[]>();
  const linkedHiddenSuppressionEligibleByParent = new Map<string, string[]>();

  for (const entry of reportable) {
    if (!isHiddenEntry(entry)) continue;
    if (entry.normalizedType !== 'binary_flag') continue;

    const linkedToQuestionId = getLinkedParentQuestionId(entry);
    if (!linkedToQuestionId) continue;

    const substantiveItems = getSubstantiveItems(entry);
    if (substantiveItems.length < HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_ITEM_COUNT) continue;

    pushMapArray(linkedHiddenAllByParent, linkedToQuestionId, entry.questionId);

    const linkedSuppression = evaluateHiddenLinkedMessageMatrixSuppression({
      dataset,
      entry,
      reportableMap,
      hasMaxDiffSurvey,
    });
    if (linkedSuppression) {
      pushMapArray(linkedHiddenSuppressionEligibleByParent, linkedToQuestionId, entry.questionId);
    }
  }

  return { linkedHiddenAllByParent, linkedHiddenSuppressionEligibleByParent };
}

// =============================================================================
// Suppression — MaxDiff exercise family index
// =============================================================================

function buildMaxDiffExerciseFamilyIndex(params: {
  reportable: QuestionIdEntry[];
  hasMaxDiffSurvey: boolean;
}): MaxDiffExerciseFamilyIndex {
  const out: MaxDiffExerciseFamilyIndex = {
    familyRoots: new Set<string>(),
    artifactQuestionIds: new Set<string>(),
    unresolvedArtifactQuestionIds: [],
  };

  if (!params.hasMaxDiffSurvey) return out;

  for (const entry of params.reportable) {
    if (entry.analyticalSubtype !== 'maxdiff_exercise') continue;

    out.artifactQuestionIds.add(entry.questionId);

    const linkedParent = getLinkedParentQuestionId(entry);
    if (linkedParent) {
      out.familyRoots.add(linkedParent);
      continue;
    }

    if (entry.loop?.familyBase) {
      out.familyRoots.add(entry.loop.familyBase);
      continue;
    }

    out.unresolvedArtifactQuestionIds.push(entry.questionId);
  }

  return out;
}

// =============================================================================
// Suppression — Rule #5: MaxDiff exercise family
// =============================================================================

function evaluateMaxDiffExerciseFamilySuppression(params: {
  dataset: string;
  entry: QuestionIdEntry;
  hasMaxDiffSurvey: boolean;
  exerciseIndex: MaxDiffExerciseFamilyIndex;
}): Omit<HiddenSuppressionDecision, 'wouldHaveTableCount' | 'wouldHaveByKind'> | null {
  const { dataset, entry, hasMaxDiffSurvey, exerciseIndex } = params;
  if (!hasMaxDiffSurvey) return null;
  if (exerciseIndex.artifactQuestionIds.size === 0) return null;

  const substantiveItems = getSubstantiveItems(entry);
  const itemCount = substantiveItems.length;
  const zeroItemCount = substantiveItems.filter(item => Number(item.itemBase) === 0).length;
  const zeroItemPct = zeroItemCount / Math.max(itemCount, 1);

  if (exerciseIndex.artifactQuestionIds.has(entry.questionId)) {
    const familyRoot = getLinkedParentQuestionId(entry) || entry.loop?.familyBase || entry.questionId;
    return {
      dataset,
      questionId: entry.questionId,
      analyticalSubtype: entry.analyticalSubtype || 'null',
      normalizedType: entry.normalizedType || 'unknown',
      itemCount,
      zeroItemCount,
      zeroItemPct,
      nonZeroItemCount: itemCount - zeroItemCount,
      linkedToQuestionId: getLinkedParentQuestionId(entry),
      linkedParentResolved: Boolean(getLinkedParentQuestionId(entry)),
      overlapQuestionId: familyRoot,
      overlapIntersection: 1,
      overlapJaccard: 1,
      overlapContainment: 1,
      reasonCode: 'maxdiff_exercise_family',
      detail: `MaxDiff exercise artifact question anchored to family root ${familyRoot}.`,
    };
  }

  const familyBase = entry.loop?.familyBase || null;
  if (!entry.loop || entry.loop.detected !== false || !familyBase) return null;
  if (!exerciseIndex.familyRoots.has(familyBase)) return null;

  return {
    dataset,
    questionId: entry.questionId,
    analyticalSubtype: entry.analyticalSubtype || 'null',
    normalizedType: entry.normalizedType || 'unknown',
    itemCount,
    zeroItemCount,
    zeroItemPct,
    nonZeroItemCount: itemCount - zeroItemCount,
    linkedToQuestionId: null,
    linkedParentResolved: false,
    overlapQuestionId: familyBase,
    overlapIntersection: 1,
    overlapJaccard: 1,
    overlapContainment: 1,
    reasonCode: 'maxdiff_exercise_family',
    detail:
      `Suppressed MaxDiff exercise loop iteration in anchored family ${familyBase} ` +
      `(loop.detected=false, iterationCount=${entry.loop.iterationCount}).`,
  };
}

// =============================================================================
// Suppression — Rule #3: MaxDiff linked parent
// =============================================================================

function evaluateMaxDiffLinkedParentSuppression(params: {
  dataset: string;
  entry: QuestionIdEntry;
  hasMaxDiffSurvey: boolean;
  linkedHiddenAllByParent: Map<string, string[]>;
  linkedHiddenSuppressionEligibleByParent: Map<string, string[]>;
}): Omit<HiddenSuppressionDecision, 'wouldHaveTableCount' | 'wouldHaveByKind'> | null {
  const {
    dataset,
    entry,
    hasMaxDiffSurvey,
    linkedHiddenAllByParent,
    linkedHiddenSuppressionEligibleByParent,
  } = params;

  if (!hasMaxDiffSurvey) return null;
  if (isHiddenEntry(entry)) return null;
  if (entry.normalizedType !== 'categorical_select') return null;

  const parentItems = getSubstantiveItems(entry);
  const itemCount = parentItems.length;
  if (itemCount === 0 || itemCount > MAXDIFF_PARENT_LINKED_MAX_ITEMS) return null;

  const allLinked = linkedHiddenAllByParent.get(entry.questionId) || [];
  if (allLinked.length === 0) return null;

  const eligibleLinked = linkedHiddenSuppressionEligibleByParent.get(entry.questionId) || [];
  if (eligibleLinked.length === 0) return null;
  if (MAXDIFF_PARENT_LINKED_REQUIRE_ALL_LINKED_HIDDEN && eligibleLinked.length !== allLinked.length) return null;

  const zeroItemCount = parentItems.filter(item => Number(item.itemBase) === 0).length;
  const zeroItemPct = zeroItemCount / Math.max(itemCount, 1);
  const coverageScore = eligibleLinked.length / Math.max(allLinked.length, 1);

  return {
    dataset,
    questionId: entry.questionId,
    analyticalSubtype: entry.analyticalSubtype || 'null',
    normalizedType: entry.normalizedType || 'unknown',
    itemCount,
    zeroItemCount,
    zeroItemPct,
    nonZeroItemCount: itemCount - zeroItemCount,
    linkedToQuestionId: null,
    linkedParentResolved: false,
    overlapQuestionId: eligibleLinked[0],
    overlapIntersection: eligibleLinked.length,
    overlapJaccard: coverageScore,
    overlapContainment: coverageScore,
    reasonCode: 'maxdiff_parent_linked_hidden_matrix',
    detail:
      `Visible MaxDiff parent backed by linked hidden message matrix (` +
      `${eligibleLinked.length}/${allLinked.length} linked hidden rows eligible).`,
  };
}

// =============================================================================
// Composite hidden suppression
// =============================================================================

function evaluateHiddenSuppression(params: {
  dataset: string;
  entry: QuestionIdEntry;
  visibleEntries: QuestionIdEntry[];
  reportableMap: Map<string, QuestionIdEntry>;
  hasMaxDiffSurvey: boolean;
}): Omit<HiddenSuppressionDecision, 'wouldHaveTableCount' | 'wouldHaveByKind'> | null {
  const sparseOverlap = evaluateHiddenSparseOverlapSuppression(params);
  if (sparseOverlap) return sparseOverlap;

  const linkedMessage = evaluateHiddenLinkedMessageMatrixSuppression(params);
  if (linkedMessage) return linkedMessage;

  const rankingDerivative = evaluateHiddenRankingDerivativeSuppression(params);
  if (rankingDerivative) return rankingDerivative;

  return null;
}

// =============================================================================
// Choice model suppression
// =============================================================================

function isChoiceModelIteration(entry: QuestionIdEntry, hasChoiceModelExercise: boolean): boolean {
  if (!hasChoiceModelExercise) return false;
  if (!entry.loop) return false;
  if (entry.loop.detected !== false) return false;
  if (entry.loop.iterationCount < CHOICE_MODEL_MIN_ITERATION_COUNT) return false;
  return true;
}

function evaluateChoiceModelSuppression(params: {
  dataset: string;
  entry: QuestionIdEntry;
  hasChoiceModelExercise: boolean;
}): Omit<HiddenSuppressionDecision, 'wouldHaveTableCount' | 'wouldHaveByKind'> | null {
  const { dataset, entry, hasChoiceModelExercise } = params;
  if (!isChoiceModelIteration(entry, hasChoiceModelExercise)) return null;

  return {
    dataset,
    questionId: entry.questionId,
    analyticalSubtype: entry.analyticalSubtype || 'null',
    normalizedType: entry.normalizedType || 'unknown',
    itemCount: entry.items?.length ?? 0,
    zeroItemCount: 0,
    zeroItemPct: 0,
    nonZeroItemCount: entry.items?.length ?? 0,
    linkedToQuestionId: null,
    linkedParentResolved: false,
    overlapQuestionId: entry.loop?.familyBase ?? entry.questionId,
    overlapIntersection: 0,
    overlapJaccard: 0,
    overlapContainment: 0,
    reasonCode: 'choice_model_iteration',
    detail: `Choice model iteration (loop.detected=false, iterationCount=${entry.loop!.iterationCount}, familyBase=${entry.loop!.familyBase})`,
  };
}

// =============================================================================
// classifyScale — EXPORTED
// =============================================================================

export function classifyScale(entry: QuestionIdEntry, items: QuestionItem[]): ScaleClassification {
  let labels: Array<{ value: number | string; label: string }> = [];
  for (const item of items) {
    if (item.scaleLabels && item.scaleLabels.length > 0) {
      labels = item.scaleLabels;
      break;
    }
  }

  if (labels.length === 0) {
    return {
      mode: 'unknown',
      pointCount: null,
      hasNonSubstantiveTail: false,
      tailLabel: null,
      tailLabels: [],
    };
  }

  const pointCount = labels.length;
  const tailLabels = getTrailingNonSubstantiveLabels(labels);
  const hasNonSubstantiveTail = tailLabels.length > 0;
  const tailLabel = tailLabels[0] ?? null;

  if (pointCount === 3 || pointCount === 4) {
    return { mode: 'treat_as_standard', pointCount, hasNonSubstantiveTail, tailLabel, tailLabels };
  }

  const joined = `${entry.questionText} ${labels.map(l => l.label).join(' ')}`.toLowerCase();
  const npsSignals = ['recommend', 'promoter', 'detractor', 'net promoter', 'nps'];
  const looksNps = pointCount === 11 && npsSignals.some(sig => joined.includes(sig));
  if (looksNps) {
    return { mode: 'nps', pointCount, hasNonSubstantiveTail, tailLabel, tailLabels };
  }

  if (hasNonSubstantiveTail && pointCount >= 6) {
    return { mode: 'odd_plus_non_sub_tail', pointCount, hasNonSubstantiveTail, tailLabel, tailLabels };
  }

  if (pointCount % 2 === 1) {
    return { mode: 'odd_substantive', pointCount, hasNonSubstantiveTail, tailLabel, tailLabels };
  }

  const lowLabel = labels[0]?.label?.toLowerCase() || '';
  const highLabel = labels[labels.length - 1]?.label?.toLowerCase() || '';
  const lowIsNeg = SCALE_NEGATIVE_TERMS.some(t => lowLabel.includes(t));
  const highIsPos = SCALE_POSITIVE_TERMS.some(t => highLabel.includes(t));
  const lowIsPos = SCALE_POSITIVE_TERMS.some(t => lowLabel.includes(t));
  const highIsNeg = SCALE_NEGATIVE_TERMS.some(t => highLabel.includes(t));
  const bipolar = (lowIsNeg && highIsPos) || (lowIsPos && highIsNeg);
  if (bipolar) {
    return { mode: 'even_bipolar', pointCount, hasNonSubstantiveTail, tailLabel, tailLabels };
  }

  return { mode: 'admin_artifact', pointCount, hasNonSubstantiveTail, tailLabel, tailLabels };
}

// =============================================================================
// Grid analysis
// =============================================================================

function parseGridCoord(token: string): GridCoord | null {
  const match = token.match(/r(\d+)c(\d+)/i);
  if (!match) return null;
  const row = Number(match[1]);
  const col = Number(match[2]);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col };
}

function extractGridCells(items: QuestionItem[]): GridCell[] {
  const cells: GridCell[] = [];
  for (const item of items) {
    const coord = parseGridCoord(item.column);
    if (coord) cells.push({ item, coord });
  }
  return cells;
}

function analyzeGridStructure(items: QuestionItem[]): GridAnalysis | null {
  const cells = extractGridCells(items);
  if (cells.length < items.length * 0.8) return null;

  const rowSet = new Set<number>();
  const colSet = new Set<number>();
  const byRow = new Map<number, GridCell[]>();
  const byCol = new Map<number, GridCell[]>();

  for (const cell of cells) {
    rowSet.add(cell.coord.row);
    colSet.add(cell.coord.col);

    const rowGroup = byRow.get(cell.coord.row) || [];
    rowGroup.push(cell);
    byRow.set(cell.coord.row, rowGroup);

    const colGroup = byCol.get(cell.coord.col) || [];
    colGroup.push(cell);
    byCol.set(cell.coord.col, colGroup);
  }

  const rows = Array.from(rowSet).sort((a, b) => a - b);
  const cols = Array.from(colSet).sort((a, b) => a - b);

  if (rows.length < 2 || cols.length < 2) return null;

  return { cells, rows, cols, rowCount: rows.length, colCount: cols.length, byRow, byCol };
}

interface AllocationReferenceColumnDecision {
  items: QuestionItem[];
  suppressedColumns: string[];
  notes: string[];
  inputsUsed: string[];
}

function parseSurveyMarkdownRows(surveyText: string | null): string[][] {
  if (!surveyText) return [];

  return surveyText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && line.endsWith('|'))
    .filter((line) => {
      const stripped = line.replace(/\|/g, '').trim();
      return stripped !== '' && !/^[:\-\s]+$/.test(stripped);
    })
    .map((line) => line.slice(1, -1).split('|').map(cell => cell.trim()));
}

function detectSurveyPipeDisplayColumns(surveyText: string | null, expectedCols: number): Set<number> {
  const rows = parseSurveyMarkdownRows(surveyText);
  if (rows.length < 2 || expectedCols < 1) return new Set();

  const displayOffset = 2;
  const dataRows = rows.filter((row) => {
    if (row.length < displayOffset + 1) return false;
    const stub = row[0] || row[1] || '';
    if (/^\d+$/.test(stub)) return true;
    return row.some(cell => /\{\{PROG:/i.test(cell) || /_{3,}/.test(cell));
  });
  if (dataRows.length === 0) return new Set();

  const detected = new Set<number>();

  for (let colIndex = 0; colIndex < expectedCols; colIndex++) {
    let nonEmptyCells = 0;
    let pipeCells = 0;
    let naCells = 0;
    let responsePlaceholderCells = 0;

    for (const row of dataRows) {
      const cell = row[displayOffset + colIndex] || '';
      const normalized = cell.trim();
      if (!normalized) continue;

      nonEmptyCells++;
      if (/\bPIPE\s+IN\b/i.test(normalized)) {
        pipeCells++;
        continue;
      }
      if (/\bn\/a\b/i.test(normalized) || /\*\*n\/a\*\*/i.test(normalized)) {
        naCells++;
        continue;
      }
      if (/%/.test(normalized) || /_{3,}/.test(normalized)) {
        responsePlaceholderCells++;
      }
    }

    if (
      nonEmptyCells > 0
      && pipeCells > 0
      && pipeCells + naCells === nonEmptyCells
      && responsePlaceholderCells === 0
    ) {
      detected.add(colIndex + 1);
    }
  }

  return detected;
}

function detectAllocationReferenceColumns(ctx: EntryContext): AllocationReferenceColumnDecision {
  const originalItems = ctx.substantiveItems;
  const grid = originalItems.length > 1 ? analyzeGridStructure(originalItems) : null;
  if (!grid) {
    return { items: originalItems, suppressedColumns: [], notes: [], inputsUsed: [] };
  }

  const scoreByCol = new Map<number, number>();
  const reasonByCol = new Map<number, string[]>();
  const addSignal = (col: number, score: number, reason: string): void => {
    scoreByCol.set(col, (scoreByCol.get(col) || 0) + score);
    const existing = reasonByCol.get(col) || [];
    if (!existing.includes(reason)) existing.push(reason);
    reasonByCol.set(col, existing);
  };

  for (const col of grid.cols) {
    const colCells = grid.byCol.get(col) || [];
    if (ctx.entry.pipeColumns.includes(`c${col}`)) {
      addSignal(col, 4, 'entry pipe-column detection');
    }
    if (colCells.length > 0 && colCells.every(cell => Number(cell.item.itemBase ?? 0) === 0)) {
      addSignal(col, 4, 'all items have zero base');
    }
  }

  const surveyPipeCols = detectSurveyPipeDisplayColumns(ctx.entry.surveyText, grid.colCount);
  for (const col of surveyPipeCols) {
    addSignal(col, 3, 'survey table cells are pipe-only');
  }

  const suppressedCols = grid.cols.filter(col => (scoreByCol.get(col) || 0) >= 3);
  if (suppressedCols.length === 0 || suppressedCols.length >= grid.colCount) {
    return { items: originalItems, suppressedColumns: [], notes: [], inputsUsed: [] };
  }

  const suppressedSet = new Set(suppressedCols);
  const filteredItems = originalItems.filter((item) => {
    const coord = parseGridCoord(item.column);
    return coord ? !suppressedSet.has(coord.col) : true;
  });

  if (filteredItems.length === 0 || filteredItems.length === originalItems.length) {
    return { items: originalItems, suppressedColumns: [], notes: [], inputsUsed: [] };
  }

  const suppressedColumns = suppressedCols.map(col => `c${col}`);
  const reasonSummary = suppressedCols
    .map((col) => {
      const reasons = reasonByCol.get(col) || [];
      return reasons.length > 0 ? `c${col} (${reasons.join(', ')})` : `c${col}`;
    })
    .join('; ');

  return {
    items: filteredItems,
    suppressedColumns,
    notes: [`Reference/display-only columns suppressed before allocation packaging: ${reasonSummary}.`],
    inputsUsed: ['pipeColumns', 'surveyText', 'items[].itemBase'],
  };
}

// =============================================================================
// Conceptual grid detection (c-suffix items with identical scale labels)
// =============================================================================

const CONCEPTUAL_GRID_COL_SUFFIX_RE = /c(\d+)$/i;

function analyzeConceptualGridStructure(items: QuestionItem[], analyticalSubtype: string): ConceptualGridAnalysis | null {
  if (analyticalSubtype !== 'standard') return null;
  if (items.length < 2) return null;

  const rXcYPattern = /r\d+c\d+/i;
  const colIndices: number[] = [];
  const itemsByCol = new Map<number, QuestionItem>();

  for (const item of items) {
    if (rXcYPattern.test(item.column)) return null;
    const m = item.column.match(CONCEPTUAL_GRID_COL_SUFFIX_RE);
    if (!m) return null;
    const idx = Number(m[1]);
    colIndices.push(idx);
    itemsByCol.set(idx, item);
  }

  // All items must have scale labels
  const scaleSets: string[] = [];
  for (const item of items) {
    const sl = item.scaleLabels;
    if (!sl || sl.length === 0) return null;
    scaleSets.push(sl.map(s => `${s.value}:${s.label}`).join('|'));
  }

  // Scale labels must be identical across all items
  if (new Set(scaleSets).size !== 1) return null;

  const cols = [...new Set(colIndices)].sort((a, b) => a - b);
  const scaleLabels = items[0].scaleLabels!;

  return {
    cols,
    colCount: cols.length,
    scaleLabels,
    scaleCount: scaleLabels.length,
    itemsByCol,
  };
}

// =============================================================================
// Item diagnostics
// =============================================================================

function computeItemDiagnostics(items: QuestionItem[], analyticalSubtype?: string): { gridDims: string | null; maxValueCount: number | null } {
  const grid = items.length > 1 ? analyzeGridStructure(items) : null;
  if (grid) {
    return { gridDims: `${grid.rowCount}r\u00d7${grid.colCount}c`, maxValueCount: null };
  }
  const cGrid = items.length > 1 ? analyzeConceptualGridStructure(items, analyticalSubtype || '') : null;
  if (cGrid) {
    return { gridDims: `${cGrid.scaleCount}v\u00d7${cGrid.colCount}c*`, maxValueCount: null };
  }
  const valueCounts = items
    .map(it => it.scaleLabels?.length ?? 0)
    .filter(n => n > 0);
  const maxValueCount = valueCounts.length > 0 ? Math.max(...valueCounts) : null;
  return { gridDims: null, maxValueCount };
}

// =============================================================================
// PlannedTable factory
// =============================================================================

function resolvePlannerComparability(ctx: EntryContext): PlannerBaseComparability {
  if (ctx.basePlanning.comparabilityStatus === 'split_recommended' && !ctx.basePlanning.materialSplit) {
    return 'varying_but_acceptable';
  }
  return ctx.basePlanning.comparabilityStatus;
}

function buildTableComputeRiskSignals(
  ctx: EntryContext,
  baseViewRole: PlannedTableBaseViewRole,
  tableContract: PlannedTable['baseContract'],
): ComputeRiskSignal[] {
  const out: ComputeRiskSignal[] = [...ctx.basePlanning.computeRiskSignals];

  if (
    tableContract.policy.effectiveBaseMode === 'table_mask_then_row_observed_n'
    && (
      tableContract.classification.referenceUniverse === 'question'
      || tableContract.classification.referenceUniverse === 'cluster'
      || tableContract.policy.rebasePolicy !== 'none'
      || tableContract.signals.includes('filtered-base')
      || tableContract.signals.includes('compute-mask-required')
    )
  ) {
    out.push('compute-mask-required');
  }

  if (baseViewRole === 'anchor' && ctx.basePlanning.hasVaryingItemBases) {
    out.push('row-base-varies-within-anchor-view');
  }

  return uniqueList(out);
}

// ---------------------------------------------------------------------------
// Base disclosure builder — planner-owned (Phase B)
// ---------------------------------------------------------------------------

/**
 * Build a planner-owned base disclosure for a planned table.
 * This front-loads base text and note token decisions so assembly
 * and triage don't need to re-derive them.
 */
export function buildPlannerBaseDisclosure(
  planned: Pick<PlannedTable,
    'baseViewRole' | 'plannerBaseComparability' | 'plannerBaseSignals'
    | 'baseContract' | 'basePolicy' | 'questionBase' | 'itemBase'
    | 'appliesToItem' | 'sourceQuestionId' | 'familyRoot'
  >,
  entry: QuestionIdEntry | undefined,
): CanonicalBaseDisclosure {
  const contract = planned.baseContract;
  const hasContractData = Boolean(
    planned.baseViewRole
    || planned.plannerBaseComparability
    || (planned.plannerBaseSignals && planned.plannerBaseSignals.length > 0)
    || contract.classification.situation
    || contract.classification.referenceUniverse
    || contract.classification.comparabilityStatus
    || contract.policy.effectiveBaseMode
    || contract.policy.rebasePolicy !== 'none'
    || contract.signals.length > 0
    || contract.reference.itemBaseRange
    || contract.reference.questionBase != null
    || contract.reference.totalN != null,
  );

  if (!hasContractData) {
    return buildPlannerLegacyBaseDisclosure(planned, entry);
  }

  const itemBaseRange = contract.reference.itemBaseRange ?? null;
  const plannerComparability = planned.plannerBaseComparability
    ?? contract.classification.comparabilityStatus
    ?? 'shared';
  const baseViewRole = planned.baseViewRole ?? 'anchor';
  const hasRangeDisclosure = (
    baseViewRole === 'anchor'
    && plannerComparability !== 'shared'
    && itemBaseRange != null
    && itemBaseRange[0] !== itemBaseRange[1]
  );

  const defaultNoteTokens: CanonicalBaseNoteToken[] = [];
  if (
    baseViewRole === 'anchor'
    && plannerComparability !== 'shared'
    && (
      hasRangeDisclosure
      || contract.signals.includes('varying-item-bases')
      || (planned.plannerBaseSignals ?? []).includes('varying-item-bases')
    )
  ) {
    defaultNoteTokens.push('anchor-base-varies-by-item');
  }
  if (hasRangeDisclosure) {
    defaultNoteTokens.push('anchor-base-range');
  }
  if (contract.policy.rebasePolicy !== 'none') {
    defaultNoteTokens.push('rebased-exclusion');
  }
  if (planned.plannerBaseSignals?.includes('low-base')) {
    defaultNoteTokens.push('low-base-caution');
  }

  return {
    referenceBaseN: resolvePlannerReferenceBaseN(planned),
    itemBaseRange,
    defaultBaseText: buildPlannerContractBaseText(planned, entry),
    defaultNoteTokens: Array.from(new Set(defaultNoteTokens)),
    excludedResponseLabels: contract.policy.rebasePolicy !== 'none'
      ? getExcludedResponseLabelsFromEntry(entry)
      : [],
    rangeDisclosure: hasRangeDisclosure
      ? { min: itemBaseRange[0], max: itemBaseRange[1] }
      : null,
    source: 'contract',
  };
}

function buildPlannerLegacyBaseDisclosure(
  planned: Pick<PlannedTable, 'basePolicy' | 'questionBase' | 'itemBase' | 'baseContract' | 'appliesToItem' | 'sourceQuestionId' | 'familyRoot'>,
  entry: QuestionIdEntry | undefined,
): CanonicalBaseDisclosure {
  return {
    referenceBaseN: resolvePlannerReferenceBaseN(planned),
    itemBaseRange: null,
    defaultBaseText: buildPlannerLegacyBaseText(planned, entry),
    defaultNoteTokens: planned.basePolicy.includes('rebased')
      ? ['rebased-exclusion']
      : [],
    excludedResponseLabels: planned.basePolicy.includes('rebased')
      ? getExcludedResponseLabelsFromEntry(entry)
      : [],
    rangeDisclosure: null,
    source: 'legacy_fallback',
  };
}

function resolvePlannerReferenceBaseN(
  planned: Pick<PlannedTable, 'basePolicy' | 'questionBase' | 'itemBase' | 'baseContract'>,
): number | null {
  const referenceUniverse = planned.baseContract.classification.referenceUniverse;

  if (
    planned.basePolicy.includes('item_base')
    && planned.itemBase != null
    && referenceUniverse !== 'cluster'
  ) {
    return planned.itemBase;
  }

  if (planned.questionBase != null) {
    return planned.questionBase;
  }

  return planned.itemBase ?? null;
}

function buildPlannerContractBaseText(
  planned: Pick<PlannedTable, 'baseViewRole' | 'baseContract' | 'basePolicy' | 'itemBase' | 'appliesToItem' | 'sourceQuestionId' | 'familyRoot'>,
  entry: QuestionIdEntry | undefined,
): string {
  const contract = planned.baseContract;
  const isModelDerived =
    contract.classification.referenceUniverse === 'model'
    || contract.classification.situation === 'model_derived'
    || contract.signals.includes('model-derived-base');
  const isCluster =
    contract.classification.referenceUniverse === 'cluster'
    || planned.basePolicy.includes('cluster_base');
  const isFiltered =
    contract.signals.includes('filtered-base')
    || contract.classification.referenceUniverse === 'question'
    || (entry?.isFiltered === true && contract.classification.referenceUniverse == null);
  const isItemPrecision =
    planned.baseViewRole === 'precision'
    && planned.itemBase != null
    && planned.appliesToItem != null
    && !isCluster
    && !isModelDerived;
  const usesRankingArtifactSharedBase =
    planned.baseViewRole === 'precision'
    && contract.classification.variationClass === 'ranking_artifact'
    && planned.appliesToItem != null;

  if (isModelDerived) {
    return 'Model-derived base';
  }
  if (isCluster) {
    return 'Population cluster';
  }

  // General guard: if the table's effective base equals the total sample,
  // no filtering occurred — use "Total respondents" regardless of how the
  // table was planned (item precision, variable item bases, etc.).
  const totalN = contract.reference.totalN;
  const effectiveBase = planned.itemBase ?? contract.reference.questionBase ?? totalN;
  if (totalN != null && effectiveBase != null && effectiveBase === totalN) {
    return 'Total respondents';
  }

  if (isItemPrecision && !usesRankingArtifactSharedBase) {
    const itemLabel = resolvePlannerPrecisionItemLabel(entry, planned.appliesToItem);
    return itemLabel
      ? `Respondents shown ${itemLabel}`
      : 'Respondents shown selected item';
  }
  if (isFiltered) {
    return `Those who were shown ${resolvePlannerQuestionReferenceLabel(entry, planned)}`;
  }
  return 'Total respondents';
}

function buildPlannerLegacyBaseText(
  planned: Pick<PlannedTable, 'basePolicy' | 'appliesToItem' | 'sourceQuestionId' | 'familyRoot'>,
  entry: QuestionIdEntry | undefined,
): string {
  if (planned.basePolicy.includes('cluster_base')) {
    return 'Population cluster';
  }
  if (planned.basePolicy.includes('rebased')) {
    return 'Total respondents';
  }
  if (planned.basePolicy.includes('item_base') && planned.appliesToItem) {
    // Item-level guard: if this item's base equals totalN, no filtering occurred
    const item = entry?.items?.find(i => i.column === planned.appliesToItem);
    if (item?.itemBase != null && entry?.totalN != null && item.itemBase === entry.totalN) {
      return 'Total respondents';
    }
    const itemLabel = resolvePlannerPrecisionItemLabel(entry, planned.appliesToItem);
    return itemLabel
      ? `Respondents shown ${itemLabel}`
      : 'Respondents shown selected item';
  }
  // Question-level guard: if question base equals total sample, use "Total respondents"
  if (entry?.totalN != null && entry.questionBase != null && entry.questionBase === entry.totalN) {
    return 'Total respondents';
  }
  if (entry?.isFiltered) {
    return `Those who were shown ${resolvePlannerQuestionReferenceLabel(entry, planned)}`;
  }
  return 'Total respondents';
}

function resolvePlannerQuestionReferenceLabel(
  entry: QuestionIdEntry | undefined,
  planned: Pick<PlannedTable, 'sourceQuestionId' | 'familyRoot'>,
): string {
  const value = entry?.displayQuestionId
    || entry?.questionId
    || planned.sourceQuestionId
    || planned.familyRoot;
  return value || 'this question';
}

function resolvePlannerPrecisionItemLabel(
  entry: QuestionIdEntry | undefined,
  itemColumn: string | null,
): string | null {
  if (!entry || !itemColumn) return null;
  const item = entry.items?.find(candidate => candidate.column === itemColumn);
  if (!item) return null;
  // For base text, prefer the cleanest human-readable label
  const label = (item.surveyLabel || item.label || '').trim();
  if (!label || label === itemColumn) return null;
  return label;
}

function buildPlannedTable(
  ctx: EntryContext,
  params: {
    tableKind: TableKind;
    tableRole: string;
    tableIdSuffix: string;
    basePolicy: string;
    baseSource: string;
    appliesToItem?: QuestionItem | null;
    appliesToItemKey?: string | null;
    appliesToColumn?: string | null;
    notes?: string[];
    inputsUsed?: string[];
    splitReason?: string | null;
    questionBase?: number | null;
    itemBase?: number | null;
    stimuliSetSlice?: PlannedTable['stimuliSetSlice'];
    binarySide?: PlannedTable['binarySide'];
  },
): PlannedTable {
  const item = params.appliesToItem || null;
  const questionBase = params.questionBase === undefined ? ctx.basePlanning.questionBase : params.questionBase;
  const itemBase = params.itemBase === undefined ? (item ? item.itemBase : null) : params.itemBase;
  const baseViewRole = classifyBaseViewRole(params.tableKind, params.tableRole);
  const plannerBaseComparability = resolvePlannerComparability(ctx);
  const baseContract = projectTableBaseContract(ctx.entry.baseContract, {
    basePolicy: params.basePolicy,
    questionBase,
    itemBase,
  });
  const plannerBaseSignals = uniqueList([
    ...ctx.basePlanning.signals,
    ...baseContract.signals,
    ...(([questionBase, itemBase].filter((n): n is number => n != null && Number.isFinite(n) && n < LOW_BASE_THRESHOLD).length > 0)
      ? ['low-base' as const]
      : []),
  ]);
  const computeRiskSignals = buildTableComputeRiskSignals(ctx, baseViewRole, baseContract);

  const appliesToItem = params.appliesToItemKey !== undefined
    ? params.appliesToItemKey
    : (item ? item.column : null);
  const computeMaskAnchorVariable = item?.column ?? null;

  const planned: PlannedTable = {
    dataset: ctx.dataset,
    sourceQuestionId: ctx.entry.questionId,
    sourceLoopQuestionId: ctx.entry.loopQuestionId,
    familyRoot: ctx.familyRoot,
    analyticalSubtype: ctx.entry.analyticalSubtype || 'null',
    normalizedType: ctx.entry.normalizedType || 'unknown',
    tableKind: params.tableKind,
    tableRole: params.tableRole,
    tableIdCandidate: createTableIdCandidate(ctx.familyRoot, params.tableIdSuffix),
    sortBlock: ctx.sortBlock,
    sortFamily: ctx.sortFamily,
    basePolicy: params.basePolicy,
    baseSource: params.baseSource,
    splitReason: params.splitReason === undefined ? ctx.splitReason : params.splitReason,
    baseViewRole,
    plannerBaseComparability,
    plannerBaseSignals,
    computeRiskSignals,
    questionBase,
    itemBase,
    baseContract,
    appliesToItem,
    computeMaskAnchorVariable,
    appliesToColumn: params.appliesToColumn || null,
    stimuliSetSlice: params.stimuliSetSlice ?? null,
    binarySide: params.binarySide ?? null,
    notes: params.notes || [],
    inputsUsed: params.inputsUsed || [],
  };

  planned.baseDisclosure = buildPlannerBaseDisclosure(planned, ctx.entry);

  return planned;
}

function clonePerSetSummaryTable(
  table: PlannedTable,
  slice: EntryStimuliSetSlice,
  params?: {
    tableIdSuffix?: string;
    tableRole?: string;
    notes?: string[];
    binarySide?: PlannedTable['binarySide'];
  },
): PlannedTable {
  const setToken = `set${slice.setIndex + 1}`;
  const suffix = params?.tableIdSuffix || `${table.tableIdCandidate.split('__').pop() || sanitizeToken(table.tableRole)}_${setToken}`;
  return {
    ...table,
    tableIdCandidate: createTableIdCandidate(table.familyRoot, suffix),
    tableRole: params?.tableRole || table.tableRole,
    splitReason: 'stimuli_set_slice',
    appliesToColumn: slice.columns.join(','),
    stimuliSetSlice: {
      familySource: slice.familySource,
      setIndex: slice.setIndex,
      setLabel: slice.setLabel,
      sourceQuestionId: slice.sourceQuestionId,
    },
    binarySide: params?.binarySide ?? null,
    baseContract: projectTableBaseContract(table.baseContract, {
      basePolicy: table.basePolicy,
      questionBase: table.questionBase,
      itemBase: table.itemBase,
    }),
    notes: [
      ...table.notes,
      `Stimuli set slice: ${slice.setLabel} from ${slice.familySource}.`,
      ...(params?.notes || []),
    ],
  };
}

function hasUniformTwoValueBinaryLikeItems(items: QuestionItem[]): boolean {
  if (items.length === 0) return false;

  return items.every(item => {
    const scaleLabels = item.scaleLabels ?? [];
    if (scaleLabels.length !== 2) return false;

    const numericValues = scaleLabels
      .map(label => Number(label.value))
      .filter(value => !Number.isNaN(value));
    return numericValues.length === 2;
  });
}

function shouldCreateStimuliSetBinarySplit(
  ctx: EntryContext,
  overrides?: PlannerOverrides,
): boolean {
  if (!ctx.isMessageTestingSurvey || overrides?.skipBinarySplit) return false;
  if (ctx.stimuliSetSlices.length === 0) return false;

  return (
    ctx.entry.normalizedType === 'binary_flag'
    || (
      ctx.entry.normalizedType === 'categorical_select'
      && hasUniformTwoValueBinaryLikeItems(ctx.substantiveItems)
    )
  );
}

/**
 * Detect selection exercise pattern: many items with identical 2-value labels,
 * varying bases, and at least one item with base=0 (nobody selected that option).
 *
 * Selection exercises (story highlighting, "highlight what's compelling") differ
 * from genuine routing: NA means "not selected", not "not shown". All respondents
 * saw all items. The question base should be the denominator, not per-item counts.
 *
 * B800-like routing (Yes/No follow-ups with show logic) is excluded because
 * routed items always have some respondents (no base=0 items).
 */
function isSelectionExercisePattern(ctx: EntryContext): boolean {
  if (ctx.substantiveItems.length < 5) return false;
  if (!hasUniformTwoValueBinaryLikeItems(ctx.substantiveItems)) return false;
  if (!ctx.basePlanning.hasVaryingItemBases) return false;

  const questionBase = ctx.entry.questionBase;
  if (questionBase == null || questionBase <= 0) return false;

  const bases = ctx.substantiveItems.map(it => it.itemBase);
  const hasZeroBase = bases.some(b => b === 0);
  const maxBase = Math.max(...bases);

  // At least one item with base=0 (nobody selected it — smoking gun for selection exercise)
  // AND question base is substantially larger than any individual item base
  return hasZeroBase && questionBase > maxBase * 1.5;
}

// =============================================================================
// Table planning — standard frequency
// =============================================================================

function planStandardFrequencyTables(ctx: EntryContext, notes: string[] = [], extraInputs: string[] = [], overrides?: PlannerOverrides): PlannedTable[] {
  const out: PlannedTable[] = [];
  const isMulti = ctx.substantiveItems.length > 1;
  const shouldAddPrecisionFallback = ctx.precisionRouting === 'item_detail';
  const shouldAddClusterPrecision = ctx.precisionRouting === 'cluster';

  // Check for 2D grid structure (rXcY pattern in item columns)
  const grid = isMulti ? analyzeGridStructure(ctx.substantiveItems) : null;

  if (grid) {
    // Grid detected: emit row-major and col-major tables
    for (const rowNum of grid.rows) {
      const rowCells = (grid.byRow.get(rowNum) || []).sort((a, b) => a.coord.col - b.coord.col);
      if (rowCells.length === 0) continue;
      const repItem = rowCells[0].item;
      const rowColumns = rowCells.map(c => c.item.column);

      out.push(buildPlannedTable(ctx, {
        tableKind: 'grid_row_detail',
        tableRole: 'grid_row_slice',
        tableIdSuffix: `grid_row_r${rowNum}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: repItem,
        appliesToItemKey: `r${rowNum}`,
        appliesToColumn: rowColumns.join(','),
        notes: [
          `Grid row-major view: row ${rowNum} of ${grid.rowCount} (${rowCells.length} columns).`,
          `Grid dimensions: ${grid.rowCount} rows \u00d7 ${grid.colCount} cols = ${grid.cells.length} cells.`,
          ...notes,
        ],
        inputsUsed: ['items[].column', 'grid_structure', ...extraInputs],
      }));
    }

    for (const colNum of grid.cols) {
      const colCells = (grid.byCol.get(colNum) || []).sort((a, b) => a.coord.row - b.coord.row);
      if (colCells.length === 0) continue;
      const repItem = colCells[0].item;
      const colColumns = colCells.map(c => c.item.column);

      out.push(buildPlannedTable(ctx, {
        tableKind: 'grid_col_detail',
        tableRole: 'grid_col_slice',
        tableIdSuffix: `grid_col_c${colNum}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: repItem,
        appliesToItemKey: `c${colNum}`,
        appliesToColumn: colColumns.join(','),
        notes: [
          `Grid col-major view: column ${colNum} of ${grid.colCount} (${colCells.length} rows).`,
          `Grid dimensions: ${grid.rowCount} rows \u00d7 ${grid.colCount} cols = ${grid.cells.length} cells.`,
          ...notes,
        ],
        inputsUsed: ['items[].column', 'grid_structure', ...extraInputs],
      }));
    }
  } else {
    // Check for conceptual grid (c-suffix items with identical scale labels)
    const conceptualGrid = (isMulti && !overrides?.skipConceptualGrid)
      ? analyzeConceptualGridStructure(ctx.substantiveItems, ctx.entry.analyticalSubtype || '')
      : null;

    if (conceptualGrid) {
      // Col-major: one table per item
      for (const colNum of conceptualGrid.cols) {
        const item = conceptualGrid.itemsByCol.get(colNum);
        if (!item) continue;

        out.push(buildPlannedTable(ctx, {
          tableKind: 'grid_col_detail',
          tableRole: 'grid_col_slice',
          tableIdSuffix: `cgrid_col_c${colNum}`,
          basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
          baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
          appliesToItem: item,
          appliesToItemKey: `c${colNum}`,
          appliesToColumn: item.column,
          notes: [
            `Conceptual grid col view: column ${colNum} of ${conceptualGrid.colCount} (${conceptualGrid.scaleCount} scale points).`,
            `Conceptual grid dimensions: ${conceptualGrid.scaleCount} scale points \u00d7 ${conceptualGrid.colCount} items.`,
            ...notes,
          ],
          inputsUsed: ['items[].column', 'items[].scaleLabels', 'conceptual_grid_structure', ...extraInputs],
        }));
      }

      // Row-major: one table per scale value
      for (let i = 0; i < conceptualGrid.scaleLabels.length; i++) {
        const sl = conceptualGrid.scaleLabels[i];
        const allColumns = conceptualGrid.cols.map(c => conceptualGrid.itemsByCol.get(c)!.column);
        const repItem = conceptualGrid.itemsByCol.get(conceptualGrid.cols[0])!;

        out.push(buildPlannedTable(ctx, {
          tableKind: 'grid_row_detail',
          tableRole: 'grid_row_slice',
          tableIdSuffix: `cgrid_row_v${sl.value}`,
          basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
          baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
          appliesToItem: repItem,
          appliesToItemKey: `v${sl.value}`,
          appliesToColumn: allColumns.join(','),
          notes: [
            `Conceptual grid row view: scale value ${sl.value} "${sl.label}" (${conceptualGrid.colCount} items).`,
            `Conceptual grid dimensions: ${conceptualGrid.scaleCount} scale points \u00d7 ${conceptualGrid.colCount} items.`,
            ...notes,
          ],
          inputsUsed: ['items[].column', 'items[].scaleLabels', 'conceptual_grid_structure', ...extraInputs],
        }));
      }
    } else {
      // No grid or degenerate grid: emit standard overview
      const selectionExercise = isSelectionExercisePattern(ctx);
      out.push(buildPlannedTable(ctx, {
        tableKind: 'standard_overview',
        tableRole: 'overview',
        tableIdSuffix: 'standard_overview',
        basePolicy: selectionExercise ? 'selection_exercise_shared' : 'question_base_shared',
        baseSource: 'questionBase',
        notes: [
          ...notes,
          ...(selectionExercise
            ? ['Selection exercise detected: using shared table base for all rows (NA = not selected, not not shown).']
            : ctx.basePlanning.hasVaryingItemBases
              ? ['Anchor overview retained even though row bases may vary by item.']
              : []),
        ],
        inputsUsed: ['analyticalSubtype', 'normalizedType', 'variableCount', 'hasVariableItemBases', 'variableBaseReason', ...extraInputs],
      }));
    }
  }

  const binaryStimuliSetSplit = shouldCreateStimuliSetBinarySplit(ctx, overrides);
  const overviewTables = out.filter(table =>
    table.tableKind === 'standard_overview' && table.stimuliSetSlice === null,
  );
  if (overviewTables.length > 0 && ctx.stimuliSetSlices.length > 0 && !overrides?.skipStimuliSets) {
    if (binaryStimuliSetSplit) {
      for (const overview of overviewTables) {
        const index = out.indexOf(overview);
        if (index >= 0) out.splice(index, 1);
      }
    }

    for (const overview of overviewTables) {
      for (const slice of ctx.stimuliSetSlices) {
        if (binaryStimuliSetSplit) {
          out.push(clonePerSetSummaryTable(overview, slice, {
            tableIdSuffix: `${sanitizeToken(overview.tableRole)}_selected_set${slice.setIndex + 1}`,
            tableRole: `${overview.tableRole}_selected_set_${slice.setIndex + 1}`,
            notes: ['Selected-side per-set binary summary.'],
            binarySide: 'selected',
          }));
          out.push(clonePerSetSummaryTable(overview, slice, {
            tableIdSuffix: `${sanitizeToken(overview.tableRole)}_unselected_set${slice.setIndex + 1}`,
            tableRole: `${overview.tableRole}_unselected_set_${slice.setIndex + 1}`,
            notes: ['Not-selected per-set binary summary.'],
            binarySide: 'unselected',
          }));
          continue;
        }

        out.push(clonePerSetSummaryTable(overview, slice, {
          tableIdSuffix: `${sanitizeToken(overview.tableRole)}_set${slice.setIndex + 1}`,
          tableRole: `${overview.tableRole}_set_${slice.setIndex + 1}`,
        }));
      }
    }
  }

  // Cluster detail tables for non-grid genuine-split questions
  const conceptualGridForCluster = isMulti && !grid
    ? analyzeConceptualGridStructure(ctx.substantiveItems, ctx.entry.analyticalSubtype || '')
    : null;
  if (shouldAddClusterPrecision && isMulti && !grid && !conceptualGridForCluster && ctx.clusterAnalysis) {
    const { routingType, populationClusters } = ctx.clusterAnalysis;

    if (routingType === 'population') {
      for (const cluster of populationClusters) {
        const markerItems = cluster.items.map(it => it.column);
        out.push(buildPlannedTable(ctx, {
          tableKind: 'standard_cluster_detail',
          tableRole: 'cluster_detail',
          tableIdSuffix: `standard_cluster_n${cluster.base}`,
          basePolicy: 'cluster_base',
          baseSource: `cluster(n=${cluster.base}, markers=[${markerItems.join(',')}])`,
          notes: [
            `Population cluster: base=${cluster.base}, ${cluster.items.length} exclusive item(s).`,
            `Marker items (identify population): ${markerItems.join(', ')}.`,
            `Table should show ALL question items among respondents where any marker item is non-NA.`,
          ],
          inputsUsed: ['hasVariableItemBases', 'variableBaseReason', 'items[].itemBase', 'totalN', ...extraInputs],
        }));
      }
    }
  }

  if (shouldAddPrecisionFallback && isMulti && !grid && !conceptualGridForCluster) {
    for (const item of ctx.substantiveItems) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'standard_item_detail',
        tableRole: 'item_detail',
        tableIdSuffix: `standard_item_${sanitizeToken(item.column)}`,
        basePolicy: 'item_base',
        baseSource: 'items[].itemBase',
        appliesToItem: item,
        notes: [
          'Precision item detail emitted because varying item bases were materially different.',
          ...notes,
        ],
        inputsUsed: ['items[].itemBase', 'baseContract.classification.comparabilityStatus', ...extraInputs],
      }));
    }
  }

  return out;
}

// =============================================================================
// Table planning — standard numeric
// =============================================================================

function planStandardNumericTables(ctx: EntryContext): PlannedTable[] {
  const out: PlannedTable[] = [];
  const isMulti = ctx.substantiveItems.length > 1;
  const baseNotes = ['Numeric range stats package: mean, mean-no-outliers, median, std dev, binned distribution.'];

  if (!isMulti) {
    const item = ctx.substantiveItems[0] || null;
    out.push(buildPlannedTable(ctx, {
      tableKind: 'numeric_item_detail',
      tableRole: 'item_detail',
      tableIdSuffix: item ? `numeric_item_${sanitizeToken(item.column)}` : 'numeric_item_single',
      basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
      baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
      appliesToItem: item,
      notes: baseNotes,
      inputsUsed: ['normalizedType', 'variableCount', 'items[].scaleLabels', 'questionBase'],
    }));

    // Per-value distribution table (single-item, non-allocation, nUnique <= 50)
    if (item && ctx.entry.analyticalSubtype !== 'allocation'
        && item.nUnique != null && item.nUnique <= 50
        && item.observedValues && item.observedValues.length > 0) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'numeric_per_value_detail',
        tableRole: 'item_detail',
        tableIdSuffix: `numeric_pervalue_${sanitizeToken(item.column)}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: item,
        notes: [`Per-value distribution: ${item.nUnique} observed values.`, ...baseNotes],
        inputsUsed: ['normalizedType', 'items[].observedValues', 'items[].nUnique'],
      }));
    }

    // Optimized binning from observed range (single-item, non-allocation)
    if (item && ctx.entry.analyticalSubtype !== 'allocation'
        && item.observedMin != null && item.observedMax != null) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'numeric_optimized_bin_detail',
        tableRole: 'item_detail',
        tableIdSuffix: `numeric_optbin_${sanitizeToken(item.column)}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: item,
        notes: [`Optimized bins: observed range [${item.observedMin}, ${item.observedMax}].`, ...baseNotes],
        inputsUsed: ['normalizedType', 'items[].observedMin', 'items[].observedMax'],
      }));
    }

    return out;
  }

  const grid = analyzeGridStructure(ctx.substantiveItems);

  if (grid) {
    // Col-major
    for (const colNum of grid.cols) {
      const colCells = (grid.byCol.get(colNum) || []).sort((a, b) => a.coord.row - b.coord.row);
      if (colCells.length === 0) continue;
      const repItem = colCells[0].item;
      const colColumns = colCells.map(c => c.item.column);

      out.push(buildPlannedTable(ctx, {
        tableKind: 'grid_col_detail',
        tableRole: 'grid_col_slice',
        tableIdSuffix: `numeric_grid_col_c${colNum}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: repItem,
        appliesToItemKey: `c${colNum}`,
        appliesToColumn: colColumns.join(','),
        notes: [
          `Numeric grid col-major view: column ${colNum} of ${grid.colCount} (${colCells.length} rows).`,
          `Grid dimensions: ${grid.rowCount} rows \u00d7 ${grid.colCount} cols = ${grid.cells.length} cells.`,
          ...baseNotes,
        ],
        inputsUsed: ['items[].column', 'grid_structure', 'normalizedType'],
      }));
    }

    // Row-major
    for (const rowNum of grid.rows) {
      const rowCells = (grid.byRow.get(rowNum) || []).sort((a, b) => a.coord.col - b.coord.col);
      if (rowCells.length === 0) continue;
      const repItem = rowCells[0].item;
      const rowColumns = rowCells.map(c => c.item.column);

      out.push(buildPlannedTable(ctx, {
        tableKind: 'grid_row_detail',
        tableRole: 'grid_row_slice',
        tableIdSuffix: `numeric_grid_row_r${rowNum}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: repItem,
        appliesToItemKey: `r${rowNum}`,
        appliesToColumn: rowColumns.join(','),
        notes: [
          `Numeric grid row-major view: row ${rowNum} of ${grid.rowCount} (${rowCells.length} columns).`,
          `Grid dimensions: ${grid.rowCount} rows \u00d7 ${grid.colCount} cols = ${grid.cells.length} cells.`,
          ...baseNotes,
        ],
        inputsUsed: ['items[].column', 'grid_structure', 'normalizedType'],
      }));
    }
  } else {
    // No grid: overview + per-item detail
    out.push(buildPlannedTable(ctx, {
      tableKind: 'numeric_overview_mean',
      tableRole: 'overview',
      tableIdSuffix: 'numeric_overview_mean',
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      notes: ['Overview means across all items.', ...baseNotes],
      inputsUsed: ['normalizedType', 'variableCount', 'questionBase'],
    }));

    for (const item of ctx.substantiveItems) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'numeric_item_detail',
        tableRole: 'item_detail',
        tableIdSuffix: `numeric_item_${sanitizeToken(item.column)}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: item,
        notes: baseNotes,
        inputsUsed: ['hasVariableItemBases', 'variableBaseReason', 'items[].itemBase', 'questionBase'],
      }));
    }
  }

  return out;
}

// =============================================================================
// Table planning — ranking
// =============================================================================

function planRankingTables(ctx: EntryContext, ambiguities: PlannerAmbiguity[], overrides?: PlannerOverrides): PlannedTable[] {
  const out: PlannedTable[] = [];
  const rd = ctx.entry.rankingDetail;

  if (!rd) {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'ranking_detail_missing',
      detail: 'rankingDetail missing; planner falls back to standard frequency behavior.',
    });

    return planStandardFrequencyTables(
      {
        ...ctx,
        splitReason: 'ranking_detail_missing_fallback',
      },
      ['Ranking subtype without rankingDetail -> fallback standard frequency plan.'],
      ['rankingDetail'],
    );
  }

  const k = rd.K;
  const overviewRankLevels = k;

  for (let r = 1; r <= overviewRankLevels; r++) {
    out.push(buildPlannedTable(ctx, {
      tableKind: 'ranking_overview_rank',
      tableRole: `overview_rank_${r}`,
      tableIdSuffix: `ranking_overview_rank${r}`,
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      notes: [`Rank ${r} overview: all items as rows showing % ranked #${r}.`],
      inputsUsed: ['rankingDetail.K', 'rankingDetail.N', 'questionBase'],
    }));
  }

  if (k >= 2) {
    const topKMax = Math.max(3, k - 1);
    for (let t = 2; t <= topKMax; t++) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'ranking_overview_topk',
        tableRole: `overview_top${t}`,
        tableIdSuffix: `ranking_overview_top${t}`,
        basePolicy: 'question_base_shared',
        baseSource: 'questionBase',
        notes: [`Top ${t} overview: all items as rows showing cumulative % ranked in top ${t}.`],
        inputsUsed: ['rankingDetail.K', 'questionBase'],
      }));
    }
  }

  if (ctx.stimuliSetSlices.length > 0 && !overrides?.skipStimuliSets) {
    const overviewTables = out.filter(table =>
      table.tableKind === 'ranking_overview_rank' || table.tableKind === 'ranking_overview_topk',
    );

    for (const slice of ctx.stimuliSetSlices) {
      for (const overview of overviewTables) {
        out.push(clonePerSetSummaryTable(overview, slice, {
          tableIdSuffix: `${sanitizeToken(overview.tableRole)}_set${slice.setIndex + 1}`,
          tableRole: `${overview.tableRole}_set_${slice.setIndex + 1}`,
        }));
      }
    }
  }

  for (const item of ctx.substantiveItems) {
    const itemBasePolicy = ctx.genuineSplit ? 'item_base' : 'question_base_shared';
    const itemBaseSource = ctx.genuineSplit ? 'items[].itemBase' : 'questionBase';

    out.push(buildPlannedTable(ctx, {
      tableKind: 'ranking_item_rank',
      tableRole: 'item_rank_detail',
      tableIdSuffix: `ranking_item_rank_${sanitizeToken(item.column)}`,
      basePolicy: itemBasePolicy,
      baseSource: itemBaseSource,
      appliesToItem: item,
      notes: [`Item-centric rank distribution through Rank ${k}.`],
      inputsUsed: ['rankingDetail.K', 'hasVariableItemBases', 'variableBaseReason', 'items[].itemBase'],
    }));
  }

  if (ctx.rankingArtifactBases) {
    for (const table of out) {
      table.notes.push('Variable item bases treated as ranking artifact; no extra split family created.');
    }
  }

  if (k === 1) {
    for (const table of out) {
      table.notes.push('K=1 special case: no ranking roll-up families.');
    }
  }

  return out;
}

// =============================================================================
// Table planning — scale
// =============================================================================

function planScaleTables(ctx: EntryContext, ambiguities: PlannerAmbiguity[], overrides?: PlannerOverrides): PlannedTable[] {
  const out: PlannedTable[] = [];
  const isMulti = ctx.substantiveItems.length > 1;

  // When forceScaleMode is set, bypass classifyScale
  let classification: ScaleClassification;
  if (overrides?.forceScaleMode) {
    const forcedMode = overrides.forceScaleMode as ScaleClassification['mode'];
    let pointCount: number | null = null;
    for (const item of ctx.substantiveItems) {
      if (item.scaleLabels && item.scaleLabels.length > 0) {
        pointCount = item.scaleLabels.length;
        break;
      }
    }
    classification = {
      mode: forcedMode,
      pointCount,
      hasNonSubstantiveTail: false,
      tailLabel: null,
      tailLabels: [],
    };
  } else {
    classification = classifyScale(ctx.entry, ctx.substantiveItems);
  }

  if (classification.mode === 'unknown') {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'scale_unknown_labels',
      detail: 'Scale entry has no scaleLabels; planned as standard frequency fallback.',
    });
    return planStandardFrequencyTables(
      { ...ctx, splitReason: ctx.splitReason || 'scale_unknown_fallback' },
      ['Scale labels unavailable -> fallback to standard frequency plan.'],
      ['items[].scaleLabels'],
    );
  }

  if (classification.mode === 'treat_as_standard' || classification.mode === 'admin_artifact') {
    if (classification.mode === 'admin_artifact') {
      ambiguities.push({
        dataset: ctx.dataset,
        questionId: ctx.entry.questionId,
        code: 'scale_admin_artifact',
        detail: `Even-point scale (${classification.pointCount}) did not look bipolar; planned as standard frequency fallback.`,
      });
    }

    const fallbackNote = classification.mode === 'treat_as_standard'
      ? `Scale ${classification.pointCount}-point treated as standard frequency per contract.`
      : 'Even-point scale classified as admin/artifact; using standard frequency fallback.';
    return planStandardFrequencyTables(
      { ...ctx, splitReason: ctx.splitReason || 'scale_standardized' },
      [fallbackNote],
      ['analyticalSubtype', 'items[].scaleLabels'],
    );
  }

  const classNote = `Scale classification: ${classification.mode}.`;
  const tailNote = classification.tailLabels.length > 0
    ? `Non-substantive tail option${classification.tailLabels.length > 1 ? 's' : ''}: ${formatQuotedLabelList(classification.tailLabels)}.`
    : '';

  if (classification.mode === 'nps') {
    if (!isMulti) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'scale_overview_full',
        tableRole: 'overview_full_coded',
        tableIdSuffix: 'scale_overview_full',
        basePolicy: 'question_base_shared',
        baseSource: 'questionBase',
        notes: [classNote, tailNote || 'Full coded scale distribution.'],
        inputsUsed: ['items[].scaleLabels', 'questionText', 'questionBase'],
      }));
    } else {
      for (const item of ctx.substantiveItems) {
        out.push(buildPlannedTable(ctx, {
          tableKind: 'scale_item_detail_full',
          tableRole: 'item_detail_full_coded',
          tableIdSuffix: `scale_item_detail_full_${sanitizeToken(item.column)}`,
          basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
          baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
          appliesToItem: item,
          notes: [classNote, 'Per-item full coded distribution.'],
          inputsUsed: ['items[].scaleLabels', 'questionBase', 'items[].itemBase'],
        }));
      }
    }
    out.push(buildPlannedTable(ctx, {
      tableKind: 'scale_overview_rollup_nps',
      tableRole: 'overview_rollup',
      tableIdSuffix: 'scale_overview_rollup_nps',
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      notes: ['NPS-specific derived family (explicitly detected, not inferred from 11-point alone).'],
      inputsUsed: ['questionText', 'items[].scaleLabels'],
    }));
    return out;
  }

  // Non-NPS scales
  const rebasedPolicy = classification.hasNonSubstantiveTail
    ? 'question_base_rebased_excluding_non_substantive_tail'
    : 'question_base_shared';
  const rebasedSource = classification.hasNonSubstantiveTail
    ? 'questionBase minus tail responders (computed at render step)'
    : 'questionBase';
  const rollupNote = classification.tailLabels.length > 0
    ? `Roll-ups rebased to exclude ${formatQuotedLabelList(classification.tailLabels)}.`
    : 'Roll-ups on full question base.';

  if (!isMulti) {
    out.push(buildPlannedTable(ctx, {
      tableKind: 'scale_overview_full',
      tableRole: 'overview_full_coded',
      tableIdSuffix: 'scale_overview_full',
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      notes: [classNote, tailNote || 'Full coded scale distribution.'],
      inputsUsed: ['items[].scaleLabels', 'questionText', 'questionBase'],
    }));
    out.push(buildPlannedTable(ctx, {
      tableKind: 'scale_overview_rollup_combined',
      tableRole: 'overview_rollup_combined',
      tableIdSuffix: 'scale_overview_rollup',
      basePolicy: rebasedPolicy,
      baseSource: rebasedSource,
      notes: ['Combined rollup: T2B, Middle, B2B as rows in one table.', rollupNote],
      inputsUsed: ['items[].scaleLabels', 'questionBase'],
    }));
  } else {
    for (const item of ctx.substantiveItems) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'scale_item_detail_full',
        tableRole: 'item_detail_full_coded',
        tableIdSuffix: `scale_item_detail_full_${sanitizeToken(item.column)}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: item,
        notes: [classNote, 'Per-item full coded distribution.', tailNote].filter(Boolean),
        inputsUsed: ['items[].scaleLabels', 'questionBase', 'items[].itemBase'],
      }));
    }
    out.push(buildPlannedTable(ctx, {
      tableKind: 'scale_overview_rollup_t2b',
      tableRole: 'overview_rollup',
      tableIdSuffix: 'scale_overview_rollup_t2b',
      basePolicy: rebasedPolicy,
      baseSource: rebasedSource,
      notes: ['T2B overview: all items as rows.', rollupNote],
      inputsUsed: ['items[].scaleLabels', 'questionBase'],
    }));
    out.push(buildPlannedTable(ctx, {
      tableKind: 'scale_overview_rollup_middle',
      tableRole: 'overview_rollup',
      tableIdSuffix: 'scale_overview_rollup_middle',
      basePolicy: rebasedPolicy,
      baseSource: rebasedSource,
      notes: ['Middle overview: all items as rows.', rollupNote],
      inputsUsed: ['items[].scaleLabels', 'questionBase'],
    }));
    out.push(buildPlannedTable(ctx, {
      tableKind: 'scale_overview_rollup_b2b',
      tableRole: 'overview_rollup',
      tableIdSuffix: 'scale_overview_rollup_b2b',
      basePolicy: rebasedPolicy,
      baseSource: rebasedSource,
      notes: ['B2B overview: all items as rows.', rollupNote],
      inputsUsed: ['items[].scaleLabels', 'questionBase'],
    }));
    out.push(buildPlannedTable(ctx, {
      tableKind: 'scale_overview_rollup_mean',
      tableRole: 'overview_rollup',
      tableIdSuffix: 'scale_overview_rollup_mean',
      basePolicy: rebasedPolicy,
      baseSource: rebasedSource,
      notes: ['Mean summary: all items as rows, mean score per item.', rollupNote],
      inputsUsed: ['items[].scaleLabels', 'questionBase'],
    }));
  }

  return out;
}

// =============================================================================
// Table planning — allocation
// =============================================================================

function planAllocationTables(ctx: EntryContext, ambiguities: PlannerAmbiguity[]): PlannedTable[] {
  const out: PlannedTable[] = [];
  const columnDecision = detectAllocationReferenceColumns(ctx);
  const allocationItems = columnDecision.items;
  const isMulti = allocationItems.length > 1;
  const axis = ctx.entry.sumConstraint?.constraintAxis || 'unknown';
  const baseNotes = [
    'Allocation stats surface: binned distribution + mean, mean-no-outliers, median, std dev.',
    ...columnDecision.notes,
  ];
  const grid = isMulti ? analyzeGridStructure(allocationItems) : null;
  const allocationInputsUsed = uniqueList([
    'sumConstraint.constraintAxis',
    'normalizedType',
    ...columnDecision.inputsUsed,
  ]);

  if (grid) {
    for (const colNum of grid.cols) {
      const colCells = (grid.byCol.get(colNum) || []).sort((a, b) => a.coord.row - b.coord.row);
      if (colCells.length === 0) continue;
      const repItem = colCells[0].item;
      const colColumns = colCells.map(c => c.item.column);

      out.push(buildPlannedTable(ctx, {
        tableKind: 'grid_col_detail',
        tableRole: 'grid_col_slice',
        tableIdSuffix: `allocation_grid_col_c${colNum}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: repItem,
        appliesToItemKey: `c${colNum}`,
        appliesToColumn: colColumns.join(','),
        notes: [
          `Allocation grid col-major view: column ${colNum} of ${grid.colCount} (${colCells.length} rows).`,
          `Grid dimensions: ${grid.rowCount} rows \u00d7 ${grid.colCount} cols = ${grid.cells.length} cells.`,
          ...baseNotes,
        ],
        inputsUsed: uniqueList([...allocationInputsUsed, 'items[].column', 'grid_structure']),
      }));
    }

    for (const rowNum of grid.rows) {
      const rowCells = (grid.byRow.get(rowNum) || []).sort((a, b) => a.coord.col - b.coord.col);
      if (rowCells.length === 0) continue;
      const repItem = rowCells[0].item;
      const rowColumns = rowCells.map(c => c.item.column);

      out.push(buildPlannedTable(ctx, {
        tableKind: 'grid_row_detail',
        tableRole: 'grid_row_slice',
        tableIdSuffix: `allocation_grid_row_r${rowNum}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: repItem,
        appliesToItemKey: `r${rowNum}`,
        appliesToColumn: rowColumns.join(','),
        notes: [
          `Allocation grid row-major view: row ${rowNum} of ${grid.rowCount} (${rowCells.length} columns).`,
          `Grid dimensions: ${grid.rowCount} rows \u00d7 ${grid.colCount} cols = ${grid.cells.length} cells.`,
          ...baseNotes,
        ],
        inputsUsed: uniqueList([...allocationInputsUsed, 'items[].column', 'grid_structure']),
      }));
    }
    return out;
  }

  if (axis === 'across-cols') {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'allocation_across_cols_grid_not_detected',
      detail: 'Across-cols allocation did not qualify as a 2D grid; using flat allocation overview + per-item fallback.',
    });
  } else if (axis !== 'down-rows' && axis !== 'unknown') {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'allocation_unknown_axis_value',
      detail: `Allocation constraintAxis "${axis}" not explicitly mapped; using down-rows packaging fallback.`,
    });
  }

  out.push(buildPlannedTable(ctx, {
    tableKind: 'allocation_overview',
    tableRole: 'overview',
    tableIdSuffix: 'allocation_overview',
    basePolicy: 'question_base_shared',
    baseSource: 'questionBase',
    notes: ['Allocation overview fallback (no qualifying 2D grid detected).', ...baseNotes],
    inputsUsed: uniqueList([...allocationInputsUsed, 'questionBase']),
  }));

  if (isMulti) {
    for (const item of allocationItems) {
      out.push(buildPlannedTable(ctx, {
        tableKind: 'allocation_item_detail',
        tableRole: 'item_detail',
        tableIdSuffix: `allocation_item_${sanitizeToken(item.column)}`,
        basePolicy: ctx.genuineSplit ? 'item_base' : 'question_base_shared',
        baseSource: ctx.genuineSplit ? 'items[].itemBase' : 'questionBase',
        appliesToItem: item,
        notes: baseNotes,
        inputsUsed: uniqueList([...allocationInputsUsed, 'hasVariableItemBases', 'variableBaseReason', 'items[].itemBase']),
      }));
    }
  }

  return out;
}

// =============================================================================
// Low-base detail table suppression (Phase A)
// =============================================================================

/** Detail table kinds eligible for low-base suppression. */
const LOW_BASE_SUPPRESSIBLE_KINDS = new Set<TableKind>([
  'standard_item_detail',
  'standard_cluster_detail',
  'numeric_item_detail',
  'scale_item_detail_full',
  'allocation_item_detail',
  'ranking_item_rank',
]);

/**
 * Suppress precision detail tables when ALL candidates have base below threshold.
 * Returns tables unchanged if suppression is disabled, no candidates exist, or
 * at least one candidate has sufficient base.
 */
function applyLowBaseDetailSuppression(
  tables: PlannedTable[],
  config: PlannerConfig,
): { retained: PlannedTable[]; suppressed: number; suppressedKinds: string[] } {
  if (!config.lowBaseSuppression.enabled) {
    return { retained: tables, suppressed: 0, suppressedKinds: [] };
  }

  const threshold = config.lowBaseSuppression.threshold;
  const precisionCandidates = tables.filter(t => LOW_BASE_SUPPRESSIBLE_KINDS.has(t.tableKind));

  if (precisionCandidates.length === 0) {
    return { retained: tables, suppressed: 0, suppressedKinds: [] };
  }

  // Only suppress if ALL precision candidates have low base
  const allLow = precisionCandidates.every(t => {
    const base = t.itemBase ?? t.questionBase ?? Infinity;
    return base < threshold;
  });

  if (!allLow) {
    return { retained: tables, suppressed: 0, suppressedKinds: [] };
  }

  const suppressedKinds = [...new Set(precisionCandidates.map(t => t.tableKind))];
  const retained = tables.filter(t => !LOW_BASE_SUPPRESSIBLE_KINDS.has(t.tableKind));

  // Safety: never suppress everything — at least anchor/overview tables must survive
  if (retained.length === 0) {
    return { retained: tables, suppressed: 0, suppressedKinds: [] };
  }

  return { retained, suppressed: precisionCandidates.length, suppressedKinds };
}

// =============================================================================
// planEntryTables — EXPORTED
// =============================================================================

export function planEntryTables(
  ctx: EntryContext,
  ambiguities: PlannerAmbiguity[],
  overrides?: PlannerOverrides,
  config?: PlannerConfig,
  baseDecisions?: BaseDecision[],
): PlannedTable[] {
  if (ctx.basePlanning.legacyMismatchReasons.length > 0) {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'base_contract_legacy_mismatch',
      detail: `baseContract/legacy mismatch: ${ctx.basePlanning.legacyMismatchReasons.join('; ')}`,
    });
  }

  if (ctx.basePlanning.borderlineMateriality) {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'base_variation_borderline_materiality',
      detail: `Genuine base variation is near the materiality threshold (relative=${((ctx.basePlanning.relativeSpread ?? 0) * 100).toFixed(1)}%, absolute=${ctx.basePlanning.absoluteSpread ?? 'n/a'}).`,
    });
  }

  if (ctx.basePlanning.signals.includes('ranking-artifact-ambiguous')) {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'ranking_artifact_ambiguous',
      detail: 'Ranking structure overlaps with a filtered universe; planner kept deterministic output and flagged ambiguity.',
    });
  }

  if (
    ctx.basePlanning.hasVaryingItemBases
    && (resolvePlannerComparability(ctx) === 'varying_but_acceptable' || ctx.basePlanning.comparabilityStatus === 'ambiguous')
  ) {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'anchor_view_row_base_variation',
      detail: 'Anchor view retained even though row bases are expected to vary within the overview.',
    });
  }

  // --- Subtype dispatch ---
  const subtype = ctx.entry.analyticalSubtype;
  let planned: PlannedTable[];

  if (subtype === 'standard') {
    if (ctx.entry.normalizedType === 'numeric_range') {
      planned = planStandardNumericTables(ctx);
    } else {
      planned = planStandardFrequencyTables(ctx, [], [], overrides);
    }
  } else if (subtype === 'ranking') {
    planned = planRankingTables(ctx, ambiguities, overrides);
  } else if (subtype === 'scale') {
    planned = planScaleTables(ctx, ambiguities, overrides);
  } else if (subtype === 'allocation') {
    planned = planAllocationTables(ctx, ambiguities);
  } else if (subtype === 'maxdiff_exercise') {
    planned = [];
  } else {
    ambiguities.push({
      dataset: ctx.dataset,
      questionId: ctx.entry.questionId,
      code: 'subtype_null_fallback',
      detail: 'analyticalSubtype was null; planned as standard frequency fallback.',
    });
    planned = planStandardFrequencyTables(
      { ...ctx, splitReason: ctx.splitReason || 'subtype_null_fallback' },
      ['Subtype null fallback to standard frequency behavior.'],
      ['analyticalSubtype'],
      overrides,
    );
  }

  // --- Phase A: Post-dispatch signal-driven decisions ---

  // 1. ranking-artifact-ambiguous → flag tables for StructureGateAgent review
  if (ctx.basePlanning.signals.includes('ranking-artifact-ambiguous') && planned.length > 0) {
    for (const table of planned) {
      table.structureGateReviewRequired = true;
    }
    baseDecisions?.push({
      decision: 'ranking_ambiguous_flagged_for_structure_gate',
      detail: 'Anchor view retained; tables flagged for StructureGateAgent review.',
      affectedTableKinds: [...new Set(planned.map(t => t.tableKind))],
      affectedTableCount: planned.length,
    });
  }

  // 2. compute-mask-required verification
  if (ctx.basePlanning.computeRiskSignals.includes('compute-mask-required') && planned.length > 0) {
    let allVerified = true;
    for (const table of planned) {
      const tableHasMask = table.computeRiskSignals?.includes('compute-mask-required') ?? false;
      if (!tableHasMask) {
        allVerified = false;
        table.computeRiskSignals = uniqueList([
          ...(table.computeRiskSignals ?? []),
          'compute-mask-required',
        ]);
        table.notes.push('compute-mask-required added at planning verification (was missing from buildTableComputeRiskSignals).');
      }
      table.computeMaskVerified = true;
    }
    baseDecisions?.push({
      decision: 'compute_mask_verified',
      detail: allVerified
        ? 'All tables already carried compute-mask-required from buildPlannedTable.'
        : 'Compute-mask-required was missing from some tables; patched at planning verification.',
      affectedTableKinds: [...new Set(planned.map(t => t.tableKind))],
      affectedTableCount: planned.length,
    });
  }

  // 3. Low-base precision table suppression
  const resolvedConfig = config ?? DEFAULT_PLANNER_CONFIG;
  const { retained, suppressed, suppressedKinds } = applyLowBaseDetailSuppression(planned, resolvedConfig);
  if (suppressed > 0) {
    baseDecisions?.push({
      decision: 'low_base_detail_suppressed',
      detail: `Suppressed ${suppressed} precision detail table(s) because all candidate items have base < ${resolvedConfig.lowBaseSuppression.threshold}.`,
      affectedTableKinds: suppressedKinds,
      affectedTableCount: suppressed,
    });
  }

  return retained;
}

// =============================================================================
// Sibling dimension detection
// =============================================================================

const SIBLING_DIMENSION_SUFFIX_RE = /^(.+)_r(\d+)$/i;

function stripRowSuffix(column: string, rowSuffix: string): string | null {
  const lower = column.toLowerCase();
  const suffixLower = rowSuffix.toLowerCase();
  if (lower.endsWith(suffixLower)) {
    return column.slice(0, column.length - rowSuffix.length);
  }
  return null;
}

function extractDimensionLabel(items: QuestionItem[]): string | null {
  const labels = new Set<string>();
  for (const item of items) {
    const raw = String(item.label || '').trim();
    if (!raw) continue;
    const prefixMatch = raw.match(/^\S+:\s*/);
    const stripped = prefixMatch ? raw.slice(prefixMatch[0].length).trim() : raw;
    labels.add(stripped.toLowerCase());
  }
  if (labels.size === 1) {
    const raw = String(items[0].label || '').trim();
    const prefixMatch = raw.match(/^\S+:\s*/);
    return prefixMatch ? raw.slice(prefixMatch[0].length).trim() : raw;
  }
  return null;
}

function detectSiblingDimensionGroups(
  reportable: QuestionIdEntry[],
  suppressedIds: Set<string>,
): SiblingDimensionGroup[] {
  const candidatesByGroup = new Map<string, Array<{
    questionId: string;
    rowSuffix: string;
    entry: QuestionIdEntry;
  }>>();

  for (const entry of reportable) {
    if (suppressedIds.has(entry.questionId)) continue;

    const match = entry.questionId.match(SIBLING_DIMENSION_SUFFIX_RE);
    if (!match) continue;

    if (entry.loop?.detected) continue;

    const stem = match[1];
    const rowSuffix = `r${match[2]}`;
    const group = candidatesByGroup.get(stem) || [];
    group.push({ questionId: entry.questionId, rowSuffix, entry });
    candidatesByGroup.set(stem, group);
  }

  const groups: SiblingDimensionGroup[] = [];

  for (const [stem, candidates] of candidatesByGroup) {
    if (candidates.length < 2) continue;

    const subtypes = new Set(candidates.map(c => c.entry.analyticalSubtype));
    if (subtypes.size !== 1) continue;
    const subtype = candidates[0].entry.analyticalSubtype;
    if (!subtype) continue;

    const itemCounts = new Set(candidates.map(c => getSubstantiveItems(c.entry).length));
    if (itemCounts.size !== 1) continue;
    const itemCount = getSubstantiveItems(candidates[0].entry).length;
    if (itemCount === 0) continue;

    const members: SiblingDimensionMember[] = [];
    let allParallel = true;

    for (const cand of candidates) {
      const items = getSubstantiveItems(cand.entry);
      const messageKeys: string[] = [];

      for (const item of items) {
        const key = stripRowSuffix(item.column, cand.rowSuffix);
        if (!key) {
          allParallel = false;
          break;
        }
        messageKeys.push(key);
      }
      if (!allParallel) break;

      const dimensionLabel = extractDimensionLabel(items) || cand.entry.questionText || cand.questionId;

      members.push({
        questionId: cand.questionId,
        dimensionLabel,
        rowSuffix: cand.rowSuffix,
        messageKeys,
        entry: cand.entry,
      });
    }
    if (!allParallel) continue;

    const referenceKeys = members[0].messageKeys;
    const allMatch = members.every(m =>
      m.messageKeys.length === referenceKeys.length &&
      m.messageKeys.every((k, i) => k === referenceKeys[i]),
    );
    if (!allMatch) continue;

    const allHaveDimensionLabel = members.every(m => extractDimensionLabel(getSubstantiveItems(m.entry)) !== null);
    if (!allHaveDimensionLabel) continue;

    const uniqueDimLabels = new Set(members.map(m => m.dimensionLabel.toLowerCase()));
    if (uniqueDimLabels.size < 2) continue;

    members.sort((a, b) => {
      const aNum = parseInt(a.rowSuffix.replace(/^r/i, ''), 10);
      const bNum = parseInt(b.rowSuffix.replace(/^r/i, ''), 10);
      return aNum - bNum;
    });

    groups.push({
      stem,
      members,
      itemCount,
      analyticalSubtype: subtype || 'null',
      messageKeys: referenceKeys,
    });
  }

  return groups;
}

function planSiblingDimensionTables(
  dataset: string,
  group: SiblingDimensionGroup,
): PlannedTable[] {
  const out: PlannedTable[] = [];
  const familyRoot = group.stem;
  const sortBlock = `${dataset}::${familyRoot}`;
  const dimensionSummary = group.members.map(m => `${m.questionId}="${m.dimensionLabel}"`).join(', ');

  for (let i = 0; i < group.messageKeys.length; i++) {
    const messageKey = group.messageKeys[i];
    const messageIndex = i + 1;

    const columnsAcrossDimensions = group.members.map(m => {
      const items = getSubstantiveItems(m.entry);
      return items[i]?.column || `${messageKey}${m.rowSuffix}`;
    });

    const _firstMemberItems = getSubstantiveItems(group.members[0].entry);
    const _messageItemLabel = _firstMemberItems[i]?.label || messageKey;
    const baseContract = projectTableBaseContract(group.members[0].entry.baseContract, {
      basePolicy: 'question_base_uniform',
      questionBase: group.members[0].entry.questionBase as number | null,
      itemBase: null,
    });

    const dimTable: PlannedTable = {
      dataset,
      sourceQuestionId: null,
      sourceLoopQuestionId: null,
      familyRoot,
      analyticalSubtype: group.analyticalSubtype,
      normalizedType: 'categorical_select',
      tableKind: 'scale_dimension_compare',
      tableRole: 'dimension_compare_per_message',
      tableIdCandidate: createTableIdCandidate(familyRoot, `dimension_compare_${sanitizeToken(messageKey)}`),
      sortBlock,
      sortFamily: 'survey_anchored',
      basePolicy: 'question_base_uniform',
      baseSource: `Cross-dimension comparison for ${messageKey} across ${group.members.length} dimensions`,
      splitReason: 'sibling_dimension_group',
      baseViewRole: 'anchor',
      plannerBaseComparability: normalizeComparabilityStatus(group.members[0].entry),
      plannerBaseSignals: uniqueList(baseContract.signals),
      computeRiskSignals: [],
      questionBase: (group.members[0].entry.questionBase as number | null),
      itemBase: null,
      baseContract,
      appliesToItem: messageKey,
      computeMaskAnchorVariable: null,
      appliesToColumn: columnsAcrossDimensions.join(','),
      stimuliSetSlice: null,
      binarySide: null,
      notes: [
        `Sibling dimension comparison: message ${messageIndex} of ${group.messageKeys.length}.`,
        `Dimensions: ${dimensionSummary}.`,
        `Columns: ${columnsAcrossDimensions.join(', ')}.`,
      ],
      inputsUsed: [
        ...group.members.map(m => m.questionId),
        ...columnsAcrossDimensions,
      ],
    };
    dimTable.baseDisclosure = buildPlannerBaseDisclosure(dimTable, group.members[0].entry);
    out.push(dimTable);
  }

  return out;
}

// =============================================================================
// MaxDiff detection and planning
// =============================================================================

function detectMaxDiffFamily(token: string): 'api' | 'ap' | 'sharpref' | 'rawut' | 'rawexp' | null {
  if (/^AnchProbInd(?:_|Sum$)/i.test(token)) return 'api';
  if (/^AnchProb(?:_|Sum$)/i.test(token)) return 'ap';
  if (/^SharPref(?:_|Sum$)/i.test(token)) return 'sharpref';
  if (/^RawUt(?:_|Sum$)/i.test(token)) return 'rawut';
  if (/^RawExp(?:_|Sum$)/i.test(token)) return 'rawexp';
  return null;
}

function detectMaxDiff(entries: QuestionIdEntry[], _metadata: SurveyMetadata): MaxDiffDetection {
  const allFamiliesDetected: Record<string, number> = {};
  const referenceQuestionIds = new Set<string>();

  for (const entry of entries) {
    const questionHit = detectMaxDiffFamily(entry.questionId);
    if (questionHit) {
      inc(allFamiliesDetected, questionHit);
      referenceQuestionIds.add(entry.questionId);
    }
    for (const variable of entry.variables || []) {
      const variableHit = detectMaxDiffFamily(variable);
      if (variableHit) {
        inc(allFamiliesDetected, variableHit);
        referenceQuestionIds.add(entry.questionId);
      }
    }
  }

  const publishableFamilies: Array<'api' | 'ap' | 'sharpref'> = [];
  if (allFamiliesDetected['api']) publishableFamilies.push('api');
  if (allFamiliesDetected['ap']) publishableFamilies.push('ap');
  if (allFamiliesDetected['sharpref']) publishableFamilies.push('sharpref');

  return {
    publishableFamilies,
    allFamiliesDetected,
    referenceQuestionIds: Array.from(referenceQuestionIds).sort(),
  };
}

function planMaxDiffTables(
  dataset: string,
  entries: QuestionIdEntry[],
  metadata: SurveyMetadata,
  ambiguities: PlannerAmbiguity[],
): { tables: PlannedTable[]; families: string[] } {
  const out: PlannedTable[] = [];
  const detection = detectMaxDiff(entries, metadata);
  const families = detection.publishableFamilies.map(f => f.toUpperCase());
  const hasMaxDiff = Boolean(metadata.hasMaxDiff);
  const hasAnchoredScores = metadata.hasAnchoredScores === true;
  const reportableExercise = entries.find(e => e.disposition === 'reportable' && e.analyticalSubtype === 'maxdiff_exercise') || null;

  if (!hasMaxDiff && detection.publishableFamilies.length === 0) {
    return { tables: out, families: [] };
  }

  if (detection.publishableFamilies.length === 0) {
    ambiguities.push({
      dataset,
      questionId: reportableExercise?.questionId || null,
      code: 'maxdiff_no_publishable_score_families',
      detail: 'Survey indicates MaxDiff context but no AnchProbInd/AnchProb/SharPref families were detected from question IDs or variables.',
    });
    return { tables: out, families: [] };
  }

  const familyRoot = 'maxdiff_scores';
  const sourceQuestionId = reportableExercise?.questionId || detection.referenceQuestionIds[0] || null;
  const baseInputs = [
    'metadata.hasMaxDiff',
    'metadata.hasAnchoredScores',
    'questionIds[].questionId',
    'questionIds[].variables[]',
    'exclusionReason',
  ];

  const orderedFamilies: Array<'api' | 'ap' | 'sharpref'> = [];
  if (detection.publishableFamilies.includes('api')) orderedFamilies.push('api');
  if (detection.publishableFamilies.includes('ap')) orderedFamilies.push('ap');
  if (detection.publishableFamilies.includes('sharpref')) orderedFamilies.push('sharpref');

  for (const fam of orderedFamilies) {
    if (fam === 'api') {
      const baseContract = projectTableBaseContract(reportableExercise?.baseContract ?? makeEmptyBaseContract(), {
        basePolicy: 'score_family_model_base',
        questionBase: null,
        itemBase: null,
      });
      const mdApiTable: PlannedTable = {
        dataset,
        sourceQuestionId,
        sourceLoopQuestionId: null,
        familyRoot,
        analyticalSubtype: 'maxdiff',
        normalizedType: 'maxdiff_score_family',
        tableKind: 'maxdiff_api',
        tableRole: 'maxdiff_consolidated',
        tableIdCandidate: createTableIdCandidate(familyRoot, 'api'),
        sortBlock: `${dataset}::${familyRoot}`,
        sortFamily: 'after_main',
        basePolicy: 'score_family_model_base',
        baseSource: 'AnchProbInd score outputs (consolidated by message)',
        splitReason: 'maxdiff_consolidated_family',
        baseViewRole: 'anchor',
        plannerBaseComparability: 'shared',
        plannerBaseSignals: uniqueList(baseContract.signals),
        computeRiskSignals: [],
        questionBase: null,
        itemBase: null,
        baseContract,
        appliesToItem: null,
        computeMaskAnchorVariable: null,
        appliesToColumn: null,
        stimuliSetSlice: null,
        binarySide: null,
        notes: [
          'MaxDiff consolidated family table.',
          hasAnchoredScores
            ? 'API is primary because anchored scores are available.'
            : 'API detected in data; treated as primary publishable family.',
        ],
        inputsUsed: baseInputs,
      };
      mdApiTable.baseDisclosure = buildPlannerBaseDisclosure(mdApiTable, reportableExercise ?? undefined);
      out.push(mdApiTable);
      continue;
    }

    if (fam === 'ap') {
      const baseContract = projectTableBaseContract(reportableExercise?.baseContract ?? makeEmptyBaseContract(), {
        basePolicy: 'score_family_model_base',
        questionBase: null,
        itemBase: null,
      });
      const mdApTable: PlannedTable = {
        dataset,
        sourceQuestionId,
        sourceLoopQuestionId: null,
        familyRoot,
        analyticalSubtype: 'maxdiff',
        normalizedType: 'maxdiff_score_family',
        tableKind: 'maxdiff_ap',
        tableRole: 'maxdiff_consolidated',
        tableIdCandidate: createTableIdCandidate(familyRoot, 'ap'),
        sortBlock: `${dataset}::${familyRoot}`,
        sortFamily: 'after_main',
        basePolicy: 'score_family_model_base',
        baseSource: 'AnchProb score outputs (consolidated by message)',
        splitReason: 'maxdiff_consolidated_family',
        baseViewRole: 'anchor',
        plannerBaseComparability: 'shared',
        plannerBaseSignals: uniqueList(baseContract.signals),
        computeRiskSignals: [],
        questionBase: null,
        itemBase: null,
        baseContract,
        appliesToItem: null,
        computeMaskAnchorVariable: null,
        appliesToColumn: null,
        stimuliSetSlice: null,
        binarySide: null,
        notes: ['Secondary MaxDiff family (AP).'],
        inputsUsed: baseInputs,
      };
      mdApTable.baseDisclosure = buildPlannerBaseDisclosure(mdApTable, reportableExercise ?? undefined);
      out.push(mdApTable);
      continue;
    }

    const baseContract = projectTableBaseContract(reportableExercise?.baseContract ?? makeEmptyBaseContract(), {
      basePolicy: 'score_family_model_base',
      questionBase: null,
      itemBase: null,
    });
    const mdSpTable: PlannedTable = {
      dataset,
      sourceQuestionId,
      sourceLoopQuestionId: null,
      familyRoot,
      analyticalSubtype: 'maxdiff',
      normalizedType: 'maxdiff_score_family',
      tableKind: 'maxdiff_sharpref',
      tableRole: 'maxdiff_consolidated',
      tableIdCandidate: createTableIdCandidate(familyRoot, 'sharpref'),
      sortBlock: `${dataset}::${familyRoot}`,
      sortFamily: 'after_main',
      basePolicy: 'score_family_model_base',
      baseSource: 'SharPref score outputs (consolidated by message)',
      splitReason: 'maxdiff_consolidated_family',
      baseViewRole: 'anchor',
      plannerBaseComparability: 'shared',
      plannerBaseSignals: uniqueList(baseContract.signals),
      computeRiskSignals: [],
      questionBase: null,
      itemBase: null,
      baseContract,
      appliesToItem: null,
      computeMaskAnchorVariable: null,
      appliesToColumn: null,
      stimuliSetSlice: null,
      binarySide: null,
      notes: ['Secondary MaxDiff family (Share of Preference).'],
      inputsUsed: baseInputs,
    };
    mdSpTable.baseDisclosure = buildPlannerBaseDisclosure(mdSpTable, reportableExercise ?? undefined);
    out.push(mdSpTable);
  }

  if (hasAnchoredScores && !detection.publishableFamilies.includes('api')) {
    ambiguities.push({
      dataset,
      questionId: sourceQuestionId,
      code: 'maxdiff_anchored_without_api_family',
      detail: 'Metadata indicates anchored scores, but AnchProbInd family was not detected.',
    });
  }

  if (detection.allFamiliesDetected['rawut'] || detection.allFamiliesDetected['rawexp']) {
    ambiguities.push({
      dataset,
      questionId: sourceQuestionId,
      code: 'maxdiff_raw_families_detected_not_planned',
      detail: 'RawUt/RawExp detected; planner intentionally excludes raw families from publishable table plan.',
    });
  }

  return { tables: out, families };
}

// =============================================================================
// runTablePlanner — EXPORTED (main entry point)
// =============================================================================

export function runTablePlanner(input: TablePlannerInput): TablePlanOutput {
  const { entries, metadata, dataset, config: inputConfig } = input;
  const config = inputConfig ?? DEFAULT_PLANNER_CONFIG;

  const reportable = entries
    .filter(e => e.disposition === 'reportable')
    .sort(compareReportableQuestionOrder);
  const hasMaxDiffSurvey = metadata.hasMaxDiff === true;
  const hasChoiceModelExercise = metadata.hasChoiceModelExercise === true;
  const reportableMap = new Map<string, QuestionIdEntry>(reportable.map(e => [e.questionId, e]));
  const visibleReportable = reportable.filter(e => !isHiddenEntry(e));

  const linkedHiddenIndex = buildMaxDiffLinkedHiddenIndex({
    dataset,
    reportable,
    reportableMap,
    hasMaxDiffSurvey,
  });
  const maxdiffExerciseIndex = buildMaxDiffExerciseFamilyIndex({
    reportable,
    hasMaxDiffSurvey,
  });

  const ambiguities: PlannerAmbiguity[] = [];
  const stimuliSetRegistry = buildStimuliSetRegistry(reportableMap, metadata);

  for (const qid of maxdiffExerciseIndex.unresolvedArtifactQuestionIds) {
    ambiguities.push({
      dataset,
      questionId: qid,
      code: 'maxdiff_exercise_artifact_unresolved_family',
      detail: 'MaxDiff exercise artifact found but hiddenLink/loop family root could not be resolved.',
    });
  }

  const dsPlans: PlannedTable[] = [];
  const dsByKind: Record<string, number> = {};
  const dsBySubtype: Record<string, number> = {};
  const questionDiagnostics: QuestionDiagnostic[] = [];
  const suppressionDecisions: HiddenSuppressionDecision[] = [];
  const suppressedIds = new Set<string>();
  let suppressedQuestions = 0;
  let suppressedPlannedTables = 0;

  for (const entry of reportable) {
    const ctx = buildContext(dataset, entry, reportableMap, metadata, stimuliSetRegistry);
    const entryBaseDecisions: BaseDecision[] = [];
    const planned = planEntryTables(ctx, ambiguities, undefined, config, entryBaseDecisions);
    const qKinds: Record<string, number> = {};

    // Evaluate suppressions in priority order
    let suppression = evaluateChoiceModelSuppression({
      dataset,
      entry,
      hasChoiceModelExercise,
    });
    if (!suppression) {
      suppression = evaluateMaxDiffExerciseFamilySuppression({
        dataset,
        entry,
        hasMaxDiffSurvey,
        exerciseIndex: maxdiffExerciseIndex,
      });
    }
    if (!suppression) {
      suppression = evaluateHiddenSuppression({
        dataset,
        entry,
        visibleEntries: visibleReportable,
        reportableMap,
        hasMaxDiffSurvey,
      });
    }
    if (!suppression) {
      suppression = evaluateMaxDiffLinkedParentSuppression({
        dataset,
        entry,
        hasMaxDiffSurvey,
        linkedHiddenAllByParent: linkedHiddenIndex.linkedHiddenAllByParent,
        linkedHiddenSuppressionEligibleByParent: linkedHiddenIndex.linkedHiddenSuppressionEligibleByParent,
      });
    }

    if (suppression) {
      const wouldHaveByKind = buildKindCounts(planned);
      const decision: HiddenSuppressionDecision = {
        ...suppression,
        wouldHaveTableCount: planned.length,
        wouldHaveByKind,
      };
      suppressionDecisions.push(decision);
      suppressedIds.add(entry.questionId);
      suppressedQuestions++;
      suppressedPlannedTables += planned.length;
      const suppressedDiag = computeItemDiagnostics(ctx.substantiveItems, entry.analyticalSubtype || undefined);
      questionDiagnostics.push({
        dataset,
        questionId: entry.questionId,
        analyticalSubtype: entry.analyticalSubtype || 'null',
        normalizedType: entry.normalizedType || 'unknown',
        itemCount: ctx.substantiveItems.length,
        tableCount: 0,
        splitReason: ctx.splitReason,
        genuineSplit: ctx.genuineSplit,
        clusterRouting: ctx.clusterAnalysis?.routingType || null,
        baseSituation: ctx.basePlanning.situation,
        baseVariationClass: ctx.basePlanning.variationClass,
        baseComparability: resolvePlannerComparability(ctx),
        baseSignals: ctx.basePlanning.signals,
        computeRiskSignals: ctx.basePlanning.computeRiskSignals,
        minBase: ctx.basePlanning.minBase,
        maxBase: ctx.basePlanning.maxBase,
        absoluteSpread: ctx.basePlanning.absoluteSpread,
        relativeSpread: ctx.basePlanning.relativeSpread,
        precisionRouting: ctx.precisionRouting,
        lowBase: ctx.basePlanning.lowBase,
        isHidden: isHiddenEntry(entry),
        isLoop: Boolean(entry.loop?.detected),
        loopQuestionId: entry.loopQuestionId,
        tableKinds: {},
        suppressed: true,
        suppressionCode: decision.reasonCode,
        suppressedWouldHaveTableCount: decision.wouldHaveTableCount,
        gridDims: suppressedDiag.gridDims,
        maxValueCount: suppressedDiag.maxValueCount,
        baseDecisions: entryBaseDecisions.length > 0 ? entryBaseDecisions : undefined,
        stimuliSetResolution: ctx.stimuliSetResolution ?? undefined,
      });
      continue;
    }

    for (const table of planned) {
      dsPlans.push(table);
      inc(dsByKind, table.tableKind);
      inc(dsBySubtype, table.analyticalSubtype);
      inc(qKinds, table.tableKind);
    }
    const itemDiag = computeItemDiagnostics(ctx.substantiveItems, entry.analyticalSubtype || undefined);
    questionDiagnostics.push({
      dataset,
      questionId: entry.questionId,
      analyticalSubtype: entry.analyticalSubtype || 'null',
      normalizedType: entry.normalizedType || 'unknown',
      itemCount: ctx.substantiveItems.length,
      tableCount: planned.length,
      splitReason: ctx.splitReason,
      genuineSplit: ctx.genuineSplit,
      clusterRouting: ctx.clusterAnalysis?.routingType || null,
      baseSituation: ctx.basePlanning.situation,
      baseVariationClass: ctx.basePlanning.variationClass,
      baseComparability: resolvePlannerComparability(ctx),
      baseSignals: uniqueList(planned.flatMap(table => table.plannerBaseSignals ?? [])),
      computeRiskSignals: uniqueList(planned.flatMap(table => table.computeRiskSignals ?? [])),
      minBase: ctx.basePlanning.minBase,
      maxBase: ctx.basePlanning.maxBase,
      absoluteSpread: ctx.basePlanning.absoluteSpread,
      relativeSpread: ctx.basePlanning.relativeSpread,
      precisionRouting: ctx.precisionRouting,
      lowBase: ctx.basePlanning.lowBase,
      isHidden: isHiddenEntry(entry),
      isLoop: Boolean(entry.loop?.detected),
      loopQuestionId: entry.loopQuestionId,
      tableKinds: qKinds,
      suppressed: false,
      suppressionCode: null,
      suppressedWouldHaveTableCount: null,
      gridDims: itemDiag.gridDims,
      maxValueCount: itemDiag.maxValueCount,
      baseDecisions: entryBaseDecisions.length > 0 ? entryBaseDecisions : undefined,
      stimuliSetResolution: ctx.stimuliSetResolution
        ? {
            ...ctx.stimuliSetResolution,
            binarySplitApplied: planned.some(t => t.binarySide !== null),
          }
        : undefined,
    });
  }

  // MaxDiff score family tables
  const maxdiff = planMaxDiffTables(dataset, entries, metadata, ambiguities);
  for (const table of maxdiff.tables) {
    dsPlans.push(table);
    inc(dsByKind, table.tableKind);
    inc(dsBySubtype, table.analyticalSubtype);
  }

  // Sibling dimension detection
  const siblingDimensionGroups = detectSiblingDimensionGroups(reportable, suppressedIds);
  for (const group of siblingDimensionGroups) {
    const dimensionTables = planSiblingDimensionTables(dataset, group);
    for (const table of dimensionTables) {
      dsPlans.push(table);
      inc(dsByKind, table.tableKind);
      inc(dsBySubtype, table.analyticalSubtype);
    }
  }

  // Diagnostic ambiguities for flag/exercise mismatches
  if (hasChoiceModelExercise && !suppressionDecisions.some(d => d.reasonCode === 'choice_model_iteration')) {
    ambiguities.push({
      dataset,
      questionId: null,
      code: 'choice_model_flag_no_matches',
      detail: `hasChoiceModelExercise=true but no questions matched the choice model iteration rule (loop.detected=false && iterationCount>=${CHOICE_MODEL_MIN_ITERATION_COUNT})`,
    });
  }
  if (
    maxdiffExerciseIndex.artifactQuestionIds.size > 0
    && !suppressionDecisions.some(d => d.reasonCode === 'maxdiff_exercise_family')
  ) {
    ambiguities.push({
      dataset,
      questionId: null,
      code: 'maxdiff_exercise_family_no_matches',
      detail: `Detected ${maxdiffExerciseIndex.artifactQuestionIds.size} maxdiff_exercise artifact question(s), but no family-scoped suppressions were applied.`,
    });
  }

  // Assemble summary
  const summary: DatasetPlanSummary = {
    dataset,
    reportableQuestions: reportable.length,
    plannedTables: dsPlans.length,
    byKind: dsByKind,
    bySubtype: dsBySubtype,
    maxdiffDetectedFamilies: maxdiff.families,
    siblingDimensionGroups: siblingDimensionGroups.map(g => ({
      stem: g.stem,
      memberCount: g.members.length,
      memberIds: g.members.map(m => m.questionId),
      dimensionLabels: g.members.map(m => m.dimensionLabel),
      itemCount: g.itemCount,
      tablesAdded: g.messageKeys.length,
    })),
    questionDiagnostics,
    suppressedQuestions,
    suppressedPlannedTables,
    suppressionDecisions,
  };

  const output: TablePlanOutput = {
    metadata: {
      generatedAt: new Date().toISOString(),
      plannerVersion: '13b-v3',
      dataset,
      suppressionPolicy: {
        minItemCount: HIDDEN_SUPPRESS_MIN_ITEM_COUNT,
        minZeroItemPct: HIDDEN_SUPPRESS_MIN_ZERO_ITEM_PCT,
        minOverlapJaccard: HIDDEN_SUPPRESS_MIN_OVERLAP_JACCARD,
        minOverlapItems: HIDDEN_SUPPRESS_MIN_OVERLAP_ITEMS,
        linkedMessageMinItemCount: HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_ITEM_COUNT,
        linkedMessageMinCoveragePct: HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_COVERAGE_PCT,
        linkedParentMaxItems: HIDDEN_SUPPRESS_LINKED_PARENT_MAX_ITEMS,
        linkedMessageRequiresMaxDiff: HIDDEN_SUPPRESS_LINKED_MESSAGE_REQUIRES_MAXDIFF,
        linkedMessageMinLabelAlignPct: HIDDEN_SUPPRESS_LINKED_MESSAGE_MIN_LABEL_ALIGN_PCT,
        linkedMessageLabelTokenJaccardMin: HIDDEN_SUPPRESS_LINKED_MESSAGE_LABEL_TOKEN_JACCARD_MIN,
        parentLinkedMaxItems: MAXDIFF_PARENT_LINKED_MAX_ITEMS,
        parentLinkedRequireAllLinkedHidden: MAXDIFF_PARENT_LINKED_REQUIRE_ALL_LINKED_HIDDEN,
        choiceModelMinIterationCount: CHOICE_MODEL_MIN_ITERATION_COUNT,
      },
    },
    summary,
    ambiguities,
    plannedTables: dsPlans,
  };

  return output;
}
