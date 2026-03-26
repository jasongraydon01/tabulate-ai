/**
 * V3 Runtime — Planning Pipeline Tests (Phase 3: Stages 20–21, 21a diagnostic)
 *
 * Tests cover:
 * - Stage range/order for 20→21
 * - Checkpoint progression through planning boundaries
 * - Banner diagnostic (21a) token extraction + column classification
 * - Determinism of diagnostic output
 * - Stage artifact names
 */

import { describe, it, expect } from 'vitest';
import {
  getStageRange,
  V3_STAGE_PHASES,
  V3_STAGE_NAMES,
  isBefore,
  type V3StageId,
} from '../stageOrder';
import {
  V3_STAGE_ARTIFACTS,
  createPipelineCheckpoint,
  recordStageCompletion,
} from '../contracts';
import {
  runBannerDiagnostic,
  extractBannerTokens,
  classifyColumnStatus,
} from '../planning/bannerDiagnostic';
import type {
  QuestionMatch,
  DiagnosticQuestionIdEntry,
} from '../planning/types';

// =============================================================================
// Test Fixtures
// =============================================================================

function makeQuestionIdEntry(overrides: Partial<DiagnosticQuestionIdEntry> = {}): DiagnosticQuestionIdEntry {
  return {
    questionId: 'Q1',
    disposition: 'reportable',
    isHidden: false,
    normalizedType: 'categorical_select',
    variables: ['Q1_1', 'Q1_2'],
    items: [
      { column: 'Q1_1' },
      { column: 'Q1_2' },
    ],
    ...overrides,
  };
}

function makeBannerPlan(groups: Array<{
  groupName: string;
  columns: Array<{ name: string; original: string }>;
}>) {
  return { bannerCuts: groups };
}

// =============================================================================
// Stage Order / Phase Tests
// =============================================================================

describe('Planning chain stage order', () => {
  it('getStageRange returns correct stages for 20→21', () => {
    const range = getStageRange('20', '21');
    expect(range).toEqual(['20', '21']);
  });

  it('all planning stages are in banner-chain phase', () => {
    const planningStages: V3StageId[] = ['20', '21'];
    for (const stage of planningStages) {
      expect(V3_STAGE_PHASES[stage]).toBe('banner-chain');
    }
  });

  it('planning stages execute after canonical chain', () => {
    expect(isBefore('13d', '20')).toBe(true);
  });

  it('planning stages execute before compute chain', () => {
    expect(isBefore('21', '22')).toBe(true);
  });

  it('stage 20 executes before stage 21', () => {
    expect(isBefore('20', '21')).toBe(true);
  });

  it('all planning stages have names', () => {
    const stages: V3StageId[] = ['20', '21'];
    for (const stage of stages) {
      expect(V3_STAGE_NAMES[stage]).toBeDefined();
      expect(V3_STAGE_NAMES[stage].length).toBeGreaterThan(0);
    }
  });

  it('all planning stages have artifact names', () => {
    expect(V3_STAGE_ARTIFACTS['20']).toBe('planning/20-banner-plan.json');
    expect(V3_STAGE_ARTIFACTS['21']).toBe('planning/21-crosstab-plan.json');
  });
});

// =============================================================================
// Checkpoint Progression Tests
// =============================================================================

describe('Checkpoint progression through planning boundaries', () => {
  it('records stage 20 completion and advances to 21', () => {
    let cp = createPipelineCheckpoint('run-p3', 'test-dataset');

    // Simulate completion of all prior stages (00-12, 13b-13d)
    const priorStages: V3StageId[] = [
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e',
    ];
    for (const stage of priorStages) {
      cp = recordStageCompletion(cp, stage, 100);
    }

    expect(cp.lastCompletedStage).toBe('13e');
    expect(cp.nextStage).toBe('20');

    // Complete 20
    cp = recordStageCompletion(cp, '20', 3000);
    expect(cp.lastCompletedStage).toBe('20');
    expect(cp.nextStage).toBe('21');
  });

  it('progresses through 20 → 21 → 22', () => {
    let cp = createPipelineCheckpoint('run-p3-full', 'test-dataset');

    // Complete all prior stages
    const priorStages: V3StageId[] = [
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e',
    ];
    for (const stage of priorStages) {
      cp = recordStageCompletion(cp, stage, 100);
    }

    cp = recordStageCompletion(cp, '20', 3000);
    expect(cp.nextStage).toBe('21');

    cp = recordStageCompletion(cp, '21', 5000);
    expect(cp.nextStage).toBe('22');
    expect(cp.completedStages).toHaveLength(15);
  });

  it('preserves checkpoint immutability', () => {
    const original = createPipelineCheckpoint('run-immutable', 'ds');
    const afterStage20 = recordStageCompletion(original, '20', 100);

    expect(original.completedStages).toHaveLength(0);
    expect(afterStage20.completedStages).toHaveLength(1);
    expect(afterStage20.lastCompletedStage).toBe('20');
  });

  it('full pipeline checkpoint includes all 17 stages', () => {
    let cp = createPipelineCheckpoint('full-run', 'ds');
    const allStages: V3StageId[] = [
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e',
      '20', '21',
      '22', '14',
    ];

    for (const stage of allStages) {
      cp = recordStageCompletion(cp, stage, 50);
    }

    expect(cp.completedStages).toHaveLength(17);
    expect(cp.lastCompletedStage).toBe('14');
    expect(cp.nextStage).toBeNull();
  });
});

// =============================================================================
// Banner Diagnostic Tests (21a)
// =============================================================================

describe('Banner diagnostic: extractBannerTokens', () => {
  it('extracts variable from equality comparison', () => {
    const tokens = extractBannerTokens('Q1 == 1');
    expect(tokens).toContain('Q1');
  });

  it('extracts variable from inequality comparison', () => {
    const tokens = extractBannerTokens('Age != 99');
    expect(tokens).toContain('Age');
  });

  it('extracts variable from %in% comparison', () => {
    const tokens = extractBannerTokens('Region %in% c(1,2,3)');
    expect(tokens).toContain('Region');
  });

  it('extracts multiple variables from complex expression', () => {
    const tokens = extractBannerTokens('Gender == 1 & Age >= 18');
    expect(tokens).toContain('Gender');
    expect(tokens).toContain('Age');
  });

  it('deduplicates case-insensitively', () => {
    const tokens = extractBannerTokens('Q1 == 1 & q1 != 2');
    // Should have only one token (first occurrence wins)
    const lowerTokens = tokens.map(t => t.toLowerCase());
    const unique = new Set(lowerTokens);
    expect(unique.size).toBe(1);
  });

  it('returns empty array for empty expression', () => {
    const tokens = extractBannerTokens('');
    expect(tokens).toEqual([]);
  });

  it('extracts tokens from function call context', () => {
    const tokens = extractBannerTokens('is.na(Q5)');
    expect(tokens).toContain('Q5');
  });
});

describe('Banner diagnostic: classifyColumnStatus', () => {
  it('classifies reportable-only matches', () => {
    const matches: QuestionMatch[] = [
      {
        token: 'Q1',
        matchedAs: 'questionId',
        questionId: 'Q1',
        disposition: 'reportable',
        isHidden: false,
        normalizedType: null,
      },
    ];
    expect(classifyColumnStatus(matches, [])).toBe('reportable_only');
  });

  it('classifies excluded-only matches', () => {
    const matches: QuestionMatch[] = [
      {
        token: 'S1',
        matchedAs: 'variable',
        questionId: 'S1',
        disposition: 'excluded',
        isHidden: false,
        normalizedType: null,
      },
    ];
    expect(classifyColumnStatus(matches, [])).toBe('excluded_only');
  });

  it('classifies mixed reportable + excluded', () => {
    const matches: QuestionMatch[] = [
      {
        token: 'Q1',
        matchedAs: 'questionId',
        questionId: 'Q1',
        disposition: 'reportable',
        isHidden: false,
        normalizedType: null,
      },
      {
        token: 'S1',
        matchedAs: 'variable',
        questionId: 'S1',
        disposition: 'excluded',
        isHidden: false,
        normalizedType: null,
      },
    ];
    expect(classifyColumnStatus(matches, [])).toBe('mixed');
  });

  it('classifies unresolved-only when no matches but tokens exist', () => {
    expect(classifyColumnStatus([], ['UNKNOWN_VAR'])).toBe('unresolved_only');
  });

  it('classifies no_explicit_reference when no matches and no tokens', () => {
    expect(classifyColumnStatus([], [])).toBe('no_explicit_reference');
  });

  it('classifies other-only for non-standard dispositions', () => {
    const matches: QuestionMatch[] = [
      {
        token: 'WT1',
        matchedAs: 'questionId',
        questionId: 'WT1',
        disposition: 'text_open_end',
        isHidden: false,
        normalizedType: null,
      },
    ];
    expect(classifyColumnStatus(matches, [])).toBe('other_only');
  });
});

describe('Banner diagnostic: runBannerDiagnostic', () => {
  it('matches banner columns to question-id entries by variable', () => {
    const entries = [
      makeQuestionIdEntry({
        questionId: 'Gender',
        variables: ['Gender'],
        items: [{ column: 'Gender' }],
      }),
    ];

    const bannerPlan = makeBannerPlan([
      {
        groupName: 'Demographics',
        columns: [
          { name: 'Male', original: 'Gender == 1' },
          { name: 'Female', original: 'Gender == 2' },
        ],
      },
    ]);

    const result = runBannerDiagnostic({ bannerPlan, entries });

    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].status).toBe('reportable_only');
    expect(result.columns[1].status).toBe('reportable_only');
    expect(result.summary.reportableOnlyColumns).toBe(2);
  });

  it('flags columns referencing excluded questions', () => {
    const entries = [
      makeQuestionIdEntry({
        questionId: 'S1',
        disposition: 'excluded',
        variables: ['S1'],
        items: [{ column: 'S1' }],
      }),
    ];

    const bannerPlan = makeBannerPlan([
      {
        groupName: 'Screeners',
        columns: [
          { name: 'Qualified', original: 'S1 == 1' },
        ],
      },
    ]);

    const result = runBannerDiagnostic({ bannerPlan, entries });

    expect(result.columns[0].status).toBe('excluded_only');
    expect(result.summary.excludedOnlyColumns).toBe(1);
    expect(result.summary.uniqueExcludedQuestionIds).toContain('S1');
  });

  it('handles derived question-id resolution (strip suffix)', () => {
    const entries = [
      makeQuestionIdEntry({
        questionId: 'Q5',
        variables: ['Q5_1', 'Q5_2'],
        items: [
          { column: 'Q5_1' },
          { column: 'Q5_2' },
        ],
      }),
    ];

    const bannerPlan = makeBannerPlan([
      {
        groupName: 'Test',
        columns: [
          // Q5_1 should match as variable directly
          { name: 'Item 1 Yes', original: 'Q5_1 == 1' },
        ],
      },
    ]);

    const result = runBannerDiagnostic({ bannerPlan, entries });

    expect(result.columns[0].status).toBe('reportable_only');
    expect(result.columns[0].matchedQuestions[0].matchedAs).toBe('variable');
  });

  it('flags unresolved references', () => {
    const entries = [
      makeQuestionIdEntry({ questionId: 'Q1' }),
    ];

    const bannerPlan = makeBannerPlan([
      {
        groupName: 'Unknown',
        columns: [
          { name: 'Mystery', original: 'XYZVAR == 1' },
        ],
      },
    ]);

    const result = runBannerDiagnostic({ bannerPlan, entries });

    expect(result.columns[0].status).toBe('unresolved_only');
    expect(result.columns[0].unresolvedTokens).toContain('XYZVAR');
  });

  it('handles empty banner plan', () => {
    const result = runBannerDiagnostic({
      bannerPlan: { bannerCuts: [] },
      entries: [makeQuestionIdEntry()],
    });

    expect(result.columns).toHaveLength(0);
    expect(result.summary.totalColumns).toBe(0);
  });

  it('handles columns with no explicit variable references', () => {
    const bannerPlan = makeBannerPlan([
      {
        groupName: 'Total',
        columns: [
          { name: 'Total', original: 'TRUE' },
        ],
      },
    ]);

    const result = runBannerDiagnostic({
      bannerPlan,
      entries: [makeQuestionIdEntry()],
    });

    expect(result.columns[0].status).toBe('no_explicit_reference');
  });

  it('produces deterministic output for same input', () => {
    const entries = [
      makeQuestionIdEntry({ questionId: 'Q1' }),
      makeQuestionIdEntry({ questionId: 'Q2', variables: ['Q2_1'], items: [{ column: 'Q2_1' }] }),
    ];

    const bannerPlan = makeBannerPlan([
      {
        groupName: 'Group A',
        columns: [
          { name: 'Col 1', original: 'Q1_1 == 1' },
          { name: 'Col 2', original: 'Q2_1 %in% c(1,2)' },
        ],
      },
    ]);

    const result1 = runBannerDiagnostic({ bannerPlan, entries });
    const result2 = runBannerDiagnostic({ bannerPlan, entries });

    expect(result1.columns.length).toBe(result2.columns.length);
    for (let i = 0; i < result1.columns.length; i++) {
      expect(result1.columns[i].status).toBe(result2.columns[i].status);
      expect(result1.columns[i].matchedQuestions.length).toBe(
        result2.columns[i].matchedQuestions.length,
      );
    }
    expect(result1.summary).toEqual(result2.summary);
  });

  it('summarizes mixed-disposition results correctly', () => {
    const entries = [
      makeQuestionIdEntry({ questionId: 'Q1', disposition: 'reportable' }),
      makeQuestionIdEntry({ questionId: 'S1', disposition: 'excluded', variables: ['S1'], items: [{ column: 'S1' }] }),
    ];

    const bannerPlan = makeBannerPlan([
      {
        groupName: 'Mixed',
        columns: [
          { name: 'Pure Reportable', original: 'Q1_1 == 1' },
          { name: 'Pure Excluded', original: 'S1 == 1' },
          { name: 'No Ref', original: 'TRUE' },
        ],
      },
    ]);

    const result = runBannerDiagnostic({ bannerPlan, entries });

    expect(result.summary.totalColumns).toBe(3);
    expect(result.summary.reportableOnlyColumns).toBe(1);
    expect(result.summary.excludedOnlyColumns).toBe(1);
    expect(result.summary.noExplicitReferenceColumns).toBe(1);
  });
});

// =============================================================================
// Planning Stage Artifact Names
// =============================================================================

describe('Planning stage artifact mapping', () => {
  it('stage 20 produces planning/20-banner-plan.json', () => {
    expect(V3_STAGE_ARTIFACTS['20']).toBe('planning/20-banner-plan.json');
  });

  it('stage 21 produces planning/21-crosstab-plan.json', () => {
    expect(V3_STAGE_ARTIFACTS['21']).toBe('planning/21-crosstab-plan.json');
  });
});

// =============================================================================
// Planning Stage Names
// =============================================================================

describe('Planning stage naming', () => {
  it('stage 20 is named banner-plan', () => {
    expect(V3_STAGE_NAMES['20']).toBe('banner-plan');
  });

  it('stage 21 is named crosstab-plan', () => {
    expect(V3_STAGE_NAMES['21']).toBe('crosstab-plan');
  });
});
