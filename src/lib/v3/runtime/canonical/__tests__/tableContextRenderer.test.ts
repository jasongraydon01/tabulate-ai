import { describe, it, expect } from 'vitest';
import { renderTableContextBlock, type TableContextGroup } from '../tableContextRenderer';
import type { QuestionIdEntry, ParsedSurveyQuestion, CanonicalTable } from '../types';


// =============================================================================
// Test Helpers
// =============================================================================

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  return {
    questionId: 'Q5',
    questionText: 'How satisfied are you?',
    analyticalSubtype: 'scale_likert',
    normalizedType: 'scale',
    disposition: 'report',
    items: [],
    ...overrides,
  } as QuestionIdEntry;
}

function makeTable(overrides: Partial<CanonicalTable> = {}): CanonicalTable {
  return {
    tableId: 'Q5_overview',
    questionId: 'Q5',
    familyRoot: 'Q5',
    sourceTableId: 'Q5_overview',
    splitFromTableId: '',
    tableKind: 'scale_overview_full',
    analyticalSubtype: 'scale_likert',
    normalizedType: 'scale',
    tableType: 'frequency',
    questionText: 'How satisfied are you?',
    rows: [
      {
        variable: 'Q5',
        label: 'Very Satisfied',
        filterValue: '5',
        rowKind: 'value',
        isNet: false,
        indent: 0,
        netLabel: '',
        netComponents: [],
        statType: '',
        binRange: null,
        binLabel: '',
        rankLevel: null,
        topKLevel: null,
        excludeFromStats: false,
        rollupConfig: null,
      },
    ],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    basePolicy: 'total',
    baseSource: 'question',
    questionBase: 500,
    itemBase: null,
    baseText: 'Total Respondents',
    isDerived: false,
    sortOrder: 1,
    sortBlock: 'Q5',
    surveySection: '',
    userNote: '',
    tableSubtitle: 'Overall Satisfaction',
    splitReason: null,
    appliesToItem: null,
    computeMaskAnchorVariable: null,
    appliesToColumn: null,
    additionalFilter: '',
    exclude: false,
    excludeReason: '',
    filterReviewRequired: false,
    lastModifiedBy: 'assembler',
    notes: [],
    ...overrides,
  } as CanonicalTable;
}

function makeSurveyQuestion(overrides: Partial<ParsedSurveyQuestion> = {}): ParsedSurveyQuestion {
  return {
    questionId: 'Q5',
    rawText: 'Q5. How satisfied are you with the product?',
    questionText: 'How satisfied are you with the product?',
    instructionText: null,
    answerOptions: [
      { code: 1, text: 'Very Dissatisfied', isOther: false, anchor: false, routing: null, progNote: null },
      { code: 5, text: 'Very Satisfied', isOther: false, anchor: false, routing: null, progNote: null },
    ],
    scaleLabels: [
      { value: 1, label: 'Very Dissatisfied' },
      { value: 5, label: 'Very Satisfied' },
    ],
    questionType: 'single',
    format: 'radio',
    progNotes: [],
    strikethroughSegments: [],
    sectionHeader: null,
    ...overrides,
  } as ParsedSurveyQuestion;
}

// =============================================================================
// Tests
// =============================================================================

describe('renderTableContextBlock', () => {
  it('renders question context with questionId, questionText, analyticalSubtype', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable()],
      triageReasons: new Map([['Q5_overview', [{ signal: 'filtered-base', detail: 'test', severity: 'medium' }]]]),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<questionId>Q5</questionId>');
    expect(result).toContain('<questionText>How satisfied are you?</questionText>');
    expect(result).toContain('<analyticalSubtype>scale_likert</analyticalSubtype>');
    expect(result).toContain('<normalizedType>scale</normalizedType>');
  });

  it('includes survey rawText when surveyQuestion provided', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable()],
      triageReasons: new Map(),
      surveyQuestion: makeSurveyQuestion(),
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<survey_text>');
    expect(result).toContain('Q5. How satisfied are you with the product?');
    expect(result).toContain('<answer_options>');
    expect(result).toContain('<scale_labels>');
  });

  it('renders structural base metadata and disclosure defaults for AI context', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry({
        baseContract: {
          version: 1,
          reference: { totalN: 500, questionBase: 420, itemBase: null, itemBaseRange: [380, 420] },
          classification: {
            situation: 'varying_items',
            referenceUniverse: 'question',
            variationClass: 'genuine',
            comparabilityStatus: 'split_recommended',
          },
          policy: {
            effectiveBaseMode: 'table_mask_then_row_observed_n',
            validityPolicy: 'none',
            rebasePolicy: 'none',
          },
          signals: ['filtered-base', 'varying-item-bases'],
        },
      }),
      tables: [makeTable({
        baseViewRole: 'anchor',
        plannerBaseComparability: 'varying_but_acceptable',
        plannerBaseSignals: ['filtered-base', 'varying-item-bases'],
        computeRiskSignals: ['row-base-varies-within-anchor-view'],
        baseDisclosure: {
          referenceBaseN: 420,
          itemBaseRange: [380, 420],
          defaultBaseText: 'Those who were shown Q5',
          defaultNoteTokens: ['anchor-base-varies-by-item', 'anchor-base-range'],
          rangeDisclosure: { min: 380, max: 420 },
          source: 'contract',
        },
      })],
      triageReasons: new Map([['Q5_overview', [{ signal: 'filtered-base', detail: 'test', severity: 'medium' }]]]),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<baseSignals>filtered-base, varying-item-bases</baseSignals>');
    expect(result).toContain('<baseViewRole>anchor</baseViewRole>');
    expect(result).toContain('<plannerBaseComparability>varying_but_acceptable</plannerBaseComparability>');
    expect(result).toContain('<defaultBaseText>Those who were shown Q5</defaultBaseText>');
    expect(result).toContain('<rangeDisclosure>380-420</rangeDisclosure>');
  });

  it('omits survey_text section when surveyQuestion is absent', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable()],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).not.toContain('<survey_text>');
  });

  it('includes savLabel/surveyLabel only on rows with label-divergence signal', () => {
    const entry = makeEntry({
      items: [
        {
          column: 'Q5',
          label: 'Very Satisfied',
          savLabel: 'Q5: Very satisfied with the product',
          surveyLabel: 'Extremely Happy',
          normalizedType: 'scale',
          itemBase: 500,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });

    const group: TableContextGroup = {
      questionId: 'Q5',
      entry,
      tables: [makeTable()],
      triageReasons: new Map([
        ['Q5_overview', [{ signal: 'label-divergence', detail: 'labels differ', severity: 'medium' }]],
      ]),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    // Should include savLabel and surveyLabel attributes on the divergent row
    expect(result).toContain('surveyLabel=');
  });

  it('uses scaleLabels when row divergence is at value-level, not item-level', () => {
    const entry = makeEntry({
      items: [
        {
          column: 'Q5',
          label: 'Satisfaction scale',
          savLabel: 'Satisfaction scale',
          surveyLabel: 'Satisfaction scale',
          normalizedType: 'scale',
          itemBase: 500,
          scaleLabels: [
            {
              value: 5,
              label: 'Very satisfied',
              savLabel: 'Very satisfied with product performance',
              surveyLabel: 'Extremely Happy',
            },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });

    const group: TableContextGroup = {
      questionId: 'Q5',
      entry,
      tables: [makeTable({ rows: [makeTable().rows[0]] })],
      triageReasons: new Map([
        ['Q5_overview', [{ signal: 'label-divergence', detail: 'scale labels differ', severity: 'medium' }]],
      ]),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('savLabel="Very satisfied with product performance"');
    expect(result).toContain('surveyLabel="Extremely Happy"');
  });

  it('does NOT include savLabel/surveyLabel when no label-divergence signal', () => {
    const entry = makeEntry({
      items: [
        {
          column: 'Q5',
          label: 'Very Satisfied',
          savLabel: 'Very Satisfied',
          surveyLabel: 'Very Satisfied',
          normalizedType: 'scale',
          itemBase: 500,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });

    const group: TableContextGroup = {
      questionId: 'Q5',
      entry,
      tables: [makeTable()],
      triageReasons: new Map([
        ['Q5_overview', [{ signal: 'filtered-base', detail: 'base differs', severity: 'medium' }]],
      ]),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).not.toContain('savLabel=');
    expect(result).not.toContain('surveyLabel=');
  });

  it('handles group with multiple tables', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [
        makeTable({ tableId: 'Q5_full', tableKind: 'scale_overview_full' }),
        makeTable({ tableId: 'Q5_t2b', tableKind: 'scale_overview_rollup_t2b' }),
      ],
      triageReasons: new Map([
        ['Q5_full', [{ signal: 'grid-structure', detail: 'grid table', severity: 'high' }]],
        ['Q5_t2b', [{ signal: 'rebased-base', detail: 'rebased', severity: 'low' }]],
      ]),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('tableId="Q5_full"');
    expect(result).toContain('tableId="Q5_t2b"');
    expect(result).toContain('grid-structure');
    expect(result).toContain('rebased-base');
  });

  it('handles empty rows', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({ rows: [] })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    // Should not contain <rows> section
    expect(result).not.toContain('<rows>');
  });

  it('escapes XML special characters', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry({ questionText: 'How "satisfied" are you & <why>?' }),
      tables: [makeTable()],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;why&gt;');
    expect(result).toContain('&quot;satisfied&quot;');
  });

  it('renders stimuliSetSlice when present', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({
        stimuliSetSlice: {
          familySource: 'B500',
          setIndex: 0,
          setLabel: 'Set 1',
          sourceQuestionId: 'B500',
        },
      })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<stimuliSetSlice');
    expect(result).toContain('familySource="B500"');
    expect(result).toContain('setIndex="0"');
    expect(result).toContain('setLabel="Set 1"');
    expect(result).toContain('sourceQuestionId="B500"');
  });

  it('does NOT render stimuliSetSlice when null', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({ stimuliSetSlice: null })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).not.toContain('<stimuliSetSlice');
  });

  it('renders binarySide when present', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({ binarySide: 'selected' })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<binarySide>selected</binarySide>');
  });

  it('renders binarySide unselected correctly', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({ binarySide: 'unselected' })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<binarySide>unselected</binarySide>');
  });

  it('does NOT render binarySide when null', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({ binarySide: null })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).not.toContain('<binarySide>');
  });

  it('renders both stimuliSetSlice and binarySide together', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({
        stimuliSetSlice: {
          familySource: 'B500',
          setIndex: 1,
          setLabel: 'Set 2',
          sourceQuestionId: 'B500',
        },
        binarySide: 'unselected',
      })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<stimuliSetSlice');
    expect(result).toContain('setLabel="Set 2"');
    expect(result).toContain('<binarySide>unselected</binarySide>');
  });

  // =========================================================================
  // Binary pair annotations
  // =========================================================================

  it('renders <binary_pairs> when group contains a binary pair', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [
        makeTable({
          tableId: 'Q5_sel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 0, setLabel: 'Set 1', sourceQuestionId: 'B500' },
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'Q5_unsel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 0, setLabel: 'Set 1', sourceQuestionId: 'B500' },
          binarySide: 'unselected',
        }),
      ],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('<binary_pairs>');
    expect(result).toContain('<pair');
    expect(result).toContain('setLabel="Set 1"');
    expect(result).toContain('familySource="B500"');
    expect(result).toContain('<selected tableId="Q5_sel"');
    expect(result).toContain('<unselected tableId="Q5_unsel"');
    expect(result).toContain('<guidance>');
    expect(result).toContain('</binary_pairs>');
  });

  it('does NOT render <binary_pairs> when no pairs exist', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [makeTable({ binarySide: null, stimuliSetSlice: null })],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).not.toContain('<binary_pairs>');
  });

  it('renders multiple pairs within a single group', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [
        makeTable({
          tableId: 'S1_sel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 0, setLabel: 'Set 1', sourceQuestionId: 'B500' },
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'S1_unsel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 0, setLabel: 'Set 1', sourceQuestionId: 'B500' },
          binarySide: 'unselected',
        }),
        makeTable({
          tableId: 'S2_sel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 1, setLabel: 'Set 2', sourceQuestionId: 'B500' },
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'S2_unsel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 1, setLabel: 'Set 2', sourceQuestionId: 'B500' },
          binarySide: 'unselected',
        }),
      ],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).toContain('setLabel="Set 1"');
    expect(result).toContain('setLabel="Set 2"');
    expect(result).toContain('<selected tableId="S1_sel"');
    expect(result).toContain('<unselected tableId="S1_unsel"');
    expect(result).toContain('<selected tableId="S2_sel"');
    expect(result).toContain('<unselected tableId="S2_unsel"');
  });

  it('solo binary table (selected only) does not produce <binary_pairs>', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [
        makeTable({
          tableId: 'Q5_sel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 0, setLabel: 'Set 1', sourceQuestionId: 'B500' },
          binarySide: 'selected',
        }),
      ],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    expect(result).not.toContain('<binary_pairs>');
  });

  it('binary_pairs section appears before tables section', () => {
    const group: TableContextGroup = {
      questionId: 'Q5',
      entry: makeEntry(),
      tables: [
        makeTable({
          tableId: 'Q5_sel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 0, setLabel: 'Set 1', sourceQuestionId: 'B500' },
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'Q5_unsel',
          stimuliSetSlice: { familySource: 'B500', setIndex: 0, setLabel: 'Set 1', sourceQuestionId: 'B500' },
          binarySide: 'unselected',
        }),
      ],
      triageReasons: new Map(),
      surveyQuestion: undefined,
    };

    const result = renderTableContextBlock(group);

    const pairsIndex = result.indexOf('<binary_pairs>');
    const tablesIndex = result.indexOf('<tables>');
    expect(pairsIndex).toBeGreaterThan(-1);
    expect(tablesIndex).toBeGreaterThan(-1);
    expect(pairsIndex).toBeLessThan(tablesIndex);
  });
});
