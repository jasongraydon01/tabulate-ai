/**
 * Standard Frequency Table Renderer
 *
 * Renders frequency tables with standard horizontal format:
 * - Single row per answer option
 * - Context column (merged per table) with questionId: questionText
 * - Label column for answer options
 * - Value + Sig column pairs for each cut
 * - Supports both percent and count display modes
 */

import type { Worksheet, Cell, Borders } from 'exceljs';
import { FILLS, FONTS, ALIGNMENTS, COLUMN_WIDTHS_STD, getGroupFill } from '../styles';
import type { BannerGroup } from '../../r/RScriptGeneratorV2';
import { formatQuestionTitle } from './questionTitle';
import {
  getDisplayBannerLabel,
  resolveTablePresentationConfig,
} from '@/lib/tablePresentation/labelVocabulary';
import type {
  TableLabelVocabulary,
  TablePresentationConfig,
} from '@/lib/tablePresentation/labelVocabulary';

// =============================================================================
// Types
// =============================================================================

export interface FrequencyRowData {
  label: string;
  n: number | null;
  count: number | null;
  pct: number | null;
  sig_higher_than?: string[] | string;
  sig_vs_total?: string | null;
  isNet?: boolean;
  isStat?: boolean;
  indent?: number;
  isCategoryHeader?: boolean;
}

export interface FrequencyCutData {
  stat_letter: string;
  [rowKey: string]: FrequencyRowData | string;
}

export interface FrequencyTableData {
  tableId: string;
  questionId: string;
  questionText: string;
  tableType: 'frequency';
  isDerived: boolean;
  sourceTableId: string;
  data: Record<string, FrequencyCutData>;
  // Phase 2: Additional table metadata
  surveySection?: string;
  baseText?: string;
  userNote?: string;
  tableSubtitle?: string;
  // Phase 5: Excluded tables support
  excluded?: boolean;
  excludeReason?: string;
}

export interface RenderContext {
  totalRespondents: number;
  bannerGroups: BannerGroup[];
  comparisonGroups: string[];
  significanceLevel: number;
  tablePresentation?: TablePresentationConfig;
}

export type ValueType = 'percent' | 'count';

// =============================================================================
// Column Layout Helpers
// =============================================================================

const CONTEXT_COL = 1;
const LABEL_COL = 2;
const DATA_START_COL = 3;

/**
 * Extended cut info that includes absolute column positions
 * This allows for spacer columns between banner groups
 */
export interface CutColumnInfo {
  name: string;
  displayName: string;
  statLetter: string;
  groupName: string;
  groupDisplayName: string;
  groupIndex: number;
  valueCol: number;  // Absolute column index for value
  sigCol: number;    // Absolute column index for sig
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
}

function buildColumnLayoutWithVocabulary(
  bannerGroups: BannerGroup[],
  vocabulary: TableLabelVocabulary,
): {
  cuts: CutColumnInfo[];
  groupSpacerCols: number[];
  totalCols: number;
} {
  const cuts: CutColumnInfo[] = [];
  const groupSpacerCols: number[] = [];
  let currentCol = DATA_START_COL;

  for (let groupIdx = 0; groupIdx < bannerGroups.length; groupIdx++) {
    const group = bannerGroups[groupIdx];
    const isLastGroup = groupIdx === bannerGroups.length - 1;

    for (let cutIdx = 0; cutIdx < group.columns.length; cutIdx++) {
      const col = group.columns[cutIdx];
      cuts.push({
        name: col.name,
        displayName: getDisplayBannerLabel(col.name, vocabulary),
        statLetter: col.statLetter,
        groupName: group.groupName,
        groupDisplayName: getDisplayBannerLabel(group.groupName, vocabulary),
        groupIndex: groupIdx,
        valueCol: currentCol,
        sigCol: currentCol + 1,
        isFirstInGroup: cutIdx === 0,
        isLastInGroup: cutIdx === group.columns.length - 1,
      });
      currentCol += 2; // value + sig
    }

    // Add spacer column after each group (except the last)
    if (!isLastGroup) {
      groupSpacerCols.push(currentCol);
      currentCol += 1;
    }
  }

  return {
    cuts,
    groupSpacerCols,
    totalCols: currentCol - 1, // Last used column
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatSignificance(sig: string[] | string | undefined): string {
  if (!sig) return '';
  if (typeof sig === 'string') return sig || '';
  if (Array.isArray(sig) && sig.length > 0) {
    // No commas - just concatenate letters (e.g., "AB" not "A,B")
    return sig.join('');
  }
  return '';
}

function normalizeBaseText(baseText: string | undefined): string | null {
  const trimmed = baseText?.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^Base:\s*/i, '').trim();
  return withoutPrefix || null;
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

/**
 * Apply standard-format border based on position
 * Standard format uses minimal borders - thick only at structural boundaries
 * Double-line border goes UNDER group names, NOT between columns
 */
function applyStdBorder(
  cell: Cell,
  options: {
    isFirstCol?: boolean;      // Left edge of table (thick left)
    isLastCol?: boolean;       // Right edge of table (thick right)
    isFirstRow?: boolean;      // Top edge of section (thick top)
    isLastRow?: boolean;       // Bottom edge of section (thick bottom)
    isContextCol?: boolean;    // Context column (thick left AND right)
    isAfterLabel?: boolean;    // Right after label column (thick left)
    isBaseRow?: boolean;       // Base row (thick bottom for separation)
    isGroupNameRow?: boolean;  // Group name row (double-line bottom)
  }
): void {
  const { isFirstCol, isLastCol, isFirstRow, isLastRow, isContextCol, isAfterLabel, isBaseRow, isGroupNameRow } = options;

  // Build border based on position
  const border: Partial<Borders> = {};

  if (isFirstCol || isContextCol) {
    border.left = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isLastCol) {
    border.right = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isContextCol) {
    // Context column gets thick border on both sides
    border.right = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isFirstRow) {
    border.top = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isLastRow) {
    border.bottom = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isBaseRow) {
    // Base row gets thick bottom border to separate from data
    border.bottom = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isAfterLabel) {
    border.left = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isGroupNameRow) {
    // Group name row gets double-line bottom border
    border.bottom = { style: 'double', color: { argb: 'FF000000' } };
  }

  cell.border = border;
}

// =============================================================================
// Header Rendering
// =============================================================================

export interface StdHeaderInfo {
  headerRowCount: number;
  totalCols: number;
  cuts: CutColumnInfo[];
  groupSpacerCols: number[];
  bannerGroups: BannerGroup[];
  tablePresentation?: TablePresentationConfig;
}

/**
 * Render standard-format headers (only once per worksheet)
 * Returns info needed for data rendering
 *
 * Standard format:
 * - Blue headers with wrap text
 * - Spacer column between each banner group
 * - No "Sig" text, red stat letters
 * - Minimal borders
 */
export function renderStdHeaders(
  worksheet: Worksheet,
  bannerGroups: BannerGroup[],
  startRow: number,
  tablePresentation?: TablePresentationConfig,
): StdHeaderInfo {
  let currentRow = startRow;
  const vocabulary = resolveTablePresentationConfig(tablePresentation).labelVocabulary;

  // Build column layout with spacers
  const { cuts, groupSpacerCols, totalCols } = buildColumnLayoutWithVocabulary(bannerGroups, vocabulary);

  // -------------------------------------------------------------------------
  // Row 1: Group headers (merged over value+sig column pairs for each group)
  // -------------------------------------------------------------------------
  // Context column - blank, blue, thick top+left border
  const contextHeader = worksheet.getCell(currentRow, CONTEXT_COL);
  contextHeader.value = '';
  contextHeader.fill = FILLS.stdHeader;
  applyStdBorder(contextHeader, { isFirstRow: true, isContextCol: true });

  // Label column - blank, blue, thick top border
  const labelHeader = worksheet.getCell(currentRow, LABEL_COL);
  labelHeader.value = '';
  labelHeader.fill = FILLS.stdHeader;
  applyStdBorder(labelHeader, { isFirstRow: true });

  // Group headers - each group spans its cuts' columns (KEEP merge for group names only)
  // Double-line border UNDER the group name row
  for (let groupIdx = 0; groupIdx < bannerGroups.length; groupIdx++) {
    const group = bannerGroups[groupIdx];
    const groupCuts = cuts.filter(c => c.groupIndex === groupIdx);
    const isLastGroup = groupIdx === bannerGroups.length - 1;

    if (groupCuts.length > 0) {
      const startCol = groupCuts[0].valueCol;
      const endCol = groupCuts[groupCuts.length - 1].sigCol;

      // Merge group name across all its columns (this is the ONLY merge we keep)
      if (endCol > startCol) {
        worksheet.mergeCells(currentRow, startCol, currentRow, endCol);
      }

      const groupCell = worksheet.getCell(currentRow, startCol);
      groupCell.value = getDisplayBannerLabel(group.groupName, vocabulary);
      groupCell.font = FONTS.header;
      groupCell.fill = FILLS.stdHeader;
      groupCell.alignment = { ...ALIGNMENTS.center, wrapText: true };
      // Thick top, double-line bottom (under group name)
      applyStdBorder(groupCell, {
        isFirstRow: true,
        isGroupNameRow: true,  // Double-line bottom border under group name
        isAfterLabel: groupIdx === 0,
        isLastCol: isLastGroup,
      });
    }

    // Spacer column after group (if not last) - header blue, NO border (gap creates separation)
    if (!isLastGroup && groupSpacerCols[groupIdx]) {
      const spacerCell = worksheet.getCell(currentRow, groupSpacerCols[groupIdx]);
      spacerCell.value = '';
      spacerCell.fill = FILLS.stdHeader;
      // No border on spacer - the gap is the visual separation
    }
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Row 2: Column headers (cut names) - NO merge, value col gets name, sig col empty
  // -------------------------------------------------------------------------
  const contextHeader2 = worksheet.getCell(currentRow, CONTEXT_COL);
  contextHeader2.value = '';
  contextHeader2.fill = FILLS.stdHeader;
  applyStdBorder(contextHeader2, { isContextCol: true });

  const labelHeader2 = worksheet.getCell(currentRow, LABEL_COL);
  labelHeader2.value = '';
  labelHeader2.fill = FILLS.stdHeader;

  for (const cut of cuts) {
    // Value column gets the cut name (NO merge)
    const valCell = worksheet.getCell(currentRow, cut.valueCol);
    valCell.value = cut.displayName;
    valCell.font = FONTS.header;
    valCell.fill = FILLS.stdHeader;
    valCell.alignment = { ...ALIGNMENTS.center, wrapText: true };
    applyStdBorder(valCell, {
      isAfterLabel: cut.isFirstInGroup && cut.groupIndex === 0,
    });

    // Sig column is empty but styled
    const sigCell = worksheet.getCell(currentRow, cut.sigCol);
    sigCell.value = '';
    sigCell.fill = FILLS.stdHeader;
    applyStdBorder(sigCell, {
      isLastCol: cut.isLastInGroup && cut.groupIndex === bannerGroups.length - 1,
    });
  }

  // Spacer columns - header blue, NO border (gap is the separation)
  for (const spacerCol of groupSpacerCols) {
    const spacerCell = worksheet.getCell(currentRow, spacerCol);
    spacerCell.value = '';
    spacerCell.fill = FILLS.stdHeader;
    // No border on spacer
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Row 3: Stat letters (red) - NO merge, value col gets letter, sig col empty
  // -------------------------------------------------------------------------
  const contextHeader3 = worksheet.getCell(currentRow, CONTEXT_COL);
  contextHeader3.value = '';
  contextHeader3.fill = FILLS.stdHeader;
  applyStdBorder(contextHeader3, { isContextCol: true, isLastRow: true });

  const labelHeader3 = worksheet.getCell(currentRow, LABEL_COL);
  labelHeader3.value = '';
  labelHeader3.fill = FILLS.stdHeader;
  applyStdBorder(labelHeader3, { isLastRow: true });

  for (const cut of cuts) {
    // Value column gets the stat letter (NO merge)
    const valCell = worksheet.getCell(currentRow, cut.valueCol);
    valCell.value = `(${cut.statLetter})`;
    valCell.font = FONTS.stdStatLetterRed;
    valCell.fill = FILLS.stdHeader;
    valCell.alignment = ALIGNMENTS.center;
    applyStdBorder(valCell, {
      isAfterLabel: cut.isFirstInGroup && cut.groupIndex === 0,
      isLastRow: true,
    });

    // Sig column is empty but styled
    const sigCell = worksheet.getCell(currentRow, cut.sigCol);
    sigCell.value = '';
    sigCell.fill = FILLS.stdHeader;
    applyStdBorder(sigCell, {
      isLastCol: cut.isLastInGroup && cut.groupIndex === bannerGroups.length - 1,
      isLastRow: true,
    });
  }

  // Spacer columns - header blue, NO border (gap is the separation)
  for (const spacerCol of groupSpacerCols) {
    const spacerCell = worksheet.getCell(currentRow, spacerCol);
    spacerCell.value = '';
    spacerCell.fill = FILLS.stdHeader;
    // No border on spacer
  }
  currentRow++;

  return {
    headerRowCount: currentRow - startRow,
    totalCols,
    cuts,
    groupSpacerCols,
    bannerGroups,
    tablePresentation,
  };
}

// =============================================================================
// Main Renderer
// =============================================================================

export interface StdFrequencyRenderResult {
  endRow: number;
  contextMergeStart: number;
  contextMergeEnd: number;
}

/**
 * Render a single frequency table in standard format
 *
 * Standard format:
 * - Purple context column (merged per table)
 * - Purple + bold+italic base row
 * - Yellow label column
 * - Color-coded data cells per banner group (blue, green, yellow, etc.)
 * - Spacer columns between banner groups
 * - Minimal borders (thick at structural boundaries only)
 * - Bold red significance letters (no commas)
 */
export function renderStdFrequencyTable(
  worksheet: Worksheet,
  table: FrequencyTableData,
  startRow: number,
  headerInfo: StdHeaderInfo,
  valueType: ValueType = 'percent',
  _isFirstTable: boolean = false,
  totalRespondents: number = 0
): StdFrequencyRenderResult {
  const { cuts, groupSpacerCols, bannerGroups } = headerInfo;
  const vocabulary = resolveTablePresentationConfig(headerInfo.tablePresentation).labelVocabulary;
  let currentRow = startRow;
  const contextMergeStart = currentRow;

  // Get row keys from Total cut
  const totalCutData = table.data['Total'];
  const rowKeys = Object.keys(totalCutData || {}).filter(k => k !== 'stat_letter' && k !== 'table_base_n');
  const totalDataRows = rowKeys.length;
  const numGroups = bannerGroups.length;

  // -------------------------------------------------------------------------
  // Base (n) row - Purple background, bold+italic text, thick bottom border
  // NO merge - value col gets n, sig col empty
  // -------------------------------------------------------------------------
  // Find the first non-category-header row with a positive base for base calculation.
  // Category headers have n=null/undefined/{} and should be skipped.
  // Rows with n=0 (e.g., variables not found in .sav) are deprioritized — prefer
  // a row with actual data so the base count is meaningful.
  const firstDataRowKey = rowKeys.find(key => {
    const rowData = totalCutData?.[key] as FrequencyRowData | undefined;
    return rowData && !rowData.isCategoryHeader && typeof rowData.n === 'number' && rowData.n > 0;
  }) || rowKeys.find(key => {
    const rowData = totalCutData?.[key] as FrequencyRowData | undefined;
    return rowData && !rowData.isCategoryHeader && typeof rowData.n === 'number';
  }) || rowKeys[0];

  // Context column - purple, thick left + top + bottom border
  const baseContextCell = worksheet.getCell(currentRow, CONTEXT_COL);
  baseContextCell.value = '';
  baseContextCell.fill = FILLS.stdContext;
  applyStdBorder(baseContextCell, { isContextCol: true, isFirstRow: true, isBaseRow: true });

  // Label column - purple, bold+italic "Base: ...", thick bottom border
  const baseLabelCell = worksheet.getCell(currentRow, LABEL_COL);
  // Get base n from first data row of Total cut (skipping category headers).
  // Prefer table-level base when items have varying bases (emitted by R as table_base_n).
  const firstRowData = totalCutData?.[firstDataRowKey] as FrequencyRowData | undefined;
  const totalTableBaseN = typeof (totalCutData as Record<string, unknown>)?.['table_base_n'] === 'number'
    ? ((totalCutData as Record<string, unknown>)['table_base_n'] as number)
    : null;
  const baseN = totalTableBaseN ?? (typeof firstRowData?.n === 'number' ? firstRowData.n : 0);
  // Base text logic: use provided baseText, or fall back to count-based default
  let baseTextValue: string;
  const normalizedBaseText = normalizeBaseText(table.baseText);
  if (normalizedBaseText) {
    baseTextValue = `${vocabulary.baseLabel}: ${normalizedBaseText}`;
  } else if (totalRespondents > 0 && baseN === totalRespondents) {
    baseTextValue = `${vocabulary.baseLabel}: All respondents`;
  } else {
    baseTextValue = `${vocabulary.baseLabel}: Shown this question`;
  }
  baseLabelCell.value = baseTextValue;
  baseLabelCell.font = FONTS.stdBaseBold;
  baseLabelCell.fill = FILLS.stdBase;
  baseLabelCell.alignment = ALIGNMENTS.left;
  applyStdBorder(baseLabelCell, { isFirstRow: true, isBaseRow: true });

  // Base n for each cut - purple background, bold+italic, NO merge
  for (const cut of cuts) {
    const cutData = table.data[cut.name];
    // Prefer table-level base (table_base_n) over first row's per-item observed n
    const cutTableBaseN = typeof (cutData as Record<string, unknown>)?.['table_base_n'] === 'number'
      ? ((cutData as Record<string, unknown>)['table_base_n'] as number)
      : null;
    const rowData = cutData?.[firstDataRowKey] as FrequencyRowData | undefined;
    const n = cutTableBaseN ?? (typeof rowData?.n === 'number' ? rowData.n : 0);

    // Value column gets the n value (NO merge)
    const valCell = worksheet.getCell(currentRow, cut.valueCol);
    valCell.value = n;
    valCell.font = FONTS.stdBaseBold;
    valCell.fill = FILLS.stdBase;
    valCell.alignment = ALIGNMENTS.center;
    applyStdBorder(valCell, {
      isAfterLabel: cut.isFirstInGroup && cut.groupIndex === 0,
      isFirstRow: true,
      isBaseRow: true,
    });

    // Sig column is empty but styled
    const sigCell = worksheet.getCell(currentRow, cut.sigCol);
    sigCell.value = '';
    sigCell.fill = FILLS.stdBase;
    applyStdBorder(sigCell, {
      isLastCol: cut.isLastInGroup && cut.groupIndex === numGroups - 1,
      isFirstRow: true,
      isBaseRow: true,
    });
  }

  // Spacer columns in base row - purple, WITH borders (continuous border across base row)
  for (const spacerCol of groupSpacerCols) {
    const spacerCell = worksheet.getCell(currentRow, spacerCol);
    spacerCell.value = '';
    spacerCell.fill = FILLS.stdBase;
    // Base row spacers get top and bottom borders for continuity
    spacerCell.border = {
      top: { style: 'medium', color: { argb: 'FF000000' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
    };
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Pre-scan: detect rows with count=0 across ALL cuts (terminate options)
  // These get rendered as "-" instead of "0%" / "0"
  // -------------------------------------------------------------------------
  const allZeroRows = new Set<string>();
  for (const rowKey of rowKeys) {
    const totalRowData = totalCutData?.[rowKey] as FrequencyRowData | undefined;
    if (totalRowData?.isCategoryHeader) continue;
    let allZero = true;
    for (const cut of cuts) {
      const cutData = table.data[cut.name];
      const rowData = cutData?.[rowKey] as FrequencyRowData | undefined;
      if (rowData?.count !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) allZeroRows.add(rowKey);
  }

  // -------------------------------------------------------------------------
  // Data rows: 1 row per answer option, alternating colors within table
  // -------------------------------------------------------------------------
  let insertedStatSpacer = false;
  for (let rowIdx = 0; rowIdx < rowKeys.length; rowIdx++) {
    const rowKey = rowKeys[rowIdx];
    const totalRowData = totalCutData?.[rowKey] as FrequencyRowData | undefined;
    const isNet = totalRowData?.isNet || false;
    const indent = totalRowData?.indent || 0;
    const isCategoryHeader = totalRowData?.isCategoryHeader || false;
    const isStat = totalRowData?.isStat || false;
    const isLastDataRow = rowIdx === totalDataRows - 1;

    // Insert empty spacer row before the first stat row (visual break between
    // scale points and Mean/Median/Std Dev/Std Err)
    if (isStat && !insertedStatSpacer) {
      insertedStatSpacer = true;
      const spacerRowNum = currentRow;
      const ctxCell = worksheet.getCell(spacerRowNum, CONTEXT_COL);
      ctxCell.value = '';
      ctxCell.fill = FILLS.stdContext;
      const lblCell = worksheet.getCell(spacerRowNum, LABEL_COL);
      lblCell.value = '';
      lblCell.fill = FILLS.stdLabel;
      for (const cut of cuts) {
        const vCell = worksheet.getCell(spacerRowNum, cut.valueCol);
        vCell.value = '';
        vCell.fill = getGroupFill(cut.groupIndex, rowIdx);
        const sCell = worksheet.getCell(spacerRowNum, cut.sigCol);
        sCell.value = '';
        sCell.fill = getGroupFill(cut.groupIndex, rowIdx);
      }
      for (let i = 0; i < groupSpacerCols.length; i++) {
        const sCell = worksheet.getCell(spacerRowNum, groupSpacerCols[i]);
        sCell.value = '';
        sCell.fill = getGroupFill(i, rowIdx);
      }
      worksheet.getRow(spacerRowNum).height = 6;
      currentRow++;
    }

    // Build label with indentation
    let rowLabel = totalRowData?.label || rowKey;
    if (indent > 0) {
      rowLabel = '  '.repeat(indent) + rowLabel;
    }

    // Context column - purple (will be merged later)
    const contextCell = worksheet.getCell(currentRow, CONTEXT_COL);
    contextCell.value = '';
    contextCell.fill = FILLS.stdContext;
    applyStdBorder(contextCell, { isContextCol: true, isLastRow: isLastDataRow });

    // Label column - yellow (bold for category headers)
    const labelCell = worksheet.getCell(currentRow, LABEL_COL);
    labelCell.value = rowLabel;
    labelCell.font = isCategoryHeader ? FONTS.labelNet : (isNet ? FONTS.labelNet : FONTS.label);
    labelCell.fill = FILLS.stdLabel;
    labelCell.alignment = ALIGNMENTS.wrapText;
    applyStdBorder(labelCell, { isLastRow: isLastDataRow });

    // Value + Sig for each cut - color per banner group, alternating by row
    for (const cut of cuts) {
      const cutData = table.data[cut.name];
      const rowData = cutData?.[rowKey] as FrequencyRowData | undefined;
      // Pass rowIdx for alternating colors within the table
      const groupFill = getGroupFill(cut.groupIndex, rowIdx);

      // Value column (percent, count, or stat)
      // Rows with count=0 across all cuts (terminate options) show "-" instead of 0%/0
      const valCell = worksheet.getCell(currentRow, cut.valueCol);
      const isAllZeroRow = allZeroRows.has(rowKey);
      const isStat = rowData?.isStat || false;
      if (isCategoryHeader) {
        // Category header: empty cell, no data
        valCell.value = '';
      } else if (isAllZeroRow && !isStat) {
        valCell.value = '-';
      } else if (isStat) {
        // Stat rows (mean, median, std dev, std err): plain number, not percentage
        const pct = rowData?.pct;
        if (pct !== undefined && pct !== null) {
          valCell.value = pct;
          valCell.numFmt = '0.00';
        } else {
          valCell.value = '-';
        }
      } else if (valueType === 'percent') {
        const pct = rowData?.pct;
        if (pct !== undefined && pct !== null) {
          valCell.value = pct / 100;
          valCell.numFmt = '0%';
        } else {
          valCell.value = '-';
        }
      } else {
        const count = rowData?.count;
        if (count !== undefined && count !== null) {
          valCell.value = count;
        } else {
          valCell.value = '-';
        }
      }
      valCell.font = FONTS.data;
      valCell.fill = groupFill;
      valCell.alignment = ALIGNMENTS.center;
      applyStdBorder(valCell, {
        isAfterLabel: cut.isFirstInGroup && cut.groupIndex === 0,
        isLastRow: isLastDataRow,
      });

      // Sig column (bold red letters, empty for category headers)
      const sigCell = worksheet.getCell(currentRow, cut.sigCol);
      const sigValue = isCategoryHeader ? '' : formatSignificance(rowData?.sig_higher_than);
      sigCell.value = sigValue || '';
      sigCell.font = sigValue ? FONTS.significanceLetterRed : FONTS.data;
      sigCell.fill = groupFill;
      sigCell.alignment = ALIGNMENTS.center;
      applyStdBorder(sigCell, {
        isLastCol: cut.isLastInGroup && cut.groupIndex === numGroups - 1,
        isLastRow: isLastDataRow,
      });
    }

    // Spacer columns in data rows - inherit color from left group (with row alternation), NO border
    for (let i = 0; i < groupSpacerCols.length; i++) {
      const spacerCol = groupSpacerCols[i];
      const spacerCell = worksheet.getCell(currentRow, spacerCol);
      spacerCell.value = '';
      // Inherit color from the group to the left (group index i), with row alternation
      spacerCell.fill = getGroupFill(i, rowIdx);
      // No border on spacer - the gap is the visual separation
    }

    currentRow++;
  }

  const contextMergeEnd = currentRow - 1;

  // -------------------------------------------------------------------------
  // Merge context column and add question text
  // -------------------------------------------------------------------------
  if (contextMergeEnd >= contextMergeStart) {
    worksheet.mergeCells(contextMergeStart, CONTEXT_COL, contextMergeEnd, CONTEXT_COL);

    // Build context text with multi-line structure:
    // Line 1: Survey section (ALL CAPS, if present)
    // Line 2: Table subtitle (if present) - differentiates derived tables from same question
    // Line 3: Question ID + text
    // Line 4: User note (if present)
    // Line 5: Exclude reason (if on Excluded sheet)
    const contextLines: string[] = [];

    // 1. Survey section
    if (table.surveySection) {
      contextLines.push(table.surveySection);  // Already ALL CAPS from agent
    }

    // 2. Table subtitle (differentiates derived tables from same question)
    // Skip if it substantially duplicates the question text (e.g., single-item
    // numeric tables where the item label IS the question text with an ID prefix).
    const questionLine = formatQuestionTitle(table.questionId, table.questionText);
    if (table.tableSubtitle) {
      const normalizedSubtitle = normalizeComparisonText(
        stripQuestionIdPrefix(table.tableSubtitle, table.questionId),
      );
      const normalizedQuestion = normalizeComparisonText(table.questionText);
      if (normalizedSubtitle !== normalizedQuestion) {
        contextLines.push(table.tableSubtitle);
      }
    }

    // 3. Question text with ID prefix (system always prepends for consistency)
    // Agent outputs verbatim question text without the question number prefix
    contextLines.push(questionLine);

    // 4. User note (if present - already in parenthetical format from agent)
    if (table.userNote) {
      contextLines.push(table.userNote);
    }

    // 5. Exclude reason (for tables on Excluded sheet)
    if (table.excludeReason) {
      contextLines.push(`[Excluded: ${table.excludeReason}]`);
    }

    const contextText = contextLines.join('\n');

    // Auto-size row heights if context text needs more space
    // ExcelJS doesn't auto-fit, so we estimate based on text length
    const charsPerLine = 30;  // rough estimate for 25-char column width at 10pt font
    const lineHeight = 14;    // ~14pt per line
    const explicitNewlines = (contextText.match(/\n/g) || []).length;
    const estimatedWrapLines = Math.ceil(contextText.length / charsPerLine);
    const totalLines = explicitNewlines + estimatedWrapLines;
    const requiredHeight = totalLines * lineHeight;

    const numRows = contextMergeEnd - contextMergeStart + 1;
    const defaultRowHeight = 16;
    const availableHeight = numRows * defaultRowHeight;

    if (requiredHeight > availableHeight && numRows > 0) {
      const heightPerRow = Math.ceil(requiredHeight / numRows);
      for (let r = contextMergeStart; r <= contextMergeEnd; r++) {
        worksheet.getRow(r).height = heightPerRow;
      }
    }

    const mergedContextCell = worksheet.getCell(contextMergeStart, CONTEXT_COL);
    mergedContextCell.value = contextText;
    mergedContextCell.font = FONTS.context;
    mergedContextCell.fill = FILLS.stdContext;
    mergedContextCell.alignment = {
      ...ALIGNMENTS.wrapText,
      vertical: 'top',
    };
  }

  return {
    endRow: currentRow,
    contextMergeStart,
    contextMergeEnd,
  };
}

// =============================================================================
// Column Width Setup
// =============================================================================

const SPACER_COL_WIDTH = 2; // Narrow spacer between groups

/**
 * Set column widths for standard format
 * Uses headerInfo to get actual column positions (with spacers)
 */
export function setStdColumnWidths(
  worksheet: Worksheet,
  headerInfo: StdHeaderInfo,
  options?: { labelWidth?: number }
): void {
  worksheet.getColumn(CONTEXT_COL).width = COLUMN_WIDTHS_STD.context;
  worksheet.getColumn(LABEL_COL).width = options?.labelWidth ?? COLUMN_WIDTHS_STD.label;

  // Set widths for value and sig columns
  for (const cut of headerInfo.cuts) {
    worksheet.getColumn(cut.valueCol).width = COLUMN_WIDTHS_STD.value;
    worksheet.getColumn(cut.sigCol).width = COLUMN_WIDTHS_STD.significance;
  }

  // Set narrow width for spacer columns
  for (const spacerCol of headerInfo.groupSpacerCols) {
    worksheet.getColumn(spacerCol).width = SPACER_COL_WIDTH;
  }
}
