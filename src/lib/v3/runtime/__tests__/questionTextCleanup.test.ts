/**
 * Tests for reconciliation cleanup and display override passes (step 12, passes 5–10):
 *   - Pass 5: stripQuestionIdPrefix
 *   - Pass 6: sectionHeader propagation (via runReconcile)
 *   - Pass 7: cleanQuestionText
 *   - Pass 8: survey label refresh
 *   - Pass 9: display override resolution
 *   - Pass 10: cleaned question text propagation from 08b
 */
import { describe, it, expect } from 'vitest';
import { buildEntryBaseContract } from '../baseContract';
import {
  stripQuestionIdPrefix,
  cleanQuestionText,
  runReconcile,
} from '../questionId/reconcile';
import type { QuestionIdEntry, QuestionIdItem, ParsedSurveyQuestion } from '../questionId/types';

// =============================================================================
// Helpers
// =============================================================================

function makeItem(column = 'Q1_1'): QuestionIdItem {
  return {
    column,
    label: 'Item',
    normalizedType: 'categorical_select',
    itemBase: 50,
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null,
    matchConfidence: 0,
  };
}

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const entry: QuestionIdEntry = {
    questionId: 'Q1',
    questionText: 'How often do you use the product?',
    variables: ['Q1_1'],
    variableCount: 1,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'deterministic',
    subtypeConfidence: 1,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: null,
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'categorical_select',
    items: [makeItem()],
    totalN: 100,
    questionBase: 50,
    isFiltered: false,
    gapFromTotal: null,
    gapPct: null,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 100,
      questionBase: 50,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: 100,
    proposedBaseLabel: 'Total',
    hasMessageMatches: false,
    stimuliSets: null,
    displayQuestionId: null,
    displayQuestionText: null,
    sectionHeader: null,
    itemActivity: null,
    _aiGateReview: null,
    _reconciliation: null,
    ...overrides,
  };
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
    rawText: 'Q1. How often?',
    questionText: 'How often?',
    instructionText: null,
    answerOptions: [],
    scaleLabels: null,
    questionType: 'single_select',
    format: 'numbered_list',
    progNotes: [],
    strikethroughSegments: [],
    sectionHeader: null,
    ...overrides,
  };
}

const baseMetadata = {
  dataset: 'test',
  generatedAt: '2026-01-01T00:00:00.000Z',
  scriptVersion: 'test',
  isMessageTestingSurvey: false,
  isConceptTestingSurvey: false,
  hasMaxDiff: null,
  hasAnchoredScores: null,
  messageTemplatePath: null,
  isDemandSurvey: false,
  hasChoiceModelExercise: null,
};

// =============================================================================
// Pass 5: stripQuestionIdPrefix
// =============================================================================

describe('stripQuestionIdPrefix', () => {
  it('strips dot separator: "Q3. How often..." → "How often..."', () => {
    expect(stripQuestionIdPrefix('Q3. How often do you visit?', 'Q3', null))
      .toBe('How often do you visit?');
  });

  it('strips colon separator: "S5: What is your..." → "What is your..."', () => {
    expect(stripQuestionIdPrefix('S5: What is your primary care provider?', 'S5', null))
      .toBe('What is your primary care provider?');
  });

  it('strips paren separator: "S9) Which of..." → "Which of..."', () => {
    expect(stripQuestionIdPrefix('S9) Which of the following?', 'S9', null))
      .toBe('Which of the following?');
  });

  it('strips with extra whitespace after separator', () => {
    expect(stripQuestionIdPrefix('Q7:   Rate the following', 'Q7', null))
      .toBe('Rate the following');
  });

  it('leaves text unchanged when no prefix matches', () => {
    expect(stripQuestionIdPrefix('How satisfied are you?', 'Q1', null))
      .toBe('How satisfied are you?');
  });

  it('preserves bare questionId text (would empty if stripped)', () => {
    expect(stripQuestionIdPrefix('Q3', 'Q3', null))
      .toBe('Q3');
  });

  it('strips loopQuestionId prefix when questionId prefix not found', () => {
    expect(stripQuestionIdPrefix('LOOP1. Rate this item', 'LOOP1_iter1', 'LOOP1'))
      .toBe('Rate this item');
  });

  it('strips questionId prefix first even when loopQuestionId also provided', () => {
    expect(stripQuestionIdPrefix('Q5: What do you think?', 'Q5', 'LOOP1'))
      .toBe('What do you think?');
  });

  it('handles grid-style questionId like S9r1c1', () => {
    expect(stripQuestionIdPrefix('S9r1c1. Rate this concept', 'S9r1c1', null))
      .toBe('Rate this concept');
  });

  it('handles case-insensitive match', () => {
    expect(stripQuestionIdPrefix('s5: lower case prefix', 'S5', null))
      .toBe('lower case prefix');
  });

  it('handles dash separator', () => {
    expect(stripQuestionIdPrefix('Q10 - What brand?', 'Q10', null))
      .toBe('What brand?');
  });

  it('does not strip partial match (Q1 should not strip from Q10)', () => {
    expect(stripQuestionIdPrefix('Q10. What brand?', 'Q1', null))
      .toBe('Q10. What brand?');
  });

  it('handles empty questionText', () => {
    expect(stripQuestionIdPrefix('', 'Q1', null)).toBe('');
  });

  it('handles comma separator', () => {
    expect(stripQuestionIdPrefix('E1r98oe, What type of provider?', 'E1r98oe', null))
      .toBe('What type of provider?');
  });
});

// =============================================================================
// Pass 7: cleanQuestionText
// =============================================================================

describe('cleanQuestionText', () => {
  it('strips strikethrough markers, keeps content', () => {
    expect(cleanQuestionText('from the ~~above~~ set')).toBe('from the above set');
  });

  it('strips bold markers', () => {
    expect(cleanQuestionText('Rate the **following** items')).toBe('Rate the following items');
  });

  it('strips italic markers', () => {
    expect(cleanQuestionText('the *most important* factor')).toBe('the most important factor');
  });

  it('cleans stacked backslash escapes', () => {
    expect(cleanQuestionText('condition\\\\\\end')).toBe('condition end');
  });

  it('removes trailing lone backslash', () => {
    expect(cleanQuestionText('question text\\')).toBe('question text');
  });

  it('collapses whitespace and trims', () => {
    expect(cleanQuestionText('  extra   spaces  ')).toBe('extra spaces');
  });

  it('handles combined artifacts', () => {
    expect(cleanQuestionText('~~old~~ **new** text\\\\'))
      .toBe('old new text');
  });

  it('is a no-op for already-clean text', () => {
    expect(cleanQuestionText('How satisfied are you?')).toBe('How satisfied are you?');
  });

  it('preserves empty text', () => {
    expect(cleanQuestionText('')).toBe('');
  });

  it('preserves short text', () => {
    expect(cleanQuestionText('Q3')).toBe('Q3');
  });

  it('handles strikethrough with punctuation: ~~?~~', () => {
    expect(cleanQuestionText('condition~~?~~)')).toBe('condition?)');
  });

  it('strips nested markdown: **~~text~~**', () => {
    expect(cleanQuestionText('the **~~revised~~** approach')).toBe('the revised approach');
  });
});

// =============================================================================
// Pass 6: Section header propagation (via runReconcile)
// =============================================================================

describe('sectionHeader propagation via runReconcile', () => {
  it('copies sectionHeader from matching survey question', () => {
    const entries = [makeEntry({ questionId: 'Q1', questionText: 'How often?' })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'Q1', sectionHeader: 'Demographics' }),
    ];
    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].sectionHeader).toBe('Demographics');
  });

  it('sets null when no survey match exists', () => {
    const entries = [makeEntry({ questionId: 'Q99', questionText: 'Unknown question' })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'Q1', sectionHeader: 'Demographics' }),
    ];
    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].sectionHeader).toBeNull();
  });

  it('uses loopQuestionId as anchor when present', () => {
    const entries = [makeEntry({
      questionId: 'LOOP1_iter1',
      loopQuestionId: 'LOOP1',
      questionText: 'Rate item',
    })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'LOOP1', sectionHeader: 'Product Evaluation' }),
    ];
    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].sectionHeader).toBe('Product Evaluation');
  });

  it('sets all to null when surveyParsed is empty', () => {
    const entries = [
      makeEntry({ questionId: 'Q1' }),
      makeEntry({ questionId: 'Q2' }),
    ];
    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed: [] });
    expect(result.entries[0].sectionHeader).toBeNull();
    expect(result.entries[1].sectionHeader).toBeNull();
  });

  it('preserves null sectionHeader from survey question', () => {
    const entries = [makeEntry({ questionId: 'Q1' })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'Q1', sectionHeader: null }),
    ];
    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].sectionHeader).toBeNull();
  });
});

// =============================================================================
// Integration: all passes run together in runReconcile
// =============================================================================

describe('runReconcile integration — passes 5, 6, 7, 8 combined', () => {
  it('strips prefix, propagates header, and cleans markdown in one pass', () => {
    const entries = [makeEntry({
      questionId: 'S5',
      questionText: 'S5: Rate the ~~following~~ **items**',
    })];
    const surveyParsed = [
      makeSurveyQuestion({
        questionId: 'S5',
        questionText: 'S5: Rate the ~~following~~ **items**',
        sectionHeader: 'Evaluation',
      }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });

    // Pass 5 strips "S5: " → "Rate the ~~following~~ **items**"
    // Pass 7 strips markdown → "Rate the following items"
    expect(result.entries[0].questionText).toBe('Rate the following items');
    // Pass 6 propagates section header
    expect(result.entries[0].sectionHeader).toBe('Evaluation');
    // Pass 8 should not set display overrides for non-iteration IDs
    expect(result.entries[0].displayQuestionId).toBeNull();
    expect(result.entries[0].displayQuestionText).toBeNull();
  });
});

describe('runReconcile pass 10 — cleaned question text propagation', () => {
  it('replaces truncated entry questionText with cleaned survey questionText', () => {
    const entries = [makeEntry({
      questionId: 'Q1',
      questionText: 'Truncated .sav label',
      _aiGateReview: null,
    })];
    const surveyParsed = [
      makeSurveyQuestion({
        questionId: 'Q1',
        questionText: 'Q1. Full cleaned survey question text with details',
      }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].questionText).toBe('Full cleaned survey question text with details');
  });

  it('replaces child-letter entry questionText from a multipart parent survey question', () => {
    const entries = [makeEntry({
      questionId: 'A100a',
      questionText: 'What are your current perceptions ... overall for....',
      surveyMatch: 'none',
    })];
    const surveyParsed = [
      makeSurveyQuestion({
        questionId: 'A100',
        rawText: [
          'A100. What are your current perceptions of each of the following pneumococcal vaccines/vaccine series overall for....',
          '',
          '**a. For patients <2 years of age:**',
          '',
          '**b. For patients 2-17 years of age with underlying medical conditions:**',
        ].join('\n'),
        questionText: 'What are your current perceptions of each of the following pneumococcal vaccines/vaccine series overall for.... a. For patients <2 years of age:',
      }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].questionText).toBe(
      'What are your current perceptions of each of the following pneumococcal vaccines/vaccine series overall for.... a. For patients <2 years of age:',
    );
  });

  it('extracts the correct multipart child text for later subparts', () => {
    const entries = [makeEntry({
      questionId: 'A100b',
      questionText: 'What are your current perceptions ... overall for....',
      surveyMatch: 'none',
    })];
    const surveyParsed = [
      makeSurveyQuestion({
        questionId: 'A100',
        rawText: [
          'A100. What are your current perceptions of each of the following pneumococcal vaccines/vaccine series overall for....',
          '',
          '**a. For patients <2 years of age:**',
          '',
          '| table follows |',
          '',
          '**b. For patients 2-17 years of age with underlying medical conditions:**',
          '',
          '| another table follows |',
        ].join('\n'),
        questionText: 'What are your current perceptions of each of the following pneumococcal vaccines/vaccine series overall for.... a. For patients <2 years of age:',
      }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].questionText).toBe(
      'What are your current perceptions of each of the following pneumococcal vaccines/vaccine series overall for.... b. For patients 2-17 years of age with underlying medical conditions:',
    );
  });

  it('does not replace child-letter entry questionText when the parent survey question is not multipart', () => {
    const entries = [makeEntry({
      questionId: 'S2a',
      questionText: 'Original child question text',
      surveyMatch: 'none',
    })];
    const surveyParsed = [
      makeSurveyQuestion({
        questionId: 'S2',
        rawText: 'S2. How satisfied are you overall?',
        questionText: 'How satisfied are you overall?',
      }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].questionText).toBe('Original child question text');
  });
});

describe('runReconcile pass 8 — cleaned survey label hydration', () => {
  it('hydrates categorical value labels from cleaned survey answerOptions even without ai corrections', () => {
    const entries = [makeEntry({
      questionId: 'S15',
      questionText: 'S15: Which of the following best describes the IDN you are a part of?',
      surveyMatch: 'exact',
      items: [{
        column: 'S15',
        label: 'S15: Which of the following best describes the IDN you are a part of?',
        normalizedType: 'categorical_select',
        itemBase: 52,
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
        scaleLabels: [
          { value: 1, label: 'High control IDN (i.e.' },
          { value: 2, label: 'Medium control IDN (i.e.' },
          { value: 3, label: 'Low control IDN (i.e.' },
        ],
      }],
    })];

    const surveyParsed = [
      makeSurveyQuestion({
        questionId: 'S15',
        questionText: 'S15. Which of the following best describes the IDN you are a part of?',
        answerOptions: [
          { code: 1, text: 'High control IDN (i.e., vaccine usage is heavily informed and managed by the IDN)', isOther: false, anchor: false, routing: null, progNote: null },
          { code: 2, text: 'Medium control IDN (i.e., my IDN has some influence in deciding which vaccines HCPs can administer)', isOther: false, anchor: false, routing: null, progNote: null },
          { code: 3, text: 'Low control IDN (i.e., HCPs or individual practices are able to freely choose vaccines with few IDN formulary restrictions)', isOther: false, anchor: false, routing: null, progNote: null },
        ],
      }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });
    expect(result.entries[0].items[0].scaleLabels).toEqual([
      {
        value: 1,
        label: 'High control IDN (i.e., vaccine usage is heavily informed and managed by the IDN)',
        savLabel: 'High control IDN (i.e.',
        surveyLabel: 'High control IDN (i.e., vaccine usage is heavily informed and managed by the IDN)',
      },
      {
        value: 2,
        label: 'Medium control IDN (i.e., my IDN has some influence in deciding which vaccines HCPs can administer)',
        savLabel: 'Medium control IDN (i.e.',
        surveyLabel: 'Medium control IDN (i.e., my IDN has some influence in deciding which vaccines HCPs can administer)',
      },
      {
        value: 3,
        label: 'Low control IDN (i.e., HCPs or individual practices are able to freely choose vaccines with few IDN formulary restrictions)',
        savLabel: 'Low control IDN (i.e.',
        surveyLabel: 'Low control IDN (i.e., HCPs or individual practices are able to freely choose vaccines with few IDN formulary restrictions)',
      },
    ]);
  });
});

// =============================================================================
// findSurveyQuestion — iteration suffix matching (third strategy)
// =============================================================================

describe('findSurveyQuestion — iteration suffix matching via runReconcile', () => {
  it('matches B500_1 to survey question B500 via iteration suffix stripping', () => {
    const entries = [makeEntry({
      questionId: 'B500_1',
      questionText: 'B500_1',  // bare ID — no real text
      surveyMatch: 'suffix',
    })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'B500', questionText: 'Please rank the messages by motivation', sectionHeader: 'MESSAGE RANKING' }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });

    // Section header should propagate from B500 survey match
    expect(result.entries[0].sectionHeader).toBe('MESSAGE RANKING');
  });

  it('matches Q7_2 to survey question Q7', () => {
    const entries = [makeEntry({
      questionId: 'Q7_2',
      questionText: 'Q7_2',
    })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'Q7', questionText: 'How likely are you to recommend?', sectionHeader: 'LOYALTY' }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });

    expect(result.entries[0].sectionHeader).toBe('LOYALTY');
  });

  it('does not strip when no underscore-digit suffix', () => {
    // Q71 should NOT match Q7 (no underscore separator)
    const entries = [makeEntry({
      questionId: 'Q71',
      questionText: 'Different question',
    })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'Q7', sectionHeader: 'LOYALTY' }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });

    expect(result.entries[0].sectionHeader).toBeNull();
  });

  it('prefers exact survey match over base fallback when both Q5 and Q5_1 exist', () => {
    const entries = [makeEntry({
      questionId: 'Q5_1',
      questionText: 'Q5_1',
    })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'Q5', questionText: 'Parent prompt', sectionHeader: 'PARENT' }),
      makeSurveyQuestion({ questionId: 'Q5_1', questionText: 'Q5_1. Iteration prompt', sectionHeader: 'ITERATION' }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });

    // Section header should come from exact Q5_1 match
    expect(result.entries[0].sectionHeader).toBe('ITERATION');
    // Exact iteration question exists, so display override should not force parent Q5
    expect(result.entries[0].displayQuestionId).toBeNull();
  });
});

// =============================================================================
// Pass 8: Display override resolution
// =============================================================================

describe('runReconcile pass 8 — display overrides', () => {
  it('sets displayQuestionId for iteration-suffix entries with survey match', () => {
    const entries = [
      makeEntry({ questionId: 'B500_1', questionText: 'B500_1' }),
      makeEntry({ questionId: 'B500_2', questionText: 'B500_2' }),
      makeEntry({ questionId: 'Q3', questionText: 'How satisfied?' }),
    ];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'B500', questionText: 'Rank the most motivating messages' }),
      makeSurveyQuestion({ questionId: 'Q3', questionText: 'How satisfied?' }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });

    // B500_1 → displayQuestionId = B500
    expect(result.entries[0].displayQuestionId).toBe('B500');
    expect(result.entries[0].displayQuestionText).toBe('Rank the most motivating messages');

    // B500_2 → displayQuestionId = B500
    expect(result.entries[1].displayQuestionId).toBe('B500');
    expect(result.entries[1].displayQuestionText).toBe('Rank the most motivating messages');

    // Q3 has no iteration suffix → no display override
    expect(result.entries[2].displayQuestionId).toBeNull();
    expect(result.entries[2].displayQuestionText).toBeNull();
  });

  it('does not set displayQuestionText when entry already has real question text', () => {
    const entries = [makeEntry({
      questionId: 'Q5_1',
      questionText: 'Please rate the following',
    })];
    const surveyParsed = [
      makeSurveyQuestion({ questionId: 'Q5', questionText: 'Rate items' }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed });

    expect(result.entries[0].displayQuestionId).toBe('Q5');
    // questionText is real text (not bare ID), so displayQuestionText stays null
    expect(result.entries[0].displayQuestionText).toBeNull();
  });

  it('resolves display overrides for hidden variables linked to parents', () => {
    const entries = [
      makeEntry({
        questionId: 'Q10',
        questionText: 'Awareness of brands',
        isHidden: false,
        hiddenLink: null,
      }),
      makeEntry({
        questionId: 'hQ10_coded',
        questionText: 'hQ10_coded',
        isHidden: true,
        hiddenLink: { linkedTo: 'Q10', linkMethod: 'prefix-match' },
      }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed: [] });

    // Hidden variable should inherit parent's question ID and text
    expect(result.entries[1].displayQuestionId).toBe('Q10');
    expect(result.entries[1].displayQuestionText).toBe('Awareness of brands');
  });

  it('leaves display fields null when no matching survey question or parent', () => {
    const entries = [makeEntry({
      questionId: 'X99_1',
      questionText: 'X99_1',
    })];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed: [] });

    expect(result.entries[0].displayQuestionId).toBeNull();
    expect(result.entries[0].displayQuestionText).toBeNull();
  });

  it('falls back to base displayQuestionId for bare iteration families without survey docs', () => {
    const entries = [
      makeEntry({ questionId: 'B500_1', questionText: 'B500_1' }),
      makeEntry({ questionId: 'B500_2', questionText: 'B500_2' }),
    ];

    const result = runReconcile({ entries, metadata: baseMetadata, surveyParsed: [] });

    expect(result.entries[0].displayQuestionId).toBe('B500');
    expect(result.entries[1].displayQuestionId).toBe('B500');
    expect(result.entries[0].displayQuestionText).toBeNull();
    expect(result.entries[1].displayQuestionText).toBeNull();
  });
});
