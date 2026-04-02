/**
 * V3 Runtime — Step 13d Canonical Table Assembly
 *
 * Converts validated table plan (from 13c) into canonical tables per the spec
 * in docs/v3-13d-canonical-table-spec.md.
 *
 * This module is deterministic: same inputs always produce the same output.
 * No AI calls, no file I/O — pure transformation.
 *
 * See also:
 *   - ./types.ts for all type definitions
 *   - docs/v3-13d-canonical-table-spec.md for the full specification
 */

import type {
  QuestionIdEntry,
  SurveyMetadata,
  PlannedTable,
  TableKind,
  ValidatedPlanOutput,
  CanonicalTable,
  CanonicalRow,
  CanonicalTableOutput,
  TableType,
  StatsSpec,
  RollupConfig,
  QuestionItem,
  CanonicalBaseDisclosure,
  CanonicalBaseNoteToken,
  WinCrossDenominatorSemantic,
} from './types';
import type { TablePresentationConfig, TableLabelVocabulary } from '@/lib/tablePresentation/labelVocabulary';
import { stripDeterministicQuestionStem } from '@/lib/questionContext/deterministicLabelCleanup';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import {
  getBottomBoxLabel,
  getRankLabel,
  getTopBoxLabel,
  resolveTablePresentationConfig,
} from '@/lib/tablePresentation/labelVocabulary';
import {
  collapseLoopFamiliesInValidatedPlan,
  normalizeCanonicalLoopTables,
} from './loopFamilyCollapse';

// =============================================================================
// Public interface
// =============================================================================

export interface CanonicalAssemblyInput {
  validatedPlan: ValidatedPlanOutput;
  entries: QuestionIdEntry[];
  loopMappings?: LoopGroupMapping[];
  metadata: SurveyMetadata;
  dataset: string;
  tablePresentation?: TablePresentationConfig;
}

export const ASSEMBLER_VERSION = '13d-v1';

/**
 * Main entry point: converts a validated plan + enriched question-id entries
 * into the canonical table artifact.
 */
export function runCanonicalAssembly(input: CanonicalAssemblyInput): CanonicalTableOutput {
  const { validatedPlan, entries, metadata, dataset } = input;
  const tablePresentation = resolveTablePresentationConfig(input.tablePresentation);
  const loopAwarePlan = collapseLoopFamiliesInValidatedPlan(
    validatedPlan,
    entries,
    input.loopMappings ?? [],
  );

  // 1. Index entries by questionId for O(1) lookup
  const entryIndex = indexEntries(entries);

  // 2. Build canonical tables from planned tables
  const usedIds = new Set<string>();
  const tables: CanonicalTable[] = [];

  for (let i = 0; i < loopAwarePlan.plannedTables.length; i++) {
    const planned = loopAwarePlan.plannedTables[i];
    const entry = planned.sourceQuestionId
      ? entryIndex.get(planned.sourceQuestionId) ?? undefined
      : undefined;

    const table = buildCanonicalTable(planned, entry, i, usedIds, dataset, tablePresentation);
    tables.push(table);
  }

  const normalizedOutput = normalizeCanonicalLoopTables({
    metadata: {
      generatedAt: new Date().toISOString(),
      assemblerVersion: ASSEMBLER_VERSION,
      dataset,
      inputPlanPath: 'table-plan-validated.json',
      inputQuestionIdPath: 'questionid-final.json',
      totalTables: tables.length,
      isMessageTestingSurvey: metadata.isMessageTestingSurvey || undefined,
      hasMaxDiff: metadata.hasMaxDiff ?? undefined,
      isDemandSurvey: metadata.isDemandSurvey || undefined,
    },
    summary: buildSummary(tables),
    tables,
  }, input.loopMappings ?? []);

  return {
    ...normalizedOutput,
    metadata: {
      ...normalizedOutput.metadata,
      totalTables: normalizedOutput.tables.length,
    },
    summary: buildSummary(normalizedOutput.tables),
  };
}

// =============================================================================
// Non-substantive tail detection (shared utility)
// =============================================================================

import { getNonSubstantiveLabels, isNonSubstantiveTail } from './nonSubstantive';

// =============================================================================
// Entry indexing
// =============================================================================

function indexEntries(entries: QuestionIdEntry[]): Map<string, QuestionIdEntry> {
  const map = new Map<string, QuestionIdEntry>();
  for (const e of entries) {
    map.set(e.questionId, e);
  }
  return map;
}

// =============================================================================
// Table-level construction
// =============================================================================

const MEAN_ROWS_TABLE_KINDS = new Set<TableKind>([
  'numeric_overview_mean',
  'allocation_overview',
  'scale_overview_rollup_mean',
  'scale_dimension_compare',
]);

const DERIVED_TABLE_KIND_TOKENS = ['rollup', 'topk', 'dimension_compare'];

function deriveTableType(
  tableKind: TableKind,
  analyticalSubtype: string,
  normalizedType: string,
): TableType {
  if (
    (analyticalSubtype === 'allocation' || normalizedType === 'numeric_range') &&
    (tableKind === 'grid_row_detail' || tableKind === 'grid_col_detail')
  ) {
    return 'mean_rows';
  }
  return MEAN_ROWS_TABLE_KINDS.has(tableKind) ? 'mean_rows' : 'frequency';
}

function isDerivedTable(tableKind: TableKind): boolean {
  const kindStr = tableKind as string;
  return DERIVED_TABLE_KIND_TOKENS.some(token => kindStr.includes(token));
}

/**
 * Finalize tableId with uniqueness enforcement. If a collision is detected,
 * append a `-N` suffix.
 */
function finalizeTableId(candidate: string, usedIds: Set<string>): string {
  if (!usedIds.has(candidate)) {
    usedIds.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (usedIds.has(`${candidate}-${suffix}`)) {
    suffix++;
  }
  const unique = `${candidate}-${suffix}`;
  usedIds.add(unique);
  return unique;
}

function buildDisplayQuestionText(entry: QuestionIdEntry | undefined): string {
  const displayText = entry?.displayQuestionText ?? entry?.questionText ?? '';
  if (!entry?.isHidden) return displayText;

  const rawQuestionId = entry.questionId.trim();
  const shownQuestionId = entry.displayQuestionId?.trim() ?? '';
  if (!rawQuestionId || !shownQuestionId || rawQuestionId === shownQuestionId) {
    return displayText;
  }

  const hiddenSuffix = `(${rawQuestionId})`;
  if (displayText.includes(hiddenSuffix)) return displayText;
  return displayText ? `${displayText} ${hiddenSuffix}` : hiddenSuffix;
}

function buildCanonicalTable(
  planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
  sortIndex: number,
  usedIds: Set<string>,
  _dataset: string,
  tablePresentation: TablePresentationConfig,
): CanonicalTable {
  const tableId = finalizeTableId(planned.tableIdCandidate, usedIds);
  const tableKind = planned.tableKind;
  const tableType = deriveTableType(
    tableKind,
    planned.analyticalSubtype,
    planned.normalizedType,
  );

  // Get substantive items from entry
  const items = entry ? getSubstantiveItems(entry) : [];

  // Build rows deterministically
  const rawRows = buildRows(planned, entry, items, tablePresentation.labelVocabulary);
  const frequencyPolicy = applyFrequencyRowPolicy({
    rows: rawRows,
    tableType,
    tableKind,
    tableIdCandidate: planned.tableIdCandidate,
    tableNormalizedType: planned.normalizedType,
    items,
  });
  const rows = frequencyPolicy.rows;

  // Build stats spec
  const statsSpec = buildStatsSpec(tableKind, entry, items);

  // Prefer sectionHeader propagated in step 12, fallback to surveyText parsing.
  const surveySection = entry?.sectionHeader?.trim()
    ? entry.sectionHeader.trim()
    : (entry?.surveyText ? extractSection(entry.surveyText) : '');

  // Build subtitle from appliesToItem/appliesToColumn context
  const tableSubtitle = buildTableSubtitle(planned, entry, items);

  const shouldExcludeForPolicy = frequencyPolicy.unresolved.length > 0;
  const policyExcludeReason = shouldExcludeForPolicy
    ? `canonical_missing_filtervalue_unresolved:${frequencyPolicy.unresolved.length}`
    : '';
  const notes = [
    ...planned.notes,
    ...frequencyPolicy.notes,
  ];
  // Use planner-owned disclosure when available (Phase B); fall back to assembly-time derivation
  const baseDisclosure = planned.baseDisclosure ?? buildBaseDisclosure(planned, entry);
  const displayQuestionId = entry?.displayQuestionId ?? planned.sourceQuestionId ?? '';
  const displayQuestionText = buildDisplayQuestionText(entry);
  const wincrossDenominator = resolveWinCrossDenominatorConfig(planned, items);

  return {
    // Identity and lineage
    tableId,
    questionId: displayQuestionId,
    familyRoot: planned.familyRoot,
    sourceTableId: tableId,
    splitFromTableId: '',

    // Classification
    tableKind,
    analyticalSubtype: planned.analyticalSubtype,
    normalizedType: planned.normalizedType,
    tableType,

    // Content
    questionText: displayQuestionText,
    rows,

    // Stats and rollup semantics
    statsSpec,
    derivationHint: null,
    statTestSpec: null,
    wincrossDenominatorSemantic: wincrossDenominator.semantic,
    wincrossQualifiedCodes: wincrossDenominator.qualifiedCodes,
    wincrossFilteredTotalExpr: null,

    // Base and context
    basePolicy: planned.basePolicy,
    baseSource: planned.baseSource,
    questionBase: planned.questionBase,
    itemBase: planned.itemBase,
    baseContract: planned.baseContract,
    baseViewRole: planned.baseViewRole,
    plannerBaseComparability: planned.plannerBaseComparability,
    plannerBaseSignals: planned.plannerBaseSignals,
    computeRiskSignals: planned.computeRiskSignals,
    sumConstraint: entry?.sumConstraint ?? null,
    baseDisclosure,
    baseText: baseDisclosure.defaultBaseText,

    // Presentation/order metadata
    isDerived: isDerivedTable(tableKind),
    sortOrder: sortIndex,
    sortBlock: planned.sortBlock,
    surveySection,
    userNote: '',
    tableSubtitle,

    // Filters/splits
    splitReason: planned.splitReason,
    appliesToItem: planned.appliesToItem,
    computeMaskAnchorVariable: planned.computeMaskAnchorVariable,
    appliesToColumn: planned.appliesToColumn,
    stimuliSetSlice: planned.stimuliSetSlice,
    binarySide: planned.binarySide,
    additionalFilter: '',

    // Pipeline controls
    exclude: shouldExcludeForPolicy,
    excludeReason: policyExcludeReason,
    filterReviewRequired: shouldExcludeForPolicy,
    lastModifiedBy: 'TableBlockAssembler',

    // Notes
    notes,
  };
}

function resolveWinCrossDenominatorConfig(
  planned: PlannedTable,
  _items: QuestionItem[],
): {
  semantic: WinCrossDenominatorSemantic;
  qualifiedCodes?: string[];
} {
  const summaryKinds = new Set<TableKind>([
    'scale_overview_rollup_t2b',
    'scale_overview_rollup_middle',
    'scale_overview_rollup_b2b',
    'scale_overview_rollup_nps',
    'scale_overview_rollup_combined',
    'scale_overview_rollup_mean',
    'numeric_overview_mean',
    'ranking_overview_rank',
    'ranking_overview_topk',
    'allocation_overview',
    'scale_dimension_compare',
    'maxdiff_api',
    'maxdiff_ap',
    'maxdiff_sharpref',
  ]);

  const answeringBaseKinds = new Set<TableKind>([
    'standard_overview',
    'standard_item_detail',
    'standard_cluster_detail',
    'grid_row_detail',
    'grid_col_detail',
    'numeric_item_detail',
    'numeric_per_value_detail',
    'numeric_optimized_bin_detail',
    'scale_overview_full',
    'scale_item_detail_full',
    'allocation_item_detail',
    'ranking_item_rank',
  ]);

  if (summaryKinds.has(planned.tableKind)) {
    return { semantic: 'sample_base' };
  }

  if (answeringBaseKinds.has(planned.tableKind)) {
    return { semantic: 'answering_base' };
  }

  return { semantic: 'answering_base' };
}
// =============================================================================
// Label resolution
// =============================================================================

/**
 * Minimum confidence threshold for using messageText as the row label.
 * Items matched via code_extraction get 1.0; truncation_prefix gets 0.5–1.0.
 * 0.7 filters out low-confidence truncation matches while keeping good ones.
 */
export const MESSAGE_LABEL_MIN_CONFIDENCE = 0.7;

function stripMessageStemFromLabel(label: string, questionText?: string): string {
  let text = label.trim();
  if (!text) return '';

  // Remove variable/scenario prefixes that are not part of the message.
  text = text.replace(/^[A-Za-z0-9_]+:\s*/, '');
  text = text.replace(/^Scenario\s+\d+\s+Ranking\s*-\s*/i, '').trim();

  const deterministic = stripDeterministicQuestionStem(text, questionText ?? '');
  if (deterministic) {
    return deterministic;
  }

  // Fallback for common stem patterns when no question anchor is available.
  return text.replace(/\s*-\s*(?:Which|For the next|In this|If you|\[res\s).*/i, '').trim();
}

const FAVORABLE_HIGH_SCALE_PATTERN =
  /\b(agree|satisfied|positive|favorable|likely|comfortable|appealing|interested|important|effective|good|great|excellent|high|higher|highest|very|extremely|strongly|completely|totally|always|yes)\b/i;
const UNFAVORABLE_LOW_SCALE_PATTERN =
  /\b(disagree|dissatisfied|negative|unfavorable|unlikely|uncomfortable|not at all|poor|bad|low|lower|lowest|never|no)\b/i;

function shouldShowTopAnchorFirst(
  substantiveLabels: Array<{ value: number | string; label: string }>,
): boolean {
  if (substantiveLabels.length < 5) return false;

  const firstLabel = substantiveLabels[0]?.label?.trim() ?? '';
  const lastLabel = substantiveLabels[substantiveLabels.length - 1]?.label?.trim() ?? '';
  if (!firstLabel || !lastLabel) return false;

  return UNFAVORABLE_LOW_SCALE_PATTERN.test(firstLabel)
    && FAVORABLE_HIGH_SCALE_PATTERN.test(lastLabel);
}

function orderTopBoxChildren(
  labels: Array<{ value: number | string; label: string }>,
  substantiveLabels: Array<{ value: number | string; label: string }>,
): Array<{ value: number | string; label: string }> {
  return shouldShowTopAnchorFirst(substantiveLabels)
    ? [...labels].reverse()
    : labels;
}

/**
 * Resolve the display label for a QuestionItem row.
 *
 * Precedence:
 *   1. messageText (if present and matchConfidence >= threshold) — clean stimulus text
 *   2. Stem-stripped .sav label when no match was found (confidence=0)
 *   3. item.label (original/current label) — fallback
 *
 * This keeps scale labels authoritative (they use sl.label, not this function)
 * and only activates for message-testing items with confident matches.
 * Non-message-testing surveys always fall through to item.label since
 * messageText will be null.
 */
export function resolveItemLabel(
  item: Pick<QuestionItem, 'label' | 'savLabel' | 'surveyLabel' | 'messageText' | 'altText' | 'column' | 'matchConfidence'>,
  questionText?: string,
): string {
  const messageText = typeof item.messageText === 'string'
    ? item.messageText.trim()
    : '';

  if (
    messageText &&
    item.matchConfidence >= MESSAGE_LABEL_MIN_CONFIDENCE
  ) {
    return messageText;
  }

  // If no template match was found, try a deterministic stem-strip fallback
  // from the original .sav label before falling back to the current label.
  if (!messageText && item.matchConfidence === 0) {
    const candidates = [
      typeof item.savLabel === 'string' ? item.savLabel.trim() : '',
      typeof item.surveyLabel === 'string' ? item.surveyLabel.trim() : '',
      questionText ? item.label.trim() : '',
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const stripped = stripMessageStemFromLabel(candidate, questionText);
      if (stripped && stripped.length < candidate.length) {
        return stripped;
      }
    }
  }

  return item.label;
}

// =============================================================================
// Item helpers
// =============================================================================

function getSubstantiveItems(entry: QuestionIdEntry): QuestionItem[] {
  const items = entry.items ?? [];
  const substantive = items.filter(
    (item) => item.normalizedType !== 'text_open',
  );
  const filtered = (substantive.length > 0 ? substantive : items) as QuestionItem[];
  return stripDeadGridColumns(filtered);
}

interface GridCoord {
  row: number;
  col: number;
}

interface GridCell {
  item: QuestionItem;
  coord: GridCoord;
}

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

/**
 * Remove "dead" grid columns where every item has itemBase === 0.
 * This mirrors stage 13b behavior so 13d row generation doesn't reintroduce
 * non-existent/piped columns (e.g., c1 all-zero vs c2 populated).
 */
function stripDeadGridColumns(items: QuestionItem[]): QuestionItem[] {
  const cells = extractGridCells(items);
  if (cells.length < items.length * 0.8) return items;

  const colSet = new Set<number>();
  for (const cell of cells) colSet.add(cell.coord.col);
  if (colSet.size < 2) return items;

  const deadCols = new Set<number>();
  for (const col of colSet) {
    const colCells = cells.filter(c => c.coord.col === col);
    if (colCells.every(c => Number(c.item.itemBase ?? 0) === 0)) {
      deadCols.add(col);
    }
  }

  if (deadCols.size === 0) return items;
  if (deadCols.size === colSet.size) return items;

  const deadItemColumns = new Set<string>();
  for (const cell of cells) {
    if (deadCols.has(cell.coord.col)) {
      deadItemColumns.add(cell.item.column);
    }
  }

  const filtered = items.filter(item => !deadItemColumns.has(item.column));
  return filtered.length > 0 ? filtered : items;
}

/**
 * Extract scale labels from items. Returns the first item's scaleLabels found,
 * or an empty array.
 */
function getScaleLabels(items: QuestionItem[]): Array<{ value: number | string; label: string }> {
  for (const item of items) {
    if (item.scaleLabels && item.scaleLabels.length > 0) {
      return item.scaleLabels;
    }
  }
  return [];
}

interface FrequencyRowPolicyInput {
  rows: CanonicalRow[];
  tableType: TableType;
  tableKind: TableKind;
  tableIdCandidate: string;
  tableNormalizedType: string;
  items: QuestionItem[];
}

interface FrequencyRowPolicyResult {
  rows: CanonicalRow[];
  resolved: Array<{ variable: string; filterValue: string; reason: string }>;
  unresolved: Array<{ variable: string; reason: string }>;
  notes: string[];
}

function applyFrequencyRowPolicy(input: FrequencyRowPolicyInput): FrequencyRowPolicyResult {
  const { rows, tableType, tableKind, tableIdCandidate, tableNormalizedType, items } = input;
  if (tableType !== 'frequency') {
    return { rows, resolved: [], unresolved: [], notes: [] };
  }

  const itemByColumn = new Map<string, QuestionItem>();
  for (const item of items) {
    itemByColumn.set(item.column, item);
  }

  const resolved: FrequencyRowPolicyResult['resolved'] = [];
  const unresolved: FrequencyRowPolicyResult['unresolved'] = [];
  const nextRows = rows.map((row) => ({ ...row }));

  for (const row of nextRows) {
    if (!rowRequiresFilterValue(row)) continue;
    if (row.filterValue.trim() !== '') continue;

    const item = itemByColumn.get(row.variable);
    const decision = resolveMissingFilterValue(row, item, tableNormalizedType, tableKind);

    if (decision.filterValue) {
      row.filterValue = decision.filterValue;
      resolved.push({
        variable: row.variable,
        filterValue: decision.filterValue,
        reason: decision.reason,
      });
      continue;
    }

    // Keep pipeline execution-safe while explicitly flagging the table for review.
    // This fallback is only reached when we cannot infer a better value from row/item metadata.
    row.filterValue = '1';
    unresolved.push({
      variable: row.variable,
      reason: decision.reason,
    });
  }

  const notes: string[] = [];
  if (resolved.length > 0) {
    notes.push(
      `Auto-resolved ${resolved.length} blank filterValue row(s) via canonical frequency policy.`
    );
  }
  if (unresolved.length > 0) {
    const vars = unresolved.slice(0, 5).map((u) => u.variable).join(', ');
    notes.push(
      `CRITICAL: ${unresolved.length} row(s) had unresolved blank filterValue in ${tableIdCandidate} (${tableKind}); table flagged excluded/review_required.`
    );
    notes.push(
      `Unresolved variables (sample): ${vars}${unresolved.length > 5 ? ', ...' : ''}`
    );
  }

  return { rows: nextRows, resolved, unresolved, notes };
}

function rowRequiresFilterValue(row: CanonicalRow): boolean {
  if (row.variable === '_CAT_') return false;
  if (row.rowKind === 'stat' || row.rowKind === 'not_answered') return false;

  const hasNetComponents = row.isNet && row.netComponents.length > 0;
  if (hasNetComponents) return false;

  return true;
}

function parseNumericScaleValues(
  labels: Array<{ value: number | string; label: string }> | undefined,
): number[] {
  if (!labels || labels.length === 0) return [];
  const nums = labels
    .map((sl) => {
      if (typeof sl.value === 'number') return sl.value;
      const parsed = Number(String(sl.value).trim());
      return Number.isFinite(parsed) ? parsed : NaN;
    })
    .filter((n) => Number.isFinite(n));
  return [...new Set(nums)];
}

function normalizeType(value: string | undefined | null): string {
  return (value || '').trim().toLowerCase();
}

function formatFilterValueFromRange(range: [number, number]): string {
  return `${range[0]}-${range[1]}`;
}

function resolveMissingFilterValue(
  row: CanonicalRow,
  item: QuestionItem | undefined,
  tableNormalizedType: string,
  tableKind: TableKind,
): { filterValue: string | null; reason: string } {
  // 1) Row-shape-derived values (highest confidence, no assumptions).
  if (row.rowKind === 'bin' && row.binRange) {
    return {
      filterValue: formatFilterValueFromRange(row.binRange),
      reason: 'rowKind=bin with binRange',
    };
  }
  if (row.rowKind === 'rank' && typeof row.rankLevel === 'number' && row.rankLevel > 0) {
    return {
      filterValue: String(row.rankLevel),
      reason: 'rowKind=rank with rankLevel',
    };
  }
  if (row.rowKind === 'topk' && typeof row.topKLevel === 'number' && row.topKLevel > 0) {
    return {
      filterValue: row.topKLevel > 1 ? `1-${row.topKLevel}` : '1',
      reason: 'rowKind=topk with topKLevel',
    };
  }

  if (row.isNet && row.netComponents.length > 0) {
    const numericComponents = row.netComponents.filter((c) => /^-?\d+(?:\.\d+)?$/.test(c.trim()));
    if (numericComponents.length > 0) {
      return {
        filterValue: numericComponents.join(','),
        reason: 'isNet with numeric netComponents',
      };
    }
  }

  // 2) Item coding-derived values (next best source of truth).
  const numericScaleValues = parseNumericScaleValues(item?.scaleLabels);
  if (numericScaleValues.length === 1) {
    return {
      filterValue: String(numericScaleValues[0]),
      reason: 'single numeric scale label',
    };
  }

  const normalizedType = normalizeType(item?.normalizedType || tableNormalizedType);
  if (numericScaleValues.length >= 2) {
    // For binary/selected-style outputs, using max coded value aligns with existing
    // standard_overview behavior and common 0/1 or 1/2 coding conventions.
    const selectedValue = Math.max(...numericScaleValues);
    if (
      normalizedType === 'binary_flag' ||
      normalizedType === 'categorical_select' ||
      normalizedType === 'single_select'
    ) {
      return {
        filterValue: String(selectedValue),
        reason: `${normalizedType} selected code from numeric scale labels`,
      };
    }
  }

  // 3) Deterministic type fallback when the domain is binary and labels are missing.
  if (normalizedType === 'binary_flag') {
    return {
      filterValue: '1',
      reason: 'binary_flag fallback selected code',
    };
  }

  return {
    filterValue: null,
    reason: `unresolved normalizedType=${normalizedType || 'unknown'} tableKind=${tableKind}`,
  };
}

/**
 * Parse a comma-separated column list from appliesToColumn and filter items
 * to only those in the list.
 */
function getItemsForColumns(items: QuestionItem[], appliesToColumn: string | null): QuestionItem[] {
  if (!appliesToColumn) return items;
  const cols = new Set(appliesToColumn.split(',').map(c => c.trim()));
  const filtered = items.filter(item => cols.has(item.column));
  return filtered.length > 0 ? filtered : items;
}

/**
 * Find a specific item by column name matching appliesToItem.
 */
function findItemByColumn(items: QuestionItem[], appliesToItem: string | null): QuestionItem | undefined {
  if (!appliesToItem) return undefined;
  return items.find(item => item.column === appliesToItem);
}

function resolveBinaryFilterValue(
  item: QuestionItem,
  binarySide: PlannedTable['binarySide'],
): string {
  const itemLabels = item.scaleLabels ?? [];
  if (itemLabels.length === 2) {
    const sideValues = resolveBinarySideValues(itemLabels);
    if (sideValues) {
      return String(binarySide === 'unselected' ? sideValues.unselected : sideValues.selected);
    }
  }

  return binarySide === 'unselected' ? '0' : '1';
}

function normalizeBinaryScaleLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isAffirmativeBinaryLabel(label: string): boolean {
  const normalized = normalizeBinaryScaleLabel(label);
  return normalized === 'yes'
    || normalized === 'selected'
    || normalized === 'true'
    || normalized === 'motivate'
    || normalized === 'motivating'
    || normalized.startsWith('most');
}

function isNegativeBinaryLabel(label: string): boolean {
  const normalized = normalizeBinaryScaleLabel(label);
  return normalized === 'no'
    || normalized === 'notselected'
    || normalized === 'unselected'
    || normalized === 'false'
    || normalized === 'notmotivate'
    || normalized === 'notmotivating'
    || normalized.startsWith('least');
}

function resolveBinarySideValues(
  scaleLabels: Array<{ value: number | string; label: string }>,
): { selected: number; unselected: number } | null {
  const numericLabels = scaleLabels
    .map(label => ({ value: Number(label.value), label: label.label }))
    .filter((label): label is { value: number; label: string } => !Number.isNaN(label.value));
  if (numericLabels.length !== 2) return null;

  const affirmative = numericLabels.find(label => isAffirmativeBinaryLabel(label.label));
  const negative = numericLabels.find(label => isNegativeBinaryLabel(label.label));
  if (affirmative && negative) {
    return {
      selected: affirmative.value,
      unselected: negative.value,
    };
  }

  return {
    selected: Math.max(...numericLabels.map(label => label.value)),
    unselected: Math.min(...numericLabels.map(label => label.value)),
  };
}

function formatBinarySubtitleLabel(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function resolveBinarySideSubtitleLabel(
  items: QuestionItem[],
  binarySide: PlannedTable['binarySide'],
): string | null {
  const firstBinaryItem = items.find(item => (item.scaleLabels ?? []).length === 2);
  if (!firstBinaryItem || !binarySide) return null;

  const scaleLabels = firstBinaryItem.scaleLabels ?? [];
  const sideValues = resolveBinarySideValues(scaleLabels);
  if (!sideValues) return null;

  const targetValue = binarySide === 'unselected' ? sideValues.unselected : sideValues.selected;
  const matchingLabel = scaleLabels.find(label => Number(label.value) === targetValue)?.label;
  return matchingLabel ? formatBinarySubtitleLabel(matchingLabel) : null;
}

// =============================================================================
// Row factory helpers
// =============================================================================

function makeValueRow(
  variable: string,
  label: string,
  filterValue: string,
  overrides?: Partial<CanonicalRow>,
): CanonicalRow {
  return {
    variable,
    label,
    filterValue,
    rowKind: 'value',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig: null,
    ...overrides,
  };
}

function makeNetRow(
  variable: string,
  netLabel: string,
  filterValue: string,
  netComponents: string[],
): CanonicalRow {
  return {
    variable,
    label: netLabel,
    filterValue,
    rowKind: 'net',
    isNet: true,
    indent: 0,
    netLabel,
    netComponents,
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig: null,
  };
}

function makeStatRow(
  variable: string,
  statType: 'mean' | 'median' | 'stddev' | 'stderr',
  label: string,
): CanonicalRow {
  return {
    variable,
    label,
    filterValue: '',
    rowKind: 'stat',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType,
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig: null,
  };
}

function makeBinRow(
  variable: string,
  binRange: [number, number],
  binLabel: string,
): CanonicalRow {
  return {
    variable,
    label: binLabel,
    filterValue: `${binRange[0]}-${binRange[1]}`,
    rowKind: 'bin',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange,
    binLabel,
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig: null,
  };
}

function makeRankRow(
  variable: string,
  label: string,
  rankLevel: number,
  filterValue: string,
): CanonicalRow {
  return {
    variable,
    label,
    filterValue,
    rowKind: 'rank',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig: null,
  };
}

function makeTopKRow(
  variable: string,
  label: string,
  topKLevel: number,
  filterValue: string,
): CanonicalRow {
  return {
    variable,
    label,
    filterValue,
    rowKind: 'topk',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel,
    excludeFromStats: false,
    rollupConfig: null,
  };
}

function makeRollupRow(
  variable: string,
  label: string,
  filterValue: string,
  rollupConfig: RollupConfig,
): CanonicalRow {
  return {
    variable,
    label,
    filterValue,
    rowKind: 'value',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig,
  };
}

// =============================================================================
// Row generation — main dispatch
// =============================================================================

function buildRows(
  planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const kind = planned.tableKind;

  switch (kind) {
    // Standard family
    case 'standard_overview':
      return buildStandardOverviewRows(planned, entry, items);
    case 'standard_item_detail':
      return buildStandardItemDetailRows(planned, entry, items);
    case 'standard_cluster_detail':
      return buildStandardClusterDetailRows(planned, entry, items);

    // Grid family
    case 'grid_row_detail':
    case 'grid_col_detail':
      return buildGridDetailRows(planned, entry, items);

    // Scale full distribution family
    case 'scale_overview_full':
      return buildScaleFullRows(planned, entry, items, false, vocabulary);
    case 'scale_item_detail_full':
      return buildScaleFullRows(planned, entry, items, true, vocabulary);

    // Scale rollup family
    case 'scale_overview_rollup_t2b':
      return buildScaleRollupRows(planned, entry, items, 'top', vocabulary);
    case 'scale_overview_rollup_middle':
      return buildScaleRollupRows(planned, entry, items, 'middle', vocabulary);
    case 'scale_overview_rollup_b2b':
      return buildScaleRollupRows(planned, entry, items, 'bottom', vocabulary);
    case 'scale_overview_rollup_mean':
      return buildScaleRollupMeanRows(planned, entry, items);
    case 'scale_overview_rollup_nps':
      return buildScaleRollupNpsRows(planned, entry, items, vocabulary);
    case 'scale_overview_rollup_combined':
      return buildScaleRollupCombinedRows(planned, entry, items, vocabulary);

    // Scale dimension compare
    case 'scale_dimension_compare':
      return buildScaleDimensionCompareRows(planned, entry, items);

    // Numeric family
    case 'numeric_overview_mean':
      return buildNumericOverviewMeanRows(planned, entry, items);
    case 'numeric_item_detail':
      return buildNumericItemDetailRows(planned, entry, items, vocabulary);
    case 'numeric_per_value_detail':
      return buildNumericPerValueDetailRows(planned, entry, items, vocabulary);
    case 'numeric_optimized_bin_detail':
      return buildNumericOptimizedBinDetailRows(planned, entry, items, vocabulary);

    // Allocation family
    case 'allocation_overview':
      return buildAllocationOverviewRows(planned, entry, items);
    case 'allocation_item_detail':
      return buildAllocationItemDetailRows(planned, entry, items, vocabulary);

    // Ranking family
    case 'ranking_overview_rank':
      return buildRankingOverviewRankRows(planned, entry, items);
    case 'ranking_overview_topk':
      return buildRankingOverviewTopKRows(planned, entry, items);
    case 'ranking_item_rank':
      return buildRankingItemRankRows(planned, entry, items, vocabulary);

    // MaxDiff family
    case 'maxdiff_api':
    case 'maxdiff_ap':
    case 'maxdiff_sharpref':
      return buildMaxDiffRows(planned, entry, items);

    default: {
      // Exhaustive check — should not reach here if all 23 kinds are handled
      const _exhaustive: never = kind;
      return [];
    }
  }
}

// =============================================================================
// Standard frequency rows
// =============================================================================

function buildStandardOverviewRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  const sliceItems = getItemsForColumns(items, planned.appliesToColumn);
  const rows: CanonicalRow[] = [];

  if (sliceItems.length <= 1) {
    // Single-variable: rows from scale labels (coded values)
    const item = sliceItems[0];
    if (!item) return rows;

    const scaleLabels = getScaleLabels(items);
    if (scaleLabels.length > 0) {
      for (const sl of scaleLabels) {
        rows.push(makeValueRow(item.column, sl.label, String(sl.value)));
      }
    } else {
      // No scale labels — single row for the variable itself
      rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
    }
  } else {
    // Multi-item overview: one row per item.
    // Each item is typically a binary flag (0 = not selected, 1 = selected).
    // filterValue counts the selected/unselected side based on planned.binarySide.
    for (const item of sliceItems) {
      rows.push(makeValueRow(
        item.column,
        resolveItemLabel(item),
        resolveBinaryFilterValue(item, planned.binarySide),
      ));
    }
  }

  return rows;
}

function buildStandardItemDetailRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // Per-item detail: if there's an appliesToItem, show that item's coded values
  const targetItem = findItemByColumn(items, planned.appliesToItem);
  const item = targetItem ?? items[0];
  if (!item) return [];

  const rows: CanonicalRow[] = [];
  const scaleLabels = item.scaleLabels ?? [];
  if (scaleLabels.length > 0) {
    for (const sl of scaleLabels) {
      rows.push(makeValueRow(item.column, sl.label, String(sl.value)));
    }
  } else {
    rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
  }

  return rows;
}

function buildStandardClusterDetailRows(
  _planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // Cluster detail: show all items in the question for a given population cluster
  const rows: CanonicalRow[] = [];
  for (const item of items) {
    rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
  }
  return rows;
}

// =============================================================================
// Grid detail rows
// =============================================================================

function buildGridDetailRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // Grid detail: rows from the items in the specified column slice
  const sliceItems = getItemsForColumns(items, planned.appliesToColumn);
  const rows: CanonicalRow[] = [];

  for (const item of sliceItems) {
    const scaleLabels = item.scaleLabels ?? [];
    if (scaleLabels.length > 0) {
      // If the grid items have scale labels, each scale point is a row
      for (const sl of scaleLabels) {
        rows.push(makeValueRow(item.column, sl.label, String(sl.value)));
      }
    } else {
      // Binary/categorical grid: one row per item
      rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
    }
  }

  return rows;
}

// =============================================================================
// Scale full distribution rows
// =============================================================================

/**
 * Build full scale distribution with NETs (T2B, Middle, B2B), child values,
 * non-substantive tail, and stat rows.
 */
function buildScaleFullRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  isItemDetail: boolean,
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const rows: CanonicalRow[] = [];

  // For item detail, use the specific item's column; for overview, use first item
  const targetItem = isItemDetail
    ? (findItemByColumn(items, planned.appliesToItem) ?? items[0])
    : items[0];
  if (!targetItem) return rows;

  const variable = targetItem.column;
  const scaleLabels = targetItem.scaleLabels ?? getScaleLabels(items);
  if (scaleLabels.length === 0) {
    // Fallback: single value row for the variable
    rows.push(makeValueRow(variable, resolveItemLabel(targetItem), ''));
    return rows;
  }

  // Separate substantive labels from non-substantive tail
  const substantiveLabels: Array<{ value: number | string; label: string }> = [];
  const tailLabels: Array<{ value: number | string; label: string }> = [];

  for (const sl of scaleLabels) {
    if (isNonSubstantiveTail(sl.label)) {
      tailLabels.push(sl);
    } else {
      substantiveLabels.push(sl);
    }
  }

  const subCount = substantiveLabels.length;

  // Determine NET boundaries for odd-point scales (and even-bipolar)
  // T2B = top 2, B2B = bottom 2, Middle = everything between.
  // Keep row order T2B -> Middle -> B2B per 13d contract.
  if (subCount >= 5) {
    // Top-2 Box
    const t2bLabels = orderTopBoxChildren(
      substantiveLabels.slice(subCount - 2),
      substantiveLabels,
    );
    const t2bValues = t2bLabels.map(sl => String(sl.value));
    rows.push(makeNetRow(variable, getTopBoxLabel(2, vocabulary), t2bValues.join(','), t2bValues));
    for (const sl of t2bLabels) {
      rows.push(makeValueRow(variable, sl.label, String(sl.value), { indent: 1 }));
    }

    // Middle
    const midLabels = substantiveLabels.slice(2, subCount - 2);
    if (midLabels.length >= 2) {
      const midValues = midLabels.map(sl => String(sl.value));
      rows.push(makeNetRow(variable, vocabulary.middleBoxLabel, midValues.join(','), midValues));
      for (const sl of midLabels) {
        rows.push(makeValueRow(variable, sl.label, String(sl.value), { indent: 1 }));
      }
    } else if (midLabels.length === 1) {
      // Avoid singleton "Middle" NETs on 5-point scales. They duplicate the
      // lone midpoint value row and create noisy duplicate-key warnings later.
      const [middle] = midLabels;
      rows.push(makeValueRow(variable, middle.label, String(middle.value)));
    }

    // Bottom-2 Box
    const b2bLabels = substantiveLabels.slice(0, 2);
    const b2bValues = b2bLabels.map(sl => String(sl.value));
    rows.push(makeNetRow(variable, getBottomBoxLabel(2, vocabulary), b2bValues.join(','), b2bValues));
    for (const sl of b2bLabels) {
      rows.push(makeValueRow(variable, sl.label, String(sl.value), { indent: 1 }));
    }
  } else {
    // For scales <5 substantive points (shouldn't normally reach scale_full, but handle gracefully)
    for (const sl of substantiveLabels) {
      rows.push(makeValueRow(variable, sl.label, String(sl.value)));
    }
  }

  // Non-substantive tail values (e.g., "Don't Know")
  for (const sl of tailLabels) {
    rows.push(makeValueRow(variable, sl.label, String(sl.value), { excludeFromStats: true }));
  }

  // Stat rows
  rows.push(makeStatRow(variable, 'mean', vocabulary.meanLabel));
  rows.push(makeStatRow(variable, 'median', vocabulary.medianLabel));
  rows.push(makeStatRow(variable, 'stddev', vocabulary.stddevLabel));
  rows.push(makeStatRow(variable, 'stderr', vocabulary.stderrLabel));

  return rows;
}

// =============================================================================
// Scale rollup rows
// =============================================================================

/**
 * Compute rollup config from scale labels for a given box position.
 */
function computeRollupConfig(
  scaleLabels: Array<{ value: number | string; label: string }>,
  boxPosition: 'top' | 'middle' | 'bottom',
  vocabulary: TableLabelVocabulary,
): RollupConfig {
  // Filter out non-substantive tails for counting
  const substantive = scaleLabels.filter(sl => !isNonSubstantiveTail(sl.label));
  const scalePoints = substantive.length;

  let boxWidth: number;
  let defaultLabel: string;

  if (boxPosition === 'top') {
    boxWidth = 2;
    defaultLabel = getTopBoxLabel(boxWidth, vocabulary);
  } else if (boxPosition === 'bottom') {
    boxWidth = 2;
    defaultLabel = getBottomBoxLabel(boxWidth, vocabulary);
  } else {
    // Middle = everything between top and bottom 2
    boxWidth = Math.max(scalePoints - 4, 1);
    defaultLabel = vocabulary.middleBoxLabel;
  }

  return { scalePoints, boxPosition, boxWidth, defaultLabel };
}

/**
 * Compute rollup filter value — the coded values that fall in the box.
 */
function computeRollupFilterValue(
  scaleLabels: Array<{ value: number | string; label: string }>,
  boxPosition: 'top' | 'middle' | 'bottom',
): string {
  const substantive = scaleLabels.filter(sl => !isNonSubstantiveTail(sl.label));
  const count = substantive.length;

  if (count < 2) {
    return substantive.map(sl => String(sl.value)).join(',');
  }

  let slice: Array<{ value: number | string; label: string }>;
  if (boxPosition === 'bottom') {
    slice = substantive.slice(0, 2);
  } else if (boxPosition === 'top') {
    slice = substantive.slice(count - 2);
  } else {
    slice = substantive.slice(2, count - 2);
  }

  return slice.map(sl => String(sl.value)).join(',');
}

function buildScaleRollupRows(
  _planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  boxPosition: 'top' | 'middle' | 'bottom',
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const rows: CanonicalRow[] = [];
  const scaleLabels = getScaleLabels(items);
  const rollupConfig = computeRollupConfig(scaleLabels, boxPosition, vocabulary);
  const filterValue = computeRollupFilterValue(scaleLabels, boxPosition);

  // One row per item — each item's rollup proportion for this box
  for (const item of items) {
    rows.push(makeRollupRow(
      item.column,
      resolveItemLabel(item),
      filterValue,
      rollupConfig,
    ));
  }

  return rows;
}

function buildScaleRollupMeanRows(
  _planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // One row per item — mean score per item
  const rows: CanonicalRow[] = [];
  for (const item of items) {
    rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
  }
  return rows;
}

function buildScaleRollupNpsRows(
  _planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const rows: CanonicalRow[] = [];
  const scaleLabels = getScaleLabels(items);
  const substantive = scaleLabels.filter(sl => !isNonSubstantiveTail(sl.label));

  // NPS: Detractors (0-6), Passives (7-8), Promoters (9-10) if 11-point
  // Generic fallback: bottom chunk, middle chunk, top chunk
  const count = substantive.length;
  const isStandard11 = count === 11;

  let detractorValues: string[];
  let passiveValues: string[];
  let promoterValues: string[];

  if (isStandard11) {
    detractorValues = substantive.slice(0, 7).map(sl => String(sl.value));
    passiveValues = substantive.slice(7, 9).map(sl => String(sl.value));
    promoterValues = substantive.slice(9, 11).map(sl => String(sl.value));
  } else {
    // Non-standard: rough thirds
    const third = Math.floor(count / 3);
    detractorValues = substantive.slice(0, third).map(sl => String(sl.value));
    passiveValues = substantive.slice(third, count - third).map(sl => String(sl.value));
    promoterValues = substantive.slice(count - third).map(sl => String(sl.value));
  }

  // For multi-item: one row per item with each NPS segment
  // For single-item: three segment rows (Promoter, Passive, Detractor) + NPS score
  if (items.length <= 1) {
    const variable = items[0]?.column ?? '';
    rows.push(makeNetRow(variable, vocabulary.promotersLabel, promoterValues.join(','), promoterValues));
    rows.push(makeNetRow(variable, vocabulary.passivesLabel, passiveValues.join(','), passiveValues));
    rows.push(makeNetRow(variable, vocabulary.detractorsLabel, detractorValues.join(','), detractorValues));
    rows.push(makeStatRow(variable, 'mean', vocabulary.npsScoreLabel));
  } else {
    // Multi-item NPS overview: one rollup row per item (NPS score per item)
    for (const item of items) {
      rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
    }
  }

  return rows;
}

function buildScaleRollupCombinedRows(
  _planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const rows: CanonicalRow[] = [];
  const scaleLabels = getScaleLabels(items);
  const variable = items[0]?.column ?? '';

  // Combined rollup: T2B, Middle, B2B as rows in a single table
  const t2bConfig = computeRollupConfig(scaleLabels, 'top', vocabulary);
  const midConfig = computeRollupConfig(scaleLabels, 'middle', vocabulary);
  const b2bConfig = computeRollupConfig(scaleLabels, 'bottom', vocabulary);

  const t2bFilter = computeRollupFilterValue(scaleLabels, 'top');
  const midFilter = computeRollupFilterValue(scaleLabels, 'middle');
  const b2bFilter = computeRollupFilterValue(scaleLabels, 'bottom');

  rows.push(makeRollupRow(variable, getTopBoxLabel(2, vocabulary), t2bFilter, t2bConfig));
  rows.push(makeRollupRow(variable, vocabulary.middleBoxLabel, midFilter, midConfig));
  rows.push(makeRollupRow(variable, getBottomBoxLabel(2, vocabulary), b2bFilter, b2bConfig));

  return rows;
}

// =============================================================================
// Scale dimension compare rows
// =============================================================================

function buildScaleDimensionCompareRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // One row per dimension member column
  const rows: CanonicalRow[] = [];
  const colItems = getItemsForColumns(items, planned.appliesToColumn);

  if (colItems.length > 0) {
    for (const item of colItems) {
      rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
    }
  } else if (planned.appliesToColumn) {
    // Items not found in entry — generate placeholder rows from column names
    const cols = planned.appliesToColumn.split(',').map(c => c.trim());
    for (const col of cols) {
      rows.push(makeValueRow(col, col, ''));
    }
  }

  return rows;
}

// =============================================================================
// Numeric rows
// =============================================================================

function buildNumericOverviewMeanRows(
  _planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // One row per item — mean per item (mean_rows tableType)
  const rows: CanonicalRow[] = [];
  for (const item of items) {
    rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
  }
  return rows;
}

/**
 * Generate deterministic bin rows for numeric/allocation detail.
 * Default 0-100 bins; non-0-100 ranges use deterministic contextual bins.
 */
const NICE_STEPS = [1, 2, 5, 10, 15, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

function parseNumericScaleValue(value: number | string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function getNumericRangeFromScaleLabels(
  scaleLabels: Array<{ value: number | string; label: string }>,
): [number, number] | null {
  const numericValues = scaleLabels
    .map(sl => parseNumericScaleValue(sl.value))
    .filter((n): n is number => n !== null);

  if (numericValues.length === 0) return null;
  return [Math.min(...numericValues), Math.max(...numericValues)];
}

function getObservedRangeFromItems(items: QuestionItem[]): [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    if (item.observedMin != null) min = Math.min(min, item.observedMin);
    if (item.observedMax != null) max = Math.max(max, item.observedMax);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return [min, max];
}

function getNumericRangeForItems(items: QuestionItem[]): [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const scaleLabels = item.scaleLabels ?? [];
    for (const sl of scaleLabels) {
      const n = parseNumericScaleValue(sl.value);
      if (n === null) continue;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return [min, max];
}

function buildEqualWidthBinRanges(
  intMin: number,
  intMax: number,
  count: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (count <= 0) return ranges;

  const width = (intMax - intMin + 1) / count;
  let previousEnd = intMin - 1;

  for (let i = 0; i < count; i++) {
    const rawStart = i === 0 ? intMin : Math.floor(intMin + width * i);
    const rawEnd = i === count - 1 ? intMax : Math.floor(intMin + width * (i + 1) - 1);
    const start = Math.max(rawStart, previousEnd + 1);
    const end = Math.max(start, rawEnd);
    previousEnd = end;
    ranges.push([start, end]);
  }

  return ranges;
}

function buildContextualBinRanges(
  min: number,
  max: number,
): Array<[number, number]> {
  const intMin = Math.floor(min);
  const intMax = Math.ceil(max);
  if (intMax <= intMin) return [];

  if (intMax - intMin <= 2) {
    return [[intMin, intMax]];
  }

  type Candidate = { step: number; niceStart: number; binCount: number };
  const candidates: Candidate[] = [];

  for (const step of NICE_STEPS) {
    const niceStart = Math.floor(intMin / step) * step;
    const binCount = Math.ceil((intMax - niceStart) / step);
    if (binCount >= 3 && binCount <= 7) {
      candidates.push({ step, niceStart, binCount });
    }
  }

  if (candidates.length === 0) {
    return buildEqualWidthBinRanges(intMin, intMax, 5);
  }

  candidates.sort((a, b) => {
    const distA = Math.abs(a.binCount - 5);
    const distB = Math.abs(b.binCount - 5);
    if (distA !== distB) return distA - distB;
    return b.step - a.step;
  });

  const best = candidates[0];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < best.binCount; i++) {
    const start = best.niceStart + i * best.step;
    const rawEnd = start + best.step - 1;
    const end = i === best.binCount - 1 ? Math.max(rawEnd, intMax) : rawEnd;
    ranges.push([start, end]);
  }
  return ranges;
}

function buildNumericBinRows(
  variable: string,
  valueRange: [number, number] | null,
): CanonicalRow[] {
  const rows: CanonicalRow[] = [];

  const isDefaultRange = !valueRange
    || (Math.floor(valueRange[0]) === 0 && Math.ceil(valueRange[1]) === 100);

  if (isDefaultRange) {
    rows.push(makeBinRow(variable, [0, 0], '0'));
    rows.push(makeBinRow(variable, [1, 10], '1-10'));
    rows.push(makeBinRow(variable, [11, 20], '11-20'));
    rows.push(makeBinRow(variable, [21, 30], '21-30'));
    rows.push(makeBinRow(variable, [31, 40], '31-40'));
    rows.push(makeBinRow(variable, [41, 50], '41-50'));
    rows.push(makeBinRow(variable, [51, 60], '51-60'));
    rows.push(makeBinRow(variable, [61, 70], '61-70'));
    rows.push(makeBinRow(variable, [71, 80], '71-80'));
    rows.push(makeBinRow(variable, [81, 90], '81-90'));
    rows.push(makeBinRow(variable, [91, 99], '91-99'));
    rows.push(makeBinRow(variable, [100, 100], '100'));
    return rows;
  }

  const ranges = buildContextualBinRanges(valueRange[0], valueRange[1]);
  for (const [start, end] of ranges) {
    rows.push(makeBinRow(variable, [start, end], `${start}-${end}`));
  }

  return rows;
}

function buildNumericStatRows(variable: string, vocabulary: TableLabelVocabulary): CanonicalRow[] {
  return [
    makeStatRow(variable, 'mean', vocabulary.meanLabel),
    makeStatRow(variable, 'median', vocabulary.medianLabel),
    makeStatRow(variable, 'stddev', vocabulary.stddevLabel),
    makeStatRow(variable, 'stderr', vocabulary.stderrLabel),
  ];
}

function buildNumericItemDetailRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const targetItem = findItemByColumn(items, planned.appliesToItem) ?? items[0];
  if (!targetItem) return [];

  const variable = targetItem.column;
  const rows: CanonicalRow[] = [];
  const valueRange = getNumericRangeFromScaleLabels(targetItem.scaleLabels ?? []);

  // Bin rows + stat rows
  rows.push(...buildNumericBinRows(variable, valueRange));
  rows.push(...buildNumericStatRows(variable, vocabulary));

  return rows;
}

function buildNumericPerValueDetailRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const targetItem = findItemByColumn(items, planned.appliesToItem) ?? items[0];
  if (!targetItem) return [];

  const variable = targetItem.column;
  const observedValues = targetItem.observedValues ?? [];
  if (observedValues.length === 0) return [];

  const rows: CanonicalRow[] = [];
  for (const val of observedValues) {
    rows.push(makeValueRow(variable, String(val), String(val)));
  }
  rows.push(...buildNumericStatRows(variable, vocabulary));
  return rows;
}

function buildNumericOptimizedBinDetailRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const targetItem = findItemByColumn(items, planned.appliesToItem) ?? items[0];
  if (!targetItem) return [];

  const variable = targetItem.column;
  const observedMin = targetItem.observedMin;
  const observedMax = targetItem.observedMax;
  if (observedMin == null || observedMax == null) return [];

  const rows: CanonicalRow[] = [];
  const ranges = buildContextualBinRanges(observedMin, observedMax);
  for (const [start, end] of ranges) {
    rows.push(makeBinRow(variable, [start, end], `${start}-${end}`));
  }
  rows.push(...buildNumericStatRows(variable, vocabulary));
  return rows;
}

// =============================================================================
// Allocation rows
// =============================================================================

function buildAllocationOverviewRows(
  _planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // Allocation overview = mean per item (mean_rows tableType)
  const rows: CanonicalRow[] = [];
  for (const item of items) {
    rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
  }
  return rows;
}

function buildAllocationItemDetailRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const targetItem = findItemByColumn(items, planned.appliesToItem) ?? items[0];
  if (!targetItem) return [];

  const variable = targetItem.column;
  const rows: CanonicalRow[] = [];
  const valueRange = getNumericRangeFromScaleLabels(targetItem.scaleLabels ?? []);

  // Bin rows + stat rows (same structure as numeric detail)
  rows.push(...buildNumericBinRows(variable, valueRange));
  rows.push(...buildNumericStatRows(variable, vocabulary));

  return rows;
}

// =============================================================================
// Ranking rows
// =============================================================================

function buildRankingOverviewRankRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  // Infer rank level from the planned table's tableRole or tableIdCandidate
  const rankLevel = extractRankLevel(planned);
  const sliceItems = getItemsForColumns(items, planned.appliesToColumn);
  const rows: CanonicalRow[] = [];

  // One row per item, each filtered to the specific rank level
  for (const item of sliceItems) {
    rows.push(makeRankRow(
      item.column,
      resolveItemLabel(item),
      rankLevel,
      String(rankLevel),
    ));
  }

  return rows;
}

function buildRankingOverviewTopKRows(
  planned: PlannedTable,
  _entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  const topKLevel = extractTopKLevel(planned);
  const sliceItems = getItemsForColumns(items, planned.appliesToColumn);
  const rows: CanonicalRow[] = [];

  // One row per item, filtered to cumulative range 1..K
  const filterValue = topKLevel > 1 ? `1-${topKLevel}` : '1';
  for (const item of sliceItems) {
    rows.push(makeTopKRow(
      item.column,
      resolveItemLabel(item),
      topKLevel,
      filterValue,
    ));
  }

  return rows;
}

function buildRankingItemRankRows(
  planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
  vocabulary: TableLabelVocabulary,
): CanonicalRow[] {
  const K = entry?.rankingDetail?.K ?? 5;
  const targetItem = findItemByColumn(items, planned.appliesToItem) ?? items[0];
  if (!targetItem) return [];

  const variable = targetItem.column;
  const rows: CanonicalRow[] = [];

  // Rank rows 1..K (e.g. "Ranked 1st", "Rank 1", "First Choice")
  for (let r = 1; r <= K; r++) {
    rows.push(makeRankRow(variable, getRankLabel(r, vocabulary), r, String(r)));
  }

  // Cumulative top-K rows mirror ranking overviews without duplicating Rank 1.
  for (let topK = 2; topK < K; topK++) {
    rows.push(makeTopKRow(variable, `Top ${topK}`, topK, `1-${topK}`));
  }

  // Not answered row
  rows.push({
    variable,
    label: vocabulary.notRankedLabel,
    filterValue: '',
    rowKind: 'not_answered',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: true,
    rollupConfig: null,
  });

  return rows;
}

/**
 * Extract rank level from planned table metadata.
 * Parses from tableRole (e.g., "overview_rank_2") or tableIdCandidate.
 */
function extractRankLevel(planned: PlannedTable): number {
  // Try tableRole: "overview_rank_N"
  const roleMatch = planned.tableRole.match(/overview_rank_(\d+)/);
  if (roleMatch) return parseInt(roleMatch[1], 10);

  // Try tableIdCandidate: contains "rank1", "rank2", etc.
  const idMatch = planned.tableIdCandidate.match(/rank(\d+)/);
  if (idMatch) return parseInt(idMatch[1], 10);

  return 1; // fallback
}

/**
 * Extract top-K level from planned table metadata.
 * Parses from tableRole (e.g., "overview_top3") or tableIdCandidate.
 */
function extractTopKLevel(planned: PlannedTable): number {
  // Try tableRole: "overview_topN"
  const roleMatch = planned.tableRole.match(/overview_top(\d+)/);
  if (roleMatch) return parseInt(roleMatch[1], 10);

  // Try tableIdCandidate: contains "top2", "top3", etc.
  const idMatch = planned.tableIdCandidate.match(/top(\d+)/);
  if (idMatch) return parseInt(idMatch[1], 10);

  return 2; // fallback
}

// =============================================================================
// MaxDiff rows
// =============================================================================

function buildMaxDiffRows(
  _planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): CanonicalRow[] {
  const rows: CanonicalRow[] = [];

  // MaxDiff tables: one value row per score variable/item
  // If we have items from the entry, use those
  if (items.length > 0) {
    for (const item of items) {
      rows.push(makeValueRow(item.column, resolveItemLabel(item), ''));
    }
  } else {
    // No entry items — try to construct from variables in the entry
    const vars = entry?.variables ?? [];
    for (const v of vars) {
      rows.push(makeValueRow(v, v, ''));
    }
  }

  if (rows.length === 0) {
    const fallbackVariable = entry?.questionId ?? 'maxdiff';
    const fallbackLabel = entry?.questionText ?? 'MaxDiff score';
    rows.push(makeValueRow(fallbackVariable, fallbackLabel, ''));
  }

  return rows;
}

// =============================================================================
// Stats spec defaults
// =============================================================================

function buildStatsSpec(
  tableKind: TableKind,
  entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): StatsSpec | null {
  if (
    (entry?.analyticalSubtype === 'allocation' || entry?.normalizedType === 'numeric_range') &&
    (tableKind === 'grid_row_detail' || tableKind === 'grid_col_detail')
  ) {
    const numericRange = getNumericRangeForItems(items) ?? [0, 100];
    const tailValues = getTailValuesForItems(items);
    return {
      mean: true,
      meanWithoutOutliers: true,
      median: true,
      stdDev: true,
      stdErr: true,
      valueRange: numericRange,
      excludeTailValues: tailValues,
    };
  }

  switch (tableKind) {
    case 'scale_overview_full':
    case 'scale_item_detail_full': {
      const scaleLabels = getScaleLabels(items);
      const substantive = scaleLabels.filter(sl => !isNonSubstantiveTail(sl.label));
      const tailValues = getTailValuesFromScaleLabels(scaleLabels);

      const numericValues = substantive
        .map(sl => typeof sl.value === 'number' ? sl.value : parseFloat(String(sl.value)))
        .filter(v => !isNaN(v));

      const valueRange: [number, number] | null = numericValues.length >= 2
        ? [Math.min(...numericValues), Math.max(...numericValues)]
        : null;

      return {
        mean: true,
        meanWithoutOutliers: false,
        median: true,
        stdDev: true,
        stdErr: true,
        valueRange,
        excludeTailValues: tailValues,
      };
    }

    case 'scale_overview_rollup_mean': {
      const scaleLabels = getScaleLabels(items);
      const substantive = scaleLabels.filter(sl => !isNonSubstantiveTail(sl.label));
      const tailValues = getTailValuesFromScaleLabels(scaleLabels);

      const numericValues = substantive
        .map(sl => typeof sl.value === 'number' ? sl.value : parseFloat(String(sl.value)))
        .filter(v => !isNaN(v));

      const valueRange: [number, number] | null = numericValues.length >= 2
        ? [Math.min(...numericValues), Math.max(...numericValues)]
        : null;

      return {
        mean: true,
        meanWithoutOutliers: false,
        median: false,
        stdDev: false,
        stdErr: false,
        valueRange,
        excludeTailValues: tailValues,
      };
    }

    // Scale rollup percentage tables: no stat rows, but they still need
    // excludeTailValues for rebasing when non-substantive tail is excluded.
    case 'scale_overview_rollup_t2b':
    case 'scale_overview_rollup_middle':
    case 'scale_overview_rollup_b2b':
    case 'scale_overview_rollup_combined':
    case 'scale_overview_rollup_nps': {
      const scaleLabelsForRollup = getScaleLabels(items);
      const tailValuesForRollup = getTailValuesFromScaleLabels(scaleLabelsForRollup);
      return {
        mean: false,
        meanWithoutOutliers: false,
        median: false,
        stdDev: false,
        stdErr: false,
        valueRange: null,
        excludeTailValues: tailValuesForRollup,
      };
    }

    case 'numeric_overview_mean':
    case 'numeric_item_detail':
    case 'numeric_per_value_detail':
    case 'numeric_optimized_bin_detail':
    case 'allocation_overview':
    case 'allocation_item_detail': {
      const observedRange = getObservedRangeFromItems(items);
      const numericRange = observedRange ?? getNumericRangeForItems(items) ?? [0, 100];
      const tailValues = getTailValuesForItems(items);
      return {
        mean: true,
        meanWithoutOutliers: true,
        median: true,
        stdDev: true,
        stdErr: true,
        valueRange: numericRange,
        excludeTailValues: tailValues,
      };
    }

    default:
      return null;
  }
}

function getTailValuesFromScaleLabels(
  scaleLabels: Array<{ value: number | string; label: string }>,
): number[] {
  const tailValues = new Set<number>();

  for (const sl of scaleLabels) {
    if (!isNonSubstantiveTail(sl.label)) continue;
    const numericValue = parseNumericScaleValue(sl.value);
    if (numericValue !== null) {
      tailValues.add(numericValue);
    }
  }

  return Array.from(tailValues).sort((a, b) => a - b);
}

function getTailValuesForItems(items: QuestionItem[]): number[] {
  const tailValues = new Set<number>();

  for (const item of items) {
    const itemTailValues = getTailValuesFromScaleLabels(item.scaleLabels ?? []);
    for (const value of itemTailValues) {
      tailValues.add(value);
    }
  }

  return Array.from(tailValues).sort((a, b) => a - b);
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
// Base text generation
// =============================================================================

function buildBaseDisclosure(
  planned: PlannedTable,
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
    return buildLegacyBaseDisclosure(planned, entry);
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

  return {
    referenceBaseN: resolveReferenceBaseN(planned),
    itemBaseRange,
    defaultBaseText: buildContractBaseText(planned, entry),
    defaultNoteTokens: Array.from(new Set(defaultNoteTokens)),
    excludedResponseLabels: contract.policy.rebasePolicy !== 'none'
      ? getExcludedResponseLabelsFromEntry(entry)
      : [],
    rangeDisclosure: hasRangeDisclosure
      ? {
          min: itemBaseRange[0],
          max: itemBaseRange[1],
        }
      : null,
    source: 'contract',
  };
}

function buildLegacyBaseDisclosure(
  planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
): CanonicalBaseDisclosure {
  return {
    referenceBaseN: resolveReferenceBaseN(planned),
    itemBaseRange: null,
    defaultBaseText: buildLegacyBaseText(planned, entry),
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

function resolveReferenceBaseN(planned: PlannedTable): number | null {
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

function buildContractBaseText(
  planned: PlannedTable,
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

  let baseText: string;
  if (isModelDerived) {
    baseText = 'Model-derived base';
  } else if (isCluster) {
    baseText = 'Population cluster';
  } else if (isItemPrecision && !usesRankingArtifactSharedBase) {
    const itemLabel = resolvePrecisionItemLabel(entry, planned.appliesToItem);
    baseText = itemLabel
      ? `Respondents shown ${itemLabel}`
      : 'Respondents shown selected item';
  } else if (isFiltered) {
    baseText = `Those who were shown ${resolveQuestionReferenceLabel(entry, planned)}`;
  } else {
    baseText = 'Total respondents';
  }

  return baseText;
}

function buildLegacyBaseText(
  planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
): string {
  if (planned.basePolicy.includes('cluster_base')) {
    return 'Population cluster';
  }

  if (planned.basePolicy.includes('rebased')) {
    return 'Total respondents';
  }

  if (planned.basePolicy.includes('item_base') && planned.appliesToItem) {
    const itemLabel = resolvePrecisionItemLabel(entry, planned.appliesToItem);
    return itemLabel
      ? `Respondents shown ${itemLabel}`
      : 'Respondents shown selected item';
  }

  if (entry?.isFiltered) {
    return `Those who were shown ${resolveQuestionReferenceLabel(entry, planned)}`;
  }

  return 'Total respondents';
}

function resolveQuestionReferenceLabel(
  entry: QuestionIdEntry | undefined,
  planned: PlannedTable,
): string {
  const value = entry?.displayQuestionId
    || entry?.questionId
    || planned.sourceQuestionId
    || planned.familyRoot;
  return value || 'this question';
}

function resolvePrecisionItemLabel(
  entry: QuestionIdEntry | undefined,
  itemColumn: string | null,
): string | null {
  if (!entry || !itemColumn) return null;

  const item = entry.items?.find(candidate => candidate.column === itemColumn);
  if (!item) return null;

  const resolved = resolveItemLabel(item, entry.questionText).trim();
  if (!resolved || resolved === itemColumn) return null;
  return resolved;
}

// =============================================================================
// Presentation helpers
// =============================================================================

/**
 * Extract a section header from survey text. Looks for patterns like
 * "SECTION: ..." or "[Section N]" at the beginning.
 */
function extractSection(surveyText: string): string {
  if (!surveyText) return '';

  // Try "SECTION: ..." or "Section N:" patterns
  const sectionMatch = surveyText.match(/^(?:SECTION|Section)\s*:?\s*([^\n]+)/i);
  if (sectionMatch) return sectionMatch[1].trim();

  // Try bracketed section headers: "[Section N]"
  const bracketMatch = surveyText.match(/^\[([^\]]+)\]/);
  if (bracketMatch) return bracketMatch[1].trim();

  return '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeComparisonText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function stripQuestionIdPrefix(value: string, questionId: string): string {
  const trimmed = value.trim();
  const normalizedQuestionId = questionId.trim();
  if (!normalizedQuestionId) return trimmed;

  const prefixRx = new RegExp(
    `^${escapeRegExp(normalizedQuestionId)}\\s*[.:)\\-]\\s*`,
    'i',
  );
  return trimmed.replace(prefixRx, '').trim();
}

function subtitleDuplicatesQuestion(
  subtitle: string,
  questionText: string,
  questionId: string,
): boolean {
  const normalizedQuestion = normalizeComparisonText(questionText);
  if (!normalizedQuestion) return false;
  const normalizedSubtitle = normalizeComparisonText(
    stripQuestionIdPrefix(subtitle, questionId),
  );
  return normalizedSubtitle === normalizedQuestion;
}

/**
 * Build a table subtitle from appliesToItem/appliesToColumn context.
 */
function buildTableSubtitle(
  planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
  items: QuestionItem[],
): string {
  if (planned.stimuliSetSlice) {
    if (planned.binarySide) {
      const sliceItems = getItemsForColumns(items, planned.appliesToColumn);
      const sideLabel = resolveBinarySideSubtitleLabel(sliceItems, planned.binarySide);
      if (sideLabel) return `${planned.stimuliSetSlice.setLabel} — ${sideLabel}`;
      if (planned.binarySide === 'selected') return `${planned.stimuliSetSlice.setLabel} — Selected`;
      if (planned.binarySide === 'unselected') return `${planned.stimuliSetSlice.setLabel} — Not Selected`;
    }
    return planned.stimuliSetSlice.setLabel;
  }

  const questionId = entry?.displayQuestionId ?? entry?.questionId ?? '';
  const questionText = entry?.displayQuestionText ?? entry?.questionText ?? '';

  if (planned.appliesToItem && entry) {
    // Try to find the item label for richer subtitle
    const item = findItemByColumn(items, planned.appliesToItem);
    if (item) {
      const label = resolveItemLabel(item, questionText);
      return subtitleDuplicatesQuestion(label, questionText, questionId) ? '' : label;
    }

    // Grid coordinate key (e.g., "r1", "c1", "v3") — resolve from appliesToColumn
    if (planned.appliesToColumn) {
      const gridLabel = resolveGridSliceSubtitle(planned, items, questionText);
      if (gridLabel) {
        return subtitleDuplicatesQuestion(gridLabel, questionText, questionId) ? '' : gridLabel;
      }
    }

    return planned.appliesToItem;
  }

  if (planned.appliesToColumn && !planned.appliesToItem) {
    // Grid slice: describe the column range
    const colCount = planned.appliesToColumn.split(',').length;
    if (colCount > 1) {
      return `${colCount} items`;
    }
    // Single column: try to find its label
    const item = findItemByColumn(items, planned.appliesToColumn);
    if (item) {
      const label = resolveItemLabel(item, questionText);
      return subtitleDuplicatesQuestion(label, questionText, questionId) ? '' : label;
    }
    return planned.appliesToColumn;
  }

  return '';
}

// =============================================================================
// Grid subtitle resolution helpers
// =============================================================================

/**
 * Resolve a meaningful subtitle for a grid table whose appliesToItem is
 * a coordinate key (e.g., "r1", "c1", "v3") rather than an actual column name.
 * Uses appliesToColumn to find real items and derive a label.
 *
 * Fallback chain:
 *   1. Scale value label (conceptual grid v-slices)
 *   2. Shared resolved label across items (row-major grids)
 *   3. Common suffix from resolved labels (col-major with composite labels)
 *   4. Common suffix from savLabels (col-major — column dimension in raw label)
 *   5. First item's resolved label (always better than raw key)
 */
function resolveGridSliceSubtitle(
  planned: PlannedTable,
  items: QuestionItem[],
  questionText: string,
): string {
  if (!planned.appliesToColumn) return '';

  const columnNames = planned.appliesToColumn.split(',');
  const sliceItems = columnNames
    .map(col => findItemByColumn(items, col))
    .filter((it): it is QuestionItem => it != null);

  if (sliceItems.length === 0) return '';

  // Conceptual grid scale value slice (v{value}) — use the scale label
  if (planned.appliesToItem?.match(/^v\d+$/)) {
    const value = planned.appliesToItem.slice(1);
    for (const item of sliceItems) {
      const match = item.scaleLabels?.find(sl => String(sl.value) === value);
      if (match) return match.label;
    }
  }

  // Single item: straightforward label resolution
  if (sliceItems.length === 1) {
    return resolveItemLabel(sliceItems[0], questionText);
  }

  // Multiple items: check for shared label (common in row-major grids)
  const labels = sliceItems.map(it => resolveItemLabel(it, questionText));
  const uniqueLabels = new Set(labels);
  if (uniqueLabels.size === 1) {
    return labels[0];
  }

  // Different labels (col-major) — try common suffix on resolved labels
  // e.g., "Product A - current allocation", "Product B - current allocation" → "current allocation"
  const labelSuffix = extractCommonSuffix(labels);
  if (labelSuffix) return labelSuffix;

  // Try common suffix on savLabels (column dimension may only be in raw label)
  const savSuffix = extractCommonSavLabelSuffix(sliceItems);
  if (savSuffix) return savSuffix;

  // Fallback: first item's resolved label (still better than raw key like "c1")
  return labels[0];
}

const GRID_SUFFIX_MIN_LENGTH = 3;
const GRID_SUFFIX_SEPARATOR_RE = /^[\s\-–—:,;/|]+/;

/**
 * Find the longest common suffix across strings, then strip leading separators.
 * Returns '' if the cleaned result is too short to be meaningful.
 */
function extractCommonSuffix(strings: string[]): string {
  if (strings.length < 2) return '';

  const minLen = Math.min(...strings.map(s => s.length));
  let commonLen = 0;

  for (let i = 1; i <= minLen; i++) {
    if (strings.every(s => s[s.length - i] === strings[0][strings[0].length - i])) {
      commonLen = i;
    } else {
      break;
    }
  }

  if (commonLen < GRID_SUFFIX_MIN_LENGTH) return '';

  const suffix = strings[0].slice(strings[0].length - commonLen);
  const cleaned = suffix.replace(GRID_SUFFIX_SEPARATOR_RE, '').trim();
  return cleaned.length >= GRID_SUFFIX_MIN_LENGTH ? cleaned : '';
}

/**
 * Extract common suffix from savLabels after stripping the variable name prefix.
 * savLabels typically follow "D300ar1c1: Product - Scenario" format.
 */
function extractCommonSavLabelSuffix(items: QuestionItem[]): string {
  const stripped = items.map(it => {
    const sav = typeof it.savLabel === 'string' ? it.savLabel : '';
    // Strip variable name prefix (e.g., "D300ar1c1: ")
    const colonIdx = sav.indexOf(': ');
    return colonIdx >= 0 ? sav.slice(colonIdx + 2) : sav;
  }).filter(s => s.length > 0);

  if (stripped.length < 2) return '';

  return extractCommonSuffix(stripped);
}

// =============================================================================
// Summary generation
// =============================================================================

function buildSummary(tables: CanonicalTable[]): CanonicalTableOutput['summary'] {
  const byTableKind: Record<string, number> = {};
  const byTableType: Record<string, number> = {};
  const byAnalyticalSubtype: Record<string, number> = {};
  let totalRows = 0;

  for (const t of tables) {
    byTableKind[t.tableKind] = (byTableKind[t.tableKind] || 0) + 1;
    byTableType[t.tableType] = (byTableType[t.tableType] || 0) + 1;
    byAnalyticalSubtype[t.analyticalSubtype] = (byAnalyticalSubtype[t.analyticalSubtype] || 0) + 1;
    totalRows += t.rows.length;
  }

  return { byTableKind, byTableType, byAnalyticalSubtype, totalRows };
}
