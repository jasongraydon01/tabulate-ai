import { describe, it, expect } from 'vitest';
import {
  matchesQuestionId,
  extractSurveyQuestionIds,
  filterTablesBySurveyQuestions,
} from '../surveyQuestionFilter';

// ─── matchesQuestionId ───────────────────────────────────────────────────────

describe('matchesQuestionId', () => {
  const surveyIds = ['S1', 'S2', 'Q3', 'Q10', 'D1'];

  it('returns exact match', () => {
    expect(matchesQuestionId('S1', surveyIds)).toBe('S1');
    expect(matchesQuestionId('Q10', surveyIds)).toBe('Q10');
  });

  it('does not match peer-level letter suffix by prefix fallback (S2a/S2b)', () => {
    expect(matchesQuestionId('S2a', surveyIds)).toBeNull();
    expect(matchesQuestionId('S2b', surveyIds)).toBeNull();
  });

  it('still supports exact peer-level IDs when present', () => {
    expect(matchesQuestionId('S2a', ['S2', 'S2a'])).toBe('S2a');
    expect(matchesQuestionId('S2b', ['S2', 'S2b'])).toBe('S2b');
  });

  it('matches child letter suffix to a multipart parent when survey text confirms the part', () => {
    expect(
      matchesQuestionId(
        'A100a',
        ['A100'],
        [{
          questionId: 'A100',
          text: [
            'A100. What are your current perceptions overall?',
            '',
            '**a. For patients <2 years of age:**',
            '',
            '**b. For patients 2-17 years of age:**',
          ].join('\n'),
        }],
      ),
    ).toBe('A100');
  });

  it('does not use child letter suffix fallback when the parent is not explicitly multipart', () => {
    expect(
      matchesQuestionId(
        'S2a',
        ['S2'],
        [{
          questionId: 'S2',
          text: 'S2. How satisfied are you overall?',
        }],
      ),
    ).toBeNull();
  });

  it('matches prefix + underscore (Q3_r1)', () => {
    expect(matchesQuestionId('Q3_r1', surveyIds)).toBe('Q3');
  });

  it('matches prefix + r for grid rows (Q3r1)', () => {
    expect(matchesQuestionId('Q3r1', surveyIds)).toBe('Q3');
  });

  it('matches structured suffix variants required by deterministic base plan', () => {
    expect(matchesQuestionId('S2r1', ['S2'])).toBe('S2');
    expect(matchesQuestionId('S2_detail', ['S2'])).toBe('S2');
    expect(matchesQuestionId('S2c1', ['S2'])).toBe('S2');
  });

  it('digit guard: S2 does NOT match S20 or S21', () => {
    expect(matchesQuestionId('S20', surveyIds)).toBeNull();
    expect(matchesQuestionId('S21', surveyIds)).toBeNull();
  });

  it('digit guard: Q10 does NOT match Q100', () => {
    expect(matchesQuestionId('Q100', surveyIds)).toBeNull();
  });

  it('returns null when no match', () => {
    expect(matchesQuestionId('X99', surveyIds)).toBeNull();
    expect(matchesQuestionId('hLOCATION', surveyIds)).toBeNull();
  });

  it('returns null for empty survey ID list', () => {
    expect(matchesQuestionId('S1', [])).toBeNull();
  });

  // ─── Exact-match priority over shared prefix ───────────────────────────────

  describe('exact-match priority (peer-level IDs sharing a prefix)', () => {
    const peerIds = ['A3', 'A3a', 'A3b'];

    it('A3a matches A3a exactly, not A3', () => {
      expect(matchesQuestionId('A3a', peerIds)).toBe('A3a');
    });

    it('A3b matches A3b exactly, not A3', () => {
      expect(matchesQuestionId('A3b', peerIds)).toBe('A3b');
    });

    it('A3 still matches A3 exactly', () => {
      expect(matchesQuestionId('A3', peerIds)).toBe('A3');
    });

    it('A3x does not fall back to A3 (unstructured letter suffix)', () => {
      expect(matchesQuestionId('A3x', peerIds)).toBeNull();
    });

    it('A3a_r1 matches most-specific prefix A3a, not A3', () => {
      expect(matchesQuestionId('A3a_r1', peerIds)).toBe('A3a');
    });
  });
});

// ─── extractSurveyQuestionIds ────────────────────────────────────────────────

describe('extractSurveyQuestionIds', () => {
  it('extracts question IDs from markdown', () => {
    const markdown = [
      '# Survey',
      '',
      'S1. What is your role?',
      '1. Manager',
      '2. Director',
      '',
      'S2. How satisfied are you?',
      '1. Very satisfied',
      '',
      'Q3. What department?',
    ].join('\n');

    const ids = extractSurveyQuestionIds(markdown);
    expect(ids).toEqual(['S1', 'S2', 'Q3']);
  });

  it('excludes preamble segment (empty questionId)', () => {
    const markdown = [
      'This is the preamble text before any questions.',
      'It should not produce a question ID.',
      '',
      'S1. First question',
    ].join('\n');

    const ids = extractSurveyQuestionIds(markdown);
    expect(ids).toEqual(['S1']);
  });

  it('returns empty array for markdown with no questions', () => {
    const markdown = 'Just some text with no question patterns.';
    const ids = extractSurveyQuestionIds(markdown);
    expect(ids).toEqual([]);
  });

  it('deduplicates question IDs', () => {
    // segmentSurvey produces one segment per question boundary,
    // but just in case the same ID appears in different contexts
    const markdown = [
      'S1. First mention',
      '',
      'Some text',
      '',
      'S2. Second question',
    ].join('\n');

    const ids = extractSurveyQuestionIds(markdown);
    // Each ID should appear exactly once
    const uniqueCheck = new Set(ids);
    expect(ids.length).toBe(uniqueCheck.size);
  });
});

// ─── filterTablesBySurveyQuestions ───────────────────────────────────────────

describe('filterTablesBySurveyQuestions', () => {
  interface TestGroup {
    questionId: string;
    tables: { id: string }[];
  }

  const getQuestionId = (g: TestGroup) => g.questionId;
  const getTableCount = (g: TestGroup) => g.tables.length;

  it('keeps groups matching survey questions', () => {
    const groups: TestGroup[] = [
      { questionId: 'S1', tables: [{ id: 't1' }] },
      { questionId: 'S2', tables: [{ id: 't2' }, { id: 't3' }] },
    ];
    const surveyIds = ['S1', 'S2', 'S3'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(2);
    expect(result.stats.groupsKept).toBe(2);
    expect(result.stats.tablesKept).toBe(3);
    expect(result.stats.groupsRemoved).toBe(0);
    expect(result.stats.tablesRemoved).toBe(0);
  });

  it('removes groups not matching survey questions', () => {
    const groups: TestGroup[] = [
      { questionId: 'S1', tables: [{ id: 't1' }] },
      { questionId: 'hLOCATION', tables: [{ id: 't2' }] },
      { questionId: 'MaxDiff_Score', tables: [{ id: 't3' }] },
    ];
    const surveyIds = ['S1', 'S2'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].questionId).toBe('S1');
    expect(result.stats.groupsRemoved).toBe(2);
    expect(result.stats.tablesRemoved).toBe(2);
    expect(result.stats.removedQuestionIds).toEqual(['hLOCATION', 'MaxDiff_Score']);
  });

  it('keeps structured prefix matches (Q3_r1 matches Q3)', () => {
    const groups: TestGroup[] = [
      { questionId: 'Q3_r1', tables: [{ id: 't1' }] },
      { questionId: 'Q3r2', tables: [{ id: 't2' }] },
    ];
    const surveyIds = ['Q3'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(2);
    expect(result.stats.tablesKept).toBe(2);
  });

  it('does not keep peer-level letter variants by prefix fallback', () => {
    const groups: TestGroup[] = [
      { questionId: 'S2b', tables: [{ id: 't1' }] },
    ];
    const surveyIds = ['S2'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(0);
    expect(result.stats.tablesRemoved).toBe(1);
  });

  it('reports orphan survey IDs (in survey but no table)', () => {
    const groups: TestGroup[] = [
      { questionId: 'S1', tables: [{ id: 't1' }] },
    ];
    const surveyIds = ['S1', 'S2', 'S3'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.stats.orphanSurveyIds).toEqual(['S2', 'S3']);
  });

  it('handles empty groups array', () => {
    const result = filterTablesBySurveyQuestions([], ['S1'], getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(0);
    expect(result.stats.groupsKept).toBe(0);
    expect(result.stats.orphanSurveyIds).toEqual(['S1']);
  });

  it('handles empty survey IDs (removes everything)', () => {
    const groups: TestGroup[] = [
      { questionId: 'S1', tables: [{ id: 't1' }] },
    ];

    const result = filterTablesBySurveyQuestions(groups, [], getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(0);
    expect(result.stats.groupsRemoved).toBe(1);
  });

  it('logs correct action per group', () => {
    const groups: TestGroup[] = [
      { questionId: 'S1', tables: [{ id: 't1' }] },
      { questionId: 'hDERIVED', tables: [{ id: 't2' }, { id: 't3' }] },
    ];
    const surveyIds = ['S1'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toEqual({
      questionId: 'S1',
      action: 'keep',
      matchedSurveyId: 'S1',
      tableCount: 1,
    });
    expect(result.actions[1]).toEqual({
      questionId: 'hDERIVED',
      action: 'remove',
      matchedSurveyId: null,
      tableCount: 2,
    });
  });

  // ─── Orphan accuracy with peer-level IDs ──────────────────────────────────

  it('peer-level IDs: correct matchedSurveyId and only true orphans', () => {
    const groups: TestGroup[] = [
      { questionId: 'A3', tables: [{ id: 't1' }] },
      { questionId: 'A3a', tables: [{ id: 't2' }, { id: 't3' }] },
    ];
    const surveyIds = ['A3', 'A3a', 'A3b'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(2);
    // Each group matched its own exact survey ID
    expect(result.actions[0]).toMatchObject({ questionId: 'A3', matchedSurveyId: 'A3' });
    expect(result.actions[1]).toMatchObject({ questionId: 'A3a', matchedSurveyId: 'A3a' });
    // Only A3b is orphaned — no table maps to it
    expect(result.stats.orphanSurveyIds).toEqual(['A3b']);
  });

  it('correctly reports orphan when only subset of peer IDs have tables', () => {
    const groups: TestGroup[] = [
      { questionId: 'A3a', tables: [{ id: 't1' }] },
      { questionId: 'A3b', tables: [{ id: 't2' }] },
    ];
    const surveyIds = ['A3', 'A3a', 'A3b'];

    const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount);

    expect(result.filtered).toHaveLength(2);
    // A3 has no table → orphaned
    expect(result.stats.orphanSurveyIds).toEqual(['A3']);
  });

  // ─── Allowlist (MaxDiff integration) ────────────────────────────────────────

  describe('allowlist parameter', () => {
    it('keeps allowlisted groups even when they have no survey match', () => {
      const groups: TestGroup[] = [
        { questionId: 'S1', tables: [{ id: 't1' }] },
        { questionId: 'AnchProbInd', tables: [{ id: 't2' }, { id: 't3' }] },
        { questionId: 'AnchProb', tables: [{ id: 't4' }] },
        { questionId: 'hDERIVED', tables: [{ id: 't5' }] },
      ];
      const surveyIds = ['S1'];
      const allowlist = ['AnchProbInd', 'AnchProb'];

      const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount, allowlist);

      expect(result.filtered).toHaveLength(3); // S1 + AnchProbInd + AnchProb
      expect(result.filtered.map(g => g.questionId)).toEqual(['S1', 'AnchProbInd', 'AnchProb']);
      expect(result.stats.groupsRemoved).toBe(1); // Only hDERIVED removed
      expect(result.stats.tablesKept).toBe(4);
      expect(result.stats.tablesRemoved).toBe(1);
    });

    it('marks allowlisted groups with [allowlist] matchedSurveyId', () => {
      const groups: TestGroup[] = [
        { questionId: 'AnchProbInd', tables: [{ id: 't1' }] },
      ];
      const surveyIds = ['S1'];
      const allowlist = ['AnchProbInd'];

      const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount, allowlist);

      expect(result.actions[0]).toMatchObject({
        questionId: 'AnchProbInd',
        action: 'keep',
        matchedSurveyId: '[allowlist]',
      });
    });

    it('keeps MaxDiff family-member questionIds when family is allowlisted', () => {
      const groups: TestGroup[] = [
        { questionId: 'S1', tables: [{ id: 't1' }] },
        { questionId: 'AnchProbInd_1', tables: [{ id: 't2' }] },
        { questionId: 'AnchProbInd_31', tables: [{ id: 't3' }] },
        { questionId: 'AnchProb_2', tables: [{ id: 't4' }] },
      ];
      const surveyIds = ['S1'];
      const allowlist = ['AnchProbInd', 'AnchProb'];

      const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount, allowlist);

      expect(result.filtered.map(g => g.questionId)).toEqual(['S1', 'AnchProbInd_1', 'AnchProbInd_31', 'AnchProb_2']);
      expect(result.stats.tablesKept).toBe(4);
      expect(result.stats.tablesRemoved).toBe(0);
    });

    it('has no effect when allowlist is undefined', () => {
      const groups: TestGroup[] = [
        { questionId: 'AnchProbInd', tables: [{ id: 't1' }] },
      ];
      const surveyIds = ['S1'];

      const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount, undefined);

      expect(result.filtered).toHaveLength(0);
      expect(result.stats.groupsRemoved).toBe(1);
    });

    it('has no effect when allowlist is empty', () => {
      const groups: TestGroup[] = [
        { questionId: 'AnchProbInd', tables: [{ id: 't1' }] },
      ];
      const surveyIds = ['S1'];

      const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount, []);

      expect(result.filtered).toHaveLength(0);
      expect(result.stats.groupsRemoved).toBe(1);
    });

    it('allowlist groups are not counted as orphan survey matches', () => {
      const groups: TestGroup[] = [
        { questionId: 'S1', tables: [{ id: 't1' }] },
        { questionId: 'AnchProbInd', tables: [{ id: 't2' }] },
      ];
      const surveyIds = ['S1', 'S2'];
      const allowlist = ['AnchProbInd'];

      const result = filterTablesBySurveyQuestions(groups, surveyIds, getQuestionId, getTableCount, allowlist);

      // S2 has no table match → orphan. AnchProbInd is kept via allowlist, not survey match.
      expect(result.stats.orphanSurveyIds).toEqual(['S2']);
    });
  });
});
