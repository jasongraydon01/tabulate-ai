import { describe, it, expect } from 'vitest';
import { applyBinaryFamilyCollapse } from '../enricher';
import type { QuestionGroup } from '../groupingAdapter';

/** Helper to create a single-item binary_flag group */
function binaryGroup(questionId: string, label: string): QuestionGroup {
  return {
    questionId,
    questionText: label,
    items: [
      {
        column: questionId,
        label,
        normalizedType: 'binary_flag',
        valueType: 'Values: 0-1',
      },
    ],
  };
}

/** Helper to create a single-item group with a specific type */
function typedGroup(questionId: string, label: string, normalizedType: string): QuestionGroup {
  return {
    questionId,
    questionText: label,
    items: [
      {
        column: questionId,
        label,
        normalizedType,
        valueType: 'Values: 1-5',
      },
    ],
  };
}

/** Helper to create a multi-item group */
function multiItemGroup(questionId: string, columns: string[]): QuestionGroup {
  return {
    questionId,
    questionText: `Question ${questionId}`,
    items: columns.map(col => ({
      column: col,
      label: `Label for ${col}`,
      normalizedType: 'binary_flag',
      valueType: 'Values: 0-1',
    })),
  };
}

describe('applyBinaryFamilyCollapse', () => {
  // ── Positive cases ──

  it('collapses a binary flag family with 5+ members into 1 group', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q100_0', 'Theme A'),
      binaryGroup('Q100_1', 'Theme B'),
      binaryGroup('Q100_2', 'Theme C'),
      binaryGroup('Q100_3', 'Theme D'),
      binaryGroup('Q100_4', 'Theme E'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(result).toHaveLength(1);
    expect(result[0].questionId).toBe('Q100');
    expect(result[0].questionText).toBe('Q100');
    expect(result[0].items).toHaveLength(5);
    expect(result[0].items.map(i => i.column)).toEqual([
      'Q100_0', 'Q100_1', 'Q100_2', 'Q100_3', 'Q100_4',
    ]);

    expect(logs).toHaveLength(1);
    expect(logs[0].familyBase).toBe('Q100');
    expect(logs[0].memberCount).toBe(5);
  });

  it('collapses zero-indexed family correctly', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q200_0', 'Code 0'),
      binaryGroup('Q200_1', 'Code 1'),
      binaryGroup('Q200_2', 'Code 2'),
    ];

    const { groups: result } = applyBinaryFamilyCollapse(groups);

    expect(result).toHaveLength(1);
    expect(result[0].questionId).toBe('Q200');
    expect(result[0].items[0].column).toBe('Q200_0');
  });

  it('collapses multiple independent families in one pass', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q300_0', 'Family A code 0'),
      binaryGroup('Q300_1', 'Family A code 1'),
      binaryGroup('Q300_2', 'Family A code 2'),
      binaryGroup('Q400_0', 'Family B code 0'),
      binaryGroup('Q400_1', 'Family B code 1'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(result).toHaveLength(2);
    expect(logs).toHaveLength(2);

    const ids = result.map(g => g.questionId).sort();
    expect(ids).toEqual(['Q300', 'Q400']);

    const q300 = result.find(g => g.questionId === 'Q300')!;
    expect(q300.items).toHaveLength(3);

    const q400 = result.find(g => g.questionId === 'Q400')!;
    expect(q400.items).toHaveLength(2);
  });

  it('preserves non-family groups alongside collapsed groups', () => {
    const groups: QuestionGroup[] = [
      typedGroup('S1', 'Screener question', 'categorical_select'),
      binaryGroup('Q500_0', 'Theme 0'),
      binaryGroup('Q500_1', 'Theme 1'),
      binaryGroup('Q500_2', 'Theme 2'),
      typedGroup('Q600', 'Regular question', 'numeric_scale'),
    ];

    const { groups: result } = applyBinaryFamilyCollapse(groups);

    expect(result).toHaveLength(3); // S1, Q500 (collapsed), Q600
    expect(result.find(g => g.questionId === 'S1')).toBeDefined();
    expect(result.find(g => g.questionId === 'Q500')).toBeDefined();
    expect(result.find(g => g.questionId === 'Q600')).toBeDefined();
  });

  it('collapsed items retain original column names and labels', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q700_0', 'Very satisfied'),
      binaryGroup('Q700_1', 'Somewhat satisfied'),
      binaryGroup('Q700_2', 'Not satisfied'),
    ];

    const { groups: result } = applyBinaryFamilyCollapse(groups);
    const collapsed = result[0];

    expect(collapsed.items[0].column).toBe('Q700_0');
    expect(collapsed.items[0].label).toBe('Very satisfied');
    expect(collapsed.items[1].column).toBe('Q700_1');
    expect(collapsed.items[1].label).toBe('Somewhat satisfied');
    expect(collapsed.items[2].column).toBe('Q700_2');
    expect(collapsed.items[2].label).toBe('Not satisfied');
  });

  // ── Negative cases (should NOT collapse) ──

  it('does not collapse when parent group BASE exists', () => {
    const groups: QuestionGroup[] = [
      typedGroup('Q800', 'Parent question', 'categorical_select'),
      binaryGroup('Q800_0', 'Code 0'),
      binaryGroup('Q800_1', 'Code 1'),
      binaryGroup('Q800_2', 'Code 2'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(logs).toHaveLength(0);
    expect(result).toHaveLength(4); // All original groups preserved
  });

  it('does not collapse when items are categorical_select (not binary_flag)', () => {
    const groups: QuestionGroup[] = [
      typedGroup('Q900_0', 'Option A', 'categorical_select'),
      typedGroup('Q900_1', 'Option B', 'categorical_select'),
      typedGroup('Q900_2', 'Option C', 'categorical_select'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(logs).toHaveLength(0);
    expect(result).toHaveLength(3);
  });

  it('does not collapse multi-variable groups (loop pattern)', () => {
    const groups: QuestionGroup[] = [
      multiItemGroup('Q1000_0', ['Q1000_0r1', 'Q1000_0r2', 'Q1000_0r3']),
      multiItemGroup('Q1000_1', ['Q1000_1r1', 'Q1000_1r2', 'Q1000_1r3']),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(logs).toHaveLength(0);
    expect(result).toHaveLength(2);
  });

  it('does not collapse a family with only 1 member', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q1100_0', 'Single code'),
      typedGroup('Q1200', 'Other question', 'numeric_scale'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(logs).toHaveLength(0);
    expect(result).toHaveLength(2);
  });

  it('does not collapse when normalizedTypes are mixed within family', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q1300_0', 'Binary code'),
      typedGroup('Q1300_1', 'Scale item', 'numeric_scale'),
      binaryGroup('Q1300_2', 'Another binary'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(logs).toHaveLength(0);
    expect(result).toHaveLength(3);
  });

  // ── Edge cases ──

  it('handles non-sequential suffix indices (gaps)', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q1400_0', 'Code 0'),
      binaryGroup('Q1400_2', 'Code 2'),
      binaryGroup('Q1400_5', 'Code 5'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(result).toHaveLength(1);
    expect(result[0].questionId).toBe('Q1400');
    // Items should be in suffix order
    expect(result[0].items.map(i => i.column)).toEqual([
      'Q1400_0', 'Q1400_2', 'Q1400_5',
    ]);
    expect(logs[0].memberCount).toBe(3);
  });

  it('passes through when no sibling families exist', () => {
    const groups: QuestionGroup[] = [
      typedGroup('S1', 'Screener', 'categorical_select'),
      typedGroup('Q1', 'Question 1', 'numeric_scale'),
      typedGroup('Q2', 'Question 2', 'categorical_select'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(logs).toHaveLength(0);
    expect(result).toHaveLength(3);
    expect(result).toEqual(groups);
  });

  it('handles underscore in base name (Q_100_0 → base Q_100)', () => {
    const groups: QuestionGroup[] = [
      binaryGroup('Q_100_0', 'Code 0'),
      binaryGroup('Q_100_1', 'Code 1'),
      binaryGroup('Q_100_2', 'Code 2'),
    ];

    const { groups: result, logs } = applyBinaryFamilyCollapse(groups);

    expect(result).toHaveLength(1);
    expect(result[0].questionId).toBe('Q_100');
    expect(result[0].items).toHaveLength(3);
    expect(logs[0].familyBase).toBe('Q_100');
  });
});
