import { describe, expect, it } from 'vitest';
import { isV3Result, parseRunResult } from '../runResultSchema';

describe('parseRunResult', () => {
  it('parses a V3 result shape', () => {
    const parsed = parseRunResult({
      formatVersion: 3,
      pipelineId: 'pipeline-123',
      outputDir: '/tmp/output',
      reviewUrl: '/projects/project-123/review',
      summary: {
        tables: 12,
        cuts: 4,
        bannerGroups: 2,
        durationMs: 3456,
      },
      r2Files: {
        outputs: {
          'results/crosstabs.xlsx': 'r2-key',
        },
      },
      reviewDiff: {
        totalColumns: 3,
        approved: 1,
        hinted: 1,
        alternativesSelected: 0,
        edited: 0,
        skipped: 1,
        expressionsChanged: 1,
        expressionsUnchanged: 2,
        errors: 0,
      },
      pipelineDecisions: {
        enrichment: {
          totalQuestions: 12,
          loopsDetected: 1,
          aiTriageRequired: 2,
          aiValidationPassed: 2,
          messageCodesMatched: 4,
        },
        tables: {
          canonicalTablesPlanned: 18,
          finalTableCount: 17,
          netsAdded: 1,
          tablesExcluded: 2,
        },
        banners: {
          source: 'uploaded',
          bannerGroupCount: 2,
          totalCuts: 4,
          flaggedForReview: 0,
        },
        weights: {
          detected: true,
          variableUsed: 'wt_main',
          candidateCount: 2,
        },
        errors: {
          total: 1,
          recovered: 1,
          warnings: 3,
        },
        timing: {
          enrichmentMs: 100,
          tableGenerationMs: 200,
          computeMs: 300,
          excelMs: 400,
          totalMs: 1000,
        },
        studyFlags: {
          isDemandSurvey: false,
          hasChoiceModelExercise: null,
          hasMaxDiff: true,
        },
      },
      decisionsSummary: 'Processed 12 questions.',
    });

    expect(parsed).toBeDefined();
    expect(parsed?.formatVersion).toBe(3);
    expect(parsed?.pipelineId).toBe('pipeline-123');
    expect(parsed?.summary?.tables).toBe(12);
    expect(parsed?.r2Files?.outputs?.['results/crosstabs.xlsx']).toBe('r2-key');
    expect(parsed?.reviewDiff?.totalColumns).toBe(3);
    expect(parsed?.pipelineDecisions?.tables.netsAdded).toBe(1);
    expect(parsed?.pipelineDecisions?.studyFlags.hasMaxDiff).toBe(true);
    expect(parsed?.decisionsSummary).toBe('Processed 12 questions.');
    expect(isV3Result(parsed)).toBe(true);
  });

  it('parses a legacy shape without requiring formatVersion', () => {
    const parsed = parseRunResult({
      pipelineId: 'legacy-run',
      summary: {
        tables: 9,
      },
    });

    expect(parsed).toBeDefined();
    expect(parsed?.formatVersion).toBeUndefined();
    expect(parsed?.pipelineId).toBe('legacy-run');
    expect(parsed?.summary?.tables).toBe(9);
    expect(isV3Result(parsed)).toBe(false);
  });

  it('returns undefined for missing result', () => {
    expect(parseRunResult(undefined)).toBeUndefined();
    expect(parseRunResult(null)).toBeUndefined();
  });

  it('drops malformed nested values instead of throwing', () => {
    const parsed = parseRunResult({
      pipelineId: 42,
      summary: 'bad-summary',
      r2Files: {
        outputs: {
          good: 'key',
          bad: 123,
        },
      },
      reviewDiff: {
        totalColumns: '3',
      },
      pipelineDecisions: {
        enrichment: {
          totalQuestions: 'bad',
        },
      },
    });

    expect(parsed).toBeDefined();
    expect(parsed?.pipelineId).toBeUndefined();
    expect(parsed?.summary).toBeUndefined();
    expect(parsed?.r2Files?.outputs).toBeUndefined();
    expect(parsed?.reviewDiff).toBeUndefined();
    expect(parsed?.pipelineDecisions).toBeUndefined();
    expect(isV3Result(parsed)).toBe(false);
  });

  it('parses expanded Convex reviewState metadata and keeps legacy slim payloads valid', () => {
    const expanded = parseRunResult({
      pipelineId: 'pipeline-review',
      reviewState: {
        status: 'awaiting_review',
        flaggedColumns: [{
          groupName: 'Audience',
          columnName: 'Teachers',
          original: 'Teacher audience',
          proposed: 'Q1 == 1',
          confidence: 0.95,
          reasoning: 'Direct mapping',
          userSummary: 'Mapped directly',
          alternatives: [{
            expression: 'Teacher audience',
            rank: 5,
            userSummary: 'Original banner expression shown for reviewer reference.',
            selectable: false,
            nonSelectableReason: 'Original banner expression could not be confirmed as a valid executable fallback.',
            source: 'literal_original',
          }],
          uncertainties: [],
          expressionType: 'direct_variable',
        }],
        pathBStatus: 'completed',
        pathCStatus: 'skipped',
        totalColumns: 12,
        pipelineId: 'pipeline-review',
        createdAt: '2026-03-20T12:34:56.000Z',
        v3LastCompletedStage: '21',
        totalCanonicalTables: 42,
        bannerGroupCount: 6,
      },
    });

    const legacy = parseRunResult({
      pipelineId: 'pipeline-review',
      reviewState: {
        status: 'awaiting_review',
        flaggedColumns: [],
        pathBStatus: 'completed',
        pathCStatus: 'skipped',
        totalColumns: 12,
      },
    });

    expect(expanded?.reviewState?.pipelineId).toBe('pipeline-review');
    expect(expanded?.reviewState?.createdAt).toBe('2026-03-20T12:34:56.000Z');
    expect(expanded?.reviewState?.v3LastCompletedStage).toBe('21');
    expect(expanded?.reviewState?.totalCanonicalTables).toBe(42);
    expect(expanded?.reviewState?.bannerGroupCount).toBe(6);
    expect(expanded?.reviewState?.flaggedColumns?.[0]?.alternatives?.[0]).toMatchObject({
      selectable: false,
      source: 'literal_original',
    });

    expect(legacy?.reviewState?.status).toBe('awaiting_review');
    expect(legacy?.reviewState?.pipelineId).toBeUndefined();
    expect(legacy?.reviewState?.createdAt).toBeUndefined();
    expect(legacy?.reviewState?.v3LastCompletedStage).toBeUndefined();
    expect(legacy?.reviewState?.totalCanonicalTables).toBeUndefined();
    expect(legacy?.reviewState?.bannerGroupCount).toBeUndefined();
  });

  it('parses v3Checkpoint leniently and leaves old runs valid when missing', () => {
    const withCheckpoint = parseRunResult({
      formatVersion: 3,
      pipelineId: 'pipeline-checkpoint',
      v3Checkpoint: {
        schemaVersion: 2,
        pipelineId: 'pipeline-checkpoint',
        dataset: 'dataset-a',
        updatedAt: '2026-03-20T12:34:56.000Z',
        lastCompletedStage: '21',
        completedStages: [],
      },
    });

    const withoutCheckpoint = parseRunResult({
      formatVersion: 3,
      pipelineId: 'pipeline-checkpoint',
    });

    expect(withCheckpoint?.v3Checkpoint?.pipelineId).toBe('pipeline-checkpoint');
    expect(withCheckpoint?.v3Checkpoint?.lastCompletedStage).toBe('21');
    expect(withoutCheckpoint?.v3Checkpoint).toBeUndefined();
  });

  it('preserves review recovery keys needed for post-review resume', () => {
    const parsed = parseRunResult({
      formatVersion: 3,
      pipelineId: 'pipeline-review-r2',
      reviewR2Keys: {
        reviewState: 'r2/review-state',
        v3QuestionIdFinal: 'r2/questionid',
        v3CrosstabPlan: 'r2/crosstab-plan',
        v3TableEnriched: 'r2/table-enriched',
        v3Checkpoint: 'r2/checkpoint',
      },
    });

    expect(parsed?.reviewR2Keys?.reviewState).toBe('r2/review-state');
    expect(parsed?.reviewR2Keys?.v3QuestionIdFinal).toBe('r2/questionid');
    expect(parsed?.reviewR2Keys?.v3CrosstabPlan).toBe('r2/crosstab-plan');
    expect(parsed?.reviewR2Keys?.v3TableEnriched).toBe('r2/table-enriched');
    expect(parsed?.reviewR2Keys?.v3Checkpoint).toBe('r2/checkpoint');
  });
});
