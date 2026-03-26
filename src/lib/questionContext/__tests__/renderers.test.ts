import { describe, it, expect } from 'vitest';
import { renderQuestionContextForCrosstab, renderBannerContext } from '../renderers';
import type { QuestionContext, BannerQuestionSummary } from '@/schemas/questionContextSchema';

const sampleQuestions: QuestionContext[] = [
  {
    questionId: 'S2',
    questionText: 'Primary Specialty',
    normalizedType: 'categorical_select',
    analyticalSubtype: null,
    disposition: 'reportable',
    isHidden: false,
    hiddenLink: null,
    loop: null,
    loopQuestionId: null,
    surveyMatch: 'exact',
    baseSummary: null,
    items: [
      {
        column: 'S2',
        label: 'Primary Specialty',
        normalizedType: 'categorical_select',
        valueLabels: [
          { value: 1, label: 'Cardiologist' },
          { value: 2, label: 'Internist' },
        ],
      },
    ],
  },
  {
    questionId: 'S8',
    questionText: 'Time allocation',
    normalizedType: 'numeric_range',
    analyticalSubtype: 'allocation',
    disposition: 'reportable',
    isHidden: false,
    hiddenLink: null,
    loop: null,
    loopQuestionId: null,
    surveyMatch: null,
    baseSummary: null,
    items: [
      { column: 'S8r1', label: 'Patient care', normalizedType: 'numeric_range', valueLabels: [] },
      { column: 'S8r2', label: 'Teaching', normalizedType: 'numeric_range', valueLabels: [] },
    ],
  },
  {
    questionId: 'hBRAND',
    questionText: 'Assigned brand',
    normalizedType: 'categorical_select',
    analyticalSubtype: null,
    disposition: 'reportable',
    isHidden: true,
    hiddenLink: { linkedTo: 'BRANDSr1-r5', method: 'suffix' },
    loop: null,
    loopQuestionId: null,
    surveyMatch: null,
    baseSummary: null,
    items: [
      {
        column: 'hBRAND',
        label: 'Assigned brand',
        normalizedType: 'categorical_select',
        valueLabels: [{ value: 1, label: 'Brand A' }, { value: 2, label: 'Brand B' }],
      },
    ],
  },
];

describe('renderQuestionContextForCrosstab', () => {
  it('wraps output in <questions> element with count', () => {
    const xml = renderQuestionContextForCrosstab(sampleQuestions);
    expect(xml).toMatch(/^<questions count="3" variables="4">/);
    expect(xml).toMatch(/<\/questions>$/);
  });

  it('renders question id and type as attributes', () => {
    const xml = renderQuestionContextForCrosstab(sampleQuestions);
    expect(xml).toContain('id="S2"');
    expect(xml).toContain('type="categorical_select"');
  });

  it('renders subtype attribute when present', () => {
    const xml = renderQuestionContextForCrosstab(sampleQuestions);
    expect(xml).toContain('subtype="allocation"');
  });

  it('renders <items> for multi-item questions', () => {
    const xml = renderQuestionContextForCrosstab(sampleQuestions);
    expect(xml).toContain('<item col="S8r1">Patient care</item>');
    expect(xml).toContain('<item col="S8r2">Teaching</item>');
  });

  it('renders <values> for questions with value labels', () => {
    const xml = renderQuestionContextForCrosstab(sampleQuestions);
    expect(xml).toContain('1=Cardiologist,2=Internist');
  });

  it('renders hidden attribute and linkedTo', () => {
    const xml = renderQuestionContextForCrosstab(sampleQuestions);
    expect(xml).toContain('hidden="true"');
    expect(xml).toContain('linkedTo="BRANDSr1-r5"');
  });

  it('renders loop metadata as attributes', () => {
    const loopQuestion: QuestionContext = {
      questionId: 'A7_1',
      questionText: 'Loop question',
      normalizedType: 'binary_flag',
      analyticalSubtype: null,
      disposition: 'reportable',
      isHidden: false,
      hiddenLink: null,
      loop: { familyBase: 'A7', iterationIndex: 0, iterationCount: 2 },
      loopQuestionId: 'A7',
      surveyMatch: null,
      baseSummary: null,
      items: [{ column: 'A7_1r1', label: 'Item', normalizedType: 'binary_flag', valueLabels: [] }],
    };
    const xml = renderQuestionContextForCrosstab([loopQuestion]);
    expect(xml).toContain('loop-family="A7"');
    expect(xml).toContain('loop-count="2"');
  });

  it('does not render base attributes when baseSummary is null', () => {
    const xml = renderQuestionContextForCrosstab(sampleQuestions);
    expect(xml).not.toContain('base-situation');
    expect(xml).not.toContain('base-n=');
    expect(xml).not.toContain('total-n=');
    expect(xml).not.toContain('base-signals');
  });

  it('renders base attributes when baseSummary is present', () => {
    const baseQuestion: QuestionContext = {
      questionId: 'Q3',
      questionText: 'Filtered question',
      normalizedType: 'categorical_select',
      analyticalSubtype: null,
      disposition: 'reportable',
      isHidden: false,
      hiddenLink: null,
      loop: null,
      loopQuestionId: null,
      surveyMatch: null,
      baseSummary: {
        situation: 'filtered',
        signals: ['filtered-base'],
        questionBase: 284,
        totalN: 500,
        itemBaseRange: null,
      },
      items: [
        {
          column: 'Q3',
          label: 'Test',
          normalizedType: 'categorical_select',
          valueLabels: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }],
        },
      ],
    };
    const xml = renderQuestionContextForCrosstab([baseQuestion]);
    expect(xml).toContain('base-situation="filtered"');
    expect(xml).toContain('base-n="284"');
    expect(xml).toContain('total-n="500"');
    expect(xml).toContain('base-signals="filtered-base"');
  });

  it('renders multiple base signals comma-separated', () => {
    const multiSignalQuestion: QuestionContext = {
      questionId: 'Q5',
      questionText: 'Varying question',
      normalizedType: 'binary_flag',
      analyticalSubtype: null,
      disposition: 'reportable',
      isHidden: false,
      hiddenLink: null,
      loop: null,
      loopQuestionId: null,
      surveyMatch: null,
      baseSummary: {
        situation: 'varying_items',
        signals: ['varying-item-bases', 'low-base'],
        questionBase: 28,
        totalN: 200,
        itemBaseRange: [15, 28],
      },
      items: [
        { column: 'Q5r1', label: 'Item A', normalizedType: 'binary_flag', valueLabels: [] },
      ],
    };
    const xml = renderQuestionContextForCrosstab([multiSignalQuestion]);
    expect(xml).toContain('base-signals="varying-item-bases,low-base"');
  });

  it('omits base attributes with no value', () => {
    const partialBase: QuestionContext = {
      questionId: 'Q7',
      questionText: 'Partial base',
      normalizedType: 'categorical_select',
      analyticalSubtype: null,
      disposition: 'reportable',
      isHidden: false,
      hiddenLink: null,
      loop: null,
      loopQuestionId: null,
      surveyMatch: null,
      baseSummary: {
        situation: null,
        signals: [],
        questionBase: null,
        totalN: null,
        itemBaseRange: null,
      },
      items: [
        { column: 'Q7', label: 'Test', normalizedType: 'categorical_select', valueLabels: [] },
      ],
    };
    const xml = renderQuestionContextForCrosstab([partialBase]);
    expect(xml).not.toContain('base-situation');
    expect(xml).not.toContain('base-n=');
    expect(xml).not.toContain('total-n=');
    expect(xml).not.toContain('base-signals');
  });
});

describe('renderBannerContext', () => {
  const summaries: BannerQuestionSummary[] = [
    {
      questionId: 'S2',
      questionText: 'Primary Specialty',
      normalizedType: 'categorical_select',
      analyticalSubtype: null,
      itemCount: 1,
      valueLabels: [{ value: 1, label: 'Cardiologist' }, { value: 2, label: 'Internist' }],
      itemLabels: [{ column: 'S2', label: 'Primary Specialty' }],
      loopIterationCount: null,
      isHidden: false,
      hiddenLinkedTo: null,
    },
    {
      questionId: 'S8',
      questionText: 'Time allocation',
      normalizedType: 'numeric_range',
      analyticalSubtype: 'allocation',
      itemCount: 3,
      valueLabels: [],
      itemLabels: [
        { column: 'S8r1', label: 'Patient care' },
        { column: 'S8r2', label: 'Teaching' },
        { column: 'S8r3', label: 'Research' },
      ],
      loopIterationCount: null,
      isHidden: false,
      hiddenLinkedTo: null,
    },
  ];

  it('renders one line per question', () => {
    const text = renderBannerContext(summaries);
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
  });

  it('includes question ID and text', () => {
    const text = renderBannerContext(summaries);
    expect(text).toContain('S2 | Primary Specialty');
    expect(text).toContain('S8 | Time allocation');
  });

  it('includes type in brackets', () => {
    const text = renderBannerContext(summaries);
    expect(text).toContain('[categorical_select]');
    expect(text).toContain('[numeric_range, allocation]');
  });

  it('shows options for single-item questions with value labels', () => {
    const text = renderBannerContext(summaries);
    expect(text).toContain('Options: 1=Cardiologist, 2=Internist');
  });

  it('shows item count for multi-item questions', () => {
    const text = renderBannerContext(summaries);
    expect(text).toContain('3 items: Patient care, Teaching, Research');
  });
});
