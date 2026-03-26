import { describe, it, expect } from 'vitest';
import { generateTables, getGeneratorStats } from '../TableGenerator';
import { makeQuestionGroup, makeQuestionItem } from '../../__tests__/fixtures';

describe('TableGenerator', () => {
  it('generates frequency table from categorical_select group', () => {
    const group = makeQuestionGroup({
      questionId: 'Q1',
      items: [
        makeQuestionItem({
          column: 'Q1',
          normalizedType: 'categorical_select',
          allowedValues: [1, 2, 3],
          scaleLabels: [
            { value: 1, label: 'Low' },
            { value: 2, label: 'Medium' },
            { value: 3, label: 'High' },
          ],
        }),
      ],
    });
    const outputs = generateTables([group]);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].tables[0].tableType).toBe('frequency');
    expect(outputs[0].tables[0].rows).toHaveLength(3);
    // Should use scaleLabels for row labels
    expect(outputs[0].tables[0].rows[0].label).toBe('Low');
    expect(outputs[0].tables[0].rows[0].filterValue).toBe('1');
  });

  it('generates mean_rows table from numeric_range group', () => {
    const group = makeQuestionGroup({
      questionId: 'Q2',
      items: [
        makeQuestionItem({
          column: 'Q2r1',
          label: 'Item 1',
          normalizedType: 'numeric_range',
          allowedValues: undefined,
          scaleLabels: undefined,
          rangeMin: 0,
          rangeMax: 100,
        }),
        makeQuestionItem({
          column: 'Q2r2',
          label: 'Item 2',
          normalizedType: 'numeric_range',
          allowedValues: undefined,
          scaleLabels: undefined,
          rangeMin: 0,
          rangeMax: 100,
        }),
      ],
    });
    const outputs = generateTables([group]);
    expect(outputs[0].tables[0].tableType).toBe('mean_rows');
    expect(outputs[0].tables[0].rows).toHaveLength(2);
    // mean_rows should have empty filterValue
    expect(outputs[0].tables[0].rows[0].filterValue).toBe('');
    expect(outputs[0].tables[0].rows[0].variable).toBe('Q2r1');
  });

  it('generates binary flag rows with filterValue "1"', () => {
    const group = makeQuestionGroup({
      questionId: 'Q3',
      items: [
        makeQuestionItem({
          column: 'Q3r1',
          label: 'Feature A',
          normalizedType: 'binary_flag',
          allowedValues: undefined,
          scaleLabels: undefined,
        }),
        makeQuestionItem({
          column: 'Q3r2',
          label: 'Feature B',
          normalizedType: 'binary_flag',
          allowedValues: undefined,
          scaleLabels: undefined,
        }),
      ],
    });
    const outputs = generateTables([group]);
    expect(outputs[0].tables[0].tableType).toBe('frequency');
    expect(outputs[0].tables[0].rows).toHaveLength(2);
    expect(outputs[0].tables[0].rows[0].filterValue).toBe('1');
    expect(outputs[0].tables[0].rows[1].filterValue).toBe('1');
  });

  it('prefers scaleLabels for row labels over item label', () => {
    const group = makeQuestionGroup({
      items: [
        makeQuestionItem({
          column: 'Q1',
          label: 'Rating',
          normalizedType: 'ordinal_scale',
          allowedValues: [1, 2],
          scaleLabels: [
            { value: 1, label: 'Strongly Agree' },
            { value: 2, label: 'Agree' },
          ],
        }),
      ],
    });
    const outputs = generateTables([group]);
    expect(outputs[0].tables[0].rows[0].label).toBe('Strongly Agree');
    expect(outputs[0].tables[0].rows[1].label).toBe('Agree');
  });

  it('prefixes scale labels with sub-item labels for multi-item sub-variable groups', () => {
    const group = makeQuestionGroup({
      questionId: 'A1',
      questionText: 'Which statement best describes each treatment?',
      items: [
        makeQuestionItem({
          column: 'A1r1',
          label: 'Product A (generic)',
          subItemLabel: 'Product A (generic)',
          normalizedType: 'categorical_select',
          allowedValues: [1, 2],
          scaleLabels: [
            { value: 1, label: 'As an adjunct to diet' },
            { value: 2, label: 'As an adjunct to diet and statin therapy' },
          ],
        }),
        makeQuestionItem({
          column: 'A1r2',
          label: 'Product B (generic)',
          subItemLabel: 'Product B (generic)',
          normalizedType: 'categorical_select',
          allowedValues: [1, 2],
          scaleLabels: [
            { value: 1, label: 'As an adjunct to diet' },
            { value: 2, label: 'As an adjunct to diet and statin therapy' },
          ],
        }),
      ],
    });

    const outputs = generateTables([group]);
    expect(outputs[0].tables[0].rows[0].label).toBe('Product A (generic) - As an adjunct to diet');
    expect(outputs[0].tables[0].rows[2].label).toBe('Product B (generic) - As an adjunct to diet');
  });

  it('falls back to single row with empty filterValue when no allowedValues', () => {
    const group = makeQuestionGroup({
      items: [
        makeQuestionItem({
          column: 'Q1',
          label: 'Unknown item',
          normalizedType: 'categorical_select',
          allowedValues: undefined,
          scaleLabels: undefined,
        }),
      ],
    });
    const outputs = generateTables([group]);
    expect(outputs[0].tables[0].rows).toHaveLength(1);
    expect(outputs[0].tables[0].rows[0].filterValue).toBe('');
  });

  it('sanitizes tableId (lowercase, no special chars)', () => {
    const group = makeQuestionGroup({
      questionId: 'Q1a-Special!',
      items: [makeQuestionItem()],
    });
    const outputs = generateTables([group]);
    expect(outputs[0].tables[0].tableId).toBe('q1a_special');
  });

  it('detects grid dimensions from r[N]c[N] pattern', () => {
    const items = [];
    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 2; c++) {
        items.push(
          makeQuestionItem({
            column: `Q5r${r}c${c}`,
            label: `Row ${r} Col ${c}`,
            normalizedType: 'numeric_range',
            allowedValues: undefined,
            scaleLabels: undefined,
          }),
        );
      }
    }
    const group = makeQuestionGroup({ questionId: 'Q5', items });
    const outputs = generateTables([group]);
    expect(outputs[0].tables[0].meta.gridDimensions).toEqual({ rows: 3, cols: 2 });
  });

  it('generates one output per group for multiple groups', () => {
    const groups = [
      makeQuestionGroup({ questionId: 'Q1', items: [makeQuestionItem({ column: 'Q1r1' })] }),
      makeQuestionGroup({ questionId: 'Q2', items: [makeQuestionItem({ column: 'Q2r1' })] }),
      makeQuestionGroup({ questionId: 'Q3', items: [makeQuestionItem({ column: 'Q3r1' })] }),
    ];
    const outputs = generateTables(groups);
    expect(outputs).toHaveLength(3);
    expect(outputs[0].questionId).toBe('Q1');
    expect(outputs[1].questionId).toBe('Q2');
    expect(outputs[2].questionId).toBe('Q3');
  });

  describe('getGeneratorStats', () => {
    it('returns correct counts', () => {
      const groups = [
        makeQuestionGroup({
          questionId: 'Q1',
          items: [
            makeQuestionItem({ normalizedType: 'categorical_select', allowedValues: [1, 2] }),
          ],
        }),
        makeQuestionGroup({
          questionId: 'Q2',
          items: [
            makeQuestionItem({
              normalizedType: 'numeric_range',
              allowedValues: undefined,
              scaleLabels: undefined,
            }),
          ],
        }),
      ];
      const outputs = generateTables(groups);
      const stats = getGeneratorStats(outputs);
      expect(stats.totalGroups).toBe(2);
      expect(stats.totalTables).toBe(2);
      expect(stats.totalRows).toBe(3); // 2 categorical + 1 mean
      expect(stats.tableTypeDistribution.frequency).toBe(1);
      expect(stats.tableTypeDistribution.mean_rows).toBe(1);
    });
  });
});
