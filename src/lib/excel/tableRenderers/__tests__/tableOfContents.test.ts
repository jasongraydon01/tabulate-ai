import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { renderTableOfContents } from '../tableOfContents';
import type { TableData } from '../../ExcelFormatter';

function makeTable(overrides: Partial<TableData> = {}): TableData {
  return {
    tableId: overrides.tableId ?? 't1',
    questionId: overrides.questionId ?? 'Q1',
    questionText: overrides.questionText ?? 'Question text',
    tableType: overrides.tableType ?? 'frequency',
    isDerived: overrides.isDerived ?? false,
    sourceTableId: overrides.sourceTableId ?? (overrides.tableId ?? 't1'),
    data: overrides.data ?? {},
    surveySection: overrides.surveySection ?? '',
    baseText: overrides.baseText ?? 'Total respondents',
    userNote: overrides.userNote ?? '',
    tableSubtitle: overrides.tableSubtitle ?? '',
    excluded: overrides.excluded ?? false,
    excludeReason: overrides.excludeReason ?? '',
  };
}

describe('renderTableOfContents', () => {
  it('leaves missing sections blank instead of forward/backfilling them', () => {
    const workbook = new ExcelJS.Workbook();
    renderTableOfContents(workbook, [
      makeTable({ tableId: 't1', surveySection: 'SCREENER' }),
      makeTable({ tableId: 't2', questionId: 'Q2', surveySection: '' }),
      makeTable({ tableId: 't3', questionId: 'Q3', surveySection: 'ANALYSIS' }),
    ]);

    const sheet = workbook.getWorksheet('Table of Contents');
    expect(sheet?.getCell('D2').value).toBe('SCREENER');
    expect(sheet?.getCell('D3').value).toBe('');
    expect(sheet?.getCell('D4').value).toBe('ANALYSIS');
  });

  it('uses deterministic context fallbacks when user notes are blank', () => {
    const workbook = new ExcelJS.Workbook();
    renderTableOfContents(workbook, [
      makeTable({ tableId: 't1', userNote: 'Multiple answers accepted' }),
      makeTable({ tableId: 't2', questionId: 'Q2', userNote: '', tableSubtitle: 'Brand A' }),
      makeTable({ tableId: 't3', questionId: 'Q3', userNote: '', tableType: 'mean_rows' }),
      makeTable({ tableId: 't4', questionId: 'Q4', userNote: '', isDerived: true }),
    ]);

    const sheet = workbook.getWorksheet('Table of Contents');
    expect(sheet?.getCell('E2').value).toBe('Multiple answers accepted');
    expect(sheet?.getCell('E3').value).toBe('Brand A');
    expect(sheet?.getCell('E4').value).toBe('Mean summary');
    expect(sheet?.getCell('E5').value).toBe('Derived frequency table');
  });
});
