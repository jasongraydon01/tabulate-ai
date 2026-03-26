/**
 * Table of Contents Sheet Renderer
 *
 * Creates a ToC sheet listing all tables in the workbook.
 * Columns: #, Question ID, Question Text, Section
 */

import type { Workbook, Worksheet } from 'exceljs';
import { FILLS, FONTS, ALIGNMENTS } from '../styles';
import type { TableData } from '../ExcelFormatter';

// =============================================================================
// Constants
// =============================================================================

const TOC_COLUMNS = {
  number: 1,
  questionId: 2,
  questionText: 3,
  section: 4,
  context: 5,
};

const COL_WIDTHS = {
  number: 6,
  questionId: 15,
  questionText: 60,
  sectionMin: 20,
  sectionMax: 40,
  contextMin: 20,
  contextMax: 45,
};

// =============================================================================
// Helper Functions
// =============================================================================

function normalizeToCSection(section: string | undefined): string {
  const trimmed = (section || '').trim();
  if (!trimmed) return '';

  // Keep the human-readable section name in TOC ("Awareness"), while allowing
  // full "Section A / Section B" text to remain in the table context column.
  const withoutPrefix = trimmed.replace(
    /^section\s+[a-z0-9]+(?:\s*[:\-–]\s*|\s+)/i,
    '',
  ).trim();
  return withoutPrefix || trimmed;
}

function buildToCSections(includedTables: TableData[]): string[] {
  return includedTables.map(t => normalizeToCSection(t.surveySection));
}

function buildToCContext(table: TableData): string {
  const userNote = (table.userNote || '').trim();
  if (userNote) return userNote;

  const subtitle = (table.tableSubtitle || '').trim();
  if (subtitle) return subtitle;

  if (table.tableType === 'mean_rows') {
    return table.isDerived ? 'Derived mean summary' : 'Mean summary';
  }

  return table.isDerived ? 'Derived frequency table' : 'Standard frequency';
}

// =============================================================================
// Main Renderer
// =============================================================================

export interface ToCRenderResult {
  worksheet: Worksheet;
  tableCount: number;
}

/**
 * Render Table of Contents sheet
 *
 * Lists all included tables with:
 * - Row number
 * - Question ID
 * - Question text (truncated)
 * - Survey section
 */
export function renderTableOfContents(
  workbook: Workbook,
  tables: TableData[],
  options?: { subtitle?: string }
): ToCRenderResult {
  const worksheet = workbook.addWorksheet('Table of Contents', {
    properties: { tabColor: { argb: 'FF92D050' } }  // Green tab color
  });

  // Filter to included tables only (not excluded)
  const includedTables = tables.filter(t => !t.excluded);
  const tocSections = buildToCSections(includedTables);

  // Calculate section column width based on normalized TOC section names
  const sectionNames = tocSections.filter(Boolean);
  const maxSectionLength = sectionNames.reduce((max, name) => Math.max(max, name.length), 0);
  // Approximate: 1 character ≈ 1.2 width units, with min/max bounds
  const sectionWidth = Math.min(
    COL_WIDTHS.sectionMax,
    Math.max(COL_WIDTHS.sectionMin, Math.ceil(maxSectionLength * 1.1))
  );
  const contextValues = includedTables
    .map(buildToCContext)
    .filter(Boolean);
  const maxContextLength = contextValues.reduce((max, value) => Math.max(max, value.length), 0);
  const contextWidth = Math.min(
    COL_WIDTHS.contextMax,
    Math.max(COL_WIDTHS.contextMin, Math.ceil(maxContextLength * 0.95))
  );

  // Set column widths
  worksheet.getColumn(TOC_COLUMNS.number).width = COL_WIDTHS.number;
  worksheet.getColumn(TOC_COLUMNS.questionId).width = COL_WIDTHS.questionId;
  worksheet.getColumn(TOC_COLUMNS.questionText).width = COL_WIDTHS.questionText;
  worksheet.getColumn(TOC_COLUMNS.section).width = sectionWidth;
  worksheet.getColumn(TOC_COLUMNS.context).width = contextWidth;

  // Optional subtitle row (e.g., "Weighted results (weight variable: wt)")
  let startRow = 1;
  if (options?.subtitle) {
    const subtitleRow = worksheet.getRow(1);
    worksheet.mergeCells(1, 1, 1, 5);
    const subtitleCell = subtitleRow.getCell(1);
    subtitleCell.value = options.subtitle;
    subtitleCell.font = { ...FONTS.header, italic: true, color: { argb: 'FF4472C4' } };
    subtitleCell.alignment = ALIGNMENTS.left;
    startRow = 2;
  }

  // Header row
  const headerRow = worksheet.getRow(startRow);
  headerRow.values = ['#', 'Question ID', 'Question Text', 'Section', 'Context'];

  // Style header cells
  for (let col = 1; col <= 5; col++) {
    const cell = headerRow.getCell(col);
    cell.font = FONTS.header;
    cell.fill = FILLS.stdHeader;
    cell.alignment = ALIGNMENTS.center;
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
    };
  }

  // Group tables by section for sorting (optional - keeps tables in section order)
  // For now, maintain original order from R script

  let rowNum = startRow + 1;
  for (let i = 0; i < includedTables.length; i++) {
    const table = includedTables[i];
    const row = worksheet.getRow(rowNum);

    // Row number
    const numCell = row.getCell(TOC_COLUMNS.number);
    numCell.value = i + 1;
    numCell.alignment = ALIGNMENTS.center;

    // Question ID
    const idCell = row.getCell(TOC_COLUMNS.questionId);
    idCell.value = table.questionId || table.tableId;
    idCell.alignment = ALIGNMENTS.left;

    // Question text
    const textCell = row.getCell(TOC_COLUMNS.questionText);
    textCell.value = table.questionText || '';
    textCell.alignment = { ...ALIGNMENTS.left, wrapText: true };

    // Section
    const sectionCell = row.getCell(TOC_COLUMNS.section);
    sectionCell.value = tocSections[i] || '';
    sectionCell.alignment = { ...ALIGNMENTS.left, wrapText: true };

    const contextCell = row.getCell(TOC_COLUMNS.context);
    contextCell.value = buildToCContext(table);
    contextCell.alignment = { ...ALIGNMENTS.left, wrapText: true };

    // Alternating row colors for readability
    if (i % 2 === 1) {
      for (let col = 1; col <= 5; col++) {
        row.getCell(col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF5F5F5' },  // Very light gray
        };
      }
    }

    rowNum++;
  }

  // Freeze header row(s)
  worksheet.views = [{
    state: 'frozen',
    ySplit: startRow,
    topLeftCell: `A${startRow + 1}`,
    activeCell: `A${startRow + 1}`,
  }];

  return {
    worksheet,
    tableCount: includedTables.length,
  };
}
