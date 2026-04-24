import { describe, expect, it } from 'vitest';
import { buildQExportManifest } from '@/lib/exportData/q/manifestBuilder';
import type { QExportResolvedArtifacts } from '@/lib/exportData/q/types';
import { Q_EXPORT_RUNTIME_CONTRACT } from '@/lib/exportData/q/types';

function createBaseArtifacts(): QExportResolvedArtifacts {
  return {
    metadata: {
      manifestVersion: 'phase1.v1',
      generatedAt: '2026-02-27T00:00:00.000Z',
      weighting: { weightVariable: null, mode: 'unweighted' },
      sourceSavNames: { uploaded: 'input.sav', runtime: 'dataFile.sav' },
      availableDataFiles: [
        {
          dataFrameRef: 'wide',
          fileName: 'wide.sav',
          relativePath: 'export/data/wide.sav',
          exists: true,
          r2Key: 'r2/wide',
        },
      ],
      artifactPaths: {
        inputs: {
          sortedFinal: 'tables/07-sorted-final.json',
          resultsTables: 'results/tables.json',
          crosstabRaw: 'crosstab/crosstab-output-raw.json',
          loopSummary: 'stages/loop-summary.json',
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
      convexRefs: {
        runId: 'run-1',
        projectId: 'proj-1',
        orgId: 'org-1',
      },
      r2Refs: {
        finalized: true,
        artifacts: {
          'export/export-metadata.json': 'r2/meta',
          'export/table-routing.json': 'r2/table-routing',
          'export/job-routing-manifest.json': 'r2/job-routing',
          'export/loop-semantics-policy.json': 'r2/loop-policy',
          'export/support-report.json': 'r2/support',
        },
        dataFiles: {
          'export/data/wide.sav': 'r2/wide',
        },
      },
      warnings: [],
      idempotency: {
        integrityDigest: 'digest-1',
        jobs: {
          'q:wide.job': 'job-hash',
        },
      },
    },
    tableRouting: {
      generatedAt: '2026-02-27T00:00:00.000Z',
      totalTables: 1,
      tableToDataFrameRef: {
        t1: 'wide',
      },
      countsByDataFrameRef: {
        wide: 1,
      },
    },
    jobRoutingManifest: {
      generatedAt: '2026-02-27T00:00:00.000Z',
      totalJobs: 1,
      totalTables: 1,
      jobs: [
        {
          jobId: 'wide.job',
          dataFrameRef: 'wide',
          dataFileRelativePath: 'export/data/wide.sav',
          tableIds: ['t1'],
        },
      ],
      tableToJobId: {
        t1: 'wide.job',
      },
    },
    loopPolicy: {
      policyVersion: '1.0',
      bannerGroups: [],
      warnings: [],
      reasoning: 'No loop groups detected.',
      fallbackApplied: false,
      fallbackReason: '',
    },
    supportReport: {
      generatedAt: '2026-02-27T00:00:00.000Z',
      manifestVersion: 'phase1.v1',
      expressionSummary: { total: 2, parsed: 2, blocked: 0 },
      expressions: [],
      supportItems: [
        {
          itemType: 'cut',
          itemId: 'cut:Demo::Male',
          q: { status: 'supported', reasonCodes: ['direct_support'] },
          wincross: { status: 'supported', reasonCodes: ['direct_support'] },
        },
        {
          itemType: 'table',
          itemId: 'table:t1',
          q: { status: 'supported', reasonCodes: ['direct_support'] },
          wincross: { status: 'supported', reasonCodes: ['direct_support'] },
        },
      ],
      summary: {
        q: { supported: 2, warning: 0, blocked: 0 },
        wincross: { supported: 2, warning: 0, blocked: 0 },
      },
    },
    sortedFinal: {
      _metadata: {
        stage: 'sorted-final',
        stageNumber: 7,
        tableCount: 1,
        timestamp: '2026-02-27T00:00:00.000Z',
      },
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          rows: [
            { variable: 'Q1', label: 'Yes', filterValue: '1', isNet: false, netComponents: [], indent: 0 },
          ],
          sourceTableId: 't1',
          isDerived: false,
          exclude: false,
          excludeReason: '',
          surveySection: 'MAIN',
          baseText: '',
          userNote: '',
          tableSubtitle: '',
          additionalFilter: 'SEG == 1',
          filterReviewRequired: false,
          splitFromTableId: '',
          lastModifiedBy: 'VerificationAgent',
        },
      ],
    },
    resultsTables: {
      metadata: { generatedAt: '2026-02-27T00:00:00.000Z', tableCount: 1, cutCount: 1 },
      tables: {
        t1: {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          data: {},
          columns: [],
          rows: [],
        },
      },
    },
    crosstabRaw: {
      bannerCuts: [
        {
          groupName: 'Demo',
          columns: [{ name: 'Male', adjusted: 'GENDER == 1', expressionType: 'direct_variable' }],
        },
      ],
    },
    loopSummary: {
      totalLoopGroups: 0,
      totalIterationVars: 0,
      totalBaseVars: 0,
      groups: [],
    },
    verboseDataMap: null,
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

describe('Q manifest builder', () => {
  it('builds non-loop manifest with wide routing and native filter trees', () => {
    const manifest = buildQExportManifest({
      packageId: 'pkg-1',
      exporterVersion: 'q-exporter.v1',
      artifacts: createBaseArtifacts(),
    });

    expect(manifest.jobs).toHaveLength(1);
    expect(manifest.jobs[0].jobId).toBe('wide.job');
    expect(manifest.tables).toHaveLength(1);
    expect(manifest.tables[0].dataFrameRef).toBe('wide');
    expect(manifest.jobs[0].packageDataFilePath).toBe('data/wide.sav');
    expect(manifest.filters.map((filter) => filter.filterId)).toEqual([
      'cut:Demo::Male@wide',
      'table:t1:additionalFilter',
    ]);
    expect(manifest.filters[0]).toMatchObject({
      normalizedExpression: 'GENDER == 1',
      filterTree: {
        type: 'term',
        leftRef: 'GENDER',
        op: 'equals',
        values: [1],
      },
    });
    expect(manifest.filters.map((filter) => filter.loweringStrategy)).toEqual([
      'direct',
      'direct',
    ]);
    expect(manifest.runtimeContract.contractVersion).toBe(Q_EXPORT_RUNTIME_CONTRACT.contractVersion);
    expect(manifest.bannerPlans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        planId: 'banner:wide',
        dataFrameRef: 'wide',
        sourceCutFilterIds: ['cut:Demo::Male@wide'],
        groups: expect.arrayContaining([
          expect.objectContaining({
            groupName: 'Demo',
            groupQuestionName: 'Demo',
            filterIds: ['cut:Demo::Male@wide'],
          }),
        ]),
      }),
    ]));
    expect(manifest.blockedItems).toHaveLength(0);
    expect(manifest.generatedAt).toBe('2026-02-27T00:00:00.000Z');
    expect(manifest.supportSummary).toEqual({ supported: 2, warning: 0, blocked: 0 });
    expect(manifest.sourceSupportSummary).toEqual({ supported: 2, warning: 0, blocked: 0 });
  });

  it('emits row plans with label metadata for each table row', () => {
    const manifest = buildQExportManifest({
      packageId: 'pkg-rows',
      exporterVersion: 'q-exporter.v1',
      artifacts: createBaseArtifacts(),
    });

    expect(manifest.tables).toHaveLength(1);
    expect(manifest.tables[0].tableOrderIndex).toBe(0);
    expect(manifest.tables[0].rows).toHaveLength(1);
    expect(manifest.tables[0].rows[0]).toMatchObject({
      rowIndex: 0,
      variable: 'Q1',
      label: 'Yes',
      filterValue: '1',
      strategy: 'duplicate_value_attributes',
      selectedValues: [1],
      effectiveLabel: 'Yes',
      labelSource: 'row_label',
    });
    expect(manifest.tables[0].primaryStrategy).toBe('row_plan_primary');
    expect(manifest.tables[0].headerRows).toEqual([]);
  });

  it('falls back to variable label when row label is blank', () => {
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0].rows[0].label = '';
    artifacts.verboseDataMap = [
      { column: 'Q1', label: 'Fallback Label From Datamap' },
    ];

    const manifest = buildQExportManifest({
      packageId: 'pkg-row-label-fallback',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.tables[0].rows[0]).toMatchObject({
      label: '',
      sourceLabel: 'Fallback Label From Datamap',
      effectiveLabel: 'Fallback Label From Datamap',
      labelSource: 'variable_label',
    });
  });

  it('uses synthetic expressions for non-numeric token filters', () => {
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0].rows = [
      { variable: 'Q1', label: 'A or B', filterValue: 'A,B', isNet: false, netComponents: [], indent: 0 },
    ];

    const manifest = buildQExportManifest({
      packageId: 'pkg-token-synth',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.tables[0].rows[0]).toMatchObject({
      strategy: 'synthetic_expression',
      strategyReason: 'multi_value_string_expression',
      selectedValues: [],
      syntheticExpression: '(!is.na(`Q1`) & ((as.character(`Q1`) == "A") | (as.character(`Q1`) == "B")))',
    });
  });

  it('preserves leading-zero tokens for duplicate value-attribute selection', () => {
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0].rows = [
      { variable: 'Q1', label: '01 or 02', filterValue: '01,02', isNet: false, netComponents: [], indent: 0 },
    ];

    const manifest = buildQExportManifest({
      packageId: 'pkg-leading-zero',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.tables[0].rows[0]).toMatchObject({
      strategy: 'duplicate_value_attributes',
      selectedValues: ['01', '02'],
    });
  });

  it('backtick-quotes variable references in synthetic range expressions', () => {
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0].rows = [
      { variable: 'Q 1-LOOP', label: '10-19', filterValue: '10-19', isNet: false, netComponents: [], indent: 0 },
    ];

    const manifest = buildQExportManifest({
      packageId: 'pkg-range-quote',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.tables[0].rows[0]).toMatchObject({
      strategy: 'synthetic_expression',
      strategyReason: 'range_filter_expression',
    });
    expect(manifest.tables[0].rows[0].syntheticExpression).toContain('`Q 1-LOOP`');
  });

  it('preserves sorted-final table order via tableOrderIndex', () => {
    const artifacts = createBaseArtifacts();
    const t2 = {
      ...artifacts.sortedFinal.tables[0],
      tableId: 't2',
      questionId: 'Q2',
      questionText: 'Question 2',
      additionalFilter: '',
    };
    artifacts.sortedFinal.tables = [t2, artifacts.sortedFinal.tables[0]];
    artifacts.tableRouting = {
      ...artifacts.tableRouting,
      totalTables: 2,
      tableToDataFrameRef: {
        t1: 'wide',
        t2: 'wide',
      },
      countsByDataFrameRef: {
        wide: 2,
      },
    };
    artifacts.jobRoutingManifest = {
      ...artifacts.jobRoutingManifest,
      totalTables: 2,
      jobs: [
        {
          ...artifacts.jobRoutingManifest.jobs[0],
          tableIds: ['t1', 't2'],
        },
      ],
      tableToJobId: {
        t1: 'wide.job',
        t2: 'wide.job',
      },
    };
    artifacts.supportReport.supportItems.push({
      itemType: 'table',
      itemId: 'table:t2',
      q: { status: 'supported', reasonCodes: ['direct_support'] },
      wincross: { status: 'supported', reasonCodes: ['direct_support'] },
    });

    const manifest = buildQExportManifest({
      packageId: 'pkg-order',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.tables.map((table) => table.tableId)).toEqual(['t2', 't1']);
    expect(manifest.tables.map((table) => table.tableOrderIndex)).toEqual([0, 1]);
  });

  it('uses numeric row primary strategy for mean rows and preserves _CAT_ header metadata', () => {
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0] = {
      ...artifacts.sortedFinal.tables[0],
      tableType: 'mean_rows',
      rows: [
        { variable: '_CAT_', label: 'Section A', filterValue: '_HEADER_', isNet: false, netComponents: [], indent: 0 },
        { variable: 'Q1r1', label: 'Option 1', filterValue: '', isNet: false, netComponents: [], indent: 0 },
      ],
    };

    const manifest = buildQExportManifest({
      packageId: 'pkg-mean-headers',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.tables[0].primaryStrategy).toBe('numeric_row_plan_primary');
    expect(manifest.tables[0].rows[0]).toMatchObject({
      variable: '_CAT_',
      strategy: 'blocked',
      strategyReason: 'category_header_row',
    });
    expect(manifest.tables[0].rows[1]).toMatchObject({
      variable: 'Q1r1',
      strategy: 'direct_source_variable',
      strategyReason: 'mean_row_direct_numeric',
    });
    expect(manifest.tables[0].headerRows).toEqual([
      {
        rowIndex: 0,
        label: 'Section A',
        filterValue: '_HEADER_',
        indent: 0,
      },
    ]);
  });

  it('populates helper metadata on filters', () => {
    const manifest = buildQExportManifest({
      packageId: 'pkg-helper',
      exporterVersion: 'q-exporter.v1',
      artifacts: createBaseArtifacts(),
    });

    // Cut filter should have helper metadata with clean column name as label
    const cutFilter = manifest.filters.find((f) => f.source === 'cut');
    expect(cutFilter).toBeDefined();
    expect(cutFilter!.dataFrameRef).toBe('wide');
    expect(cutFilter!.helperVarName).toMatch(/^htf_cut_/);
    expect(cutFilter!.helperVarLabel).toBe('Male');
    expect(cutFilter!.consumerRefs).toEqual(['banner:wide']);

    // Table filter should have helper metadata
    const tableFilter = manifest.filters.find((f) => f.source === 'table');
    expect(tableFilter).toBeDefined();
    expect(tableFilter!.dataFrameRef).toBe('wide');
    expect(tableFilter!.helperVarName).toMatch(/^htf_tbl_/);
    expect(tableFilter!.consumerRefs).toEqual(['table:t1']);
  });

  it('preserves additive baseContext metadata from enriched sorted-final tables', () => {
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0] = {
      ...artifacts.sortedFinal.tables[0],
      baseText: 'Those who were shown Q1',
      userNote: 'Base varies by item (n=120-150)',
      basePolicy: 'question_base_shared',
      baseViewRole: 'anchor',
      plannerBaseComparability: 'varying_but_acceptable',
      plannerBaseSignals: ['varying-item-bases', 'filtered-base'],
      computeRiskSignals: ['row-base-varies-within-anchor-view'],
      baseContract: {
        classification: {
          referenceUniverse: 'question',
        },
        policy: {
          effectiveBaseMode: 'table_mask_then_row_observed_n',
          rebasePolicy: 'none',
        },
      },
      baseDisclosure: {
        referenceBaseN: 150,
        itemBaseRange: [120, 150],
        defaultBaseText: 'Those who were shown Q1',
        defaultNoteTokens: ['anchor-base-varies-by-item', 'anchor-base-range'],
        rangeDisclosure: { min: 120, max: 150 },
        source: 'contract',
      },
    };

    const manifest = buildQExportManifest({
      packageId: 'pkg-base-context',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.tables[0].baseContext).toEqual({
      source: 'contract',
      referenceBaseN: 150,
      itemBaseRange: [120, 150],
      displayBaseText: 'Those who were shown Q1',
      displayNote: 'Base varies by item (n=120-150)',
      compactDisclosureText: 'Those who were shown Q1; Base varies by item (n=120-150)',
      baseViewRole: 'anchor',
      plannerBaseComparability: 'varying_but_acceptable',
      plannerBaseSignals: ['varying-item-bases', 'filtered-base'],
      computeRiskSignals: ['row-base-varies-within-anchor-view'],
      referenceUniverse: 'question',
      effectiveBaseMode: 'table_mask_then_row_observed_n',
      rebasePolicy: 'none',
    });
  });

  it('routes normalized loop-family tables to stacked frames with base-name row variables', () => {
    const artifacts = createBaseArtifacts();
    artifacts.metadata.availableDataFiles = [
      ...artifacts.metadata.availableDataFiles,
      {
        dataFrameRef: 'stacked_loop_1',
        fileName: 'stacked_loop_1.sav',
        relativePath: 'export/data/stacked_loop_1.sav',
        exists: true,
        r2Key: 'r2/stacked_loop_1',
      },
    ];
    artifacts.metadata.r2Refs.dataFiles['export/data/stacked_loop_1.sav'] = 'r2/stacked_loop_1';
    artifacts.metadata.idempotency!.jobs['q:stacked_loop_1.job'] = 'job-hash-stacked';
    artifacts.tableRouting = {
      ...artifacts.tableRouting,
      tableToDataFrameRef: {
        t1: 'stacked_loop_1',
      },
      countsByDataFrameRef: {
        stacked_loop_1: 1,
      },
    };
    artifacts.jobRoutingManifest = {
      ...artifacts.jobRoutingManifest,
      jobs: [
        {
          jobId: 'stacked_loop_1.job',
          dataFrameRef: 'stacked_loop_1',
          dataFileRelativePath: 'export/data/stacked_loop_1.sav',
          tableIds: ['t1'],
        },
      ],
      tableToJobId: {
        t1: 'stacked_loop_1.job',
      },
    };
    artifacts.sortedFinal.tables[0] = {
      ...artifacts.sortedFinal.tables[0],
      questionId: 'A2',
      questionText: 'Looped question A2',
      rows: [
        { variable: 'A2', label: 'Occasion response', filterValue: '1', isNet: false, netComponents: [], indent: 0 },
      ],
    };
    artifacts.loopSummary = {
      totalLoopGroups: 1,
      totalIterationVars: 2,
      totalBaseVars: 1,
      groups: [
        {
          stackedFrameName: 'stacked_loop_1',
          skeleton: 'A2_{N}',
          iterations: ['1', '2'],
          variableCount: 1,
          variables: [
            {
              baseName: 'A2',
              label: 'Occasion response',
              iterationColumns: {
                '1': 'A2_1',
                '2': 'A2_2',
              },
            },
          ],
        },
      ],
    };

    const manifest = buildQExportManifest({
      packageId: 'pkg-loop-routing',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.jobs).toHaveLength(1);
    expect(manifest.jobs[0].jobId).toBe('stacked_loop_1.job');
    expect(manifest.jobs[0].dataFrameRef).toBe('stacked_loop_1');
    expect(manifest.jobs[0].packageDataFilePath).toBe('data/stacked_loop_1.sav');
    expect(manifest.tables).toHaveLength(1);
    expect(manifest.tables[0].dataFrameRef).toBe('stacked_loop_1');
    expect(manifest.tables[0].questionId).toBe('A2');
    expect(manifest.tables[0].rows[0]).toMatchObject({
      variable: 'A2',
      label: 'Occasion response',
    });
  });

  it('produces deterministic helper names across runs', () => {
    const first = buildQExportManifest({
      packageId: 'pkg-det-1',
      exporterVersion: 'q-exporter.v1',
      artifacts: createBaseArtifacts(),
    });
    const second = buildQExportManifest({
      packageId: 'pkg-det-2',
      exporterVersion: 'q-exporter.v1',
      artifacts: createBaseArtifacts(),
    });

    expect(first.filters.map((f) => f.helperVarName)).toEqual(
      second.filters.map((f) => f.helperVarName),
    );
  });

  it('produces different helper names for same filter on different frames', () => {
    const artifacts = createBaseArtifacts();

    artifacts.metadata.availableDataFiles.push({
      dataFrameRef: 'stacked_loop_1',
      fileName: 'stacked_loop_1.sav',
      relativePath: 'export/data/stacked_loop_1.sav',
      exists: true,
      r2Key: 'r2/stacked',
    });
    artifacts.metadata.r2Refs.dataFiles['export/data/stacked_loop_1.sav'] = 'r2/stacked';

    artifacts.tableRouting = {
      ...artifacts.tableRouting,
      totalTables: 2,
      tableToDataFrameRef: { t1: 'wide', t2: 'stacked_loop_1' },
      countsByDataFrameRef: { wide: 1, stacked_loop_1: 1 },
    };

    artifacts.jobRoutingManifest = {
      ...artifacts.jobRoutingManifest,
      totalJobs: 2,
      totalTables: 2,
      jobs: [
        artifacts.jobRoutingManifest.jobs[0],
        {
          jobId: 'stacked_loop_1.job',
          dataFrameRef: 'stacked_loop_1',
          dataFileRelativePath: 'export/data/stacked_loop_1.sav',
          tableIds: ['t2'],
        },
      ],
      tableToJobId: { t1: 'wide.job', t2: 'stacked_loop_1.job' },
    };

    artifacts.sortedFinal.tables.push({
      ...artifacts.sortedFinal.tables[0],
      tableId: 't2',
      questionId: 'Q2',
      questionText: 'Question 2',
      additionalFilter: '',
    });

    artifacts.loopPolicy = {
      policyVersion: '1.0',
      warnings: [],
      reasoning: 'test',
      fallbackApplied: false,
      fallbackReason: '',
      bannerGroups: [
        {
          groupName: 'Demo',
          anchorType: 'respondent',
          shouldPartition: true,
          comparisonMode: 'suppress',
          stackedFrameName: '',
          implementation: { strategy: 'none', aliasName: '', sourcesByIteration: [], notes: '' },
          confidence: 0.95,
          evidence: ['direct'],
        },
      ],
    };

    artifacts.supportReport.supportItems.push({
      itemType: 'table',
      itemId: 'table:t2',
      q: { status: 'supported', reasonCodes: ['direct_support'] },
      wincross: { status: 'supported', reasonCodes: ['direct_support'] },
    });

    const manifest = buildQExportManifest({
      packageId: 'pkg-multi-frame',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    const cutFilters = manifest.filters.filter((f) => f.source === 'cut');
    expect(cutFilters).toHaveLength(2);
    const names = cutFilters.map((f) => f.helperVarName);
    expect(names[0]).not.toBe(names[1]);
  });

  it('populates additionalFilterBindPath on tables with additional filters', () => {
    const manifest = buildQExportManifest({
      packageId: 'pkg-bind',
      exporterVersion: 'q-exporter.v1',
      artifacts: createBaseArtifacts(),
    });

    const tableWithFilter = manifest.tables.find((t) => t.additionalFilterId);
    expect(tableWithFilter).toBeDefined();
    expect(tableWithFilter!.additionalFilterBindPath).toBe('table_filters_variable');

    // Tables without additional filter should not have bindPath
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0].additionalFilter = '';
    const manifest2 = buildQExportManifest({
      packageId: 'pkg-no-bind',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });
    const tableWithoutFilter = manifest2.tables.find((t) => t.tableId === 't1');
    expect(tableWithoutFilter?.additionalFilterBindPath).toBeUndefined();
  });

  it('keeps entity-anchored cuts on stacked jobs only', () => {
    const artifacts = createBaseArtifacts();

    artifacts.metadata.availableDataFiles.push({
      dataFrameRef: 'stacked_loop_1',
      fileName: 'stacked_loop_1.sav',
      relativePath: 'export/data/stacked_loop_1.sav',
      exists: true,
      r2Key: 'r2/stacked',
    });
    artifacts.metadata.r2Refs.dataFiles['export/data/stacked_loop_1.sav'] = 'r2/stacked';

    artifacts.tableRouting = {
      ...artifacts.tableRouting,
      totalTables: 2,
      tableToDataFrameRef: {
        t1: 'wide',
        t2: 'stacked_loop_1',
      },
      countsByDataFrameRef: {
        wide: 1,
        stacked_loop_1: 1,
      },
    };

    artifacts.jobRoutingManifest = {
      ...artifacts.jobRoutingManifest,
      totalJobs: 2,
      totalTables: 2,
      jobs: [
        artifacts.jobRoutingManifest.jobs[0],
        {
          jobId: 'stacked_loop_1.job',
          dataFrameRef: 'stacked_loop_1',
          dataFileRelativePath: 'export/data/stacked_loop_1.sav',
          tableIds: ['t2'],
        },
      ],
      tableToJobId: {
        t1: 'wide.job',
        t2: 'stacked_loop_1.job',
      },
    };

    artifacts.sortedFinal.tables.push({
      ...artifacts.sortedFinal.tables[0],
      tableId: 't2',
      questionId: 'Q2',
      questionText: 'Question 2',
      additionalFilter: '',
    });

    artifacts.crosstabRaw.bannerCuts = [
      {
        groupName: 'Demo',
        columns: [{ name: 'Male', adjusted: 'GENDER == 1', expressionType: 'direct_variable' }],
      },
      {
        groupName: 'Brand',
        columns: [{ name: 'Brand X', adjusted: 'BRAND == 1', expressionType: 'direct_variable' }],
      },
    ];

    artifacts.loopPolicy = {
      policyVersion: '1.0',
      warnings: [],
      reasoning: 'loop policy test fixture',
      fallbackApplied: false,
      fallbackReason: '',
      bannerGroups: [
        {
          groupName: 'Demo',
          anchorType: 'respondent',
          shouldPartition: true,
          comparisonMode: 'suppress',
          stackedFrameName: '',
          implementation: {
            strategy: 'none',
            aliasName: '',
            sourcesByIteration: [],
            notes: 'respondent',
          },
          confidence: 0.95,
          evidence: ['direct'],
        },
        {
          groupName: 'Brand',
          anchorType: 'entity',
          shouldPartition: true,
          comparisonMode: 'suppress',
          stackedFrameName: 'stacked_loop_1',
          implementation: {
            strategy: 'alias_column',
            aliasName: '.hawktab_brand',
            sourcesByIteration: [{ iteration: '1', variable: 'BRAND_1' }],
            notes: 'entity',
          },
          confidence: 0.9,
          evidence: ['loop'],
        },
      ],
    };

    artifacts.supportReport.supportItems.push(
      {
        itemType: 'cut',
        itemId: 'cut:Brand::Brand X',
        q: { status: 'supported', reasonCodes: ['direct_support'] },
        wincross: { status: 'supported', reasonCodes: ['direct_support'] },
      },
      {
        itemType: 'table',
        itemId: 'table:t2',
        q: { status: 'supported', reasonCodes: ['direct_support'] },
        wincross: { status: 'supported', reasonCodes: ['direct_support'] },
      },
    );
    artifacts.supportReport.summary.q.supported = 4;
    artifacts.supportReport.summary.wincross.supported = 4;

    const manifest = buildQExportManifest({
      packageId: 'pkg-loop',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    const entityCuts = manifest.cuts.filter((cut) => cut.groupName === 'Brand');
    const respondentCuts = manifest.cuts.filter((cut) => cut.groupName === 'Demo');

    // Entity-anchored cuts apply to all compatible frames (not restricted to one)
    expect(entityCuts.map((cut) => cut.dataFrameRef).sort()).toEqual(['stacked_loop_1', 'wide']);
    expect(respondentCuts.map((cut) => cut.dataFrameRef).sort()).toEqual(['stacked_loop_1', 'wide']);
    expect(manifest.tables.map((table) => table.tableId).sort()).toEqual(['t1', 't2']);
    expect(manifest.supportSummary).toEqual({ supported: 4, warning: 0, blocked: 0 });
  });

  it('blocks groups without loop policy when multiple data frames are routed', () => {
    const artifacts = createBaseArtifacts();

    artifacts.metadata.availableDataFiles.push({
      dataFrameRef: 'stacked_loop_1',
      fileName: 'stacked_loop_1.sav',
      relativePath: 'export/data/stacked_loop_1.sav',
      exists: true,
      r2Key: 'r2/stacked',
    });
    artifacts.metadata.r2Refs.dataFiles['export/data/stacked_loop_1.sav'] = 'r2/stacked';

    artifacts.tableRouting = {
      ...artifacts.tableRouting,
      totalTables: 2,
      tableToDataFrameRef: {
        t1: 'wide',
        t2: 'stacked_loop_1',
      },
      countsByDataFrameRef: {
        wide: 1,
        stacked_loop_1: 1,
      },
    };

    artifacts.jobRoutingManifest = {
      ...artifacts.jobRoutingManifest,
      totalJobs: 2,
      totalTables: 2,
      jobs: [
        artifacts.jobRoutingManifest.jobs[0],
        {
          jobId: 'stacked_loop_1.job',
          dataFrameRef: 'stacked_loop_1',
          dataFileRelativePath: 'export/data/stacked_loop_1.sav',
          tableIds: ['t2'],
        },
      ],
      tableToJobId: {
        t1: 'wide.job',
        t2: 'stacked_loop_1.job',
      },
    };

    artifacts.sortedFinal.tables.push({
      ...artifacts.sortedFinal.tables[0],
      tableId: 't2',
      questionId: 'Q2',
      questionText: 'Question 2',
      additionalFilter: '',
    });

    artifacts.supportReport.supportItems.push({
      itemType: 'table',
      itemId: 'table:t2',
      q: { status: 'supported', reasonCodes: ['direct_support'] },
      wincross: { status: 'supported', reasonCodes: ['direct_support'] },
    });

    const manifest = buildQExportManifest({
      packageId: 'pkg-missing-policy',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.cuts).toHaveLength(0);
    expect(manifest.blockedItems).toContainEqual(expect.objectContaining({
      itemType: 'cut',
      itemId: 'cut:Demo::Male',
      reasonCodes: ['missing_loop_semantics_policy'],
    }));
    expect(manifest.supportSummary).toEqual({ supported: 2, warning: 0, blocked: 1 });
    expect(manifest.sourceSupportSummary).toEqual({ supported: 2, warning: 0, blocked: 0 });
  });

  it('blocks items that are missing from support-report.json', () => {
    const artifacts = createBaseArtifacts();
    artifacts.supportReport.supportItems = [];
    artifacts.supportReport.summary = {
      q: { supported: 0, warning: 0, blocked: 0 },
      wincross: { supported: 0, warning: 0, blocked: 0 },
    };

    const manifest = buildQExportManifest({
      packageId: 'pkg-missing-support',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.cuts).toHaveLength(0);
    expect(manifest.tables).toHaveLength(0);
    expect(manifest.blockedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: 'cut', itemId: 'cut:Demo::Male', reasonCodes: ['missing_support_item'] }),
      expect.objectContaining({ itemType: 'table', itemId: 'table:t1', reasonCodes: ['missing_support_item'] }),
    ]));
    expect(manifest.supportSummary).toEqual({ supported: 0, warning: 0, blocked: 2 });
    expect(manifest.sourceSupportSummary).toEqual({ supported: 0, warning: 0, blocked: 0 });
  });

  it('emits cross-variable cut and table filters when support is warning/derived-variable', () => {
    const artifacts = createBaseArtifacts();

    artifacts.crosstabRaw.bannerCuts = [
      {
        groupName: 'Parity',
        columns: [{ name: 'Delta', adjusted: 'A4r2c2 > A4r2c1', expressionType: 'direct_variable' }],
      },
    ];

    artifacts.sortedFinal.tables = [
      {
        ...artifacts.sortedFinal.tables[0],
        additionalFilter: '(A4r2c2 != A3r2) | (A4r3c2 != A3r3) | (A4r4c2 != A3r4)',
      },
    ];

    artifacts.supportReport.supportItems = [
      {
        itemType: 'cut',
        itemId: 'cut:Parity::Delta',
        q: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
        wincross: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
      },
      {
        itemType: 'table',
        itemId: 'table:t1',
        q: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
        wincross: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
      },
    ];

    artifacts.supportReport.summary = {
      q: { supported: 0, warning: 2, blocked: 0 },
      wincross: { supported: 0, warning: 2, blocked: 0 },
    };

    const manifest = buildQExportManifest({
      packageId: 'pkg-cross-var',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.blockedItems).toHaveLength(0);
    expect(manifest.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filterId: 'cut:Parity::Delta@wide',
        loweringStrategy: 'derived_variable',
        dataFrameRef: 'wide',
        helperVarName: expect.stringMatching(/^htf_cut_/),
        consumerRefs: ['banner:wide'],
        filterTree: expect.objectContaining({
          type: 'derived_comparison',
          leftVar: 'A4r2c2',
          op: '>',
          rightVar: 'A4r2c1',
          helperVarName: expect.stringMatching(/^hawktab_cv_[a-f0-9]{16}_/),
        }),
      }),
      expect.objectContaining({
        filterId: 'table:t1:additionalFilter',
        loweringStrategy: 'derived_variable',
        dataFrameRef: 'wide',
        helperVarName: expect.stringMatching(/^htf_tbl_/),
        consumerRefs: ['table:t1'],
        filterTree: expect.objectContaining({
          type: 'or',
        }),
      }),
    ]));
    expect(manifest.supportSummary).toEqual({ supported: 0, warning: 2, blocked: 0 });
    expect(manifest.sourceSupportSummary).toEqual({ supported: 0, warning: 2, blocked: 0 });
  });

  it('keeps unsupported additional-filter function calls blocked even when support item is warning', () => {
    const artifacts = createBaseArtifacts();
    artifacts.sortedFinal.tables[0].additionalFilter = 'grepl("A", SEG)';
    artifacts.supportReport.supportItems = [
      {
        itemType: 'cut',
        itemId: 'cut:Demo::Male',
        q: { status: 'supported', reasonCodes: ['direct_support'] },
        wincross: { status: 'supported', reasonCodes: ['direct_support'] },
      },
      {
        itemType: 'table',
        itemId: 'table:t1',
        q: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
        wincross: { status: 'warning', reasonCodes: ['cross_variable_comparison'], fallbackStrategy: 'derived_variable' },
      },
    ];
    artifacts.supportReport.summary = {
      q: { supported: 1, warning: 1, blocked: 0 },
      wincross: { supported: 1, warning: 1, blocked: 0 },
    };

    const manifest = buildQExportManifest({
      packageId: 'pkg-unsupported-function',
      exporterVersion: 'q-exporter.v1',
      artifacts,
    });

    expect(manifest.blockedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: 'table',
        itemId: 'table:t1:additionalFilter',
        reasonCodes: ['unsupported_function_call'],
      }),
    ]));
    expect(manifest.filters.map((filter) => filter.filterId)).toEqual([
      'cut:Demo::Male@wide',
    ]);
  });
});
