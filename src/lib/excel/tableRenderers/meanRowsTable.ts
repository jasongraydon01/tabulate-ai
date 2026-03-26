/**
 * Mean Rows Table Renderer
 *
 * Renders mean_rows tables with stacked formatting:
 * - Multi-row tables (>1 item): 2 rows per item (mean, significance)
 * - Single-row tables (1 item): 4 rows (mean, median, sd, significance)
 * - Multi-row headers with group/column/stat letter
 * - Heavy borders between banner groups
 */

import type { Worksheet, Cell, Borders } from 'exceljs';
import { FILLS, BORDERS, FONTS, ALIGNMENTS } from '../styles';
import type { BannerGroup } from '../../r/RScriptGeneratorV2';
import { formatQuestionTitle } from './questionTitle';
import { getDisplayBannerLabel, resolveTablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';
import type { TablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';

// =============================================================================
// Types
// =============================================================================

export interface MeanRowData {
  label: string;
  n: number;
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
  isNet?: boolean;    // NET/roll-up row (should be bold)
  indent?: number;    // Indentation level (0 = normal, 1+ = indented under NET)
}

export interface MeanCutData {
  stat_letter: string;
  [rowKey: string]: MeanRowData | string; // string is for stat_letter
}

export interface MeanRowsTableData {
  tableId: string;
  questionId: string;
  questionText: string;
  tableType: 'mean_rows';
  isDerived: boolean;
  sourceTableId: string;
  data: Record<string, MeanCutData>;
  baseText?: string;
  userNote?: string;
  tableSubtitle?: string;
}

export interface RenderContext {
  totalRespondents: number;
  bannerGroups: BannerGroup[];
  comparisonGroups: string[];
  significanceLevel: number;
  tablePresentation?: TablePresentationConfig;
}

// =============================================================================
// Helper Functions
// =============================================================================

function applyBorderForColumn(
  cell: Cell,
  colIndex: number,
  groupBoundaries: number[],
  isLastCol: boolean
): void {
  if (groupBoundaries.includes(colIndex) || isLastCol) {
    cell.border = BORDERS.groupSeparatorRight as Partial<Borders>;
  } else {
    cell.border = BORDERS.thin as Partial<Borders>;
  }
}

function formatSignificance(sig: string[] | string | undefined): string {
  if (!sig) return '-';
  if (typeof sig === 'string') return sig || '-';
  if (Array.isArray(sig) && sig.length > 0) {
    return sig.join(',');
  }
  return '-';
}

function normalizeBaseText(baseText: string | undefined): string | null {
  const trimmed = baseText?.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^Base:\s*/i, '').trim();
  return withoutPrefix || null;
}

function getContextLines(table: Pick<MeanRowsTableData, 'tableSubtitle' | 'userNote'>): string[] {
  return [table.tableSubtitle, table.userNote]
    .map(value => value?.trim() || '')
    .filter(Boolean);
}

/**
 * Set cell value as number or dash if null/undefined
 */
function setCellNumber(cell: Cell, val: number | null | undefined, decimalPlaces: number = 2): void {
  if (val === null || val === undefined || isNaN(val)) {
    cell.value = '-';
  } else {
    cell.value = val;
    // Format with specified decimal places
    cell.numFmt = decimalPlaces === 0 ? '0' : `0.${'0'.repeat(decimalPlaces)}`;
  }
}

// =============================================================================
// Main Renderer
// =============================================================================

export function renderMeanRowsTable(
  worksheet: Worksheet,
  table: MeanRowsTableData,
  startRow: number,
  context: RenderContext
): number {
  const { bannerGroups, comparisonGroups, totalRespondents, significanceLevel } = context;
  const tablePresentation = resolveTablePresentationConfig(context.tablePresentation);
  const vocabulary = tablePresentation.labelVocabulary;
  let currentRow = startRow;

  // Build flat list of cuts in order: Total first, then groups
  const cutOrder: { name: string; displayName: string; statLetter: string; groupName: string; groupDisplayName: string }[] = [];
  const groupBoundaries: number[] = [];

  let colIndex = 1;
  for (const group of bannerGroups) {
    for (const col of group.columns) {
      cutOrder.push({
        name: col.name,
        displayName: getDisplayBannerLabel(col.name, vocabulary),
        statLetter: col.statLetter,
        groupName: group.groupName,
        groupDisplayName: getDisplayBannerLabel(group.groupName, vocabulary),
      });
      colIndex++;
    }
    groupBoundaries.push(colIndex - 1);
  }

  const totalCols = cutOrder.length;

  // Get row keys (items in the mean_rows table)
  const totalCutData = table.data['Total'];
  const rowKeys = Object.keys(totalCutData || {}).filter(k => k !== 'stat_letter' && k !== 'table_base_n');
  const isSingleRow = rowKeys.length === 1;

  // -------------------------------------------------------------------------
  // Row 1: Question Text (Title)
  // -------------------------------------------------------------------------
  // Build title: "QuestionId. QuestionText" (system always prepends for consistency)
  // Agent outputs verbatim question text without the question number prefix
  let titleText = formatQuestionTitle(table.questionId, table.questionText);
  if (table.isDerived && table.sourceTableId) {
    titleText += ` [Derived from ${table.sourceTableId}]`;
  }

  const titleCell = worksheet.getCell(currentRow, 1);
  titleCell.value = titleText;
  titleCell.font = FONTS.title;
  titleCell.fill = FILLS.title;
  titleCell.alignment = ALIGNMENTS.left;
  worksheet.mergeCells(currentRow, 1, currentRow, totalCols + 1);
  currentRow++;

  // -------------------------------------------------------------------------
  // Row 2: Base description
  // -------------------------------------------------------------------------
  const firstRowKey = rowKeys.find((key) => {
    const rowData = totalCutData?.[key] as MeanRowData | undefined;
    return rowData && typeof rowData.n === 'number' && rowData.n > 0;
  }) || rowKeys.find((key) => {
    const rowData = totalCutData?.[key] as MeanRowData | undefined;
    return rowData && typeof rowData.n === 'number';
  }) || rowKeys[0];
  const firstRowData = totalCutData?.[firstRowKey] as MeanRowData | undefined;
  // Prefer table-level base when items have varying bases
  const totalTableBaseN = typeof (totalCutData as Record<string, unknown>)?.['table_base_n'] === 'number'
    ? ((totalCutData as Record<string, unknown>)['table_base_n'] as number)
    : null;
  const baseN = totalTableBaseN ?? (firstRowData?.n || 0);

  const normalizedBaseText = normalizeBaseText(table.baseText);
  const baseDescription = normalizedBaseText
    ? `${vocabulary.baseLabel}: ${normalizedBaseText}`
    : (baseN === totalRespondents ? `${vocabulary.baseLabel}: ${vocabulary.totalLabel}` : `${vocabulary.baseLabel}: Shown this question`);
  const baseCell = worksheet.getCell(currentRow, 1);
  baseCell.value = baseDescription;
  baseCell.font = FONTS.label;
  baseCell.fill = FILLS.title;
  baseCell.alignment = ALIGNMENTS.left;
  worksheet.mergeCells(currentRow, 1, currentRow, totalCols + 1);
  currentRow++;

  const contextLines = getContextLines(table);
  for (const line of contextLines) {
    const contextCell = worksheet.getCell(currentRow, 1);
    contextCell.value = line;
    contextCell.font = FONTS.label;
    contextCell.fill = FILLS.title;
    contextCell.alignment = ALIGNMENTS.left;
    worksheet.mergeCells(currentRow, 1, currentRow, totalCols + 1);
    currentRow++;
  }

  // -------------------------------------------------------------------------
  // Row 3: Group headers (merged cells)
  // -------------------------------------------------------------------------
  let headerCol = 2;
  worksheet.getCell(currentRow, 1).value = '';
  worksheet.getCell(currentRow, 1).fill = FILLS.groupHeader;
  worksheet.getCell(currentRow, 1).border = BORDERS.thin;

  for (const group of bannerGroups) {
    const startCol = headerCol;
    const endCol = headerCol + group.columns.length - 1;

    if (group.columns.length > 1) {
      worksheet.mergeCells(currentRow, startCol, currentRow, endCol);
    }

    const groupCell = worksheet.getCell(currentRow, startCol);
    groupCell.value = getDisplayBannerLabel(group.groupName, vocabulary);
    groupCell.font = FONTS.header;
    groupCell.fill = FILLS.groupHeader;
    groupCell.alignment = ALIGNMENTS.center;
    groupCell.border = BORDERS.groupSeparatorRight;

    headerCol = endCol + 1;
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Row 4: Column headers (cut names)
  // -------------------------------------------------------------------------
  worksheet.getCell(currentRow, 1).value = '';
  worksheet.getCell(currentRow, 1).fill = FILLS.groupHeader;
  worksheet.getCell(currentRow, 1).border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cell = worksheet.getCell(currentRow, i + 2);
    cell.value = cutOrder[i].displayName;
    cell.font = FONTS.header;
    cell.fill = FILLS.groupHeader;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Row 5: Stat letters
  // -------------------------------------------------------------------------
  worksheet.getCell(currentRow, 1).value = '';
  worksheet.getCell(currentRow, 1).fill = FILLS.groupHeader;
  worksheet.getCell(currentRow, 1).border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cell = worksheet.getCell(currentRow, i + 2);
    cell.value = `(${cutOrder[i].statLetter})`;
    cell.font = FONTS.statLetter;
    cell.fill = FILLS.groupHeader;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Row 6: Base n row
  // -------------------------------------------------------------------------
  const baseLabel = worksheet.getCell(currentRow, 1);
  baseLabel.value = vocabulary.baseLabel;
  baseLabel.font = FONTS.label;
  baseLabel.fill = FILLS.baseRow;
  baseLabel.alignment = ALIGNMENTS.left;
  baseLabel.border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const cutTableBase = typeof (cutData as Record<string, unknown>)?.['table_base_n'] === 'number'
      ? ((cutData as Record<string, unknown>)['table_base_n'] as number)
      : null;
    const rowData = cutData?.[firstRowKey] as MeanRowData | undefined;
    const n = cutTableBase ?? (rowData?.n || 0);

    const cell = worksheet.getCell(currentRow, i + 2);
    cell.value = n;
    cell.font = FONTS.data;
    cell.fill = FILLS.baseRow;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Data rows
  // -------------------------------------------------------------------------
  for (const rowKey of rowKeys) {
    const totalRowData = totalCutData?.[rowKey] as MeanRowData | undefined;
    const isNet = totalRowData?.isNet || false;
    const indent = totalRowData?.indent || 0;

    // Build label with indentation prefix for component rows
    let rowLabel = totalRowData?.label || rowKey;
    if (indent > 0) {
      rowLabel = '  '.repeat(indent) + rowLabel;  // 2 spaces per indent level
    }

    if (isSingleRow) {
      // Single row: show Mean, Median, SD, Significance (4 rows)
      currentRow = renderSingleRowMeanTable(
        worksheet,
        table,
        rowKey,
        rowLabel,
        currentRow,
        cutOrder,
        groupBoundaries,
        isNet,
        vocabulary,
      );
    } else {
      // Multi-row: show Mean, Significance only (2 rows per item)
      currentRow = renderMultiRowMeanItem(
        worksheet,
        table,
        rowKey,
        rowLabel,
        currentRow,
        cutOrder,
        groupBoundaries,
        isNet,
        vocabulary,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Footer rows
  // -------------------------------------------------------------------------
  currentRow++; // Gap

  const sigFooter = worksheet.getCell(currentRow, 1);
  sigFooter.value = `Significance at ${Math.round((1 - significanceLevel) * 100)}% level. T-test for means, Z-test for proportions.`;
  sigFooter.font = FONTS.footer;
  sigFooter.alignment = ALIGNMENTS.left;
  worksheet.mergeCells(currentRow, 1, currentRow, totalCols + 1);
  currentRow++;

  if (comparisonGroups.length > 0) {
    const groupFooter = worksheet.getCell(currentRow, 1);
    groupFooter.value = `Comparison groups: ${comparisonGroups.join(', ')}`;
    groupFooter.font = FONTS.footer;
    groupFooter.alignment = ALIGNMENTS.left;
    worksheet.mergeCells(currentRow, 1, currentRow, totalCols + 1);
    currentRow++;
  }

  return currentRow;
}

// =============================================================================
// Single Row Mean Table (4 rows: mean, median, sd, sig)
// =============================================================================

function renderSingleRowMeanTable(
  worksheet: Worksheet,
  table: MeanRowsTableData,
  rowKey: string,
  rowLabel: string,
  startRow: number,
  cutOrder: { name: string; displayName: string; statLetter: string; groupName: string; groupDisplayName: string }[],
  groupBoundaries: number[],
  isNet: boolean = false,
  vocabulary: ReturnType<typeof resolveTablePresentationConfig>['labelVocabulary'],
): number {
  let currentRow = startRow;

  // Row 1: Label + Mean
  const labelCell = worksheet.getCell(currentRow, 1);
  labelCell.value = rowLabel;
  labelCell.font = isNet ? FONTS.labelNet : FONTS.label;  // Bold for NET rows
  labelCell.fill = FILLS.labelColumn;
  labelCell.alignment = ALIGNMENTS.wrapText;
  labelCell.border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const rowData = cutData?.[rowKey] as MeanRowData | undefined;

    const cell = worksheet.getCell(currentRow, i + 2);
    setCellNumber(cell, rowData?.mean, 2);  // Store as number with 2 decimal places
    cell.font = FONTS.data;
    cell.fill = FILLS.data;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  // Row 2: Median
  const medianLabel = worksheet.getCell(currentRow, 1);
  medianLabel.value = vocabulary.medianLabel;
  medianLabel.font = FONTS.label;
  medianLabel.fill = FILLS.labelColumn;
  medianLabel.border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const rowData = cutData?.[rowKey] as MeanRowData | undefined;

    const cell = worksheet.getCell(currentRow, i + 2);
    setCellNumber(cell, rowData?.median, 2);  // Store as number with 2 decimal places
    cell.font = FONTS.data;
    cell.fill = FILLS.data;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  // Row 3: SD
  const sdLabel = worksheet.getCell(currentRow, 1);
  sdLabel.value = vocabulary.stddevLabel;
  sdLabel.font = FONTS.label;
  sdLabel.fill = FILLS.labelColumn;
  sdLabel.border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const rowData = cutData?.[rowKey] as MeanRowData | undefined;

    const cell = worksheet.getCell(currentRow, i + 2);
    setCellNumber(cell, rowData?.sd, 2);  // Store as number with 2 decimal places
    cell.font = FONTS.data;
    cell.fill = FILLS.data;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  // Row 4: Significance
  const sigLabel = worksheet.getCell(currentRow, 1);
  sigLabel.value = '';
  sigLabel.fill = FILLS.labelColumn;
  sigLabel.border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const rowData = cutData?.[rowKey] as MeanRowData | undefined;

    const cell = worksheet.getCell(currentRow, i + 2);
    cell.value = formatSignificance(rowData?.sig_higher_than);
    cell.font = FONTS.significance;
    cell.fill = FILLS.data;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  return currentRow;
}

// =============================================================================
// Multi Row Mean Item (2 rows: mean, sig)
// =============================================================================

function renderMultiRowMeanItem(
  worksheet: Worksheet,
  table: MeanRowsTableData,
  rowKey: string,
  rowLabel: string,
  startRow: number,
  cutOrder: { name: string; displayName: string; statLetter: string; groupName: string; groupDisplayName: string }[],
  groupBoundaries: number[],
  isNet: boolean = false,
  _vocabulary: ReturnType<typeof resolveTablePresentationConfig>['labelVocabulary'],
): number {
  let currentRow = startRow;

  // Row 1: Label + Mean
  const labelCell = worksheet.getCell(currentRow, 1);
  labelCell.value = rowLabel;
  labelCell.font = isNet ? FONTS.labelNet : FONTS.label;  // Bold for NET rows
  labelCell.fill = FILLS.labelColumn;
  labelCell.alignment = ALIGNMENTS.wrapText;
  labelCell.border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const rowData = cutData?.[rowKey] as MeanRowData | undefined;

    const cell = worksheet.getCell(currentRow, i + 2);
    setCellNumber(cell, rowData?.mean, 2);  // Store as number with 2 decimal places
    cell.font = FONTS.data;
    cell.fill = FILLS.data;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  // Row 2: Significance
  const sigLabel = worksheet.getCell(currentRow, 1);
  sigLabel.value = '';
  sigLabel.fill = FILLS.labelColumn;
  sigLabel.border = BORDERS.thin;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const rowData = cutData?.[rowKey] as MeanRowData | undefined;

    const cell = worksheet.getCell(currentRow, i + 2);
    cell.value = formatSignificance(rowData?.sig_higher_than);
    cell.font = FONTS.significance;
    cell.fill = FILLS.data;
    cell.alignment = ALIGNMENTS.center;
    applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
  }
  currentRow++;

  return currentRow;
}
