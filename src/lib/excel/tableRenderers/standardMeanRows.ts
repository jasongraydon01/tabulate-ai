/**
 * Standard Mean Rows Table Renderer
 *
 * Renders mean_rows tables with standard horizontal format:
 * - Single row per item (with mean value)
 * - Context column (merged per table) with questionId: questionText
 * - Label column for item names
 * - Value + Sig column pairs for each cut
 * - Mean values displayed as decimals (no percentage)
 */

import type { Worksheet, Cell, Borders } from 'exceljs';
import { FILLS, FONTS, ALIGNMENTS, getGroupFill } from '../styles';
import type { StdHeaderInfo } from './standardFrequency';
import { formatQuestionTitle } from './questionTitle';
import { resolveTablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';

// =============================================================================
// Types
// =============================================================================

export interface MeanRowData {
  label: string;
  n: number | null;
  mean: number | null;
  mean_label?: string;
  median: number | null;
  median_label?: string;
  sd: number | null;
  std_err: number | null;
  mean_no_outliers?: number | null;
  mean_no_outliers_label?: string;
  sig_higher_than?: string[] | string;
  sig_vs_total?: string | null;
  isNet?: boolean;
  indent?: number;
  isCategoryHeader?: boolean;
}

export interface MeanCutData {
  stat_letter: string;
  [rowKey: string]: MeanRowData | string;
}

export interface MeanRowsTableData {
  tableId: string;
  questionId: string;
  questionText: string;
  tableType: 'mean_rows';
  isDerived: boolean;
  sourceTableId: string;
  data: Record<string, MeanCutData>;
  // Phase 2: Additional table metadata
  surveySection?: string;
  baseText?: string;
  userNote?: string;
  tableSubtitle?: string;
  // Phase 5: Excluded tables support
  excluded?: boolean;
  excludeReason?: string;
}

// =============================================================================
// Column Layout Helpers
// =============================================================================

const CONTEXT_COL = 1;
const LABEL_COL = 2;

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
    isContextCol?: boolean;  // Context column (thick left AND right)
    isLastCol?: boolean;
    isFirstRow?: boolean;
    isLastRow?: boolean;
    isAfterLabel?: boolean;
    isBaseRow?: boolean;     // Base row (thick bottom for separation)
  }
): void {
  const { isContextCol, isLastCol, isFirstRow, isLastRow, isAfterLabel, isBaseRow } = options;

  const border: Partial<Borders> = {};

  if (isContextCol) {
    border.left = { style: 'medium', color: { argb: 'FF000000' } };
    border.right = { style: 'medium', color: { argb: 'FF000000' } };
  }
  if (isLastCol) {
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

  cell.border = border;
}

/**
 * Set cell value as number or dash if null/undefined
 */
function setCellNumber(cell: Cell, val: number | null | undefined, decimalPlaces: number = 2): void {
  if (val === null || val === undefined || isNaN(val)) {
    cell.value = '-';
  } else {
    cell.value = val;
    cell.numFmt = decimalPlaces === 0 ? '0' : `0.${'0'.repeat(decimalPlaces)}`;
  }
}

// =============================================================================
// Main Renderer
// =============================================================================

export interface StdMeanRowsRenderResult {
  endRow: number;
  contextMergeStart: number;
  contextMergeEnd: number;
}

/**
 * Render a single mean_rows table in standard format
 *
 * Standard format:
 * - Purple context column (merged per table)
 * - Purple + bold+italic base row
 * - Yellow label column
 * - Color-coded data cells per banner group
 * - Spacer columns between banner groups
 * - Minimal borders (thick at structural boundaries only)
 * - Bold red significance letters (no commas)
 */
export function renderStdMeanRowsTable(
  worksheet: Worksheet,
  table: MeanRowsTableData,
  startRow: number,
  headerInfo: StdHeaderInfo,
  totalRespondents: number = 0
): StdMeanRowsRenderResult {
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
  // Rows with n=0 (e.g., variables not found in .sav) are deprioritized.
  const firstDataRowKey = rowKeys.find(key => {
    const rowData = totalCutData?.[key] as MeanRowData | undefined;
    return rowData && !rowData.isCategoryHeader && typeof rowData.n === 'number' && rowData.n > 0;
  }) || rowKeys.find(key => {
    const rowData = totalCutData?.[key] as MeanRowData | undefined;
    return rowData && !rowData.isCategoryHeader && typeof rowData.n === 'number';
  }) || rowKeys[0];

  // Context column - purple, thick left+right + top + bottom border
  const baseContextCell = worksheet.getCell(currentRow, CONTEXT_COL);
  baseContextCell.value = '';
  baseContextCell.fill = FILLS.stdContext;
  applyStdBorder(baseContextCell, { isContextCol: true, isFirstRow: true, isBaseRow: true });

  // Label column - purple, bold+italic, thick bottom border
  const baseLabelCell = worksheet.getCell(currentRow, LABEL_COL);
  // Get base n from first data row of Total cut (skipping category headers).
  // Prefer table-level base when items have varying bases.
  const firstRowData = totalCutData?.[firstDataRowKey] as MeanRowData | undefined;
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
    // Prefer table-level base over first row's per-item observed n
    const cutTableBaseN = typeof (cutData as Record<string, unknown>)?.['table_base_n'] === 'number'
      ? ((cutData as Record<string, unknown>)['table_base_n'] as number)
      : null;
    const rowData = cutData?.[firstDataRowKey] as MeanRowData | undefined;
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
  // Data rows: Handle single-row tables specially (show Mean, Median, SD)
  // -------------------------------------------------------------------------
  const isSingleRowTable = rowKeys.length === 1;

  if (isSingleRowTable) {
    // Single-row table: expand to show Mean, Median, SD as separate rows
    const rowKey = rowKeys[0];
    const statRows = [
      { label: vocabulary.meanLabel, getValue: (rd: MeanRowData) => rd?.mean },
      { label: 'Mean (minus outliers)', getValue: (rd: MeanRowData) => rd?.mean_no_outliers },
      { label: vocabulary.medianLabel, getValue: (rd: MeanRowData) => rd?.median },
      { label: vocabulary.stddevLabel, getValue: (rd: MeanRowData) => rd?.sd },
      { label: vocabulary.stderrLabel, getValue: (rd: MeanRowData) => rd?.std_err },
    ];

    for (let statIdx = 0; statIdx < statRows.length; statIdx++) {
      const stat = statRows[statIdx];
      const isLastDataRow = statIdx === statRows.length - 1;

      // Context column - purple
      const contextCell = worksheet.getCell(currentRow, CONTEXT_COL);
      contextCell.value = '';
      contextCell.fill = FILLS.stdContext;
      applyStdBorder(contextCell, { isContextCol: true, isLastRow: isLastDataRow });

      // Label column - yellow
      const labelCell = worksheet.getCell(currentRow, LABEL_COL);
      labelCell.value = stat.label;
      labelCell.font = FONTS.label;
      labelCell.fill = FILLS.stdLabel;
      labelCell.alignment = ALIGNMENTS.wrapText;
      applyStdBorder(labelCell, { isLastRow: isLastDataRow });

      // Value + Sig for each cut
      for (const cut of cuts) {
        const cutData = table.data[cut.name];
        const rowData = cutData?.[rowKey] as MeanRowData | undefined;
        const groupFill = getGroupFill(cut.groupIndex, statIdx);

        // Value column
        const valCell = worksheet.getCell(currentRow, cut.valueCol);
        setCellNumber(valCell, rowData ? stat.getValue(rowData) : null, 2);
        valCell.font = FONTS.data;
        valCell.fill = groupFill;
        valCell.alignment = ALIGNMENTS.center;
        applyStdBorder(valCell, {
          isAfterLabel: cut.isFirstInGroup && cut.groupIndex === 0,
          isLastRow: isLastDataRow,
        });

        // Sig column (only show for Mean row)
        const sigCell = worksheet.getCell(currentRow, cut.sigCol);
        const sigValue = statIdx === 0 ? formatSignificance(rowData?.sig_higher_than) : '';
        sigCell.value = sigValue || '';
        sigCell.font = sigValue ? FONTS.significanceLetterRed : FONTS.data;
        sigCell.fill = groupFill;
        sigCell.alignment = ALIGNMENTS.center;
        applyStdBorder(sigCell, {
          isLastCol: cut.isLastInGroup && cut.groupIndex === numGroups - 1,
          isLastRow: isLastDataRow,
        });
      }

      // Spacer columns
      for (let i = 0; i < groupSpacerCols.length; i++) {
        const spacerCol = groupSpacerCols[i];
        const spacerCell = worksheet.getCell(currentRow, spacerCol);
        spacerCell.value = '';
        spacerCell.fill = getGroupFill(i, statIdx);
      }

      currentRow++;
    }
  } else {
    // Multi-row table: show mean per row (original behavior)
    for (let rowIdx = 0; rowIdx < rowKeys.length; rowIdx++) {
      const rowKey = rowKeys[rowIdx];
      const totalRowData = totalCutData?.[rowKey] as MeanRowData | undefined;
      const isNet = totalRowData?.isNet || false;
      const indent = totalRowData?.indent || 0;
      const isLastDataRow = rowIdx === totalDataRows - 1;

      // Build label with indentation
      let rowLabel = totalRowData?.label || rowKey;
      if (indent > 0) {
        rowLabel = '  '.repeat(indent) + rowLabel;
      }

      // Context column - purple
      const contextCell = worksheet.getCell(currentRow, CONTEXT_COL);
      contextCell.value = '';
      contextCell.fill = FILLS.stdContext;
      applyStdBorder(contextCell, { isContextCol: true, isLastRow: isLastDataRow });

      // Label column - yellow
      const labelCell = worksheet.getCell(currentRow, LABEL_COL);
      labelCell.value = rowLabel;
      labelCell.font = isNet ? FONTS.labelNet : FONTS.label;
      labelCell.fill = FILLS.stdLabel;
      labelCell.alignment = ALIGNMENTS.wrapText;
      applyStdBorder(labelCell, { isLastRow: isLastDataRow });

      // Value + Sig for each cut - color per banner group, alternating by row
      for (const cut of cuts) {
        const cutData = table.data[cut.name];
        const rowData = cutData?.[rowKey] as MeanRowData | undefined;
        // Pass rowIdx for alternating colors within the table
        const groupFill = getGroupFill(cut.groupIndex, rowIdx);

        // Value column (mean)
        const valCell = worksheet.getCell(currentRow, cut.valueCol);
        setCellNumber(valCell, rowData?.mean, 2);
        valCell.font = FONTS.data;
        valCell.fill = groupFill;
        valCell.alignment = ALIGNMENTS.center;
        applyStdBorder(valCell, {
          isAfterLabel: cut.isFirstInGroup && cut.groupIndex === 0,
          isLastRow: isLastDataRow,
        });

        // Sig column (bold red letters)
        const sigCell = worksheet.getCell(currentRow, cut.sigCol);
        const sigValue = formatSignificance(rowData?.sig_higher_than);
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
