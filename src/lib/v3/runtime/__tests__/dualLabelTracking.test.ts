/**
 * Tests for dual-label tracking (savLabel / surveyLabel).
 *
 * Verifies that:
 * - Stage 08a snapshots the original .sav label before overwriting
 * - Stage 12 preserves savLabel during re-reconciliation
 * - The canonical bridge passes both fields through castItems()
 * - Fields survive JSON round-trip (stage 12's deep clone)
 * - Idempotency: re-running doesn't re-snapshot
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildEntryBaseContract } from '../baseContract';
import type { QuestionIdItem, QuestionIdEntry, ParsedSurveyQuestion, SurveyMetadata } from '../questionId/types';
import { runReconcile } from '../questionId/reconcile';
import { runSurveyParser } from '../questionId/enrich/surveyParser';
import { buildContext } from '../canonical/plan';
import * as FileDiscovery from '@/lib/pipeline/FileDiscovery';
import * as SurveyProcessor from '@/lib/processors/SurveyProcessor';

// =============================================================================
// Helpers — minimal fixtures
// =============================================================================

function makeItem(overrides: Partial<QuestionIdItem> = {}): QuestionIdItem {
  return {
    column: 'Q1_1',
    label: 'Short label',
    normalizedType: 'categorical',
    itemBase: 10,
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null,
    matchConfidence: 0,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const entry: QuestionIdEntry = {
    questionId: 'Q1',
    questionText: 'Question 1',
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
    surveyMatch: 'exact',
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'categorical',
    items: [makeItem()],
    totalN: 100,
    questionBase: 80,
    isFiltered: false,
    gapFromTotal: 20,
    gapPct: 0.2,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 100,
      questionBase: 80,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: 80,
    proposedBaseLabel: 'Total',
    displayQuestionId: null,
    displayQuestionText: null,
    sectionHeader: null,
    itemActivity: null,
    hasMessageMatches: false,
    stimuliSets: null,
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

function makeCorrectedReview(reasoning: string = 'surveyMatch adjusted'): NonNullable<QuestionIdEntry['_aiGateReview']> {
  return {
    reviewOutcome: 'corrected',
    confidence: 0.9,
    mutationCount: 1,
    reasoning,
    reviewedAt: '2026-03-17T00:00:00.000Z',
    propagatedFrom: null,
  };
}

const testMetadata: SurveyMetadata = {
  dataset: 'test',
  generatedAt: '2026-03-17',
  scriptVersion: 'test',
  isMessageTestingSurvey: false,
  isConceptTestingSurvey: false,
  hasMaxDiff: null,
  hasAnchoredScores: null,
  messageTemplatePath: null,
  isDemandSurvey: false,
  hasChoiceModelExercise: null,
};

function mockSurveyParserRuntime(markdown: string): void {
  vi.spyOn(FileDiscovery, 'findDatasetFiles').mockResolvedValue({
    datamap: null,
    banner: null,
    spss: '/tmp/test.sav',
    survey: '/tmp/test-survey.docx',
    name: 'test-dataset',
  });
  vi.spyOn(SurveyProcessor, 'processSurvey').mockResolvedValue({
    markdown,
    characterCount: markdown.length,
    warnings: [],
  });
}

// =============================================================================
// Stage 08a — runtime behavior via runSurveyParser
// =============================================================================
describe('Stage 08a — runtime dual-label behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('snapshots savLabel and sets surveyLabel when replacing from survey', async () => {
    mockSurveyParserRuntime([
      'Q5. Rate the following options carefully',
      '1. A very long enriched label from survey document',
    ].join('\n'));

    const entry = makeEntry({
      questionId: 'Q5',
      items: [makeItem({
        column: 'Q5_1',
        label: 'Short .sav',
      })],
    });

    const result = await runSurveyParser({
      entries: [entry],
      metadata: testMetadata,
      datasetPath: '/tmp/dataset',
    });

    const item = result.entries[0].items[0];
    expect(item.label).toBe('A very long enriched label from survey document');
    expect(item.savLabel).toBe('Short .sav');
    expect(item.surveyLabel).toBe('A very long enriched label from survey document');
  });

  it('snapshots savLabel on unmatched entries that bypass label replacement', async () => {
    mockSurveyParserRuntime([
      'Q5. Rate the following options carefully',
      '1. A very long enriched label from survey document',
    ].join('\n'));

    const entry = makeEntry({
      questionId: 'Q999',
      items: [makeItem({
        column: 'Q999_1',
        label: 'Original unmatched label',
      })],
    });

    const result = await runSurveyParser({
      entries: [entry],
      metadata: testMetadata,
      datasetPath: '/tmp/dataset',
    });

    const item = result.entries[0].items[0];
    expect(item.label).toBe('Original unmatched label');
    expect(item.savLabel).toBe('Original unmatched label');
    expect(item.surveyLabel).toBeUndefined();
  });

  it('is idempotent on rerun and preserves first-run savLabel', async () => {
    mockSurveyParserRuntime([
      'Q5. Rate the following options carefully',
      '1. A very long enriched label from survey document',
    ].join('\n'));

    const firstPass = await runSurveyParser({
      entries: [makeEntry({
        questionId: 'Q5',
        items: [makeItem({
          column: 'Q5_1',
          label: 'Original from first run',
        })],
      })],
      metadata: testMetadata,
      datasetPath: '/tmp/dataset',
    });

    const secondPass = await runSurveyParser({
      entries: firstPass.entries,
      metadata: firstPass.metadata,
      datasetPath: '/tmp/dataset',
    });

    const item = secondPass.entries[0].items[0];
    expect(item.label).toBe('A very long enriched label from survey document');
    expect(item.savLabel).toBe('Original from first run');
  });
});

// =============================================================================
// Stage 12 — reconcileLabelsFromSurvey preserves savLabel
// =============================================================================

describe('Stage 12 — savLabel preservation on re-reconciliation', () => {
  const surveyQuestions: ParsedSurveyQuestion[] = [
    {
      questionId: 'Q5',
      rawText: 'Q5. Rate the following options carefully',
      questionText: 'Rate the following options carefully',
      instructionText: null,
      answerOptions: [
        { code: 1, text: 'A very long enriched label from survey document', isOther: false, anchor: false, routing: null, progNote: null },
      ],
      scaleLabels: null,
      questionType: 'single_select',
      format: 'numbered_list',
      progNotes: [],
      strikethroughSegments: [],
      sectionHeader: null,
    },
  ];

  it('preserves savLabel set by stage 08a when stage 12 overwrites item.label', () => {
    const entry = makeEntry({
      questionId: 'Q5',
      questionText: 'Rate the following',
      items: [makeItem({
        column: 'Q5_1',
        label: 'Mid label',
        savLabel: 'Original .sav label from 08a',
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestions,
    });

    const item = result.entries[0].items[0];

    // savLabel from 08a must survive stage 12's deep clone + re-reconciliation
    expect(item.savLabel).toBe('Original .sav label from 08a');
  });

  it('sets savLabel on items that did not go through 08a (fallback to current label)', () => {
    const entry = makeEntry({
      questionId: 'Q5',
      questionText: 'Rate the following',
      items: [makeItem({
        column: 'Q5_1',
        label: 'Only label',
        // no savLabel — simulates items that bypassed 08a (no survey doc)
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestions,
    });

    const item = result.entries[0].items[0];

    // savLabel should be set even if 08a didn't run — fallback to item.label
    expect(item.savLabel).toBe('Only label');
  });

  it('sets savLabel even when stage 12 label-overwrite guard does not run', () => {
    const longLabel = 'This is a long item label that should not enter the stage-12 overwrite path';
    const entry = makeEntry({
      questionId: 'Q5',
      questionText: 'Rate the following',
      items: [makeItem({
        column: 'Q5_open', // no numeric suffix => no code extraction
        label: longLabel,
        savLabel: undefined,
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch adjusted'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestions,
    });

    const item = result.entries[0].items[0];
    expect(item.savLabel).toBe(longLabel);
  });

  it('preserves savLabel on scale labels during re-reconciliation', () => {
    const surveyQuestionsWithScale: ParsedSurveyQuestion[] = [
      {
        questionId: 'Q6',
        rawText: 'Q6. How satisfied are you?',
        questionText: 'How satisfied are you?',
        instructionText: null,
        answerOptions: [
          { code: 1, text: 'Very dissatisfied with this experience overall', isOther: false, anchor: false, routing: null, progNote: null },
          { code: 5, text: 'Very satisfied with this experience overall', isOther: false, anchor: false, routing: null, progNote: null },
        ],
        scaleLabels: null,
        questionType: 'single_select',
        format: 'numbered_list',
        progNotes: [],
        strikethroughSegments: [],
        sectionHeader: null,
      },
    ];

    const entry = makeEntry({
      questionId: 'Q6',
      analyticalSubtype: 'scale',
      questionText: 'How satisfied?',
      items: [makeItem({
        column: 'Q6',
        label: 'Satisfaction',
        scaleLabels: [
          { value: 1, label: 'Dissat', savLabel: 'Dissat' },
          { value: 5, label: 'Sat', savLabel: 'Sat' },
        ],
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestionsWithScale,
    });

    const scaleLabels = result.entries[0].items[0].scaleLabels;
    expect(scaleLabels).toBeDefined();
    if (scaleLabels) {
      for (const sl of scaleLabels) {
        // savLabel should survive the deep clone and re-reconciliation
        expect(sl.savLabel).toBeDefined();
        expect(typeof sl.savLabel).toBe('string');
      }
      // The original savLabel values should be preserved
      expect(scaleLabels[0].savLabel).toBe('Dissat');
      expect(scaleLabels[1].savLabel).toBe('Sat');
    }
  });

  it('allows matching anchored survey labels on scale values', () => {
    const surveyQuestionsWithScale: ParsedSurveyQuestion[] = [
      {
        questionId: 'Q7',
        rawText: 'Q7. Rate this concept',
        questionText: 'Rate this concept',
        instructionText: null,
        answerOptions: [
          { code: 7, text: '7-Extremely Positive', isOther: false, anchor: false, routing: null, progNote: null },
        ],
        scaleLabels: null,
        questionType: 'single_select',
        format: 'numbered_list',
        progNotes: [],
        strikethroughSegments: [],
        sectionHeader: null,
      },
    ];

    const entry = makeEntry({
      questionId: 'Q7',
      analyticalSubtype: 'scale',
      items: [makeItem({
        column: 'Q7',
        label: 'Concept rating',
        scaleLabels: [
          { value: 7, label: 'Extremely Positive', savLabel: '7-Extremely Positive' },
        ],
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestionsWithScale,
    });

    expect(result.entries[0].items[0].scaleLabels?.[0].label).toBe('7-Extremely Positive');
    expect(result.entries[0]._reconciliation?.diagnostics).toBeUndefined();
  });

  it('allows unanchored cleaner survey labels on scale values', () => {
    const surveyQuestionsWithScale: ParsedSurveyQuestion[] = [
      {
        questionId: 'Q8',
        rawText: 'Q8. Rate this concept',
        questionText: 'Rate this concept',
        instructionText: null,
        answerOptions: [
          { code: 7, text: 'Extremely Positive overall', isOther: false, anchor: false, routing: null, progNote: null },
        ],
        scaleLabels: null,
        questionType: 'single_select',
        format: 'numbered_list',
        progNotes: [],
        strikethroughSegments: [],
        sectionHeader: null,
      },
    ];

    const entry = makeEntry({
      questionId: 'Q8',
      analyticalSubtype: 'scale',
      items: [makeItem({
        column: 'Q8',
        label: 'Concept rating',
        scaleLabels: [
          { value: 7, label: 'Positive', savLabel: 'Positive' },
        ],
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestionsWithScale,
    });

    expect(result.entries[0].items[0].scaleLabels?.[0].label).toBe('Extremely Positive overall');
    expect(result.entries[0]._reconciliation?.diagnostics).toBeUndefined();
  });

  it('rejects conflicting anchored survey labels and records a diagnostic', () => {
    const surveyQuestionsWithScale: ParsedSurveyQuestion[] = [
      {
        questionId: 'Q9',
        rawText: 'Q9. Rate this concept',
        questionText: 'Rate this concept',
        instructionText: null,
        answerOptions: [
          { code: 7, text: '1-Extremely Positive', isOther: false, anchor: false, routing: null, progNote: null },
        ],
        scaleLabels: null,
        questionType: 'single_select',
        format: 'numbered_list',
        progNotes: [],
        strikethroughSegments: [],
        sectionHeader: null,
      },
    ];

    const entry = makeEntry({
      questionId: 'Q9',
      analyticalSubtype: 'scale',
      items: [makeItem({
        column: 'Q9',
        label: 'Concept rating',
        scaleLabels: [
          { value: 7, label: '7-Extremely Positive', savLabel: '7-Extremely Positive' },
        ],
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestionsWithScale,
    });

    expect(result.entries[0].items[0].scaleLabels?.[0].label).toBe('7-Extremely Positive');
    expect(result.entries[0]._reconciliation?.diagnostics?.[0]?.code).toBe('scale_anchor_conflict');
  });

  it('restores savLabel when the current scale label is corrupted and survey text conflicts', () => {
    const surveyQuestionsWithScale: ParsedSurveyQuestion[] = [
      {
        questionId: 'Q10',
        rawText: 'Q10. Rate this concept',
        questionText: 'Rate this concept',
        instructionText: null,
        answerOptions: [
          { code: 7, text: '1-Extremely Positive', isOther: false, anchor: false, routing: null, progNote: null },
        ],
        scaleLabels: null,
        questionType: 'single_select',
        format: 'numbered_list',
        progNotes: [],
        strikethroughSegments: [],
        sectionHeader: null,
      },
    ];

    const entry = makeEntry({
      questionId: 'Q10',
      analyticalSubtype: 'scale',
      items: [makeItem({
        column: 'Q10',
        label: 'Concept rating',
        scaleLabels: [
          { value: 7, label: '1-Extremely Positive', savLabel: '7-Extremely Positive' },
        ],
      })],
      _aiGateReview: makeCorrectedReview('surveyMatch'),
    });

    const result = runReconcile({
      entries: [entry],
      metadata: testMetadata,
      surveyParsed: surveyQuestionsWithScale,
    });

    expect(result.entries[0].items[0].scaleLabels?.[0].label).toBe('7-Extremely Positive');
    expect(result.entries[0]._reconciliation?.diagnostics?.[0]?.code).toBe('scale_anchor_conflict');
  });
});

describe('08a -> 12 full flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves 08a savLabel through stage 12 re-reconciliation', async () => {
    mockSurveyParserRuntime([
      'Q5. Rate the following options carefully',
      '1. A very long enriched label from survey document',
    ].join('\n'));

    const parsed = await runSurveyParser({
      entries: [makeEntry({
        questionId: 'Q5',
        surveyMatch: 'exact',
        items: [makeItem({
          column: 'Q5_1',
          label: 'Short .sav label',
        })],
      })],
      metadata: testMetadata,
      datasetPath: '/tmp/dataset',
    });

    const correctedEntry: QuestionIdEntry = {
      ...parsed.entries[0],
      _aiGateReview: makeCorrectedReview('surveyMatch adjusted'),
    };

    const reconciled = runReconcile({
      entries: [correctedEntry],
      metadata: testMetadata,
      surveyParsed: parsed.surveyParsed,
    });

    const item = reconciled.entries[0].items[0];
    expect(item.savLabel).toBe('Short .sav label');
    expect(item.surveyLabel).toBe('A very long enriched label from survey document');
    expect(item.label).toBe('A very long enriched label from survey document');
  });
});

// =============================================================================
// JSON round-trip (stage 12 deep-clones via JSON.parse(JSON.stringify))
// =============================================================================

describe('JSON round-trip', () => {
  it('savLabel and surveyLabel survive JSON.parse(JSON.stringify(...))', () => {
    const item = makeItem({
      savLabel: 'Original .sav',
      surveyLabel: 'From survey doc',
      scaleLabels: [
        { value: 1, label: 'Good', savLabel: 'Gd', surveyLabel: 'Good' },
      ],
    });

    const roundTripped = JSON.parse(JSON.stringify(item));

    expect(roundTripped.savLabel).toBe('Original .sav');
    expect(roundTripped.surveyLabel).toBe('From survey doc');
    expect(roundTripped.scaleLabels[0].savLabel).toBe('Gd');
    expect(roundTripped.scaleLabels[0].surveyLabel).toBe('Good');
  });

  it('undefined fields are omitted (not null) after round-trip', () => {
    const item = makeItem({ savLabel: 'From .sav' });
    // surveyLabel is not set

    const roundTripped = JSON.parse(JSON.stringify(item));

    expect(roundTripped.savLabel).toBe('From .sav');
    expect('surveyLabel' in roundTripped).toBe(false);
  });
});

// =============================================================================
// Canonical bridge — castItems pass-through via buildContext
// =============================================================================

describe('Canonical bridge — castItems pass-through', () => {
  it('passes savLabel and surveyLabel through to QuestionItem', () => {
    const entry = makeEntry({
      items: [makeItem({
        savLabel: 'From .sav',
        surveyLabel: 'From survey',
      })],
    });

    // buildContext requires a reportableMap; create a minimal one
    const reportableMap = new Map<string, QuestionIdEntry>();
    reportableMap.set(entry.questionId, entry);

    const ctx = buildContext('test-ds', entry, reportableMap);
    const item = ctx.substantiveItems[0];

    expect(item.savLabel).toBe('From .sav');
    expect(item.surveyLabel).toBe('From survey');
  });

  it('passes undefined savLabel/surveyLabel when not set on source item', () => {
    const entry = makeEntry({
      items: [makeItem()], // no savLabel or surveyLabel
    });

    const reportableMap = new Map<string, QuestionIdEntry>();
    reportableMap.set(entry.questionId, entry);

    const ctx = buildContext('test-ds', entry, reportableMap);
    const item = ctx.substantiveItems[0];

    expect(item.savLabel).toBeUndefined();
    expect(item.surveyLabel).toBeUndefined();
  });

  it('passes scale-level savLabel/surveyLabel through', () => {
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      items: [makeItem({
        savLabel: 'Item .sav',
        surveyLabel: 'Item survey',
        scaleLabels: [
          { value: 1, label: 'Low', savLabel: 'Lo', surveyLabel: 'Low' },
          { value: 5, label: 'High', savLabel: 'Hi', surveyLabel: 'High' },
        ],
      })],
    });

    const reportableMap = new Map<string, QuestionIdEntry>();
    reportableMap.set(entry.questionId, entry);

    const ctx = buildContext('test-ds', entry, reportableMap);
    const item = ctx.substantiveItems[0];

    expect(item.scaleLabels).toBeDefined();
    if (item.scaleLabels) {
      expect(item.scaleLabels[0].savLabel).toBe('Lo');
      expect(item.scaleLabels[0].surveyLabel).toBe('Low');
      expect(item.scaleLabels[1].savLabel).toBe('Hi');
      expect(item.scaleLabels[1].surveyLabel).toBe('High');
    }
  });
});
