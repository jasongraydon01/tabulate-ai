import { describe, expect, it } from 'vitest';

import { buildEntryBaseContract } from '../../../baseContract';
import type { LoopFamily } from '../../gates/loopGate';
import { detectStimuliSets } from '../stimuliSetDetector';
import type { QuestionIdEntry, QuestionIdItem, SurveyMetadata } from '../../types';

function makeMetadata(overrides: Partial<SurveyMetadata> = {}): SurveyMetadata {
  return {
    dataset: 'test-dataset',
    generatedAt: '2026-03-19T00:00:00Z',
    scriptVersion: 'v3-runtime-test',
    isMessageTestingSurvey: false,
    isConceptTestingSurvey: false,
    hasMaxDiff: null,
    hasAnchoredScores: null,
    messageTemplatePath: null,
    isDemandSurvey: false,
    hasChoiceModelExercise: null,
    ...overrides,
  };
}

function makeItem(column: string, label: string, overrides: Partial<QuestionIdItem> = {}): QuestionIdItem {
  return {
    column,
    label,
    normalizedType: 'categorical_select',
    itemBase: 100,
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
    questionText: 'Which of the following messages would MOST prompt you to prescribe?',
    variables: ['Q1_1', 'Q1_2'],
    variableCount: 2,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'test',
    subtypeConfidence: 0.95,
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
    totalN: 100,
    questionBase: 100,
    isFiltered: false,
    gapFromTotal: 0,
    gapPct: 0,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: [100, 100],
    baseContract: buildEntryBaseContract({
      totalN: 100,
      questionBase: 100,
      itemBase: null,
      itemBaseRange: [100, 100],
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: 100,
    proposedBaseLabel: 'All respondents',
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

function makeClearedFamily(members: QuestionIdEntry[], familyBase: string): LoopFamily {
  return {
    familyBase,
    members,
    representative: members[0],
  };
}

describe('detectStimuliSets', () => {
  it('annotates cleared loop families with distinct stimuli sets in message testing surveys', () => {
    const questionText = 'Which of the following messages would MOST prompt you to prescribe?';
    const familyMembers = [
      makeEntry({
        questionId: 'B500_1',
        variables: ['B500_1r101', 'B500_1r102'],
        items: [
          makeItem('B500_1r101', 'B500_1r101: Message A - Which of the following messages would MOST prompt you to prescribe?'),
          makeItem('B500_1r102', 'B500_1r102: Message B - Which of the following messages would MOST prompt you to prescribe?'),
        ],
        loop: { detected: true, familyBase: 'B500', iterationIndex: 1, iterationCount: 3, siblingFamilyBases: [] },
        questionText,
      }),
      makeEntry({
        questionId: 'B500_2',
        variables: ['B500_2r201', 'B500_2r202'],
        items: [
          makeItem('B500_2r201', 'B500_2r201: Message C - Which of the following messages would MOST prompt you to prescribe?'),
          makeItem('B500_2r202', 'B500_2r202: Message D - Which of the following messages would MOST prompt you to prescribe?'),
        ],
        loop: { detected: true, familyBase: 'B500', iterationIndex: 2, iterationCount: 3, siblingFamilyBases: [] },
        questionText,
      }),
      makeEntry({
        questionId: 'B500_3',
        variables: ['B500_3r301', 'B500_3r302'],
        items: [
          makeItem('B500_3r301', 'B500_3r301: Message E - Which of the following messages would MOST prompt you to prescribe?'),
          makeItem('B500_3r302', 'B500_3r302: Message F - Which of the following messages would MOST prompt you to prescribe?'),
        ],
        loop: { detected: true, familyBase: 'B500', iterationIndex: 3, iterationCount: 3, siblingFamilyBases: [] },
        questionText,
      }),
    ];

    const resolvedEntries = familyMembers.map(member => ({
      ...member,
      loop: null,
      loopQuestionId: null,
    }));
    const unrelated = makeEntry({ questionId: 'Q9', variables: ['Q9_1'], items: [makeItem('Q9_1', 'Yes')] });

    const output = detectStimuliSets({
      entries: [...resolvedEntries, unrelated],
      clearedFamilies: [makeClearedFamily(familyMembers, 'B500')],
      metadata: makeMetadata({ isMessageTestingSurvey: true }),
    });

    const first = output.find(entry => entry.questionId === 'B500_1');
    const second = output.find(entry => entry.questionId === 'B500_2');
    const third = output.find(entry => entry.questionId === 'B500_3');
    const untouched = output.find(entry => entry.questionId === 'Q9');

    expect(first?.stimuliSets).not.toBeNull();
    expect(second?.stimuliSets).toEqual(first?.stimuliSets);
    expect(third?.stimuliSets).toEqual(first?.stimuliSets);
    expect(first?.stimuliSets).toMatchObject({
      detected: true,
      setCount: 3,
      familySource: 'B500',
      detectionMethod: 'label_comparison',
    });
    expect(first?.stimuliSets?.sets).toEqual([
      {
        setIndex: 0,
        sourceQuestionId: 'B500_1',
        items: ['B500_1r101', 'B500_1r102'],
        itemCount: 2,
      },
      {
        setIndex: 1,
        sourceQuestionId: 'B500_2',
        items: ['B500_2r201', 'B500_2r202'],
        itemCount: 2,
      },
      {
        setIndex: 2,
        sourceQuestionId: 'B500_3',
        items: ['B500_3r301', 'B500_3r302'],
        itemCount: 2,
      },
    ]);
    expect(untouched?.stimuliSets).toBeNull();
  });

  it('does not annotate cleared families when all iterations share the same label set', () => {
    const familyMembers = [
      makeEntry({
        questionId: 'C500_1',
        variables: ['C500_1r101', 'C500_1r102'],
        items: [
          makeItem('C500_1r101', 'C500_1r101: Shared A'),
          makeItem('C500_1r102', 'C500_1r102: Shared B'),
        ],
        loop: { detected: true, familyBase: 'C500', iterationIndex: 1, iterationCount: 2, siblingFamilyBases: [] },
      }),
      makeEntry({
        questionId: 'C500_2',
        variables: ['C500_2r201', 'C500_2r202'],
        items: [
          makeItem('C500_2r201', 'C500_2r201: Shared A'),
          makeItem('C500_2r202', 'C500_2r202: Shared B'),
        ],
        loop: { detected: true, familyBase: 'C500', iterationIndex: 2, iterationCount: 2, siblingFamilyBases: [] },
      }),
    ];

    const output = detectStimuliSets({
      entries: familyMembers.map(member => ({ ...member, loop: null, loopQuestionId: null })),
      clearedFamilies: [makeClearedFamily(familyMembers, 'C500')],
      metadata: makeMetadata({ isMessageTestingSurvey: true }),
    });

    expect(output.every(entry => entry.stimuliSets === null)).toBe(true);
  });

  it('runs for concept testing surveys even when message testing is false', () => {
    const familyMembers = [
      makeEntry({
        questionId: 'T100_1',
        variables: ['T100_1r101'],
        items: [makeItem('T100_1r101', 'T100_1r101: Concept Alpha')],
        loop: { detected: true, familyBase: 'T100', iterationIndex: 1, iterationCount: 2, siblingFamilyBases: [] },
      }),
      makeEntry({
        questionId: 'T100_2',
        variables: ['T100_2r201'],
        items: [makeItem('T100_2r201', 'T100_2r201: Concept Beta')],
        loop: { detected: true, familyBase: 'T100', iterationIndex: 2, iterationCount: 2, siblingFamilyBases: [] },
      }),
    ];

    const output = detectStimuliSets({
      entries: familyMembers.map(member => ({ ...member, loop: null, loopQuestionId: null })),
      clearedFamilies: [makeClearedFamily(familyMembers, 'T100')],
      metadata: makeMetadata({ isMessageTestingSurvey: false, isConceptTestingSurvey: true }),
    });

    expect(output[0].stimuliSets?.setCount).toBe(2);
    expect(output[1].stimuliSets?.familySource).toBe('T100');
  });

  it('skips detection outside message/concept testing surveys', () => {
    const familyMembers = [
      makeEntry({
        questionId: 'A1_1',
        variables: ['A1_1r101'],
        items: [makeItem('A1_1r101', 'A1_1r101: Stimulus 1')],
        loop: { detected: true, familyBase: 'A1', iterationIndex: 1, iterationCount: 2, siblingFamilyBases: [] },
      }),
      makeEntry({
        questionId: 'A1_2',
        variables: ['A1_2r201'],
        items: [makeItem('A1_2r201', 'A1_2r201: Stimulus 2')],
        loop: { detected: true, familyBase: 'A1', iterationIndex: 2, iterationCount: 2, siblingFamilyBases: [] },
      }),
    ];

    const output = detectStimuliSets({
      entries: familyMembers.map(member => ({ ...member, loop: null, loopQuestionId: null })),
      clearedFamilies: [makeClearedFamily(familyMembers, 'A1')],
      metadata: makeMetadata(),
    });

    expect(output.every(entry => entry.stimuliSets === null)).toBe(true);
  });

  it('ignores cleared hidden families even when labels differ by iteration', () => {
    const familyMembers = [
      makeEntry({
        questionId: 'hComp_TOP_1',
        isHidden: true,
        variables: ['hComp_TOP_1'],
        items: [makeItem('hComp_TOP_1', 'hComp_TOP_1: Competitor A')],
        loop: { detected: true, familyBase: 'hComp_TOP', iterationIndex: 1, iterationCount: 2, siblingFamilyBases: [] },
      }),
      makeEntry({
        questionId: 'hComp_TOP_2',
        isHidden: true,
        variables: ['hComp_TOP_2'],
        items: [makeItem('hComp_TOP_2', 'hComp_TOP_2: Competitor B')],
        loop: { detected: true, familyBase: 'hComp_TOP', iterationIndex: 2, iterationCount: 2, siblingFamilyBases: [] },
      }),
    ];

    const output = detectStimuliSets({
      entries: familyMembers.map(member => ({ ...member, loop: null, loopQuestionId: null })),
      clearedFamilies: [makeClearedFamily(familyMembers, 'hComp_TOP')],
      metadata: makeMetadata({ isMessageTestingSurvey: true }),
    });

    expect(output.every(entry => entry.stimuliSets === null)).toBe(true);
  });
});
