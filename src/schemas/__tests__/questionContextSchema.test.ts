import { describe, it, expect } from 'vitest';
import {
  QuestionContextSchema,
  QuestionContextItemSchema,
  BannerQuestionSummarySchema,
  ValueLabelSchema,
} from '../questionContextSchema';

describe('QuestionContextSchema', () => {
  const validItem = {
    column: 'S8r1',
    label: 'Patient care',
    normalizedType: 'numeric_range',
    valueLabels: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }],
  };

  const validQuestion = {
    questionId: 'S8',
    questionText: 'What proportion of time do you spend on...',
    normalizedType: 'numeric_range',
    analyticalSubtype: 'allocation',
    disposition: 'reportable' as const,
    isHidden: false,
    hiddenLink: null,
    loop: null,
    loopQuestionId: null,
    surveyMatch: 'exact',
    baseSummary: null,
    items: [validItem],
  };

  it('parses a valid QuestionContext', () => {
    const result = QuestionContextSchema.safeParse(validQuestion);
    expect(result.success).toBe(true);
  });

  it('parses with nullable fields set to null', () => {
    const result = QuestionContextSchema.safeParse({
      ...validQuestion,
      analyticalSubtype: null,
      hiddenLink: null,
      loop: null,
      loopQuestionId: null,
      surveyMatch: null,
    });
    expect(result.success).toBe(true);
  });

  it('parses with hiddenLink populated', () => {
    const result = QuestionContextSchema.safeParse({
      ...validQuestion,
      isHidden: true,
      hiddenLink: { linkedTo: 'S8r1-r5', method: 'suffix' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hiddenLink?.linkedTo).toBe('S8r1-r5');
    }
  });

  it('parses with loop metadata', () => {
    const result = QuestionContextSchema.safeParse({
      ...validQuestion,
      loop: { familyBase: 'A7', iterationIndex: 0, iterationCount: 3 },
      loopQuestionId: 'A7',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.loop?.iterationCount).toBe(3);
    }
  });

  it('parses with baseSummary populated', () => {
    const result = QuestionContextSchema.safeParse({
      ...validQuestion,
      baseSummary: {
        situation: 'filtered',
        signals: ['filtered-base', 'low-base'],
        questionBase: 284,
        totalN: 500,
        itemBaseRange: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseSummary?.situation).toBe('filtered');
      expect(result.data.baseSummary?.signals).toEqual(['filtered-base', 'low-base']);
      expect(result.data.baseSummary?.questionBase).toBe(284);
      expect(result.data.baseSummary?.totalN).toBe(500);
    }
  });

  it('parses with baseSummary including itemBaseRange', () => {
    const result = QuestionContextSchema.safeParse({
      ...validQuestion,
      baseSummary: {
        situation: 'varying_items',
        signals: ['varying-item-bases'],
        questionBase: 45,
        totalN: 200,
        itemBaseRange: [20, 45],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseSummary?.itemBaseRange).toEqual([20, 45]);
    }
  });

  it('rejects non-reportable disposition', () => {
    const result = QuestionContextSchema.safeParse({
      ...validQuestion,
      disposition: 'excluded',
    });
    expect(result.success).toBe(false);
  });

  it('parses items with empty valueLabels', () => {
    const result = QuestionContextItemSchema.safeParse({
      column: 'Q1',
      label: 'Question 1',
      normalizedType: 'binary_flag',
      valueLabels: [],
    });
    expect(result.success).toBe(true);
  });

  it('parses value labels with string values', () => {
    const result = ValueLabelSchema.safeParse({ value: 'A', label: 'Option A' });
    expect(result.success).toBe(true);
  });

  it('parses value labels with numeric values', () => {
    const result = ValueLabelSchema.safeParse({ value: 3, label: 'Option C' });
    expect(result.success).toBe(true);
  });
});

describe('BannerQuestionSummarySchema', () => {
  it('parses a valid summary', () => {
    const result = BannerQuestionSummarySchema.safeParse({
      questionId: 'S2',
      questionText: 'Primary Specialty',
      normalizedType: 'categorical_select',
      analyticalSubtype: null,
      itemCount: 1,
      valueLabels: [{ value: 1, label: 'Cardiologist' }],
      itemLabels: [{ column: 'S2', label: 'Primary Specialty' }],
      loopIterationCount: null,
      isHidden: false,
      hiddenLinkedTo: null,
    });
    expect(result.success).toBe(true);
  });
});
