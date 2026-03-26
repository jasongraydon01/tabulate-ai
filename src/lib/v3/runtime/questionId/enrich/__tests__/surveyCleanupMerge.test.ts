import { describe, it, expect } from 'vitest';
import {
  charLevenshtein,
  mergeCleanupOutputs,
} from '../surveyCleanupMerge';
import type { ParsedSurveyQuestion } from '../../types';
import type { SurveyCleanupOutput } from '@/schemas/surveyCleanupSchema';

// =============================================================================
// Helpers
// =============================================================================

function makeQuestion(overrides: Partial<ParsedSurveyQuestion> = {}): ParsedSurveyQuestion {
  return {
    questionId: 'Q1',
    rawText: 'Raw question text',
    questionText: 'Original question text',
    instructionText: null,
    answerOptions: [
      { code: 1, text: 'Option A', isOther: false, anchor: false, routing: null, progNote: null },
      { code: 2, text: 'Option B', isOther: false, anchor: false, routing: null, progNote: null },
    ],
    scaleLabels: null,
    questionType: 'single_select',
    format: 'numbered_list',
    progNotes: [],
    strikethroughSegments: [],
    sectionHeader: null,
    ...overrides,
  };
}

function makeCleanupOutput(
  questions: Array<{
    questionId?: string;
    questionText?: string;
    instructionText?: string;
    answerOptions?: Array<{ code: number | string; text: string }>;
    scaleLabels?: Array<{ value: number; label: string }>;
    questionType?: string;
    sectionHeader?: string;
  }>,
): SurveyCleanupOutput {
  return {
    questions: questions.map((q) => ({
      questionId: q.questionId ?? 'Q1',
      questionText: q.questionText ?? 'Original question text',
      instructionText: q.instructionText ?? '',
      answerOptions: q.answerOptions ?? [
        { code: 1, text: 'Option A' },
        { code: 2, text: 'Option B' },
      ],
      scaleLabels: q.scaleLabels ?? [],
      questionType: q.questionType ?? 'single_select',
      sectionHeader: q.sectionHeader ?? '',
    })),
  };
}

// =============================================================================
// charLevenshtein tests
// =============================================================================

describe('charLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(charLevenshtein('abc', 'abc')).toBe(0);
  });

  it('returns 0 for two empty strings', () => {
    expect(charLevenshtein('', '')).toBe(0);
  });

  it('returns length of non-empty string when other is empty', () => {
    expect(charLevenshtein('abc', '')).toBe(3);
    expect(charLevenshtein('', 'xyz')).toBe(3);
  });

  it('returns 1 for single character difference', () => {
    expect(charLevenshtein('cat', 'bat')).toBe(1);
  });

  it('returns correct distance for insertions', () => {
    expect(charLevenshtein('abc', 'abcd')).toBe(1);
  });

  it('returns correct distance for deletions', () => {
    expect(charLevenshtein('abcd', 'abc')).toBe(1);
  });

  it('returns correct distance for completely different strings', () => {
    expect(charLevenshtein('abc', 'xyz')).toBe(3);
  });

  it('handles longer strings', () => {
    expect(charLevenshtein('kitten', 'sitting')).toBe(3);
  });
});

// =============================================================================
// mergeCleanupOutputs tests
// =============================================================================

describe('mergeCleanupOutputs', () => {
  // --- Fallback cases ---

  it('returns original unchanged when 0 valid outputs', () => {
    const original = [makeQuestion()];
    const { merged, stats } = mergeCleanupOutputs(original, [null, null, null]);

    expect(merged).toEqual(original);
    expect(stats.fallbackUsed).toBe(true);
    expect(stats.validOutputs).toBe(0);
    expect(stats.questionsModified).toBe(0);
  });

  it('returns original unchanged when only 1 valid output', () => {
    const original = [makeQuestion()];
    const output = makeCleanupOutput([{ questionText: 'Cleaned text' }]);
    const { merged, stats } = mergeCleanupOutputs(original, [output, null, null]);

    expect(merged).toEqual(original);
    expect(stats.fallbackUsed).toBe(true);
    expect(stats.validOutputs).toBe(1);
  });

  // --- String field voting ---

  it('uses majority value when all 3 agree on questionText', () => {
    const original = [makeQuestion({ questionText: '**Bold** question?' })];
    const cleaned = makeCleanupOutput([{ questionText: 'Bold question?' }]);

    const { merged, stats } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].questionText).toBe('Bold question?');
    expect(stats.fieldChanges.questionText).toBe(1);
    expect(stats.questionsModified).toBe(1);
  });

  it('uses majority value when 2 of 3 agree on questionText', () => {
    const original = [makeQuestion({ questionText: '**Bold** question?' })];
    const good = makeCleanupOutput([{ questionText: 'Bold question?' }]);
    const odd = makeCleanupOutput([{ questionText: 'Bold question' }]); // missing ?

    const { merged, stats } = mergeCleanupOutputs(original, [good, odd, good]);

    expect(merged[0].questionText).toBe('Bold question?');
    expect(stats.fieldChanges.questionText).toBe(1);
  });

  it('uses closest to original when all 3 disagree on questionText', () => {
    const original = [makeQuestion({ questionText: 'How satisfied are you?' })];
    const a = makeCleanupOutput([{ questionText: 'How satisfied are you' }]); // dist 1 (missing ?)
    const b = makeCleanupOutput([{ questionText: 'How happy are you?' }]); // larger dist
    const c = makeCleanupOutput([{ questionText: 'Satisfaction level?' }]); // very different

    const { merged } = mergeCleanupOutputs(original, [a, b, c]);

    // 'a' is closest to original (Levenshtein distance 1)
    expect(merged[0].questionText).toBe('How satisfied are you');
  });

  it('returns original value when all 3 agree with original (no modification)', () => {
    const original = [makeQuestion({ questionText: 'Clean question already' })];
    const same = makeCleanupOutput([{ questionText: 'Clean question already' }]);

    const { merged, stats } = mergeCleanupOutputs(original, [same, same, same]);

    expect(merged[0].questionText).toBe('Clean question already');
    expect(stats.questionsModified).toBe(0);
  });

  // --- instructionText ---

  it('fills instructionText from consensus', () => {
    const original = [makeQuestion({ instructionText: null })];
    const cleaned = makeCleanupOutput([{ instructionText: 'Select all that apply' }]);

    const { merged, stats } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].instructionText).toBe('Select all that apply');
    expect(stats.fieldChanges.instructionText).toBe(1);
  });

  // --- questionType ---

  it('corrects questionType with 2/3 majority', () => {
    const original = [makeQuestion({ questionType: 'single_select' })];
    const a = makeCleanupOutput([{ questionType: 'multi_select' }]);
    const b = makeCleanupOutput([{ questionType: 'multi_select' }]);
    const c = makeCleanupOutput([{ questionType: 'single_select' }]);

    const { merged, stats } = mergeCleanupOutputs(original, [a, b, c]);

    expect(merged[0].questionType).toBe('multi_select');
    expect(stats.fieldChanges.questionType).toBe(1);
  });

  // --- sectionHeader ---

  it('fills sectionHeader from consensus', () => {
    const original = [makeQuestion({ sectionHeader: null })];
    const cleaned = makeCleanupOutput([{ sectionHeader: 'Demographics' }]);

    const { merged, stats } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].sectionHeader).toBe('Demographics');
    expect(stats.fieldChanges.sectionHeader).toBe(1);
  });

  // --- answerOptions ---

  it('cleans answerOption text with consensus voting by code', () => {
    const original = [
      makeQuestion({
        answerOptions: [
          { code: 1, text: '**Option A** [GO TO Q5]', isOther: false, anchor: false, routing: null, progNote: null },
          { code: 2, text: 'Option B', isOther: false, anchor: false, routing: null, progNote: null },
        ],
      }),
    ];
    const cleaned = makeCleanupOutput([{
      answerOptions: [
        { code: 1, text: 'Option A' },
        { code: 2, text: 'Option B' },
      ],
    }]);

    const { merged, stats } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].answerOptions[0].text).toBe('Option A');
    expect(merged[0].answerOptions[1].text).toBe('Option B');
    // Immutable fields preserved
    expect(merged[0].answerOptions[0].isOther).toBe(false);
    expect(merged[0].answerOptions[0].anchor).toBe(false);
    expect(merged[0].answerOptions[0].routing).toBeNull();
    expect(stats.fieldChanges.answerOptions).toBe(1);
  });

  it('preserves answerOption when fewer than 2 outputs have the code', () => {
    const original = [
      makeQuestion({
        answerOptions: [
          { code: 1, text: 'Option A', isOther: false, anchor: false, routing: null, progNote: null },
          { code: 99, text: 'Other', isOther: true, anchor: false, routing: null, progNote: null },
        ],
      }),
    ];
    // Only one output includes code 99
    const a = makeCleanupOutput([{
      answerOptions: [
        { code: 1, text: 'Option A' },
        { code: 99, text: 'Other specify' },
      ],
    }]);
    const b = makeCleanupOutput([{
      answerOptions: [
        { code: 1, text: 'Option A' },
        // code 99 missing
      ],
    }]);

    const { merged } = mergeCleanupOutputs(original, [a, b, b]);

    // code 99 only had 1 candidate — keeps original
    expect(merged[0].answerOptions[1].text).toBe('Other');
    expect(merged[0].answerOptions[1].isOther).toBe(true);
  });

  // --- scaleLabels ---

  it('cleans scaleLabel text with consensus voting by value', () => {
    const original = [
      makeQuestion({
        scaleLabels: [
          { value: 1, label: '1 - **Strongly disagree**' },
          { value: 5, label: '5 - Strongly agree' },
        ],
      }),
    ];
    const cleaned = makeCleanupOutput([{
      scaleLabels: [
        { value: 1, label: 'Strongly disagree' },
        { value: 5, label: 'Strongly agree' },
      ],
    }]);

    const { merged, stats } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].scaleLabels![0].label).toBe('Strongly disagree');
    expect(merged[0].scaleLabels![0].value).toBe(1);
    expect(stats.fieldChanges.scaleLabels).toBe(1);
  });

  it('preserves existing scale label tracking fields when voting rewrites label text', () => {
    const original = [
      makeQuestion({
        scaleLabels: [
          {
            value: 1,
            label: 'Old label',
            savLabel: 'Original .sav label',
            surveyLabel: 'Previous survey label',
          } as unknown as { value: number; label: string },
        ],
      }),
    ];
    const cleaned = makeCleanupOutput([{
      scaleLabels: [{ value: 1, label: 'Voted survey label' }],
    }]);

    const { merged } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    const mergedLabel = merged[0].scaleLabels![0] as {
      value: number;
      label: string;
      savLabel?: string;
      surveyLabel?: string;
    };
    expect(mergedLabel.label).toBe('Voted survey label');
    expect(mergedLabel.savLabel).toBe('Original .sav label');
    expect(mergedLabel.surveyLabel).toBe('Previous survey label');
  });

  it('clears misextracted scaleLabels when all 3 outputs return empty array', () => {
    const original = [
      makeQuestion({
        scaleLabels: [
          { value: 1, label: 'Q7' },
          { value: 2, label: 'Q7' },
        ],
      }),
    ];
    const cleaned = makeCleanupOutput([{ scaleLabels: [] }]);

    const { merged, stats } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].scaleLabels).toBeNull();
    expect(stats.fieldChanges.scaleLabels).toBe(1);
  });

  // --- Missing/extra questionIds ---

  it('uses original for questionIds missing from outputs', () => {
    const original = [
      makeQuestion({ questionId: 'Q1', questionText: 'First' }),
      makeQuestion({ questionId: 'Q2', questionText: 'Second' }),
    ];
    // Outputs only have Q1
    const cleaned = makeCleanupOutput([
      { questionId: 'Q1', questionText: 'Cleaned first' },
    ]);

    const { merged } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].questionText).toBe('Cleaned first');
    expect(merged[1].questionText).toBe('Second'); // unchanged
  });

  it('ignores extra questionIds in outputs', () => {
    const original = [makeQuestion({ questionId: 'Q1' })];
    const cleaned = makeCleanupOutput([
      { questionId: 'Q1', questionText: 'Cleaned' },
      { questionId: 'Q99', questionText: 'Extra' }, // not in original
    ]);

    const { merged } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged).toHaveLength(1);
    expect(merged[0].questionId).toBe('Q1');
  });

  // --- Immutable field preservation ---

  it('preserves immutable fields from original regardless of AI output', () => {
    const original = [
      makeQuestion({
        rawText: 'IMMUTABLE raw text',
        format: 'table',
        progNotes: ['{{PROG: NOTE}}'],
        strikethroughSegments: ['old text'],
      }),
    ];
    const cleaned = makeCleanupOutput([{ questionText: 'Cleaned' }]);

    const { merged } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(merged[0].rawText).toBe('IMMUTABLE raw text');
    expect(merged[0].format).toBe('table');
    expect(merged[0].progNotes).toEqual(['{{PROG: NOTE}}']);
    expect(merged[0].strikethroughSegments).toEqual(['old text']);
  });

  // --- Two valid outputs ---

  it('uses 2 outputs when they agree', () => {
    const original = [makeQuestion({ questionText: '**Bold** text' })];
    const cleaned = makeCleanupOutput([{ questionText: 'Bold text' }]);

    const { merged, stats } = mergeCleanupOutputs(original, [cleaned, cleaned, null]);

    expect(merged[0].questionText).toBe('Bold text');
    expect(stats.validOutputs).toBe(2);
    expect(stats.fallbackUsed).toBe(false);
  });

  it('falls back to closer-to-original when 2 outputs disagree', () => {
    const original = [makeQuestion({ questionText: 'How satisfied are you?' })];
    const a = makeCleanupOutput([{ questionText: 'How satisfied are you' }]); // dist 1
    const b = makeCleanupOutput([{ questionText: 'Satisfaction level?' }]); // dist much higher

    const { merged } = mergeCleanupOutputs(original, [a, b, null]);

    // Neither has majority (each has count 1), so pick closest to original
    expect(merged[0].questionText).toBe('How satisfied are you');
  });

  // --- Stats accuracy ---

  it('reports accurate stats for multi-question merge', () => {
    const original = [
      makeQuestion({ questionId: 'Q1', questionText: '**Q1**', sectionHeader: null }),
      makeQuestion({ questionId: 'Q2', questionText: 'Q2 clean', sectionHeader: null }),
      makeQuestion({ questionId: 'Q3', questionText: '~~Q3~~', questionType: 'single_select' }),
    ];
    const cleaned = makeCleanupOutput([
      { questionId: 'Q1', questionText: 'Q1', sectionHeader: 'Section A' },
      { questionId: 'Q2', questionText: 'Q2 clean', sectionHeader: 'Section A' },
      { questionId: 'Q3', questionText: 'Q3', questionType: 'multi_select', sectionHeader: '' },
    ]);

    const { stats } = mergeCleanupOutputs(original, [cleaned, cleaned, cleaned]);

    expect(stats.totalQuestions).toBe(3);
    expect(stats.questionsModified).toBe(3); // Q1: questionText+section, Q2: section, Q3: questionText+type
    expect(stats.fieldChanges.questionText).toBe(2); // Q1 and Q3
    expect(stats.fieldChanges.sectionHeader).toBe(2); // Q1 and Q2
    expect(stats.fieldChanges.questionType).toBe(1); // Q3
  });
});
