import { describe, expect, it } from 'vitest';

import { ExcelFormatter, type TableData, type TablesJson, type TablesJsonMetadata } from '../ExcelFormatter';
import { getTheme } from '../themes';

function makeTablesJson(): TablesJson {
  const metadata: TablesJsonMetadata = {
    generatedAt: new Date().toISOString(),
    tableCount: 1,
    cutCount: 2,
    significanceLevel: 0.1,
    totalRespondents: 100,
    bannerGroups: [
      {
        groupName: 'Total',
        columns: [{ name: 'Total', statLetter: 'T' }],
      },
      {
        groupName: 'Gender',
        columns: [
          { name: 'Male', statLetter: 'A' },
          { name: 'Female', statLetter: 'B' },
        ],
      },
    ],
    comparisonGroups: ['A/B'],
  };

  const tables: Record<string, TableData> = {
    q1: {
      tableId: 'q1',
      questionId: 'Q1',
      questionText: 'Sample question',
      tableType: 'frequency',
      isDerived: false,
      sourceTableId: '',
      data: {
        T: {
          base: 100,
          rows: {
            'Q1::1': { count: 60, percent: 60 },
            'Q1::2': { count: 40, percent: 40 },
          },
        },
        A: {
          base: 50,
          rows: {
            'Q1::1': { count: 30, percent: 60 },
            'Q1::2': { count: 20, percent: 40 },
          },
        },
        B: {
          base: 50,
          rows: {
            'Q1::1': { count: 30, percent: 60 },
            'Q1::2': { count: 20, percent: 40 },
          },
        },
      },
    },
  };

  return { metadata, tables };
}

function getTocHeaderFillArgb(workbook: Awaited<ReturnType<ExcelFormatter['formatFromJson']>>): string | undefined {
  const toc = workbook.getWorksheet('Table of Contents');
  if (!toc) {
    return undefined;
  }
  const fill = toc.getCell('A1').fill as { fgColor?: { argb?: string } } | undefined;
  return fill?.fgColor?.argb;
}

describe('Excel theme isolation', () => {
  it('keeps per-formatter theme output isolated under parallel generation', async () => {
    const tablesJson = makeTablesJson();

    const [coastalWorkbook, boldWorkbook] = await Promise.all([
      new ExcelFormatter({ theme: 'coastal' }).formatFromJson(tablesJson),
      new ExcelFormatter({ theme: 'bold' }).formatFromJson(tablesJson),
    ]);

    const coastalHeader = getTocHeaderFillArgb(coastalWorkbook);
    const boldHeader = getTocHeaderFillArgb(boldWorkbook);

    expect(coastalHeader).toBe(getTheme('coastal').header);
    expect(boldHeader).toBe(getTheme('bold').header);
    expect(coastalHeader).not.toBe(boldHeader);
  });
});
