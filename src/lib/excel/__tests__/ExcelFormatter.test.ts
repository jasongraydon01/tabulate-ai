import { describe, it, expect } from 'vitest';
import { ExcelFormatter, formatTablesToBuffer } from '../ExcelFormatter';
import type { TablesJson, TablesJsonMetadata, TableData } from '../ExcelFormatter';
import ExcelJS from 'exceljs';

function makeTablesJson(overrides: {
  tables?: Record<string, TableData>;
  metadata?: Partial<TablesJsonMetadata>;
} = {}): TablesJson {
  const defaultMetadata: TablesJsonMetadata = {
    generatedAt: new Date().toISOString(),
    tableCount: 1,
    cutCount: 2,
    significanceLevel: 0.10,
    totalRespondents: 200,
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
    ...overrides.metadata,
  };

  const defaultTables: Record<string, TableData> = {
    q1: {
      tableId: 'q1',
      questionId: 'Q1',
      questionText: 'What is your preference?',
      tableType: 'frequency',
      isDerived: false,
      sourceTableId: '',
      data: {
        T: {
          base: 200,
          rows: { 'Q1::1': { count: 120, percent: 60 }, 'Q1::2': { count: 80, percent: 40 } },
        },
        A: {
          base: 100,
          rows: { 'Q1::1': { count: 70, percent: 70 }, 'Q1::2': { count: 30, percent: 30 } },
        },
        B: {
          base: 100,
          rows: { 'Q1::1': { count: 50, percent: 50 }, 'Q1::2': { count: 50, percent: 50 } },
        },
      },
    },
    ...overrides.tables,
  };

  return {
    metadata: defaultMetadata,
    tables: defaultTables,
  };
}

describe('ExcelFormatter', () => {
  it('produces a valid workbook from tablesJson', async () => {
    const tablesJson = makeTablesJson();
    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    expect(workbook).toBeInstanceOf(ExcelJS.Workbook);
    expect(workbook.worksheets.length).toBeGreaterThan(0);
  });

  it('produces non-empty buffer via formatTablesToBuffer', async () => {
    const tablesJson = makeTablesJson();
    const buffer = await formatTablesToBuffer(tablesJson);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('default format is standard with single crosstabs sheet', async () => {
    const tablesJson = makeTablesJson();
    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    const sheetNames = workbook.worksheets.map(s => s.name);
    expect(sheetNames).toContain('Table of Contents');
    expect(sheetNames).toContain('Crosstabs');
  });

  it('displayMode "both" creates two data sheets in one workbook', async () => {
    const tablesJson = makeTablesJson();
    const formatter = new ExcelFormatter({ displayMode: 'both' });
    const workbook = await formatter.formatFromJson(tablesJson);
    const sheetNames = workbook.worksheets.map(s => s.name);
    expect(sheetNames).toContain('Percentages');
    expect(sheetNames).toContain('Counts');
  });

  it('places excluded tables on separate sheet', async () => {
    const tablesJson = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1',
          questionId: 'Q1',
          questionText: 'Included table',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          data: {
            T: { base: 200, rows: { 'Q1::1': { count: 120, percent: 60 } } },
          },
        },
        q2: {
          tableId: 'q2',
          questionId: 'Q2',
          questionText: 'Excluded table',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          excluded: true,
          excludeReason: 'Low value',
          data: {
            T: { base: 200, rows: { 'Q2::1': { count: 100, percent: 50 } } },
          },
        },
      },
      metadata: { tableCount: 2 },
    });
    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    const sheetNames = workbook.worksheets.map(s => s.name);
    expect(sheetNames).toContain('Excluded Tables');
  });

  it('hideExcludedTables omits excluded sheet', async () => {
    const tablesJson = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1',
          questionId: 'Q1',
          questionText: 'Included',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          data: { T: { base: 100, rows: {} } },
        },
        q2: {
          tableId: 'q2',
          questionId: 'Q2',
          questionText: 'Excluded',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          excluded: true,
          excludeReason: 'test',
          data: { T: { base: 100, rows: {} } },
        },
      },
    });
    const formatter = new ExcelFormatter({ hideExcludedTables: true });
    const workbook = await formatter.formatFromJson(tablesJson);
    const sheetNames = workbook.worksheets.map(s => s.name);
    expect(sheetNames).not.toContain('Excluded Tables');
  });

  it('handles weighted metadata without error', async () => {
    const tablesJson = makeTablesJson({
      metadata: { weighted: true, weightVariable: 'wt' },
    });
    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    expect(workbook.worksheets.length).toBeGreaterThan(0);
  });

  it('handles empty tables gracefully', async () => {
    const tablesJson = makeTablesJson({ tables: {} });
    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    // Should at least have Table of Contents
    expect(workbook.worksheets.length).toBeGreaterThanOrEqual(1);
    const sheetNames = workbook.worksheets.map(s => s.name);
    expect(sheetNames).toContain('Table of Contents');
  });

  it('TOC does not truncate long question text', async () => {
    const longText =
      'This is a deliberately long question text that should remain intact in the TOC without ellipsis even when it exceeds one hundred characters in length for regression coverage.';
    const tablesJson = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1',
          questionId: 'Q1',
          questionText: longText,
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          data: { T: { base: 100, rows: {} } },
        },
      },
    });

    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    const toc = workbook.getWorksheet('Table of Contents');
    expect(toc).toBeDefined();
    expect(toc?.getCell('C2').value).toBe(longText);
  });

  it('TOC normalizes section names and leaves blanks unfilled', async () => {
    const tablesJson = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          surveySection: 'Section A: Awareness',
          data: { T: { base: 100, rows: {} } },
        },
        q2: {
          tableId: 'q2',
          questionId: 'Q2',
          questionText: 'Question 2',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          surveySection: '',
          data: { T: { base: 100, rows: {} } },
        },
        q3: {
          tableId: 'q3',
          questionId: 'Q3',
          questionText: 'Question 3',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          surveySection: 'Section B - Consideration',
          data: { T: { base: 100, rows: {} } },
        },
        q4: {
          tableId: 'q4',
          questionId: 'Q4',
          questionText: 'Question 4',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          surveySection: '',
          data: { T: { base: 100, rows: {} } },
        },
      },
      metadata: { tableCount: 4 },
    });

    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    const toc = workbook.getWorksheet('Table of Contents');
    expect(toc).toBeDefined();

    expect(toc?.getCell('D2').value).toBe('Awareness');
    expect(toc?.getCell('D3').value).toBe('');
    expect(toc?.getCell('D4').value).toBe('Consideration');
    expect(toc?.getCell('D5').value).toBe('');
  });

  it('TOC adds a Context column with deterministic fallbacks', async () => {
    const tablesJson = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          surveySection: 'Section A: Awareness',
          userNote: 'Base varies by item (n=120-150)',
          data: { T: { base: 100, rows: {} } },
        },
        q2: {
          tableId: 'q2',
          questionId: 'Q2',
          questionText: 'Question 2',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          surveySection: 'Section A: Awareness',
          userNote: '',
          data: { T: { base: 100, rows: {} } },
        },
      },
      metadata: { tableCount: 2 },
    });

    const formatter = new ExcelFormatter();
    const workbook = await formatter.formatFromJson(tablesJson);
    const toc = workbook.getWorksheet('Table of Contents');
    expect(toc).toBeDefined();

    expect(toc?.getCell('E1').value).toBe('Context');
    expect(toc?.getCell('E2').value).toBe('Base varies by item (n=120-150)');
    expect(toc?.getCell('E3').value).toBe('Standard frequency');
  });

  it('Stacked renderers keep titles question-only and render subtitle/userNote as context rows', async () => {
    const tablesJson = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          isDerived: false,
          sourceTableId: '',
          baseText: 'Total respondents',
          tableSubtitle: 'Brand A',
          userNote: 'Excludes non-substantive responses',
          data: {
            Total: {
              stat_letter: 'T',
              row1: { label: 'Yes', n: 200, count: 120, pct: 60 },
            },
            Male: {
              stat_letter: 'A',
              row1: { label: 'Yes', n: 100, count: 60, pct: 60 },
            },
            Female: {
              stat_letter: 'B',
              row1: { label: 'Yes', n: 100, count: 60, pct: 60 },
            },
          },
        },
      },
      metadata: {
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
      },
    });

    const formatter = new ExcelFormatter({ format: 'stacked' });
    const workbook = await formatter.formatFromJson(tablesJson);
    const sheet = workbook.getWorksheet('Crosstabs');
    expect(sheet).toBeDefined();

    expect(sheet?.getCell('A1').value).toBe('Q1. Question 1');
    expect(sheet?.getCell('A2').value).toBe('Base (n): Total respondents');
    expect(sheet?.getCell('A3').value).toBe('Brand A');
    expect(sheet?.getCell('A4').value).toBe('Excludes non-substantive responses');
  });

  describe('getSecondWorkbookBuffer', () => {
    it('returns a non-empty buffer when separateWorkbooks=true and displayMode=both', async () => {
      const tablesJson = makeTablesJson();
      const formatter = new ExcelFormatter({ displayMode: 'both', separateWorkbooks: true });
      await formatter.formatFromJson(tablesJson);
      expect(formatter.hasSecondWorkbook()).toBe(true);
      const buffer = await formatter.getSecondWorkbookBuffer();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('throws when no second workbook exists', async () => {
      const tablesJson = makeTablesJson();
      const formatter = new ExcelFormatter({ displayMode: 'frequency' });
      await formatter.formatFromJson(tablesJson);
      expect(formatter.hasSecondWorkbook()).toBe(false);
      await expect(formatter.getSecondWorkbookBuffer()).rejects.toThrow(
        'No second workbook to export'
      );
    });
  });
});
