import { describe, expect, it } from 'vitest';

import {
  buildDecisionsSummary,
  buildPipelineDecisions,
  countLoopFamilies,
  countMessageCodesMatched,
} from '../pipelineDecisions';

import type { CanonicalTable } from '../canonical/types';
import type { V3PipelineCheckpoint } from '../contracts';
import type { QuestionIdEntry, SurveyMetadata } from '../questionId/types';

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  return {
    questionId: 'Q1',
    questionText: 'Question 1',
    variables: ['Q1'],
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
    surveyText: 'Question 1',
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'single_select',
    items: [
      {
        column: 'Q1',
        label: 'Item 1',
        normalizedType: 'single_select',
        itemBase: 10,
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ],
    totalN: 100,
    questionBase: 100,
    isFiltered: false,
    gapFromTotal: 0,
    gapPct: 0,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: [100, 100],
    baseContract: {} as QuestionIdEntry['baseContract'],
    proposedBase: 100,
    proposedBaseLabel: 'Total respondents',
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
}

function makeCheckpoint(): V3PipelineCheckpoint {
  return {
    schemaVersion: 2,
    pipelineId: 'pipeline-1',
    dataset: 'dataset-1',
    updatedAt: '2026-03-20T00:00:00.000Z',
    lastCompletedStage: '14',
    nextStage: null,
    completedStages: [
      { schemaVersion: 2, completedStage: '00', nextStage: '03', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 10 },
      { schemaVersion: 2, completedStage: '03', nextStage: '10a', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 20 },
      { schemaVersion: 2, completedStage: '10a', nextStage: '11', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 30 },
      { schemaVersion: 2, completedStage: '11', nextStage: '12', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 40 },
      { schemaVersion: 2, completedStage: '12', nextStage: '13b', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 50 },
      { schemaVersion: 2, completedStage: '13b', nextStage: '13e', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 60 },
      { schemaVersion: 2, completedStage: '13e', nextStage: '20', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 70 },
      { schemaVersion: 2, completedStage: '20', nextStage: '21', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 80 },
      { schemaVersion: 2, completedStage: '21', nextStage: '22', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 90 },
      { schemaVersion: 2, completedStage: '22', nextStage: '14', artifactPath: 'a', artifactName: 'a', completedAt: 'x', durationMs: 100 },
      { schemaVersion: 2, completedStage: '14', nextStage: null, artifactPath: null, artifactName: null, completedAt: 'x', durationMs: 110 },
    ],
  };
}

function makeTable(overrides: Partial<CanonicalTable> = {}): CanonicalTable {
  return {
    tableId: 'Q1__standard_overview',
    questionId: 'Q1',
    familyRoot: 'Q1',
    sourceTableId: '',
    splitFromTableId: '',
    tableKind: 'standard_overview',
    analyticalSubtype: 'standard',
    normalizedType: 'single_select',
    tableType: 'frequency',
    questionText: 'Question 1',
    rows: [],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    basePolicy: 'default',
    baseSource: 'question',
    questionBase: 100,
    itemBase: null,
    baseContract: {} as CanonicalTable['baseContract'],
    baseText: 'Total respondents',
    isDerived: false,
    sortOrder: 1,
    sortBlock: 'main',
    surveySection: '',
    userNote: '',
    tableSubtitle: '',
    splitReason: null,
    appliesToItem: null,
    computeMaskAnchorVariable: null,
    appliesToColumn: null,
    stimuliSetSlice: null,
    binarySide: null,
    additionalFilter: '',
    exclude: false,
    excludeReason: '',
    filterReviewRequired: false,
    lastModifiedBy: 'CanonicalAssembler',
    notes: [],
    ...overrides,
  };
}

describe('pipelineDecisions helper', () => {
  it('builds counts and timing from runtime artifacts', () => {
    const metadata: SurveyMetadata = {
      dataset: 'dataset-1',
      generatedAt: '2026-03-20T00:00:00.000Z',
      scriptVersion: '1',
      isMessageTestingSurvey: true,
      isConceptTestingSurvey: false,
      hasMaxDiff: true,
      hasAnchoredScores: null,
      messageTemplatePath: 'inputs/messages.csv',
      isDemandSurvey: false,
      hasChoiceModelExercise: null,
    };

    const decisions = buildPipelineDecisions({
      questionId: {
        metadata,
        entries: [
          makeEntry({
            questionId: 'Q1',
            loop: {
              detected: true,
              familyBase: 'Q_LOOP',
              iterationIndex: 1,
              iterationCount: 2,
              siblingFamilyBases: ['Q_LOOP'],
            },
            items: [
              {
                column: 'Q1',
                label: 'Item 1',
                normalizedType: 'single_select',
                itemBase: 10,
                messageCode: 'MSG1',
                messageText: 'Message 1',
                altCode: null,
                altText: null,
                matchMethod: 'code_extraction',
                matchConfidence: 1,
              },
            ],
            _aiGateReview: {
              reviewOutcome: 'confirmed',
              confidence: 0.9,
              mutationCount: 0,
              reasoning: '',
              reviewedAt: '2026-03-20T00:00:00.000Z',
              propagatedFrom: null,
            },
          }),
          makeEntry({
            questionId: 'Q2',
            items: [
              {
                column: 'Q2',
                label: 'Item 2',
                normalizedType: 'single_select',
                itemBase: 10,
                messageCode: 'MSG1',
                messageText: 'Message 1',
                altCode: null,
                altText: null,
                matchMethod: 'code_extraction',
                matchConfidence: 1,
              },
            ],
            _aiGateReview: {
              reviewOutcome: 'flagged_for_human',
              confidence: 0.4,
              mutationCount: 1,
              reasoning: '',
              reviewedAt: '2026-03-20T00:00:00.000Z',
              propagatedFrom: null,
            },
          }),
        ],
      },
      checkpoint: makeCheckpoint(),
      tables: {
        canonicalTablesPlanned: 3,
        canonicalTables: [
          makeTable(),
          makeTable({
            tableId: 'Q1__standard_overview__net_summary',
            sourceTableId: 'Q1__standard_overview',
            isDerived: true,
            lastModifiedBy: 'NETEnrichmentAgent',
          }),
          makeTable({
            tableId: 'Q2__standard_overview',
            exclude: true,
          }),
        ],
        finalTableCount: 2,
      },
      banners: {
        source: 'auto_generated',
        bannerGroupCount: 2,
        totalCuts: 4,
        flaggedForReview: 1,
      },
      weights: {
        detection: {
          candidates: [{ column: 'wt', label: '', score: 0.9, signals: [], mean: 1, sd: 0, min: 0.5, max: 1.5 }],
          bestCandidate: { column: 'wt', label: '', score: 0.9, signals: [], mean: 1, sd: 0, min: 0.5, max: 1.5 },
        },
        variableUsed: 'wt',
      },
      errors: {
        validationWarningCount: 2,
        records: [
          {
            id: 'err-1',
            timestamp: '2026-03-20T00:00:00.000Z',
            dataset: 'dataset-1',
            pipelineId: 'pipeline-1',
            outputDirRelative: 'outputs/dataset-1/pipeline-1',
            source: 'system',
            agentName: '',
            stageNumber: 22,
            stageName: 'Compute',
            itemId: '',
            severity: 'warning',
            classification: 'unknown',
            actionTaken: 'continued',
            name: 'Warn',
            message: 'Recovered warning',
            stack: '',
            meta: {},
          },
        ],
      },
      timing: {
        postRMs: 300,
        excelMs: 400,
        totalMs: 2000,
      },
    });

    expect(decisions.enrichment.totalQuestions).toBe(2);
    expect(decisions.enrichment.loopsDetected).toBe(1);
    expect(decisions.enrichment.aiTriageRequired).toBe(2);
    expect(decisions.enrichment.aiValidationPassed).toBe(1);
    expect(decisions.enrichment.messageCodesMatched).toBe(1);
    expect(decisions.tables.netsAdded).toBe(1);
    expect(decisions.tables.tablesExcluded).toBe(1);
    expect(decisions.weights.detected).toBe(true);
    expect(decisions.errors.recovered).toBe(1);
    expect(decisions.errors.warnings).toBe(3);
    expect(decisions.timing.enrichmentMs).toBe(150);
    expect(decisions.timing.tableGenerationMs).toBe(300);
    expect(decisions.timing.computeMs).toBe(510);
    expect(decisions.studyFlags.hasMaxDiff).toBe(true);
  });

  it('produces a plain-text summary from the decisions object', () => {
    const summary = buildDecisionsSummary({
      enrichment: {
        totalQuestions: 10,
        loopsDetected: 0,
        aiTriageRequired: 0,
        aiValidationPassed: 0,
        messageCodesMatched: 0,
      },
      tables: {
        canonicalTablesPlanned: 20,
        finalTableCount: 18,
        netsAdded: 2,
        tablesExcluded: 4,
      },
      banners: {
        source: 'uploaded',
        bannerGroupCount: 3,
        totalCuts: 6,
        flaggedForReview: 1,
      },
      weights: {
        detected: true,
        variableUsed: 'wt_final',
        candidateCount: 1,
      },
      errors: {
        total: 1,
        recovered: 1,
        warnings: 2,
      },
      timing: {
        enrichmentMs: 100,
        tableGenerationMs: 200,
        computeMs: 300,
        excelMs: 400,
        totalMs: 1500,
      },
      studyFlags: {
        isDemandSurvey: false,
        hasChoiceModelExercise: null,
        hasMaxDiff: false,
      },
    });

    expect(summary).toContain('Processed 10 questions');
    expect(summary).toContain('added 2 NET roll-up tables');
    expect(summary).toContain('Weighting used `wt_final`');
  });

  it('counts loop families and unique message codes conservatively', () => {
    const entries = [
      makeEntry({
        loop: {
          detected: true,
          familyBase: 'A',
          iterationIndex: 1,
          iterationCount: 2,
          siblingFamilyBases: ['A'],
        },
        items: [
          {
            column: 'Q1',
            label: 'Item 1',
            normalizedType: 'single_select',
            itemBase: 10,
            messageCode: 'M1',
            messageText: 'Message 1',
            altCode: null,
            altText: null,
            matchMethod: 'code_extraction',
            matchConfidence: 1,
          },
        ],
      }),
      makeEntry({
        questionId: 'Q2',
        loop: {
          detected: true,
          familyBase: 'A',
          iterationIndex: 2,
          iterationCount: 2,
          siblingFamilyBases: ['A'],
        },
        items: [
          {
            column: 'Q2',
            label: 'Item 2',
            normalizedType: 'single_select',
            itemBase: 10,
            messageCode: 'M1',
            messageText: 'Message 1',
            altCode: null,
            altText: null,
            matchMethod: 'code_extraction',
            matchConfidence: 1,
          },
        ],
      }),
    ];

    expect(countLoopFamilies(entries)).toBe(1);
    expect(countMessageCodesMatched(entries)).toBe(1);
  });
});
