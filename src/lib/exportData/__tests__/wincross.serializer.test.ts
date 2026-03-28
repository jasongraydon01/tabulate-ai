import { describe, expect, it } from 'vitest';
import { buildDefaultWinCrossPreferenceProfile } from '@/lib/exportData/wincross/parser';
import { parseWinCrossPreferenceJob } from '@/lib/exportData/wincross/parser';
import { serializeWinCrossJob } from '@/lib/exportData/wincross/serializer';
import type { WinCrossResolvedArtifacts } from '@/lib/exportData/wincross/types';
import { buildReferenceWinCrossJobBuffer } from './wincross.fixtures';

function createArtifacts(overrides?: {
  tables?: WinCrossResolvedArtifacts['sortedFinal']['tables'];
  bannerCuts?: WinCrossResolvedArtifacts['crosstabRaw']['bannerCuts'];
  loopSummary?: WinCrossResolvedArtifacts['loopSummary'];
}): WinCrossResolvedArtifacts {
  const metadata = {
    manifestVersion: 'phase1.v1',
    generatedAt: '2026-03-19T00:00:00.000Z',
    weighting: { weightVariable: null, mode: 'unweighted' as const },
    sourceSavNames: { uploaded: 'input.sav', runtime: 'dataFile.sav' },
    availableDataFiles: [{
      dataFrameRef: 'wide',
      fileName: 'wide.sav',
      relativePath: 'export/data/wide.sav',
      exists: true,
      r2Key: 'r2/wide',
    }],
    artifactPaths: {
      inputs: {
        sortedFinal: 'tables/13e-table-enriched.json',
        resultsTables: 'results/tables.json',
        crosstabRaw: 'planning/21-crosstab-plan.json',
        loopSummary: 'enrichment/loop-summary.json',
        loopPolicy: 'agents/loop-semantics/loop-semantics-policy.json',
      },
      outputs: {
        metadata: 'export/export-metadata.json',
        tableRouting: 'export/table-routing.json',
        jobRoutingManifest: 'export/job-routing-manifest.json',
        loopPolicy: 'export/loop-semantics-policy.json',
        supportReport: 'export/support-report.json',
      },
    },
    convexRefs: {},
    r2Refs: { finalized: false, artifacts: {}, dataFiles: {} },
    warnings: [],
    idempotency: { integrityDigest: 'digest-1', jobs: {} },
  } as unknown as WinCrossResolvedArtifacts['metadata'];

  return {
    metadata,
    tableRouting: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      totalTables: 2,
      tableToDataFrameRef: { t1: 'wide', t2: 'wide' },
      countsByDataFrameRef: { wide: 2 },
    },
    jobRoutingManifest: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      totalJobs: 1,
      totalTables: 2,
      jobs: [{
        jobId: 'wide.job',
        dataFrameRef: 'wide',
        dataFileRelativePath: 'export/data/wide.sav',
        tableIds: ['t1', 't2'],
      }],
      tableToJobId: { t1: 'wide.job', t2: 'wide.job' },
    },
    loopPolicy: null,
    supportReport: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      manifestVersion: 'phase1.v1',
      expressionSummary: { total: 0, parsed: 0, blocked: 0 },
      expressions: [],
      supportItems: [],
      summary: { q: { supported: 1, warning: 0, blocked: 0 }, wincross: { supported: 1, warning: 0, blocked: 0 } },
    },
    sortedFinal: {
      _metadata: {},
      tables: overrides?.tables ?? [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: 'SEG == 1',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'B', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Question 2',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'B', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    },
    resultsTables: { metadata: {}, tables: {} },
    crosstabRaw: {
      bannerCuts: overrides?.bannerCuts ?? [
        { groupName: 'Demo', columns: [{ name: 'Male', adjusted: 'SEX == 1' }] },
      ],
    },
    loopSummary: overrides?.loopSummary ?? {
      totalLoopGroups: 0,
      totalIterationVars: 0,
      totalBaseVars: 0,
      groups: [],
    },
    r2Keys: {
      metadata: 'r2/meta',
      tableRouting: 'r2/table-routing',
      jobRoutingManifest: 'r2/job-routing',
      loopPolicy: 'r2/loop-policy',
      supportReport: 'r2/support',
      sortedFinal: 'r2/sorted-final',
      resultsTables: 'r2/results',
      crosstabRaw: 'r2/crosstab',
      loopSummary: 'r2/loop-summary',
    },
  };
}

describe('WinCross serializer', () => {
  it('applies richer [PREFERENCES] lines from a parsed reference profile', async () => {
    const hcpBuffer = await Promise.resolve(buildReferenceWinCrossJobBuffer());
    const parsed = parseWinCrossPreferenceJob(hcpBuffer);
    const artifacts = createArtifacts();

    const result = serializeWinCrossJob(artifacts, parsed.profile);

    expect(result.contentUtf8).toContain('250,250,50,100,1,2,3,4,6,13,5,7');
    expect(result.contentUtf8).toContain('Courier New');
    expect(result.contentUtf8).toContain('Mean,Median,Standard Deviation,Standard Error,N,Grouped Median');
    expect(result.contentUtf8).toContain('OS,OR,OV,OI2,O%,SF,RV,ST,S1,P0,V1,SA,SP');
    expect(result.contentUtf8).toContain('Total^TN^1');
  });

  it('emits richer [PREFERENCES] lines from the profile when available', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.preferenceLines = [
      '250,250,50,100,Courier New,11',
      '5TB=Top #N Box,5BB=Bottom #N Box',
      'Mean,Median,Standard Deviation,Standard Error,N,Grouped Median',
      'OS,OR,OV,OI2,O%,SF,RV',
      'Total^TN^1',
    ];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('[PREFERENCES]\r\n250,250,50,100,Courier New,11\r\n5TB=Top #N Box,5BB=Bottom #N Box\r\nMean,Median,Standard Deviation,Standard Error,N,Grouped Median\r\nOS,OR,OV,OI2,O%,SF,RV\r\nTotal^TN^1\r\n');
  });

  it('reconstructs richer fallback [PREFERENCES] lines for legacy profiles without raw preference lines', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.preferenceLines = [];
    profile.numericPreferenceVector = '0,0,0,0,0';
    profile.tokenDictionary = {
      SM: 'Mean',
      SD: 'Median',
      SV: 'StdDev',
      SR: 'StdErr',
      TN: 'Total',
      SB: 'SBase',
    };
    profile.statsDictionary = {
      SM: 'Mean',
      SD: 'Median',
      SV: 'StdDev',
      SR: 'StdErr',
      N: 'N',
    };

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('SM=Mean,SD=Median,SV=StdDev,SR=StdErr,TN=Total,SB=SBase');
    expect(result.contentUtf8).toContain('Mean,Median,StdDev,StdErr,N');
  });

  it('emits WinCross-safe table blocks with indented content and a per-table total row', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          baseText: 'Total respondents',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'B', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('[TABLES]\r\nT1^1\r\n OS,OR,OV,OI2,O%\r\n Q1 - Question 1\r\nSBase: Total respondents\r\n Total^TN^1\r\n A^Q1r1 (1)');
  });

  it('emits semantic total lines for detail, summary, and filtered tables', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'SCALE_FULL',
          questionText: 'Full scale table',
          tableKind: 'scale_overview_full',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S1', label: '1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'S1', label: '7', filterValue: '7', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'RANK_SUMMARY',
          questionText: 'Ranking summary',
          tableKind: 'ranking_overview_rank',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'R1_1', label: 'Message A', filterValue: '1', rowKind: 'rank', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't3',
          questionId: 'FILTERED_SUMMARY',
          questionText: 'Filtered summary',
          tableKind: 'numeric_overview_mean',
          tableType: 'mean_rows',
          additionalFilter: 'SEG == 1',
          rows: [
            { variable: 'N1', label: 'Segment A', filterValue: '', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('SCALE_FULL - Full scale table\r\nSBase: SBase\r\n Total^TN^1');
    expect(result.contentUtf8).toContain('RANK_SUMMARY - Ranking summary\r\nSBase: SBase\r\n Total^TN^0');
    expect(result.contentUtf8).toContain('FILTERED_SUMMARY - Filtered|summary\r\nSBase: SBase\r\n Total^SEG == 1^0');
    expect(result.contentUtf8).toContain('AF=SEG == 1');
  });

  it('appends PO(...) for qualified scale rollups when qualified codes are present', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'SCALE_ROLLUP',
          questionText: 'Top 2 Box summary',
          tableKind: 'scale_overview_rollup_t2b',
          tableType: 'frequency',
          wincrossDenominatorSemantic: 'qualified_respondents',
          wincrossQualifiedCodes: ['1', '2', '3', '4', '5', '6', '7'],
          additionalFilter: '',
          rows: [
            { variable: 'S1_1', label: 'Message A', filterValue: '6,7', rowKind: 'rollup', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' OS,OR,OV,OI2,O%,PO(1-7)');
    expect(result.contentUtf8).toContain(' Total^TN^1');
  });

  it('falls back to the profile default total line for unknown table kinds', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Unknown table kind',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.defaultTotalLine = 'Total^TN^2';

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' Total^TN^2');
  });

  it('serializes long table titles within the WinCross line budget', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'S2',
          questionText: 'ADVERSE EVENTS We are obligated to disclose to the company sponsoring this study any adverse events that are reported about a product they make.',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S2', label: 'Yes', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);
    const titleLine = result.contentUtf8.split('\r\n').find((line) => line.includes('ADVERSE EVENTS'));

    expect(titleLine).toBeDefined();
    expect(titleLine).toContain('ADVERSE EVENTS');
    expect((titleLine?.match(/\|/g) ?? []).length).toBeLessThanOrEqual(3);
    expect(titleLine?.trimStart().length).toBeLessThanOrEqual(1000);
  });

  it('caps serialized table titles at the WinCross 1000-character title limit', () => {
    const longQuestionText = `Question ${'A'.repeat(995)} tail`;
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'S2',
          questionText: longQuestionText,
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S2', label: 'Yes', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);
    const titleLine = result.contentUtf8.split('\r\n').find((line) => line.includes('Question'));

    expect(titleLine).toBeDefined();
    expect(titleLine?.trimStart().length).toBeLessThanOrEqual(1000);
    expect(titleLine).toContain('...');
  });

  it('truncates table titles only after exhausting the four-line WinCross title budget', () => {
    const questionText = `Question ${'A '.repeat(2505)}overflow`;
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'S2',
          questionText,
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S2', label: 'Yes', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);
    const lines = result.contentUtf8.split('\r\n');
    const titleLine = lines.find((line) => line.startsWith(' S2 - Question '));

    expect(titleLine).toBeDefined();
    expect(titleLine?.trimStart().length).toBeLessThanOrEqual(1000);
    expect(titleLine).toContain('...');
  });

  it('keeps the question id while using an extracted ask when question text is not WinCross-safe', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'S2',
          questionText: 'ADVERSE EVENTS We are obligated to disclose to the company sponsoring this study any adverse events that are reported about a product they make. '.repeat(8),
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S2', label: 'Yes', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile, {
      questionTitleHintsById: {
        S2: {
          surveyText: 'S2. **ADVERSE EVENTS**\n\nLong legal text here.\n\nAre you willing to proceed with the screening on this basis?\n\n| 1 | Yes |',
        },
      },
    });
    const titleLine = result.contentUtf8.split('\r\n').find((line) => line.includes('Are you willing'));

    expect(titleLine).toBeDefined();
    expect(titleLine).toContain('S2');
    expect(titleLine).toContain('Are you willing');
    expect(titleLine).not.toContain('We are obligated to disclose');
  });

  it('keeps question id and subtitle ahead of extracted question text when full text would overflow', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'B500',
          questionText: "Please continue to assume Scenario 1 - click here if you would like to re-review details. We'd now like for you to review several different sets of messages for ProductX (PCV20). Please see the first set of messages below. Please now review the next set of messages. Which of the following messages would MOST prompt you to administer ProductX as the primary 4-dose pneumococcal vaccination series to your patients <2 years vs. ProductY (Type B)? Please click on the most motivating message first, for a ranking of 1, the next most motivating message second, etc., for up to 5 most motivating messages.",
          tableSubtitle: 'Ranked 1st Summary - Set 1',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'B500_1r101', label: 'Message A', filterValue: '1', rowKind: 'rank', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);
    const titleLine = result.contentUtf8.split('\r\n').find((line) => line.startsWith(' B500 - Ranked 1st Summary -'));

    expect(titleLine).toBeDefined();
    expect(titleLine).toContain('B500');
    expect(titleLine).toContain('Ranked 1st Summary -');
    expect(titleLine).toContain('Set 1');
    expect(titleLine).toContain('ProductY (Type B)?');
    expect(titleLine).not.toContain('Please continue to assume Scenario 1');
  });

  it('does not collapse ranking tables to subtitle-only titles', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'B500',
          questionText: 'Long ranking prompt that would otherwise be appended to the title for this table.',
          tableSubtitle: 'Ranked 2nd Summary - Set 1',
          analyticalSubtype: 'ranking',
          tableKind: 'ranking_overview_rank',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'B500_1r101', label: 'Message A', filterValue: '2', rowKind: 'rank', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);
    const titleLine = result.contentUtf8.split('\r\n').find((line) => line.startsWith(' B500 -'));

    expect(titleLine).toBeDefined();
    expect(titleLine).toContain('B500');
    expect(titleLine).toContain('Long ranking prompt');
    expect(titleLine).not.toContain('Ranked 2nd Summary - Set 1');
  });

  it('emits counted NET rows instead of explicit NET logic expressions', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1', label: 'Top 2 Box', filterValue: '6,7', rowKind: 'net', isNet: true, netComponents: [], indent: 0 },
            { variable: 'Q1', label: '6', filterValue: '6', rowKind: 'value', isNet: false, netComponents: [], indent: 1 },
            { variable: 'Q1', label: '7', filterValue: '7', rowKind: 'value', isNet: false, netComponents: [], indent: 1 },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.tableStyleHints.netRowSuffixToken = 'SX,GX';

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' Top 2 Box^NET2^SX,GX');
    expect(result.contentUtf8).not.toContain('NET(Q1 (6),Q1 (7))');
  });

  it('keeps indexed net rows on NET while still applying AF=IDX(...)', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Wide question',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1', label: 'Wide Top 2 Box', filterValue: '6,7', rowKind: 'net', isNet: true, netComponents: [], indent: 0 },
            { variable: 'Q1', label: '6', filterValue: '6', rowKind: 'value', isNet: false, netComponents: [], indent: 1 },
            { variable: 'Q1', label: '7', filterValue: '7', rowKind: 'value', isNet: false, netComponents: [], indent: 1 },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2_1',
          questionText: 'Indexed question',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q2_1', label: 'Indexed Top 2 Box', filterValue: '6,7', rowKind: 'net', isNet: true, netComponents: [], indent: 0 },
            { variable: 'Q2_1', label: '6', filterValue: '6', rowKind: 'value', isNet: false, netComponents: [], indent: 1 },
            { variable: 'Q2_1', label: '7', filterValue: '7', rowKind: 'value', isNet: false, netComponents: [], indent: 1 },
          ],
        },
      ],
      loopSummary: {
        totalLoopGroups: 1,
        totalIterationVars: 2,
        totalBaseVars: 1,
        groups: [
          {
            stackedFrameName: 'stacked_loop1',
            skeleton: 'Q2_N',
            iterations: ['1', '2'],
            variableCount: 1,
            variables: [
              {
                baseName: 'Q2',
                label: 'Indexed question',
                iterationColumns: {
                  '1': 'Q2_1',
                  '2': 'Q2_2',
                },
              },
            ],
          },
        ],
      },
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile, {
      tableRouting: {
        generatedAt: '2026-03-23T00:00:00.000Z',
        totalTables: 2,
        tableToDataFrameRef: { t1: 'wide', t2: 'stacked_loop1' },
        countsByDataFrameRef: { wide: 1, stacked_loop1: 1 },
      },
    });

    expect(result.contentUtf8).toContain(' Wide Top 2 Box^NET2^SX');
    expect(result.contentUtf8).toContain(' Indexed Top 2 Box^NET2^SX');
    expect(result.contentUtf8).not.toContain('IDXNET2');
    expect(result.contentUtf8).toContain('AF=IDX(1)');
  });

  it('derives stat ranges from sibling rows for scale tables', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'B100',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'B100', label: 'Top 2 Box', filterValue: '6,7', rowKind: 'net', isNet: true, netComponents: [], indent: 0, excludeFromStats: false },
            { variable: 'B100', label: '6', filterValue: '6', rowKind: 'value', isNet: false, netComponents: [], indent: 1, excludeFromStats: false },
            { variable: 'B100', label: '7', filterValue: '7', rowKind: 'value', isNet: false, netComponents: [], indent: 1, excludeFromStats: false },
            { variable: 'B100', label: 'Middle', filterValue: '3,4,5', rowKind: 'net', isNet: true, netComponents: [], indent: 0, excludeFromStats: false },
            { variable: 'B100', label: '3', filterValue: '3', rowKind: 'value', isNet: false, netComponents: [], indent: 1, excludeFromStats: false },
            { variable: 'B100', label: '4', filterValue: '4', rowKind: 'value', isNet: false, netComponents: [], indent: 1, excludeFromStats: false },
            { variable: 'B100', label: '5', filterValue: '5', rowKind: 'value', isNet: false, netComponents: [], indent: 1, excludeFromStats: false },
            { variable: 'B100', label: 'Bottom 2 Box', filterValue: '1,2', rowKind: 'net', isNet: true, netComponents: [], indent: 0, excludeFromStats: false },
            { variable: 'B100', label: '1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [], indent: 1, excludeFromStats: false },
            { variable: 'B100', label: '2', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [], indent: 1, excludeFromStats: false },
            { variable: 'B100', label: "Don't know", filterValue: '98', rowKind: 'value', isNet: false, netComponents: [], indent: 0, excludeFromStats: true },
            { variable: 'B100', label: 'Mean', filterValue: '', rowKind: 'stat', isNet: false, netComponents: [], indent: 0, statType: 'mean' },
            { variable: 'B100', label: 'Median', filterValue: '', rowKind: 'stat', isNet: false, netComponents: [], indent: 0, statType: 'median' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' Mean^B100 (1-7)^SM');
    expect(result.contentUtf8).toContain(' Median^B100 (1-7)^SD');
    expect(result.contentUtf8).not.toContain('B100^SM');
  });

  it('derives mean-row stat ranges from matching detail tables for the same variable', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 'detail',
          questionId: 'S8',
          questionText: 'Detail table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S8r1', label: '0', filterValue: '0-0', rowKind: 'bin', isNet: false, netComponents: [], indent: 0, excludeFromStats: false, binRange: [0, 0] },
            { variable: 'S8r1', label: '1-10', filterValue: '1-10', rowKind: 'bin', isNet: false, netComponents: [], indent: 0, excludeFromStats: false, binRange: [1, 10] },
            { variable: 'S8r1', label: '91-100', filterValue: '91-100', rowKind: 'bin', isNet: false, netComponents: [], indent: 0, excludeFromStats: false, binRange: [91, 100] },
            { variable: 'S8r1', label: 'Mean', filterValue: '', rowKind: 'stat', isNet: false, netComponents: [], indent: 0, statType: 'mean' },
          ],
        },
        {
          tableId: 'overview',
          questionId: 'S8',
          questionText: 'Overview table',
          tableType: 'mean_rows',
          additionalFilter: '',
          rows: [
            { variable: 'S8r1', label: 'Patient care', filterValue: '', rowKind: 'value', isNet: false, netComponents: [], indent: 0 },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' Patient care^S8r1 (0-100)^SM');
  });

  it('emits ranking not-answered rows using NOT logic with the underlying rank domain', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'B500',
          questionText: 'Ranking table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'B500_1r101', label: 'Ranked 1st', filterValue: '1', rowKind: 'rank', isNet: false, netComponents: [], indent: 0 },
            { variable: 'B500_1r101', label: 'Ranked 2nd', filterValue: '2', rowKind: 'rank', isNet: false, netComponents: [], indent: 0 },
            { variable: 'B500_1r101', label: 'Ranked 3rd', filterValue: '3', rowKind: 'rank', isNet: false, netComponents: [], indent: 0 },
            { variable: 'B500_1r101', label: 'Top 2', filterValue: '1-2', rowKind: 'topk', isNet: false, netComponents: [], indent: 0 },
            { variable: 'B500_1r101', label: 'Not Ranked', filterValue: '', rowKind: 'not_answered', isNet: false, netComponents: [], indent: 0, excludeFromStats: true },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' Not Ranked^NOT B500_1r101 (1-3)^SK');
  });

  it('does not reuse USE= for mean summaries when the underlying variable domains differ', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 'anchor-detail',
          questionId: 'S18',
          questionText: 'Anchor detail',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S18b_Br1', label: '0', filterValue: '0-0', rowKind: 'bin', isNet: false, netComponents: [], indent: 0, binRange: [0, 0] },
            { variable: 'S18b_Br1', label: '100', filterValue: '100-100', rowKind: 'bin', isNet: false, netComponents: [], indent: 0, binRange: [100, 100] },
            { variable: 'S18b_Br1', label: 'Mean', filterValue: '', rowKind: 'stat', isNet: false, netComponents: [], indent: 0, statType: 'mean' },
          ],
        },
        {
          tableId: 'candidate-detail',
          questionId: 'A100',
          questionText: 'Candidate detail',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'A100ar1', label: '1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [], indent: 0 },
            { variable: 'A100ar1', label: '7', filterValue: '7', rowKind: 'value', isNet: false, netComponents: [], indent: 0 },
            { variable: 'A100ar1', label: 'Mean', filterValue: '', rowKind: 'stat', isNet: false, netComponents: [], indent: 0, statType: 'mean' },
          ],
        },
        {
          tableId: 'anchor',
          questionId: 'S18',
          questionText: 'Anchor summary',
          tableType: 'mean_rows',
          additionalFilter: '',
          rows: [
            { variable: 'S18b_Br1', label: 'ProductX', filterValue: '', rowKind: 'value', isNet: false, netComponents: [], indent: 0 },
          ],
        },
        {
          tableId: 'candidate',
          questionId: 'A100',
          questionText: 'Candidate summary',
          tableType: 'mean_rows',
          additionalFilter: '',
          rows: [
            { variable: 'A100ar1', label: 'ProductX', filterValue: '', rowKind: 'value', isNet: false, netComponents: [], indent: 0 },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' ProductX^S18b_Br1 (0-100)^SM');
    expect(result.contentUtf8).toContain(' ProductX^A100ar1 (1-7)^SM');
    expect(result.contentUtf8).not.toContain('USE=3,S18b_Br1=A100ar1');
  });

  it('falls back to 0-100 for allocation grid mean rows when no detail table exists', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'D300a',
          questionText: 'Allocation grid summary',
          tableType: 'mean_rows',
          additionalFilter: '',
          rows: [
            { variable: 'D300ar1c1', label: 'ProductX (PCV20)', filterValue: '', rowKind: 'value', isNet: false, netComponents: [], indent: 0 },
            { variable: 'D300ar2c1', label: 'ProductY (Type B)', filterValue: '', rowKind: 'value', isNet: false, netComponents: [], indent: 0 },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(' ProductX (PCV20)^D300ar1c1 (0-100)^SM');
    expect(result.contentUtf8).toContain(' ProductY (Type B)^D300ar2c1 (0-100)^SM');
  });

  it('builds banner from crosstabRaw.bannerCuts, not profile passthrough', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Demographics',
          columns: [
            { name: 'Male', adjusted: 'SEX == 1' },
            { name: 'Female', adjusted: 'SEX == 2' },
          ],
        },
        {
          groupName: 'Region',
          columns: [
            { name: 'East', adjusted: 'REGION == 1' },
            { name: 'West', adjusted: 'REGION == 2' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    // Even if profile has bannerLines, they should NOT be used
    profile.bannerLines = ['*OldBanner', 'ShouldNotAppear'];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('*Banner1');
    expect(result.contentUtf8).toContain(' SL:A,B,C,D,E');
    expect(result.contentUtf8).toContain('TN');
    expect(result.contentUtf8).toContain('SEX (1)');
    expect(result.contentUtf8).toContain('SEX (2)');
    expect(result.contentUtf8).toContain('REGION (1)');
    expect(result.contentUtf8).toContain('REGION (2)');
    expect(result.contentUtf8).not.toContain('OldBanner');
    expect(result.contentUtf8).not.toContain('ShouldNotAppear');
  });

  it('applies portable banner layout directives while keeping run banner members', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Specialty',
          columns: [
            { name: 'Cards', adjusted: 'S2 == 1' },
            { name: 'PCPs', adjusted: 'S2 == 2' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerLayoutLines = [
      '*Banner1',
      ' ID:1',
      ' SW:1,15,1,15',
      ' HP:1,1',
      ' PT:2,1',
    ];
    profile.bannerLines = [
      ' TN^W70',
      ' S5 (1)^W70',
      ' S5 (3)^W70',
    ];
    profile.bannerDisplayLines = [
      '  ............... ............... ...............',
      '                    Specialty',
      '  ............... ............... ...............',
      '  Total           Cards           PCPs',
    ];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('[BANNERS]\r\n*Banner1\r\n ID:1\r\n SW:1,15,1,15,1,15\r\n HP:1,1,1\r\n CP:0,0\r\n SL:A,B,C\r\n ST:1,2\r\n WT:\r\n OP:1,SB,FL,HD,W200\r\n BT:\r\n BF:\r\n XL:\r\n PT:3,1\r\n TN^W70\r\n');
    expect(result.contentUtf8).toContain('S2 (1)^W70');
    expect(result.contentUtf8).toContain('S2 (2)^W70');
    expect(result.contentUtf8).toContain('  ............... ............... ...............');
    expect(result.contentUtf8).toContain('  Total           Cards           PCPs');
    expect(result.applicationDiagnostics.banner.templateKind).toBe('separator_group_separator_columns');
    expect(result.applicationDiagnostics.banner.status).toBe('applied');
    expect(result.contentUtf8).not.toContain(' PT:2,1');
    expect(result.contentUtf8).not.toContain('S5 (1)^W70');
    expect(result.contentUtf8).not.toContain('S5 (3)^W70');
  });

  it('uses banner layout directives from a parsed reference profile without leaking source banner members', async () => {
    const hcpBuffer = await Promise.resolve(buildReferenceWinCrossJobBuffer());
    const parsed = parseWinCrossPreferenceJob(hcpBuffer);
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Demo',
          columns: [{ name: 'Male', adjusted: 'SEX == 1' }],
        },
      ],
    });

    const result = serializeWinCrossJob(artifacts, parsed.profile);

    expect(result.contentUtf8).toContain('*Banner1');
    expect(result.contentUtf8).toContain('SW:1,15,1,15');
    expect(result.contentUtf8).toContain('HP:1,1');
    expect(result.contentUtf8).toContain('SL:A,B');
    expect(result.contentUtf8).toContain('PT:2,1');
    expect(result.contentUtf8).toContain(' TN^W70');
    expect(result.contentUtf8).toContain('SEX (1)^W70');
    expect(result.contentUtf8).toContain('  Total           Male');
    expect(result.applicationDiagnostics.banner.templateKind).toBe('separator_group_separator_columns');
    expect(result.contentUtf8).not.toContain('S5 (1)^W70');
    expect(result.contentUtf8).not.toContain('Primary Care');
  });

  it('generates banner display rows from current run labels without leaking source display text', async () => {
    const hcpBuffer = await Promise.resolve(buildReferenceWinCrossJobBuffer());
    const parsed = parseWinCrossPreferenceJob(hcpBuffer);
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            { name: 'Segment One', adjusted: 'SEG == 1' },
            { name: 'Segment Two', adjusted: 'SEG == 2' },
          ],
        },
      ],
    });

    const result = serializeWinCrossJob(artifacts, parsed.profile);

    expect(result.contentUtf8).toContain('SEG (1)^W70');
    expect(result.contentUtf8).toContain('SEG (2)^W70');
    expect(result.contentUtf8).toContain('  Total           Segment One     Segment Two');
    expect(result.applicationDiagnostics.banner.status).toBe('applied');
    expect(result.applicationDiagnostics.banner.notes).toContain('Source display text was not replayed verbatim.');
    expect(result.contentUtf8).not.toContain('Primary Care    Pediatrician');
    expect(result.contentUtf8).not.toContain('Specialty                      Private vs. Public');
  });

  it('supports columns-only banner display templates', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            { name: 'Alpha', adjusted: 'SEG == 1' },
            { name: 'Beta', adjusted: 'SEG == 2' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerDisplayLines = ['  Total           Alpha           Beta'];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('  Total           Alpha           Beta');
    expect(result.applicationDiagnostics.banner.templateKind).toBe('columns_only');
    expect(result.applicationDiagnostics.banner.generatedDisplayLineCount).toBe(1);
  });

  it('supports separator-plus-columns banner display templates', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            { name: 'Alpha', adjusted: 'SEG == 1' },
            { name: 'Beta', adjusted: 'SEG == 2' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerDisplayLines = [
      '  ............... ............... ...............',
      '  Total           Alpha           Beta',
    ];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('  ............... ............... ...............');
    expect(result.contentUtf8).toContain('  Total           Alpha           Beta');
    expect(result.applicationDiagnostics.banner.templateKind).toBe('separator_plus_columns');
  });

  it('uses a grouped separator row for separator-group-separator banner templates', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Group One',
          columns: [
            { name: 'Alpha', adjusted: 'SEG == 1' },
            { name: 'Beta', adjusted: 'SEG == 2' },
          ],
        },
        {
          groupName: 'Group Two',
          columns: [
            { name: 'Gamma', adjusted: 'SEG == 3' },
            { name: 'Delta', adjusted: 'SEG == 4' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerDisplayLines = [
      '  ............... ............................... ...............................',
      '                    Group One                      Group Two',
      '  ............... ............... ............... ............... ...............',
      '  Total           Alpha           Beta            Gamma           Delta',
    ];

    const result = serializeWinCrossJob(artifacts, profile);
    const lines = result.contentUtf8.split('\r\n');
    const separatorLines = lines.filter((line) => line.trim().startsWith('...............'));
    const [firstSeparator = '', secondSeparator = ''] = separatorLines;

    expect(firstSeparator).toContain('...............................');
    expect(secondSeparator).toContain('............... ...............');
    expect(firstSeparator).not.toBe(secondSeparator);
  });

  it('supports group-plus-columns banner display templates', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            { name: 'Alpha', adjusted: 'SEG == 1' },
            { name: 'Longer Beta Label', adjusted: 'SEG == 2' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerDisplayLines = [
      '                    Audience',
      '  ............... ............... ...............',
      '  Total           Alpha           Beta',
    ];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('Audience');
    expect(result.contentUtf8).toContain('Longer Beta');
    expect(result.contentUtf8).toContain('Label');
    expect(result.applicationDiagnostics.banner.templateKind).toBe('group_plus_columns');
  });

  it('derives ST comparison groups from current run banner group boundaries', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Group 1',
          columns: [
            { name: 'A', adjusted: 'A == 1' },
            { name: 'B', adjusted: 'A == 2' },
          ],
        },
        {
          groupName: 'Group 2',
          columns: [
            { name: 'C', adjusted: 'B == 1' },
            { name: 'D', adjusted: 'B == 2' },
            { name: 'E', adjusted: 'B == 3' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerLayoutLines = [
      '*Banner1',
      ' ST:1,2/3,4^MW,034^PW,034',
    ];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('SL:A,B,C,D,E,F');
    expect(result.contentUtf8).toContain('ST:1,2/3,4,5^MW,034^PW,034');
    expect(result.contentUtf8).toContain('PT:6,1');
  });

  it('translates banner cut expressions into WinCross banner logic', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Usage',
          columns: [
            { name: 'Any', adjusted: '(S10 == 1 | S11 == 1)' },
            { name: 'Not Any', adjusted: '!(S10 == 1 | S11 == 1)' },
            { name: 'Decision Maker', adjusted: 'S16 %in% c(1,2,3)' },
            { name: 'Non-User', adjusted: 'H_BRAND_USEr1 == 0' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerMemberLines = [' TN^W70', ' S5 (1)^W70'];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('S10 (1) OR S11 (1)^W70');
    expect(result.contentUtf8).toContain('?{S10 (1) OR S11 (1)}^W70');
    expect(result.contentUtf8).toContain('S16 (1-3)^W70');
    expect(result.contentUtf8).toContain('?H_BRAND_USEr1 (1)^W70');
  });

  it('falls back when source banner display layout is too specific to remap safely', () => {
    const artifacts = createArtifacts({
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            { name: 'Alpha', adjusted: 'SEG == 1' },
            { name: 'Beta', adjusted: 'SEG == 2' },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.bannerDisplayLines = [
      '  ............... ............... ...............',
      '  Group Row One',
      '  Group Row Two',
      '  ............... ............... ...............',
      '  Total           Alpha           Beta',
    ];

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.warnings).toContain('Banner display rows were not remapped because the uploaded layout was too source-specific to map safely.');
    expect(result.applicationDiagnostics.banner.templateKind).toBe('unsupported');
    expect(result.applicationDiagnostics.banner.status).toBe('degraded');
    expect(result.contentUtf8).not.toContain('  Total           Alpha           Beta');
    expect(result.contentUtf8).not.toContain('  ............... ............... ...............');
  });

  it('emits INDEX glossary lines and IDX-gated stacked tables for multi-frame artifacts', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Wide question',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [{ variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] }],
        },
        {
          tableId: 't2',
          questionId: 'Q2_1',
          questionText: 'Stacked question',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [{ variable: 'Q2_1', label: 'B', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] }],
        },
      ],
      loopSummary: {
        totalLoopGroups: 1,
        totalIterationVars: 2,
        totalBaseVars: 1,
        groups: [
          {
            stackedFrameName: 'stacked_loop1',
            skeleton: 'Q2_N',
            iterations: ['1', '2'],
            variableCount: 1,
            variables: [
              {
                baseName: 'Q2',
                label: 'Stacked question',
                iterationColumns: {
                  '1': 'Q2_1',
                  '2': 'Q2_2',
                },
              },
            ],
          },
        ],
      },
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile, {
      tableRouting: {
        generatedAt: '2026-03-19T00:00:00.000Z',
        totalTables: 2,
        tableToDataFrameRef: { t1: 'wide', t2: 'stacked_loop1' },
        countsByDataFrameRef: { wide: 1, stacked_loop1: 1 },
      },
    });

    expect(result.contentUtf8).toContain('[GLOSSARY]\r\n INDEX {Q2_1}\r\n INDEX {Q2_2}\r\n');
    expect(result.contentUtf8).toContain(' B^I1 (1)');
    expect(result.contentUtf8).toContain('AF=IDX(1)');
    expect(result.contentUtf8).not.toContain('DATA=');
  });

  it('omits DATA= for wide-only runs', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile, {
      tableRouting: {
        generatedAt: '2026-03-19T00:00:00.000Z',
        totalTables: 2,
        tableToDataFrameRef: { t1: 'wide', t2: 'wide' },
        countsByDataFrameRef: { wide: 2 },
      },
    });

    expect(result.contentUtf8).not.toContain('DATA=');
  });

  it('produces UTF-16LE BOM output (0xFF 0xFE prefix)', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.content).toBeInstanceOf(Buffer);
    expect(result.content[0]).toBe(0xFF);
    expect(result.content[1]).toBe(0xFE);
    expect(result.content.length).toBeGreaterThan(2);
  });

  it('uses CRLF line endings in UTF-8 representation', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    // Every line should end with \r\n
    expect(result.contentUtf8).toContain('\r\n');
    // No bare \n without \r
    const withoutCrlf = result.contentUtf8.replace(/\r\n/g, '');
    expect(withoutCrlf).not.toContain('\n');
  });

  it('produces deterministic output (same inputs → byte-identical Buffer)', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();

    const first = serializeWinCrossJob(artifacts, profile);
    const second = serializeWinCrossJob(artifacts, profile);

    expect(first.content.equals(second.content)).toBe(true);
    expect(first.contentUtf8).toBe(second.contentUtf8);
    expect(first.tableCount).toBe(second.tableCount);
    expect(first.useCount).toBe(second.useCount);
    expect(first.afCount).toBe(second.afCount);
  });

  it('degrades to basic (not blocked) for table with unknown rows', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question with empty variable',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: '', label: 'Label Only', filterValue: '', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.tableStatuses).toHaveLength(1);
    expect(result.tableStatuses[0].semanticExportStatus).toBe('exported');
    expect(result.tableStatuses[0].styleParityStatus).toBe('basic');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('without variable');
  });

  it('USE= conservatism: different frames do not share USE=', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Question 2',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    // Same rows but different frames — should NOT share USE=
    const result = serializeWinCrossJob(artifacts, profile, {
      tableRouting: {
        generatedAt: '2026-03-19T00:00:00.000Z',
        totalTables: 2,
        tableToDataFrameRef: { t1: 'wide', t2: 'stacked_loop1' },
        countsByDataFrameRef: { wide: 1, stacked_loop1: 1 },
      },
    });

    expect(result.useCount).toBe(0);
    expect(result.tableStatuses.every((s) => !s.usedUse)).toBe(true);
  });

  it('groups multi-frame output by routed frame order, not input order', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't2',
          questionId: 'Q2_1',
          questionText: 'Stacked first in input',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [{ variable: 'Q2_1', label: 'B', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] }],
        },
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Wide second in input',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [{ variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] }],
        },
      ],
      loopSummary: {
        totalLoopGroups: 1,
        totalIterationVars: 2,
        totalBaseVars: 1,
        groups: [
          {
            stackedFrameName: 'stacked_loop1',
            skeleton: 'Q2_N',
            iterations: ['1', '2'],
            variableCount: 1,
            variables: [
              {
                baseName: 'Q2',
                label: 'Stacked first in input',
                iterationColumns: {
                  '1': 'Q2_1',
                  '2': 'Q2_2',
                },
              },
            ],
          },
        ],
      },
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile, {
      tableRouting: {
        generatedAt: '2026-03-19T00:00:00.000Z',
        totalTables: 2,
        tableToDataFrameRef: { t1: 'wide', t2: 'stacked_loop1' },
        countsByDataFrameRef: { wide: 1, stacked_loop1: 1 },
      },
      jobRouting: {
        generatedAt: '2026-03-19T00:00:00.000Z',
        totalJobs: 2,
        totalTables: 2,
        jobs: [
          {
            jobId: 'stacked.job',
            dataFrameRef: 'stacked_loop1',
            dataFileRelativePath: 'export/data/stacked_loop1.sav',
            tableIds: ['t2'],
          },
          {
            jobId: 'wide.job',
            dataFrameRef: 'wide',
            dataFileRelativePath: 'export/data/wide.sav',
            tableIds: ['t1'],
          },
        ],
        tableToJobId: { t1: 'wide.job', t2: 'stacked.job' },
      },
    });

    expect(result.contentUtf8.indexOf('Wide second in input')).toBeLessThan(result.contentUtf8.indexOf('Stacked first in input'));
    expect(result.contentUtf8.indexOf('AF=IDX(1)')).toBeGreaterThan(-1);
  });

  it('tracks per-table status correctly', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.tableStatuses).toHaveLength(2);
    expect(result.applicationDiagnostics.tables).toHaveLength(2);
    for (const status of result.tableStatuses) {
      expect(status.semanticExportStatus).toBe('exported');
      expect(status.dataFrameRef).toBe('wide');
      expect(typeof status.ordinal).toBe('number');
    }
    // First table has AF, second doesn't
    expect(result.tableStatuses[0].usedAf).toBe(true);
    expect(result.tableStatuses[1].usedAf).toBe(false);
    expect(result.tableStatuses[0].styleParityStatus).toBe('basic');
    expect(result.tableStatuses[1].styleParityStatus).toBe('basic');
    expect(result.applicationDiagnostics.tables[0]?.displayTemplateKind).toBe('plain_rows');
  });

  it('builds SBase from structural disclosure with compact note text', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: '',
          baseText: 'Those who were shown Q1',
          userNote: 'Base varies by item (n=120-150); Excludes non-substantive responses',
          basePolicy: 'question_base_shared',
          baseViewRole: 'anchor',
          plannerBaseComparability: 'varying_but_acceptable',
          plannerBaseSignals: ['varying-item-bases', 'rebased-base'],
          computeRiskSignals: ['row-base-varies-within-anchor-view'],
          baseContract: {
            classification: {
              referenceUniverse: 'question',
            },
            policy: {
              effectiveBaseMode: 'table_mask_then_row_observed_n',
              rebasePolicy: 'exclude_non_substantive_tail',
            },
          },
          baseDisclosure: {
            referenceBaseN: 150,
            itemBaseRange: [120, 150],
            defaultBaseText: 'Those who were shown Q1',
            defaultNoteTokens: ['anchor-base-varies-by-item', 'anchor-base-range', 'rebased-exclusion'],
            rangeDisclosure: { min: 120, max: 150 },
            source: 'contract',
          },
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain(
      'SBase: Those who were shown Q1; Base varies by item (n=120-150); Rebased to exclude non-substantive responses',
    );
  });

  it('marks parity only when reuse is actually proven via USE=', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [{ variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] }],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Question 2',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [{ variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] }],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.useCount).toBe(1);
    expect(result.contentUtf8).toContain('USE=1');
    expect(result.contentUtf8).not.toContain('USE=T1^1');
    expect(result.tableStatuses[0].styleParityStatus).toBe('basic');
    expect(result.tableStatuses[1].styleParityStatus).toBe('parity');
  });

  it('emits USE= with variable substitutions when row structure matches but variables differ', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S8r1', label: '0%', filterValue: '0', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'S8r1', label: '1 to 10%', filterValue: '1-10', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'S8r1', label: 'Mean', rowKind: 'stat', statType: 'mean', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Question 2',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S8r2', label: '0%', filterValue: '0', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'S8r2', label: '1 to 10%', filterValue: '1-10', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'S8r2', label: 'Mean', rowKind: 'stat', statType: 'mean', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.useCount).toBe(1);
    expect(result.contentUtf8).toContain('USE=1,S8r1=S8r2');
    expect(result.tableStatuses[1].styleParityStatus).toBe('parity');
    expect(result.applicationDiagnostics.tables[1]?.useStrategy).toBe('substitution_reuse');
  });

  it('emits stat rows with variable references when available', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Numeric summary',
          tableType: 'mean_rows',
          additionalFilter: '',
          rows: [
            { variable: 'S8r1', label: 'Patient care', rowKind: 'stat', statType: 'mean', filterValue: '0-100', isNet: false, netComponents: [] },
            { variable: 'S8r2', label: 'Teaching/academia', rowKind: 'stat', statType: 'mean', filterValue: '0-100', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('Patient care^S8r1 (0-100)^SM');
    expect(result.contentUtf8).toContain('Teaching/academia^S8r2 (0-100)^SM');
    expect(result.applicationDiagnostics.tables[0]?.templateKind).toBe('stat_rows_only_multi_variable');
  });

  it('emits native AF= for single-variable stat-only tables', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'How long have you been working in your specialty?',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S7', label: 'Mean', rowKind: 'stat', statType: 'mean', filterValue: '0-999', isNet: false, netComponents: [] },
            { variable: 'S7', label: 'Median', rowKind: 'stat', statType: 'median', filterValue: '0-999', isNet: false, netComponents: [] },
            { variable: 'S7', label: 'Std Dev', rowKind: 'stat', statType: 'stddev', filterValue: '0-999', isNet: false, netComponents: [] },
            { variable: 'S7', label: 'Std Err', rowKind: 'stat', statType: 'stderr', filterValue: '0-999', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.afCount).toBe(1);
    expect(result.tableStatuses[0].usedAf).toBe(true);
    expect(result.contentUtf8).toContain('AF=S7^  ^OA');
    expect(result.contentUtf8).toContain('Mean^S7 (0-999)^SM');
    expect(result.contentUtf8).toContain('Median^S7 (0-999)^SD');
    expect(result.contentUtf8).toContain('Std Dev^S7 (0-999)^SV');
    expect(result.contentUtf8).toContain('Std Err^S7 (0-999)^SR');
    expect(result.applicationDiagnostics.tables[0]?.templateKind).toBe('stat_rows_only_single_variable');
    expect(result.applicationDiagnostics.tables[0]?.afStrategy).toBe('native_single_variable_stat');
  });

  it('derives missing stat labels from portable stat vocabulary', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Numeric summary',
          tableType: 'mean_rows',
          additionalFilter: '',
          rows: [
            { variable: 'S7', label: '', rowKind: 'stat', statType: 'mean', filterValue: '0-999', isNet: false, netComponents: [] },
            { variable: 'S7', rowKind: 'stat', statType: 'stderr', filterValue: '0-999', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    profile.statsDictionary = {
      SM: 'Average',
      SR: 'Standard Error',
    };

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('Average^S7 (0-999)^SM');
    expect(result.contentUtf8).toContain('Standard Error^S7 (0-999)^SR');
    expect(result.applicationDiagnostics.tables[0]?.notes).toContain('Derived missing stat label as "Average".');
  });

  it('applies shallow source table alignment hints without replaying source table text', () => {
    const inlineJob = [
      '[VERSION]',
      '25.0',
      '',
      '[PREFERENCES]',
      '0,0,0,0,0',
      'OS,OR,OV,OI2,O%',
      'Total^TN^1',
      '',
      '[TABLES]',
      'T1^1',
      ' OS,OR,OV,OI2,O%',
      ' Demo table',
      'SBase: Total',
      ' Short^            Q1r1 (1)',
      ' Longer label^     Q1r2 (2)',
      '',
      'T2^2',
      ' OS,OR,OV,OI2,O%',
      ' Demo stats',
      'SBase: Total',
      ' Mean          ^S7 (0-999)^SM',
      ' Median        ^S7 (0-999)^SD',
      '',
      '[BANNERS]',
      '*Banner1',
      'TN',
      '',
      '[TITLE]',
      'Demo',
    ].join('\r\n');
    const parsed = parseWinCrossPreferenceJob(inlineJob);
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Aligned value table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'Alpha', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Beta', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Aligned stat table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S7', label: 'Mean', rowKind: 'stat', statType: 'mean', filterValue: '0-999', isNet: false, netComponents: [] },
            { variable: 'S7', label: 'Median', rowKind: 'stat', statType: 'median', filterValue: '0-999', isNet: false, netComponents: [] },
          ],
        },
      ],
    });

    const result = serializeWinCrossJob(artifacts, parsed.profile);

    expect(result.contentUtf8).toMatch(/Alpha\^\s{2,}Q1r1 \(1\)/);
    expect(result.contentUtf8).toMatch(/Mean\s{2,}\^S7 \(0-999\)\^SM/);
    expect(result.applicationDiagnostics.tables[0]?.appliedStyleHints).toContainEqual(expect.stringContaining('value-row reference column'));
    expect(result.applicationDiagnostics.tables[1]?.appliedStyleHints).toContainEqual(expect.stringContaining('single-variable stat label caret column'));
    expect(result.contentUtf8).not.toContain('Longer label');
  });

  it('aligns value references to the longest current-run label when source alignment hints are present', () => {
    const inlineJob = [
      '[VERSION]',
      '25.0',
      '',
      '[PREFERENCES]',
      '0,0,0,0,0',
      'OS,OR,OV,OI2,O%',
      'Total^TN^1',
      '',
      '[TABLES]',
      'T1^1',
      ' OS,OR,OV,OI2,O%',
      ' Demo table',
      'SBase: Total',
      ' Short^            Q1r1 (1)',
      ' Much longer label^ Q1r2 (2)',
      '',
      '[BANNERS]',
      '*Banner1',
      ' TN',
      '',
      '[TITLE]',
      'Demo',
    ].join('\r\n');
    const parsed = parseWinCrossPreferenceJob(inlineJob);
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Aligned value table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Much longer current label', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });

    const result = serializeWinCrossJob(artifacts, parsed.profile);
    const lines = result.contentUtf8.split('\r\n');
    const shortLine = lines.find((line) => line.includes(' A^')) ?? '';
    const longLine = lines.find((line) => line.includes(' Much longer current label^')) ?? '';
    const shortRefIndex = shortLine.indexOf('Q1r1 (1)');
    const longRefIndex = longLine.indexOf('Q1r2 (2)');

    expect(shortRefIndex).toBeGreaterThan(0);
    expect(longRefIndex).toBeGreaterThan(0);
    expect(shortRefIndex).toBe(longRefIndex);
  });

  it('applies current-run row indentation as a conservative table display convention', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Indented table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'Top line', filterValue: '1', rowKind: 'value', indent: 0, isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Nested line', filterValue: '2', rowKind: 'value', indent: 1, isNet: false, netComponents: [] },
            { variable: 'Q1r3', label: 'Deep line', filterValue: '3', rowKind: 'value', indent: 2, isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('Top line^Q1r1 (1)');
    expect(result.contentUtf8).toContain('  Nested line^Q1r2 (2)');
    expect(result.contentUtf8).toContain('    Deep line^Q1r3 (3)');
    expect(result.applicationDiagnostics.tables[0]?.templateKind).toBe('value_rows_only');
    expect(result.applicationDiagnostics.tables[0]?.displayTemplateKind).toBe('indented_rows');
    expect(result.applicationDiagnostics.tables[0]?.indentedBodyRowCount).toBe(2);
  });

  it('synthesizes current-run table header rows without replaying source table bodies', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Header table',
          tableType: 'frequency',
          additionalFilter: '',
          headerRows: [
            { rowIndex: 0, label: 'Section A', filterValue: '_HEADER_', indent: 0 },
            { rowIndex: 2, label: 'Section B', filterValue: '_HEADER_', indent: 1 },
          ],
          rows: [
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Option 2', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r3', label: 'Option 3', filterValue: '3', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    const sectionAIndex = result.contentUtf8.indexOf('Section A^');
    const option1Index = result.contentUtf8.indexOf('Option 1^Q1r1 (1)');
    const sectionBIndex = result.contentUtf8.indexOf('  Section B^');
    const option3Index = result.contentUtf8.indexOf('Option 3^Q1r3 (3)');

    expect(sectionAIndex).toBeGreaterThan(-1);
    expect(option1Index).toBeGreaterThan(sectionAIndex);
    expect(sectionBIndex).toBeGreaterThan(option1Index);
    expect(option3Index).toBeGreaterThan(sectionBIndex);
    expect(result.applicationDiagnostics.tables[0]?.notes).toContain('Applied 2 current-run table header row(s).');
    expect(result.applicationDiagnostics.tables[0]?.displayTemplateKind).toBe('sectioned_header_rows');
    expect(result.applicationDiagnostics.tables[0]?.headerRowCount).toBe(2);
  });

  it('derives table header rows from current-run _CAT_ rows and omits them from normal row emission', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Derived header table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: '_CAT_', label: 'Section A', filterValue: '_HEADER_', rowKind: 'value', indent: 0, isNet: false, netComponents: [] },
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: '_CAT_', label: 'Section B', filterValue: '_HEADER_', rowKind: 'value', indent: 1, isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Option 2', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toContain('Section A^');
    expect(result.contentUtf8).toContain('  Section B^');
    expect(result.contentUtf8).not.toContain('Section A^_CAT_');
    expect(result.contentUtf8).not.toContain('Section B^_CAT_');
    expect(result.applicationDiagnostics.tables[0]?.notes).toContain('Applied 2 current-run table header row(s).');
    expect(result.applicationDiagnostics.tables[0]?.displayTemplateKind).toBe('sectioned_header_rows');
  });

  it('classifies leading current-run table header rows explicitly', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Leading header table',
          tableType: 'frequency',
          additionalFilter: '',
          headerRows: [
            { rowIndex: 0, label: 'Section A', filterValue: '_HEADER_', indent: 0 },
          ],
          rows: [
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Option 2', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.applicationDiagnostics.tables[0]?.displayTemplateKind).toBe('leading_header_rows');
    expect(result.applicationDiagnostics.tables[0]?.headerRowCount).toBe(1);
  });

  it('records applied and skipped source header-row style hints conservatively', () => {
    const inlineJob = [
      '[VERSION]',
      '25.0',
      '',
      '[PREFERENCES]',
      '0,0,0,0,0',
      'OS,OR,OV,OI2,O%',
      'Total^TN^1',
      '',
      '[TABLES]',
      'T1^1',
      ' OS,OR,OV,OI2,O%',
      ' Demo table',
      'SBase: Total',
      'Section A^',
      ' Item 1^             Q1r1 (1)',
      'Section B^',
      ' Item 2^             Q1r2 (2)',
      '',
      '[BANNERS]',
      '*Banner1',
      'TN',
      '',
      '[TITLE]',
      'Demo',
    ].join('\r\n');
    const parsed = parseWinCrossPreferenceJob(inlineJob);
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Sectioned table',
          tableType: 'frequency',
          additionalFilter: '',
          headerRows: [
            { rowIndex: 0, label: 'Section A', filterValue: '_HEADER_', indent: 0 },
            { rowIndex: 1, label: 'Section B', filterValue: '_HEADER_', indent: 0 },
          ],
          rows: [
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Option 2', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'No headers table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q2r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });

    const result = serializeWinCrossJob(artifacts, parsed.profile);

    expect(result.applicationDiagnostics.tables[0]?.appliedStyleHints).toContain('sectioned label-only header-row placement');
    expect(result.applicationDiagnostics.tables[1]?.skippedStyleHints).toContain('source header-row placement was available but the current-run table had no header rows');
  });

  it('applies shallow source header leading-space hints to current-run label-only headers', () => {
    const inlineJob = [
      '[VERSION]',
      '25.0',
      '',
      '[PREFERENCES]',
      '0,0,0,0,0',
      'OS,OR,OV,OI2,O%',
      'Total^TN^1',
      '',
      '[TABLES]',
      'T1^1',
      ' OS,OR,OV,OI2,O%',
      ' Demo table',
      'SBase: Total',
      '   Section A^',
      ' Item 1^             Q1r1 (1)',
      '   Section B^',
      ' Item 2^             Q1r2 (2)',
      '',
      '[BANNERS]',
      '*Banner1',
      'TN',
      '',
      '[TITLE]',
      'Demo',
    ].join('\r\n');
    const parsed = parseWinCrossPreferenceJob(inlineJob);
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Sectioned table',
          tableType: 'frequency',
          additionalFilter: '',
          headerRows: [
            { rowIndex: 0, label: 'Section A', filterValue: '_HEADER_', indent: 0 },
            { rowIndex: 1, label: 'Section B', filterValue: '_HEADER_', indent: 0 },
          ],
          rows: [
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Option 2', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });

    const result = serializeWinCrossJob(artifacts, parsed.profile);

    expect(result.contentUtf8).toContain('   Section A^');
    expect(result.applicationDiagnostics.tables[0]?.appliedStyleHints).toContain('header leading spaces 3');
  });

  it('applies shallow source net-row suffix hints to current-run net rows', () => {
    const inlineJob = [
      '[VERSION]',
      '25.0',
      '',
      '[PREFERENCES]',
      '0,0,0,0,0',
      'OS,OR,OV,OI2,O%',
      'Total^TN^1',
      '',
      '[TABLES]',
      'T1^1',
      ' OS,OR,OV,OI2,O%',
      ' Demo table',
      'SBase: Total',
      ' Net^NET(Q1r1,Q1r2)^SY',
      ' Item 1^             Q1r1 (1)',
      '',
      '[BANNERS]',
      '*Banner1',
      'TN',
      '',
      '[TITLE]',
      'Demo',
    ].join('\r\n');
    const parsed = parseWinCrossPreferenceJob(inlineJob);
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Net table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'NET1', label: 'Net', filterValue: '', rowKind: 'value', isNet: true, netComponents: ['Q1r1', 'Q1r2'] },
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Option 2', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });

    const result = serializeWinCrossJob(artifacts, parsed.profile);

    expect(result.contentUtf8).toMatch(/Net\^\s+NET2\^SY/);
    expect(result.applicationDiagnostics.tables[0]?.appliedStyleHints).toContain('net-row suffix token SY');
  });

  it('synthesizes NET members from variable and filterValue when netComponents are absent', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'S5',
          questionText: 'Provider type summary',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'S5', label: 'Physicians (NET)', filterValue: '1,2,3', rowKind: 'net', isNet: true, netComponents: [] },
            { variable: 'S5', label: 'Primary Care Physician', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [], indent: 1 },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.contentUtf8).toMatch(/Physicians \(NET\)\^\s*NET3\^SX/);
  });

  it('does not reuse USE= when table header rows differ', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Header table A',
          tableType: 'frequency',
          additionalFilter: '',
          headerRows: [
            { rowIndex: 0, label: 'Section A', filterValue: '_HEADER_', indent: 0 },
          ],
          rows: [
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Header table B',
          tableType: 'frequency',
          additionalFilter: '',
          headerRows: [
            { rowIndex: 0, label: 'Different Header', filterValue: '_HEADER_', indent: 0 },
          ],
          rows: [
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.useCount).toBe(0);
    expect(result.applicationDiagnostics.tables[0]?.useStrategy).toBe('none');
    expect(result.applicationDiagnostics.tables[1]?.useStrategy).toBe('none');
    expect(result.contentUtf8).not.toContain('USE=1');
  });

  it('does not reuse USE= when derived _CAT_ header structure differs', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Header table A',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: '_CAT_', label: 'Section A', filterValue: '_HEADER_', rowKind: 'value', indent: 0, isNet: false, netComponents: [] },
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Header table B',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: '_CAT_', label: 'Different Header', filterValue: '_HEADER_', rowKind: 'value', indent: 0, isNet: false, netComponents: [] },
            { variable: 'Q1r1', label: 'Option 1', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.useCount).toBe(0);
    expect(result.contentUtf8).not.toContain('USE=1');
  });

  it('does not reuse USE= when current-run row display labels differ', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Display table A',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'Alpha', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'Beta', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Display table B',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'North', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'South', filterValue: '2', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();

    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.useCount).toBe(0);
    expect(result.applicationDiagnostics.tables[0]?.useStrategy).toBe('none');
    expect(result.applicationDiagnostics.tables[1]?.useStrategy).toBe('none');
    expect(result.contentUtf8).not.toContain('USE=1');
  });

  it('blocks tables with no rows', () => {
    const artifacts = createArtifacts({
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Empty table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Normal table',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [{ variable: 'Q2r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] }],
        },
      ],
    });
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.blockedCount).toBe(1);
    expect(result.tableStatuses[0].semanticExportStatus).toBe('blocked');
    expect(result.tableStatuses[0].styleParityStatus).toBe('blocked');
    expect(result.tableStatuses[1].semanticExportStatus).toBe('exported');
    expect(result.applicationDiagnostics.tables[0]?.status).toBe('blocked');
  });
});
