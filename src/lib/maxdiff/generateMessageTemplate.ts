/**
 * MaxDiff Message Template Generator
 *
 * Generates a pre-formatted Excel template for uploading MaxDiff messages.
 * Used by the /api/maxdiff/template route to provide a downloadable template.
 */

import ExcelJS from 'exceljs';

/**
 * Generate a MaxDiff message template workbook.
 * Returns an ExcelJS workbook ready to be written to a buffer or file.
 */
export async function generateMessageTemplate(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TabulateAI';

  const sheet = workbook.addWorksheet('Messages', {
    properties: { defaultColWidth: 15 },
  });

  // Column definitions
  sheet.columns = [
    { header: 'code', key: 'code', width: 12 },
    { header: 'message', key: 'message', width: 70 },
    { header: 'is_alternate', key: 'is_alternate', width: 14 },
    { header: 'alternate_of', key: 'alternate_of', width: 14 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF374151' }, // gray-700
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 24;

  // Example rows
  const examples = [
    { code: 'I1', message: 'Product X is the only treatment approved for both condition A and condition B', is_alternate: 'no', alternate_of: '' },
    { code: 'I1A', message: 'Only Product X has dual approval for conditions A and B', is_alternate: 'yes', alternate_of: 'I1' },
    { code: 'D4', message: 'In a clinical study, Product X showed significant improvement vs. placebo on the primary endpoint', is_alternate: 'no', alternate_of: '' },
    { code: 'E1', message: 'Significant improvement in primary score compared to placebo', is_alternate: 'no', alternate_of: '' },
    { code: 'E1A', message: 'Primary score improved significantly vs. placebo in the pivotal trial', is_alternate: 'yes', alternate_of: 'E1' },
  ];

  for (const ex of examples) {
    sheet.addRow(ex);
  }

  // Style example rows with light gray background
  for (let i = 2; i <= 6; i++) {
    const row = sheet.getRow(i);
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF9FAFB' }, // gray-50
    };
    row.font = { color: { argb: 'FF6B7280' } }; // gray-500 — indicates these are examples
  }

  // Add instruction note below the examples
  const noteRow = sheet.addRow([]);
  const instructionRow = sheet.addRow([
    'Replace the example rows above with your actual messages.',
  ]);
  // Merge cells A-D for the instruction
  sheet.mergeCells(instructionRow.number, 1, instructionRow.number, 4);
  const noteCell = sheet.getCell(instructionRow.number, 1);
  noteCell.font = { italic: true, color: { argb: 'FF9CA3AF' } }; // gray-400
  noteCell.alignment = { horizontal: 'left' };

  // Add column description row
  const descRow = sheet.addRow([
    'code = message identifier',
    'message = full message text',
    'is_alternate = "yes" or "no"',
    'alternate_of = code of primary',
  ]);
  for (let col = 1; col <= 4; col++) {
    const cell = sheet.getCell(descRow.number, col);
    cell.font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' } };
  }

  // Ignore the noteRow warning — it's just spacing
  void noteRow;

  return workbook;
}
