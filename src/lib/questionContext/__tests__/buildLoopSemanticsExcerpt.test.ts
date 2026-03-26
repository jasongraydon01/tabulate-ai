import { describe, it, expect } from 'vitest';
import { buildLoopSemanticsExcerpt } from '../adapters';
import type { QuestionIdEntry } from '../adapters';

function makeEntry(overrides: Partial<QuestionIdEntry> & { questionId: string }): QuestionIdEntry {
  return {
    questionText: overrides.questionId,
    variables: [],
    disposition: 'reportable',
    normalizedType: 'single_select',
    items: [],
    ...overrides,
  };
}

describe('buildLoopSemanticsExcerpt', () => {
  it('includes variables referenced in cuts', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q1',
        questionText: 'What is your gender?',
        items: [
          { column: 'Gender', label: 'Respondent gender', normalizedType: 'single_select', scaleLabels: [{ value: 1, label: 'Male' }, { value: 2, label: 'Female' }] },
        ],
      }),
    ];

    const cuts = [{ rExpression: 'Gender == 1' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    expect(result).toHaveLength(1);
    expect(result[0].column).toBe('Gender');
    expect(result[0].description).toBe('Respondent gender');
    expect(result[0].questionId).toBe('Q1');
    expect(result[0].questionText).toBe('What is your gender?');
    expect(result[0].answerOptions).toBe('1=Male,2=Female');
  });

  it('excludes unreferenced variables', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q1',
        items: [{ column: 'Gender', label: 'Gender', normalizedType: 'single_select' }],
      }),
      makeEntry({
        questionId: 'Q2',
        items: [{ column: 'Age', label: 'Age group', normalizedType: 'single_select' }],
      }),
    ];

    const cuts = [{ rExpression: 'Gender == 1' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    expect(result).toHaveLength(1);
    expect(result[0].column).toBe('Gender');
  });

  it('includes h-prefix and d-prefix variants', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q5',
        items: [
          { column: 'Q5', label: 'Question 5', normalizedType: 'single_select' },
          { column: 'hQ5', label: 'Hidden Q5', normalizedType: 'single_select' },
        ],
      }),
    ];

    const cuts = [{ rExpression: 'Q5 == 1' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    const columns = result.map(r => r.column);
    expect(columns).toContain('Q5');
    expect(columns).toContain('hQ5');
  });

  it('propagates loop metadata from parent entry', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q10_1',
        questionText: 'Rating of concept 1',
        loop: { detected: true, familyBase: 'Q10', iterationIndex: 1, iterationCount: 3 },
        loopQuestionId: 'Q10',
        items: [{ column: 'Q10_1', label: 'Rating concept 1', normalizedType: 'scale_rating' }],
      }),
      makeEntry({
        questionId: 'Q10_2',
        questionText: 'Rating of concept 2',
        loop: { detected: true, familyBase: 'Q10', iterationIndex: 2, iterationCount: 3 },
        loopQuestionId: 'Q10',
        items: [{ column: 'Q10_2', label: 'Rating concept 2', normalizedType: 'scale_rating' }],
      }),
    ];

    const cuts = [{ rExpression: '(Q10_1 == 1 | Q10_2 == 1)' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    expect(result).toHaveLength(2);

    const q10_1 = result.find(r => r.column === 'Q10_1')!;
    expect(q10_1.loop).toEqual({ familyBase: 'Q10', iterationIndex: 1, iterationCount: 3 });
    expect(q10_1.loopQuestionId).toBe('Q10');

    const q10_2 = result.find(r => r.column === 'Q10_2')!;
    expect(q10_2.loop).toEqual({ familyBase: 'Q10', iterationIndex: 2, iterationCount: 3 });
  });

  it('sets analyticalSubtype from parent entry', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q3',
        analyticalSubtype: 'scale_rating',
        items: [{ column: 'Q3', label: 'Rating', normalizedType: 'scale' }],
      }),
    ];

    const cuts = [{ rExpression: 'Q3 == 5' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    expect(result[0].analyticalSubtype).toBe('scale_rating');
  });

  it('handles variables in entry.variables but not items', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q7',
        questionText: 'Question 7',
        variables: ['Q7'],
        items: [], // no items
      }),
    ];

    const cuts = [{ rExpression: 'Q7 == 1' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    expect(result).toHaveLength(1);
    expect(result[0].column).toBe('Q7');
    expect(result[0].questionId).toBe('Q7');
  });

  it('returns empty excerpt for empty entries', () => {
    const result = buildLoopSemanticsExcerpt([], [{ rExpression: 'Q1 == 1' }]);
    expect(result).toEqual([]);
  });

  it('returns empty excerpt for empty cuts', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q1',
        items: [{ column: 'Q1', label: 'Q1', normalizedType: 'single_select' }],
      }),
    ];

    const result = buildLoopSemanticsExcerpt(entries, []);
    expect(result).toEqual([]);
  });

  it('does not crash when cuts reference variables not in entries', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q1',
        items: [{ column: 'Q1', label: 'Q1', normalizedType: 'single_select' }],
      }),
    ];

    const cuts = [{ rExpression: 'NonExistent == 1' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);
    expect(result).toEqual([]);
  });

  it('packs answerOptions from scaleLabels correctly', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q2',
        items: [{
          column: 'Q2',
          label: 'Satisfaction',
          normalizedType: 'scale',
          scaleLabels: [
            { value: 1, label: 'Very dissatisfied' },
            { value: 5, label: 'Very satisfied' },
          ],
        }],
      }),
    ];

    const cuts = [{ rExpression: 'Q2 >= 4' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    expect(result[0].answerOptions).toBe('1=Very dissatisfied,5=Very satisfied');
  });

  it('sets null loop for entries without loop detection', () => {
    const entries: QuestionIdEntry[] = [
      makeEntry({
        questionId: 'Q1',
        items: [{ column: 'Q1', label: 'Q1', normalizedType: 'single_select' }],
      }),
    ];

    const cuts = [{ rExpression: 'Q1 == 1' }];
    const result = buildLoopSemanticsExcerpt(entries, cuts);

    expect(result[0].loop).toBeNull();
    expect(result[0].loopQuestionId).toBeNull();
  });
});
