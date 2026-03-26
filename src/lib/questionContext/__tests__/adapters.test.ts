import { describe, it, expect } from 'vitest';
import {
  buildQuestionContext,
  buildBannerContext,
  extractAllColumns,
  deriveLoopIterationCount,
  toBannerVerboseDataMap,
  type QuestionIdFinalFile,
} from '../adapters';

const sampleQuestionFile: QuestionIdFinalFile = {
  questionIds: [
    {
      questionId: 'S2',
      questionText: 'Primary Specialty',
      variables: ['S2'],
      disposition: 'reportable',
      normalizedType: 'categorical_select',
      items: [
        {
          column: 'S2',
          label: 'Primary Specialty',
          normalizedType: 'categorical_select',
          scaleLabels: [
            { value: 1, label: 'Cardiologist' },
            { value: 2, label: 'Internist' },
          ],
        },
      ],
    },
    {
      questionId: 'S8',
      questionText: 'Time allocation',
      variables: ['S8r1', 'S8r2', 'S8r3'],
      disposition: 'reportable',
      normalizedType: 'numeric_range',
      analyticalSubtype: 'allocation',
      items: [
        { column: 'S8r1', label: 'Patient care', normalizedType: 'numeric_range' },
        { column: 'S8r2', label: 'Teaching', normalizedType: 'numeric_range' },
        { column: 'S8r3', label: 'Research', normalizedType: 'numeric_range' },
      ],
    },
    {
      questionId: 'OE1',
      questionText: 'Open end',
      variables: ['OE1'],
      disposition: 'reportable',
      normalizedType: 'text_open',
      items: [{ column: 'OE1', label: 'Open end', normalizedType: 'text_open' }],
    },
    {
      questionId: 'EXCL',
      questionText: 'Excluded question',
      variables: ['EXCL'],
      disposition: 'excluded',
      normalizedType: 'categorical_select',
      items: [{ column: 'EXCL', label: 'Excluded', normalizedType: 'categorical_select' }],
    },
    {
      questionId: 'A7_1',
      questionText: 'Loop iteration 1',
      variables: ['A7_1r1'],
      disposition: 'reportable',
      normalizedType: 'binary_flag',
      loop: { detected: true, familyBase: 'A7', iterationIndex: 0, iterationCount: 2 },
      loopQuestionId: 'A7',
      items: [{ column: 'A7_1r1', label: 'Item 1', normalizedType: 'binary_flag' }],
    },
  ],
};

describe('buildQuestionContext', () => {
  it('filters to reportable only', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    const ids = result.map((q) => q.questionId);
    expect(ids).toContain('S2');
    expect(ids).toContain('S8');
    expect(ids).not.toContain('EXCL');
  });

  it('skips text_open items', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    const ids = result.map((q) => q.questionId);
    expect(ids).not.toContain('OE1');
  });

  it('preserves question grouping with nested items', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    const s8 = result.find((q) => q.questionId === 'S8');
    expect(s8).toBeDefined();
    expect(s8!.items).toHaveLength(3);
    expect(s8!.items[0].column).toBe('S8r1');
    expect(s8!.items[0].label).toBe('Patient care');
  });

  it('converts scaleLabels to structured valueLabels', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    const s2 = result.find((q) => q.questionId === 'S2');
    expect(s2!.items[0].valueLabels).toEqual([
      { value: 1, label: 'Cardiologist' },
      { value: 2, label: 'Internist' },
    ]);
  });

  it('resolves loop metadata', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    const a7 = result.find((q) => q.questionId === 'A7_1');
    expect(a7!.loop).toEqual({
      familyBase: 'A7',
      iterationIndex: 0,
      iterationCount: 2,
    });
    expect(a7!.loopQuestionId).toBe('A7');
  });

  it('sets analyticalSubtype when present', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    const s8 = result.find((q) => q.questionId === 'S8');
    expect(s8!.analyticalSubtype).toBe('allocation');
  });

  it('sets disposition to reportable for all entries', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    for (const q of result) {
      expect(q.disposition).toBe('reportable');
    }
  });

  it('sets baseSummary to null when entry has no baseContract', () => {
    const result = buildQuestionContext(sampleQuestionFile);
    const s2 = result.find((q) => q.questionId === 'S2');
    expect(s2!.baseSummary).toBeNull();
  });

  it('populates baseSummary from entry baseContract', () => {
    const fileWithBase: QuestionIdFinalFile = {
      questionIds: [
        {
          questionId: 'Q3',
          questionText: 'Test question',
          variables: ['Q3'],
          disposition: 'reportable',
          normalizedType: 'categorical_select',
          baseContract: {
            classification: { situation: 'filtered' },
            signals: ['filtered-base'],
          },
          totalN: 500,
          questionBase: 284,
          itemBaseRange: null,
          items: [
            { column: 'Q3', label: 'Test', normalizedType: 'categorical_select' },
          ],
        },
      ],
    };

    const result = buildQuestionContext(fileWithBase);
    const q3 = result.find((q) => q.questionId === 'Q3');
    expect(q3!.baseSummary).toEqual({
      situation: 'filtered',
      signals: ['filtered-base'],
      questionBase: 284,
      totalN: 500,
      itemBaseRange: null,
    });
  });

  it('populates baseSummary with itemBaseRange when varying', () => {
    const fileWithVarying: QuestionIdFinalFile = {
      questionIds: [
        {
          questionId: 'Q5',
          questionText: 'Varying base question',
          variables: ['Q5r1', 'Q5r2'],
          disposition: 'reportable',
          normalizedType: 'binary_flag',
          baseContract: {
            classification: { situation: 'varying_items' },
            signals: ['varying-item-bases', 'low-base'],
          },
          totalN: 200,
          questionBase: 45,
          itemBaseRange: [20, 45],
          items: [
            { column: 'Q5r1', label: 'Item A', normalizedType: 'binary_flag' },
            { column: 'Q5r2', label: 'Item B', normalizedType: 'binary_flag' },
          ],
        },
      ],
    };

    const result = buildQuestionContext(fileWithVarying);
    const q5 = result.find((q) => q.questionId === 'Q5');
    expect(q5!.baseSummary).toEqual({
      situation: 'varying_items',
      signals: ['varying-item-bases', 'low-base'],
      questionBase: 45,
      totalN: 200,
      itemBaseRange: [20, 45],
    });
  });

  it('handles baseContract with empty signals array', () => {
    const fileWithEmpty: QuestionIdFinalFile = {
      questionIds: [
        {
          questionId: 'Q1',
          questionText: 'Uniform base',
          variables: ['Q1'],
          disposition: 'reportable',
          normalizedType: 'categorical_select',
          baseContract: {
            classification: { situation: 'uniform' },
            signals: [],
          },
          totalN: 500,
          questionBase: 500,
          items: [
            { column: 'Q1', label: 'Test', normalizedType: 'categorical_select' },
          ],
        },
      ],
    };

    const result = buildQuestionContext(fileWithEmpty);
    const q1 = result.find((q) => q.questionId === 'Q1');
    expect(q1!.baseSummary).toEqual({
      situation: 'uniform',
      signals: [],
      questionBase: 500,
      totalN: 500,
      itemBaseRange: null,
    });
  });
});

describe('buildBannerContext', () => {
  it('produces one summary per reportable question', () => {
    const result = buildBannerContext(sampleQuestionFile);
    expect(result.length).toBe(3); // S2, S8, A7_1 (OE1 and EXCL filtered)
  });

  it('includes item count', () => {
    const result = buildBannerContext(sampleQuestionFile);
    const s8 = result.find((s) => s.questionId === 'S8');
    expect(s8!.itemCount).toBe(3);
  });

  it('includes value labels from first item with labels', () => {
    const result = buildBannerContext(sampleQuestionFile);
    const s2 = result.find((s) => s.questionId === 'S2');
    expect(s2!.valueLabels).toHaveLength(2);
  });
});

describe('extractAllColumns', () => {
  it('returns all item columns', () => {
    const questions = buildQuestionContext(sampleQuestionFile);
    const columns = extractAllColumns(questions);
    expect(columns.has('S2')).toBe(true);
    expect(columns.has('S8r1')).toBe(true);
    expect(columns.has('S8r2')).toBe(true);
    expect(columns.has('S8r3')).toBe(true);
    expect(columns.has('A7_1r1')).toBe(true);
    expect(columns.has('OE1')).toBe(false);
    expect(columns.has('EXCL')).toBe(false);
  });
});

describe('deriveLoopIterationCount', () => {
  it('returns max iteration count', () => {
    expect(deriveLoopIterationCount(sampleQuestionFile)).toBe(2);
  });

  it('returns 0 for no loops', () => {
    expect(deriveLoopIterationCount({ questionIds: [sampleQuestionFile.questionIds[0]] })).toBe(0);
  });
});

describe('toBannerVerboseDataMap', () => {
  it('expands summaries to flat rows', () => {
    const summaries = buildBannerContext(sampleQuestionFile);
    const rows = toBannerVerboseDataMap(summaries);
    expect(rows.length).toBeGreaterThan(0);
    // S8 has 3 items → 3 rows
    const s8Rows = rows.filter((r) => r.parentQuestion === 'S8');
    expect(s8Rows).toHaveLength(3);
    expect(s8Rows[0].level).toBe('parent');
    expect(s8Rows[1].level).toBe('sub');
  });

  it('sets parentQuestion from questionId', () => {
    const summaries = buildBannerContext(sampleQuestionFile);
    const rows = toBannerVerboseDataMap(summaries);
    for (const row of rows) {
      expect(row.parentQuestion).toBeTruthy();
    }
  });
});
