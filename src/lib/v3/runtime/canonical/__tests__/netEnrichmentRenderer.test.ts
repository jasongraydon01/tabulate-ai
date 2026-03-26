import { describe, it, expect } from 'vitest';
import { renderNetEnrichmentBlock, type NetEnrichmentContext } from '../netEnrichmentRenderer';
import { buildEntryBaseContract, projectTableBaseContract } from '../../baseContract';
import type { CanonicalTable, CanonicalRow, QuestionIdEntry, ParsedSurveyQuestion } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    variable: 'Q1_1',
    label: 'Option A',
    filterValue: '1',
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
    ...overrides,
  };
}

function makeTable(overrides: Partial<CanonicalTable> = {}): CanonicalTable {
  const table: CanonicalTable = {
    tableId: 'Q1__standard_overview',
    questionId: 'Q1',
    familyRoot: 'Q1',
    sourceTableId: 'Q1__standard_overview',
    splitFromTableId: '',
    tableKind: 'standard_overview',
    analyticalSubtype: 'standard',
    normalizedType: 'categorical_select',
    tableType: 'frequency',
    questionText: 'Which options?',
    rows: [
      makeRow({ variable: 'Q1_1', label: 'Option A', filterValue: '1' }),
      makeRow({ variable: 'Q1_2', label: 'Option B', filterValue: '2' }),
      makeRow({ variable: 'Q1_3', label: 'Option C', filterValue: '3' }),
    ],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    basePolicy: 'total',
    baseSource: 'question',
    questionBase: 500,
    itemBase: null,
    baseContract: projectTableBaseContract(buildEntryBaseContract({
      totalN: 500,
      questionBase: 500,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'total',
      questionBase: 500,
      itemBase: null,
    }),
    baseText: 'Total Respondents',
    isDerived: false,
    sortOrder: 1,
    sortBlock: 'Q1',
    surveySection: '',
    userNote: 'Multiple answers accepted',
    tableSubtitle: '',
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
    stimuliSetSlice: overrides.stimuliSetSlice ?? null,
    binarySide: overrides.binarySide ?? null,
  };
  table.baseContract = overrides.baseContract ?? projectTableBaseContract(buildEntryBaseContract({
    totalN: table.questionBase,
    questionBase: table.questionBase,
    itemBase: table.itemBase,
    itemBaseRange: null,
    hasVariableItemBases: false,
    variableBaseReason: null,
    rankingDetail: null,
    exclusionReason: null,
  }), {
    basePolicy: table.basePolicy,
    questionBase: table.questionBase,
    itemBase: table.itemBase,
  });
  return table;
}

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const entry = {
    questionId: 'Q1',
    questionText: 'Which options do you prefer?',
    variables: ['Q1_1', 'Q1_2', 'Q1_3'],
    variableCount: 3,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'enricher',
    subtypeConfidence: 0.9,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: 'exact',
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'categorical_select',
    items: [],
    totalN: 500,
    questionBase: 500,
    isFiltered: false,
    gapFromTotal: null,
    gapPct: null,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 500,
      questionBase: 500,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: null,
    proposedBaseLabel: null,
    displayQuestionId: null,
    displayQuestionText: null,
    sectionHeader: null,
    itemActivity: null,
    hasMessageMatches: false,
    _aiGateReview: null,
    _reconciliation: null,
    ...overrides,
  } as QuestionIdEntry;
  entry.baseContract = overrides.baseContract ?? buildEntryBaseContract({
    totalN: entry.totalN,
    questionBase: entry.questionBase,
    itemBase: null,
    itemBaseRange: entry.itemBaseRange,
    hasVariableItemBases: entry.hasVariableItemBases,
    variableBaseReason: entry.variableBaseReason,
    rankingDetail: entry.rankingDetail,
    exclusionReason: entry.exclusionReason,
  });
  return entry;
}

function makeSurveyQuestion(overrides: Partial<ParsedSurveyQuestion> = {}): ParsedSurveyQuestion {
  return {
    questionId: 'Q1',
    rawText: 'Q1. Which of the following options do you prefer?\n1. Option A\n2. Option B\n3. Option C',
    questionText: 'Which of the following options do you prefer?',
    instructionText: null,
    answerOptions: [],
    scaleLabels: null,
    questionType: 'single_select',
    format: 'standard',
    progNotes: [],
    strikethroughSegments: [],
    sectionHeader: null,
    ...overrides,
  } as ParsedSurveyQuestion;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('renderNetEnrichmentBlock', () => {
  it('renders XML with question_context and table sections', () => {
    const context: NetEnrichmentContext = {
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: ['standard_overview with 3 value rows'],
    };

    const xml = renderNetEnrichmentBlock(context);

    expect(xml).toContain('<question_context>');
    expect(xml).toContain('<questionId>Q1</questionId>');
    expect(xml).toContain('<questionText>Which options do you prefer?</questionText>');
    expect(xml).toContain('<analyticalSubtype>standard</analyticalSubtype>');
    expect(xml).toContain('<normalizedType>categorical_select</normalizedType>');
    expect(xml).toContain('<totalRows>3</totalRows>');
    expect(xml).toContain('</question_context>');
    expect(xml).toContain('<table id="Q1__standard_overview" kind="standard_overview">');
    expect(xml).toContain('<subtitle></subtitle>');
    expect(xml).toContain('<base_text>Total Respondents</base_text>');
    expect(xml).toContain('<user_note>Multiple answers accepted</user_note>');
  });

  it('includes value rows with attributes', () => {
    const context: NetEnrichmentContext = {
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: [],
    };

    const xml = renderNetEnrichmentBlock(context);

    expect(xml).toContain('variable="Q1_1"');
    expect(xml).toContain('label="Option A"');
    expect(xml).toContain('filterValue="1"');
    expect(xml).toContain('rowKind="value"');
  });

  it('includes survey_raw_text when surveyQuestion is provided', () => {
    const context: NetEnrichmentContext = {
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: makeSurveyQuestion(),
      triageReasons: [],
    };

    const xml = renderNetEnrichmentBlock(context);

    expect(xml).toContain('<survey_raw_text>');
    expect(xml).toContain('Which of the following options do you prefer?');
    expect(xml).toContain('</survey_raw_text>');
  });

  it('omits survey_raw_text when surveyQuestion is undefined', () => {
    const context: NetEnrichmentContext = {
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: [],
    };

    const xml = renderNetEnrichmentBlock(context);

    expect(xml).not.toContain('<survey_raw_text>');
  });

  it('omits survey_raw_text when rawText is empty', () => {
    const context: NetEnrichmentContext = {
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: makeSurveyQuestion({ rawText: '' }),
      triageReasons: [],
    };

    const xml = renderNetEnrichmentBlock(context);

    expect(xml).not.toContain('<survey_raw_text>');
  });

  it('escapes XML special characters in labels', () => {
    const context: NetEnrichmentContext = {
      table: makeTable({
        rows: [
          makeRow({ variable: 'Q1_1', label: 'Option A & B <special>' }),
        ],
      }),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: [],
    };

    const xml = renderNetEnrichmentBlock(context);

    expect(xml).toContain('label="Option A &amp; B &lt;special&gt;"');
  });

  it('only includes value rows (filters out stat/net rows)', () => {
    const context: NetEnrichmentContext = {
      table: makeTable({
        rows: [
          makeRow({ variable: 'Q1_1', label: 'Option A', rowKind: 'value' }),
          makeRow({ variable: 'Q1_2', label: 'Option B', rowKind: 'value' }),
          makeRow({ variable: 'Q1', label: 'Mean', rowKind: 'stat', statType: 'mean' }),
        ],
      }),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: [],
    };

    const xml = renderNetEnrichmentBlock(context);

    expect(xml).toContain('label="Option A"');
    expect(xml).toContain('label="Option B"');
    expect(xml).not.toContain('label="Mean"');
    expect(xml).toContain('<totalRows>2</totalRows>');
  });
});
