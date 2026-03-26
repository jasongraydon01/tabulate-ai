/**
 * Frequency Table Renderer
 *
 * Renders frequency tables with stacked formatting:
 * - 3 rows per answer option: count, percent, significance
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

export interface FrequencyRowData {
  label: string;
  n: number | null;
  count: number | null;
  pct: number | null;
  sig_higher_than?: string[] | string;
  sig_vs_total?: string | null;
  isNet?: boolean;    // NET/roll-up row (should be bold)
  indent?: number;    // Indentation level (0 = normal, 1+ = indented under NET)
  isCategoryHeader?: boolean;  // Visual grouping row with no data
}

export interface FrequencyCutData {
  stat_letter: string;
  [rowKey: string]: FrequencyRowData | string; // string is for stat_letter
}

export interface FrequencyTableData {
  tableId: string;
  questionId: string;
  questionText: string;
  tableType: 'frequency';
  isDerived: boolean;
  sourceTableId: string;
  data: Record<string, FrequencyCutData>;
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
  // Check if this column is at a group boundary (last column of a group)
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

function getContextLines(table: Pick<FrequencyTableData, 'tableSubtitle' | 'userNote'>): string[] {
  return [table.tableSubtitle, table.userNote]
    .map(value => value?.trim() || '')
    .filter(Boolean);
}

// =============================================================================
// Main Renderer
// =============================================================================

export function renderFrequencyTable(
  worksheet: Worksheet,
  table: FrequencyTableData,
  startRow: number,
  context: RenderContext
): number {
  const { bannerGroups, comparisonGroups, totalRespondents, significanceLevel } = context;
  const tablePresentation = resolveTablePresentationConfig(context.tablePresentation);
  const vocabulary = tablePresentation.labelVocabulary;
  let currentRow = startRow;

  // Build flat list of cuts in order: Total first, then groups
  const cutOrder: { name: string; displayName: string; statLetter: string; groupName: string; groupDisplayName: string }[] = [];
  const groupBoundaries: number[] = []; // Column indices where groups end

  let colIndex = 1; // Start after label column
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
    // Mark the last column of each group as a boundary
    groupBoundaries.push(colIndex - 1);
  }

  const totalCols = cutOrder.length;

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
  // Get base n from Total column first row
  const totalCutData = table.data['Total'];
  const rowKeys = Object.keys(totalCutData || {}).filter(k => k !== 'stat_letter' && k !== 'table_base_n');
  const firstRowKey = rowKeys.find((key) => {
    const rowData = totalCutData?.[key] as FrequencyRowData | undefined;
    return rowData && typeof rowData.n === 'number' && rowData.n > 0;
  }) || rowKeys.find((key) => {
    const rowData = totalCutData?.[key] as FrequencyRowData | undefined;
    return rowData && typeof rowData.n === 'number';
  }) || rowKeys[0];
  const firstRowData = totalCutData?.[firstRowKey] as FrequencyRowData | undefined;
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
  let headerCol = 2; // Start after label column
  worksheet.getCell(currentRow, 1).value = '';
  worksheet.getCell(currentRow, 1).fill = FILLS.groupHeader;
  worksheet.getCell(currentRow, 1).border = BORDERS.thin as Partial<Borders>;

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
    groupCell.border = BORDERS.groupSeparatorRight as Partial<Borders>;

    headerCol = endCol + 1;
  }
  currentRow++;

  // -------------------------------------------------------------------------
  // Row 4: Column headers (cut names)
  // -------------------------------------------------------------------------
  worksheet.getCell(currentRow, 1).value = '';
  worksheet.getCell(currentRow, 1).fill = FILLS.groupHeader;
  worksheet.getCell(currentRow, 1).border = BORDERS.thin as Partial<Borders>;

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
  worksheet.getCell(currentRow, 1).border = BORDERS.thin as Partial<Borders>;

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
  baseLabel.border = BORDERS.thin as Partial<Borders>;

  for (let i = 0; i < cutOrder.length; i++) {
    const cutName = cutOrder[i].name;
    const cutData = table.data[cutName];
    const cutTableBase = typeof (cutData as Record<string, unknown>)?.['table_base_n'] === 'number'
      ? ((cutData as Record<string, unknown>)['table_base_n'] as number)
      : null;
    const rowData = cutData?.[firstRowKey] as FrequencyRowData | undefined;
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
  // Pre-scan: detect rows with count=0 across ALL cuts (terminate options)
  // These get rendered as "-" instead of "0%" / "0"
  // -------------------------------------------------------------------------
  const allZeroRows = new Set<string>();
  for (const rowKey of rowKeys) {
    let allZero = true;
    for (const { name } of cutOrder) {
      const cutData = table.data[name];
      const rowData = cutData?.[rowKey] as FrequencyRowData | undefined;
      if (rowData?.count !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) allZeroRows.add(rowKey);
  }

  // -------------------------------------------------------------------------
  // Data rows: 3 rows per answer option (count, percent, significance)
  // -------------------------------------------------------------------------
  for (const rowKey of rowKeys) {
    const totalRowData = totalCutData?.[rowKey] as FrequencyRowData | undefined;
    const isNet = totalRowData?.isNet || false;
    const indent = totalRowData?.indent || 0;

    // Build label with indentation prefix for component rows
    let rowLabel = totalRowData?.label || rowKey;
    if (indent > 0) {
      rowLabel = '  '.repeat(indent) + rowLabel;  // 2 spaces per indent level
    }

    // Row 1: Label + Count
    const labelCell = worksheet.getCell(currentRow, 1);
    labelCell.value = rowLabel;
    labelCell.font = isNet ? FONTS.labelNet : FONTS.label;  // Bold for NET rows
    labelCell.fill = FILLS.labelColumn;
    labelCell.alignment = ALIGNMENTS.wrapText;
    labelCell.border = BORDERS.thin as Partial<Borders>;

    for (let i = 0; i < cutOrder.length; i++) {
      const cutName = cutOrder[i].name;
      const cutData = table.data[cutName];
      const rowData = cutData?.[rowKey] as FrequencyRowData | undefined;

      const cell = worksheet.getCell(currentRow, i + 2);
      const isAllZeroRow = allZeroRows.has(rowKey);
      if (isAllZeroRow) {
        cell.value = '-';
      } else {
        const count = rowData?.count;
        if (count !== undefined && count !== null) {
          cell.value = count;  // Store as number
        } else {
          cell.value = '-';
        }
      }
      cell.font = FONTS.data;
      cell.fill = FILLS.data;
      cell.alignment = ALIGNMENTS.center;
      applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
    }
    currentRow++;

    // Row 2: Percent
    const pctLabelCell = worksheet.getCell(currentRow, 1);
    pctLabelCell.value = '';
    pctLabelCell.fill = FILLS.labelColumn;
    pctLabelCell.border = BORDERS.thin as Partial<Borders>;

    for (let i = 0; i < cutOrder.length; i++) {
      const cutName = cutOrder[i].name;
      const cutData = table.data[cutName];
      const rowData = cutData?.[rowKey] as FrequencyRowData | undefined;

      const cell = worksheet.getCell(currentRow, i + 2);
      if (allZeroRows.has(rowKey)) {
        cell.value = '-';
      } else {
        const pct = rowData?.pct;
        if (pct !== undefined && pct !== null) {
          cell.value = pct / 100;  // Store as decimal (0.25 for 25%)
          cell.numFmt = '0%';       // Display as "25%" — full precision stored in cell value
        } else {
          cell.value = '-';
        }
      }
      cell.font = FONTS.data;
      cell.fill = FILLS.data;
      cell.alignment = ALIGNMENTS.center;
      applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
    }
    currentRow++;

    // Row 3: Significance
    const sigLabelCell = worksheet.getCell(currentRow, 1);
    sigLabelCell.value = '';
    sigLabelCell.fill = FILLS.labelColumn;
    sigLabelCell.border = BORDERS.thin as Partial<Borders>;

    for (let i = 0; i < cutOrder.length; i++) {
      const cutName = cutOrder[i].name;
      const cutData = table.data[cutName];
      const rowData = cutData?.[rowKey] as FrequencyRowData | undefined;

      const cell = worksheet.getCell(currentRow, i + 2);
      cell.value = formatSignificance(rowData?.sig_higher_than);
      cell.font = FONTS.significance;
      cell.fill = FILLS.data;
      cell.alignment = ALIGNMENTS.center;
      applyBorderForColumn(cell, i + 2, groupBoundaries.map(b => b + 1), i === cutOrder.length - 1);
    }
    currentRow++;
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
