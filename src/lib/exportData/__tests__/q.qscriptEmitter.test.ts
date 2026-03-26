import { describe, expect, it } from 'vitest';
import { emitQScript } from '@/lib/exportData/q/qscriptEmitter';
import { NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE } from '@/lib/exportData/q/runtimeContract';
import { QExportManifestSchema } from '@/lib/exportData/types';
import { Q_EXPORT_RUNTIME_CONTRACT } from '@/lib/exportData/q/types';

const manifest = QExportManifestSchema.parse({
  manifestVersion: 'q.phase2.native.v3',
  exporterVersion: 'q-exporter.v17',
  generatedAt: '2026-02-27T00:00:00.000Z',
  packageId: 'pkg-1',
  sourceManifestVersion: 'phase1.v1',
  integrityDigest: 'digest-1',
  artifacts: {
    metadataPath: 'export/export-metadata.json',
    tableRoutingPath: 'export/table-routing.json',
    jobRoutingManifestPath: 'export/job-routing-manifest.json',
    loopPolicyPath: 'export/loop-semantics-policy.json',
    supportReportPath: 'export/support-report.json',
    sortedFinalPath: 'tables/07-sorted-final.json',
    resultsTablesPath: 'results/tables.json',
    crosstabRawPath: 'crosstab/crosstab-output-raw.json',
    loopSummaryPath: 'stages/loop-summary.json',
  },
  provenance: {
    runId: 'run-1',
    projectId: 'proj-1',
    orgId: 'org-1',
  },
  runtimeContract: Q_EXPORT_RUNTIME_CONTRACT,
  jobs: [
    {
      jobId: 'wide.job',
      dataFrameRef: 'wide',
      dataFileRelativePath: 'export/data/wide.sav',
      packageDataFilePath: 'data/wide.sav',
      dataFileR2Key: 'r2/wide',
      tableIds: ['t1'],
    },
  ],
  tables: [
    {
      tableId: 't1',
      tableOrderIndex: 0,
      jobId: 'wide.job',
      dataFrameRef: 'wide',
      questionId: 'Q1',
      questionText: 'Question 1',
      tableType: 'frequency',
      primaryStrategy: 'row_plan_primary',
      supportStatus: 'supported',
      reasonCodes: ['direct_support'],
      rowCount: 2,
      rows: [
        {
          rowIndex: 0,
          variable: 'Q1',
          label: 'Yes',
          filterValue: '1',
          isNet: false,
          netComponents: [],
          indent: 0,
          strategy: 'duplicate_value_attributes',
          strategyReason: 'single_value_code',
          selectedValues: [1],
          sourceLabel: 'Question 1 - Yes',
          effectiveLabel: 'Yes',
          labelSource: 'row_label',
        },
        {
          rowIndex: 1,
          variable: 'Q1',
          label: 'No',
          filterValue: '2',
          isNet: false,
          netComponents: [],
          indent: 0,
          strategy: 'duplicate_value_attributes',
          strategyReason: 'single_value_code',
          selectedValues: [2],
          sourceLabel: 'Question 1 - No',
          effectiveLabel: 'No',
          labelSource: 'row_label',
        },
      ],
      headerRows: [],
      additionalFilter: 'SEG == 1',
      additionalFilterId: 'table:t1:additionalFilter',
      additionalFilterBindPath: 'table_filters_variable',
    },
  ],
  cuts: [
    {
      cutId: 'cut:Demo::Male@wide',
      groupName: 'Demo',
      columnName: 'Male',
      expression: 'GENDER == 1',
      dataFrameRef: 'wide',
      filterId: 'cut:Demo::Male@wide',
      supportStatus: 'supported',
      reasonCodes: ['direct_support'],
    },
  ],
  filters: [
    {
      filterId: 'cut:Demo::Male@wide',
      source: 'cut',
      sourceId: 'cut:Demo::Male',
      expression: 'GENDER == 1',
      normalizedExpression: 'GENDER == 1',
      fingerprint: 'f1',
      filterTree: {
        type: 'term',
        leftRef: 'GENDER',
        op: 'equals',
        values: [1],
      },
      parseStatus: 'parsed',
      loweringStrategy: 'direct',
      reasonCodes: ['ready'],
      dataFrameRef: 'wide',
      helperVarName: 'htf_cut_cut_Demo_Male_wide_abc1234567',
      helperVarLabel: 'Male',
      consumerRefs: ['banner:wide'],
    },
    {
      filterId: 'table:t1:additionalFilter',
      source: 'table',
      sourceId: 'table:t1',
      expression: 'SEG == 1',
      normalizedExpression: 'SEG == 1',
      fingerprint: 'f2',
      filterTree: {
        type: 'term',
        leftRef: 'SEG',
        op: 'equals',
        values: [1],
      },
      parseStatus: 'parsed',
      loweringStrategy: 'direct',
      reasonCodes: ['ready'],
      dataFrameRef: 'wide',
      helperVarName: 'htf_tbl_table_t1_wide_def9876543',
      helperVarLabel: 'HT Filter: table:t1 [wide]',
      consumerRefs: ['table:t1'],
    },
  ],
  bannerPlans: [
    {
      planId: 'banner:wide',
      dataFrameRef: 'wide',
      sourceCutFilterIds: ['cut:Demo::Male@wide'],
      bannerQuestionName: 'HT_Banner_abc',
      groups: [
        {
          groupName: 'Demo',
          groupQuestionName: 'Demo',
          filterIds: ['cut:Demo::Male@wide'],
        },
      ],
    },
  ],
  blockedItems: [],
  warnings: [],
  supportSummary: {
    supported: 2,
    warning: 0,
    blocked: 0,
  },
});

describe('Q script emitter (variable-only)', () => {
  it('produces deterministic native output with variable-only filter path', () => {
    const first = emitQScript(manifest);
    const second = emitQScript(manifest);

    expect(first).toBe(second);
    expect(first).toContain('Variable-Only Filters');
    expect(first).toContain('project.addDataFile("../data/wide.sav")');
    expect(first).toContain('project.report.appendTable()');
    expect(first).toContain('htPersistFilterVariable');
    expect(first).toContain('htBuildGroupedBanner');
    expect(first).toContain('htCompileFilterTreeToRExpression');
    expect(first).toContain('htProbeRuntimeCapabilities');
    expect(first).toContain('htSelectTableFilterBindStrategy');
    expect(first).toContain('HT_FRAME_BINDING_STRATEGY');
    expect(first).toContain('HT_RUNTIME_BINDING_SUMMARY');
    expect(first).toContain('HT_FILTER_VAR_DIAG');
    expect(first).toContain('HT_CHECKPOINT_FILTERS_DONE');
    expect(first).toContain('HT_CHECKPOINT_BANNERS_DONE');
    expect(first).toContain('HT_CHECKPOINT_TABLES_BEGIN');
    expect(first).toContain('HT_CHECKPOINT_TABLE_START:');
    expect(first).toContain('htAttachTableAdditionalFilter');
    expect(first).toContain('htBuildTablePrimaryFromRows');
    expect(first).toContain('htApplyTableHeaderMetadata');
    expect(first).toContain('additionalFilterId');
    expect(first).toContain('__htFilterVars');
    expect(first).toContain('__htFrameCapabilities');
    expect(first).toContain('__htFrameBindStrategies');
    expect(first).toContain('.secondary = __htSecondary_0;');
    expect(first).toContain('HT_CHECKPOINT_START');

    // Should NOT contain old filter-question materialization path
    expect(first).not.toContain('htPersistFilterQuestion');
    expect(first).not.toContain('htCreateHelperFilterTerm');
    expect(first).not.toContain('htTryCreateFilterTermBounded');
    expect(first).not.toContain('HT_FILTER_TERM_DIAG');
    expect(first).not.toContain('__htFilters[');
    // Note: newFilterQuestion may still appear in the runtime for masked-primary table bind fallback
  });

  it('preserves manifest table order when emitting appendTable calls', () => {
    const orderedManifest = QExportManifestSchema.parse({
      ...manifest,
      jobs: [
        {
          ...manifest.jobs[0],
          tableIds: ['t2', 't1'],
        },
      ],
      tables: [
        {
          ...manifest.tables[0],
          tableId: 't2',
          tableOrderIndex: 0,
          rows: [
            {
              ...manifest.tables[0].rows[0],
              rowIndex: 0,
            },
          ],
        },
        {
          ...manifest.tables[0],
          tableId: 't1',
          tableOrderIndex: 1,
        },
      ],
    });

    const script = emitQScript(orderedManifest);
    const t2Index = script.indexOf('HT_CHECKPOINT_TABLE_START:t2');
    const t1Index = script.indexOf('HT_CHECKPOINT_TABLE_START:t1');
    expect(t2Index).toBeGreaterThan(-1);
    expect(t1Index).toBeGreaterThan(-1);
    expect(t2Index).toBeLessThan(t1Index);
  });

  it('emits full-tree helper-compile runtime path for derived comparisons', () => {
    const derivedManifest = QExportManifestSchema.parse({
      ...manifest,
      filters: [
        ...manifest.filters,
        {
          filterId: 'cut:Demo::Delta@wide',
          source: 'cut',
          sourceId: 'cut:Demo::Delta',
          expression: 'Q1 == Q2',
          normalizedExpression: 'Q1 == Q2',
          fingerprint: 'f3',
          filterTree: {
            type: 'derived_comparison',
            leftVar: 'Q1',
            op: '==',
            rightVar: 'Q2',
            helperVarName: 'hawktab_cv_abc_root',
          },
          parseStatus: 'parsed',
          loweringStrategy: 'derived_variable',
          reasonCodes: ['derived_variable_lowering'],
          dataFrameRef: 'wide',
          helperVarName: 'htf_cut_cut_Demo_Delta_wide_xyz',
          helperVarLabel: 'Delta',
          consumerRefs: ['banner:wide'],
        },
      ],
      cuts: [
        ...manifest.cuts,
        {
          cutId: 'cut:Demo::Delta@wide',
          groupName: 'Demo',
          columnName: 'Delta',
          expression: 'Q1 == Q2',
          dataFrameRef: 'wide',
          filterId: 'cut:Demo::Delta@wide',
          supportStatus: 'warning',
          reasonCodes: ['cross_variable_comparison'],
        },
      ],
      bannerPlans: [
        {
          planId: 'banner:wide',
          dataFrameRef: 'wide',
          sourceCutFilterIds: ['cut:Demo::Delta@wide', 'cut:Demo::Male@wide'],
          bannerQuestionName: 'HT_Banner_abc',
          groups: [
            {
              groupName: 'Demo',
              groupQuestionName: 'Demo',
              filterIds: ['cut:Demo::Delta@wide', 'cut:Demo::Male@wide'],
            },
          ],
        },
      ],
    });

    const script = emitQScript(derivedManifest);
    expect(script).toContain('htCompileDerivedComparisonToBooleanExpression');
    expect(script).toContain('htCompileFilterTreeToBooleanExpression');
    expect(script).toContain('"type":"derived_comparison"');
    expect(script).toContain('newRVariable');
  });

  it('materializes filter as variable-only (no createFilterTerm dependency)', () => {
    const diagnostics: string[] = [];
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htPersistFilterVariable: htPersistFilterVariable, htProbeRuntimeCapabilities: htProbeRuntimeCapabilities };`,
    )((message: string) => diagnostics.push(message), { report: { appendTable: () => ({}) } }) as {
      htPersistFilterVariable: (
        dataFile: Record<string, unknown>,
        filterTree: Record<string, unknown>,
        filterId: string,
        helperVarName: string,
        helperVarLabel: string,
      ) => { name: string; variableType: string };
      htProbeRuntimeCapabilities: (
        dataFile: Record<string, unknown>,
        dataFrameRef: string,
      ) => Record<string, boolean>;
    };

    const variables = new Map<string, { name: string; variableType: string }>();

    const createdHelpers: Array<{ name: string; expression: string; label: string }> = [];
    const dataFile = {
      getVariableByName(name: string) {
        return variables.get(name) || null;
      },
      getQuestionByName() {
        return null;
      },
      newRVariable(expression: string, name: string, label: string) {
        createdHelpers.push({ name, expression, label });
        variables.set(name, { name, variableType: 'Numeric' });
      },
      setQuestion() {
        throw new Error('unexpected banner question call');
      },
    };

    const filterId = 'cut:Demo::Male@wide';
    const tree = { type: 'term', leftRef: 'GENDER', op: 'equals', values: [1] };

    // First call: creates the variable
    const first = runtime.htPersistFilterVariable(dataFile, tree, filterId, 'htf_cut_test_var', 'HT Filter: test [wide]');
    expect(first).toBeTruthy();
    expect(first.name).toBe('htf_cut_test_var');
    expect(createdHelpers).toHaveLength(1);
    expect(createdHelpers[0]?.expression).toContain('ifelse(');
    expect(createdHelpers[0]?.label).toBe('HT Filter: test [wide]');

    // Second call: reuses the variable
    const second = runtime.htPersistFilterVariable(dataFile, tree, filterId, 'htf_cut_test_var', 'HT Filter: test [wide]');
    expect(second).toBeTruthy();
    expect(second.name).toBe('htf_cut_test_var');
    expect(createdHelpers).toHaveLength(1); // Still 1 — reused

    // Verify diagnostics
    const diag = diagnostics
      .filter((entry) => entry.startsWith('HT_FILTER_VAR_DIAG:'))
      .map((entry) => JSON.parse(entry.slice('HT_FILTER_VAR_DIAG:'.length)));
    expect(diag).toHaveLength(2);
    expect(diag[0]).toMatchObject({
      filterId,
      helperVarName: 'htf_cut_test_var',
      compileStrategy: 'compile_filter_tree_to_r',
      blockedReason: null,
    });
    expect(diag[1]).toMatchObject({
      filterId,
      compileStrategy: 'reuse_existing_helper_variable',
      blockedReason: null,
    });
  });

  it('retries filter helper creation with a unique question name when label collides in Q', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htPersistFilterVariable: htPersistFilterVariable };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htPersistFilterVariable: (
        dataFile: Record<string, unknown>,
        filterTree: Record<string, unknown>,
        filterId: string,
        helperVarName: string,
        helperVarLabel: string,
      ) => { name: string; label?: string; variableType: string };
    };

    const variables = new Map<string, { name: string; label?: string; variableType: string }>();
    const createCalls: Array<{ expression: string; name: string; a3: unknown; a4: unknown }> = [];
    const dataFile = {
      getVariableByName(name: string) {
        return variables.get(name) || null;
      },
      getQuestionByName() {
        return null;
      },
      newRVariable(expression: string, name: string, a3: unknown, a4: unknown) {
        createCalls.push({ expression, name, a3, a4 });
        if (a3 === 'User') {
          throw new Error("variable_label: There is already a question with the name 'User'.");
        }
        variables.set(name, { name, label: typeof a4 === 'string' ? a4 : undefined, variableType: 'Numeric' });
      },
    };

    const output = runtime.htPersistFilterVariable(
      dataFile,
      { type: 'term', leftRef: 'H_BRAND_USEr1', op: 'equals', values: [1] },
      'cut:Brand_A Usage::User@wide',
      'htf_cut_cut_Brand_A_Usage_User_wide_2e270408bd',
      'User',
    );

    expect(output.name).toBe('htf_cut_cut_Brand_A_Usage_User_wide_2e270408bd');
    expect(output.label).toBe('User');
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]?.a3).toBe('User');
    expect(String(createCalls[1]?.a3)).toContain('HT_FiltQ_');
    expect(createCalls[1]?.a4).toBe('User');
  });

  it('probes runtime capabilities correctly', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htProbeRuntimeCapabilities: htProbeRuntimeCapabilities, htSelectTableFilterBindStrategy: htSelectTableFilterBindStrategy };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htProbeRuntimeCapabilities: (
        dataFile: Record<string, unknown>,
        dataFrameRef: string,
      ) => { supportsNewRVariable: boolean; supportsSetQuestionPickAny: boolean; supportsCreateBanner: boolean; supportsTableFiltersAssignment: boolean; supportsMaskedPrimary: boolean };
      htSelectTableFilterBindStrategy: (
        dataFile: Record<string, unknown>,
        dataFrameRef: string,
        capabilities: Record<string, boolean>,
      ) => string | null;
    };

    const dataFile = {
      newRVariable() {},
      setQuestion(name: string) { return { name }; },
      createBanner() { return { name: 'test' }; },
    };

    const caps = runtime.htProbeRuntimeCapabilities(dataFile, 'wide');
    expect(caps.supportsNewRVariable).toBe(true);
    expect(caps.supportsSetQuestionPickAny).toBe(true);
    expect(caps.supportsCreateBanner).toBe(true);
    // supportsTableFiltersAssignment inferred from supportsNewRVariable (no end-to-end probe)
    expect(caps.supportsTableFiltersAssignment).toBe(true);
    expect(caps.supportsMaskedPrimary).toBe(false); // no createFilterTerm

    // Test without createBanner
    const noBannerDataFile = {
      newRVariable: dataFile.newRVariable,
      setQuestion: dataFile.setQuestion,
    };
    const capsNoBanner = runtime.htProbeRuntimeCapabilities(noBannerDataFile, 'wide');
    expect(capsNoBanner.supportsCreateBanner).toBe(false);
    expect(capsNoBanner.supportsTableFiltersAssignment).toBe(true); // still has newRVariable

    // Test without newRVariable — supportsTableFiltersAssignment should be false
    const noNewRVarDataFile = {
      setQuestion: dataFile.setQuestion,
    };
    const capsNoNewR = runtime.htProbeRuntimeCapabilities(noNewRVarDataFile, 'wide');
    expect(capsNoNewR.supportsNewRVariable).toBe(false);
    expect(capsNoNewR.supportsTableFiltersAssignment).toBe(false);

    // Test with masked-primary capable runtime
    const maskedDataFile = {
      ...dataFile,
      createFilterTerm() { return {}; },
      newFilterQuestion() { return {}; },
    };
    const caps2 = runtime.htProbeRuntimeCapabilities(maskedDataFile, 'wide');
    expect(caps2.supportsMaskedPrimary).toBe(true);

    // Test strategy selection
    const strategy1 = runtime.htSelectTableFilterBindStrategy(dataFile, 'wide', { supportsTableFiltersAssignment: true, supportsMaskedPrimary: true });
    expect(strategy1).toBe('table_filters_variable');

    const strategy2 = runtime.htSelectTableFilterBindStrategy(maskedDataFile, 'wide', { supportsTableFiltersAssignment: false, supportsMaskedPrimary: true });
    expect(strategy2).toBe('table_primary_masked');

    const strategy3 = runtime.htSelectTableFilterBindStrategy(dataFile, 'wide', { supportsTableFiltersAssignment: false, supportsMaskedPrimary: false });
    expect(strategy3).toBeNull();
  });

  it('banner construction creates grouped banner via createBanner (not flat Pick Any)', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildGroupedBanner: htBuildGroupedBanner };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htBuildGroupedBanner: (
        dataFile: Record<string, unknown>,
        bannerQuestionName: string,
        groups: Array<{ groupName: string; helperVariables: Array<{ name: string }> }>,
        planId: string,
      ) => { name: string };
    };

    const setQuestionCalls: Array<{ name: string; type: string; vars: Array<{ name: string }> }> = [];
    let createBannerBlocks: Array<Array<{ name: string }>> = [];
    const dataFile = {
      setQuestion(name: string, type: string, vars: Array<{ name: string }>) {
        setQuestionCalls.push({ name, type, vars });
        return { name };
      },
      createBanner(_name: string, blocks: Array<Array<{ name: string }>>) {
        createBannerBlocks = blocks;
        return { name: _name };
      },
    };

    const groups = [
      {
        groupName: 'Demo',
        helperVariables: [
          { name: 'htf_cut_demo_male_wide_abc' },
          { name: 'htf_cut_demo_female_wide_def' },
        ],
      },
      {
        groupName: 'HCP Role',
        helperVariables: [
          { name: 'htf_cut_hcp_app_wide_ghi' },
        ],
      },
    ];

    runtime.htBuildGroupedBanner(dataFile, 'HT_Banner_test', groups, 'banner:wide');

    // Should create one Pick Any question per group with prefixed names to avoid collisions
    expect(setQuestionCalls).toHaveLength(2);
    expect(setQuestionCalls[0].name).toMatch(/^HT_BG_[A-Za-z0-9_]+_1_Demo$/);
    expect(setQuestionCalls[0].type).toBe('Pick Any');
    expect(setQuestionCalls[0].vars).toHaveLength(2);
    expect(setQuestionCalls[1].name).toMatch(/^HT_BG_[A-Za-z0-9_]+_2_HCP_Role$/);
    expect(setQuestionCalls[1].type).toBe('Pick Any');
    expect(setQuestionCalls[1].vars).toHaveLength(1);

    // Should call createBanner with non-nested blocks (each group in its own array)
    expect(createBannerBlocks).toHaveLength(2);
    expect(createBannerBlocks[0]).toHaveLength(1); // [demoQ]
    expect(createBannerBlocks[1]).toHaveLength(1); // [hcpRoleQ]
  });

  it('keeps banner grouping stable by duplicating helper vars per group before setQuestion', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildGroupedBanner: htBuildGroupedBanner };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htBuildGroupedBanner: (
        dataFile: Record<string, unknown>,
        bannerQuestionName: string,
        groups: Array<{ groupName: string; helperVariables: Array<{ name: string; duplicate: () => { name: string } }> }>,
        planId: string,
      ) => { name: string };
    };

    const duplicateCounts = new Map<string, number>();
    const makeHelper = (name: string) => ({
      name,
      variableType: 'Numeric',
      duplicate() {
        duplicateCounts.set(name, (duplicateCounts.get(name) ?? 0) + 1);
        return {
          name: `${name}_dup_${duplicateCounts.get(name)}`,
          variableType: 'Numeric',
        };
      },
    });

    const setQuestionCalls: Array<{ name: string; vars: Array<{ name: string }> }> = [];
    const dataFile = {
      setQuestion(name: string, _type: string, vars: Array<{ name: string }>) {
        setQuestionCalls.push({ name, vars });
        return { name };
      },
      createBanner(name: string) {
        return { name };
      },
    };

    runtime.htBuildGroupedBanner(dataFile, 'HT_Banner_test', [
      {
        groupName: 'Demo',
        helperVariables: [makeHelper('htf_demo_male'), makeHelper('htf_demo_female')],
      },
      {
        groupName: 'Role',
        helperVariables: [makeHelper('htf_role_physician')],
      },
    ], 'banner:wide');

    expect(duplicateCounts.get('htf_demo_male')).toBe(1);
    expect(duplicateCounts.get('htf_demo_female')).toBe(1);
    expect(duplicateCounts.get('htf_role_physician')).toBe(1);
    expect(setQuestionCalls[0]?.vars.map((item) => item.name)).toEqual(['htf_demo_male_dup_1', 'htf_demo_female_dup_1']);
    expect(setQuestionCalls[1]?.vars.map((item) => item.name)).toEqual(['htf_role_physician_dup_1']);
  });

  it('supports cross-variable comparisons through helper variable path', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htPersistFilterVariable: htPersistFilterVariable };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htPersistFilterVariable: (
        dataFile: Record<string, unknown>,
        filterTree: Record<string, unknown>,
        filterId: string,
        helperVarName: string,
        helperVarLabel: string,
      ) => { name: string };
    };

    const variables = new Map<string, { name: string; variableType: string }>();
    variables.set('Q1', { name: 'Q1', variableType: 'Numeric' });
    variables.set('Q2', { name: 'Q2', variableType: 'Numeric' });

    const createdHelpers: Array<{ name: string; expression: string }> = [];
    const dataFile = {
      getVariableByName(name: string) {
        return variables.get(name) || null;
      },
      getQuestionByName() {
        return null;
      },
      newRVariable(expression: string, name: string) {
        createdHelpers.push({ name, expression });
        variables.set(name, { name, variableType: 'Numeric' });
      },
    };

    const output = runtime.htPersistFilterVariable(
      dataFile,
      {
        type: 'or',
        children: [
          { type: 'derived_comparison', leftVar: 'Q1', op: '==', rightVar: 'Q2', helperVarName: 'legacy_ignored' },
          { type: 'term', leftRef: 'Q1', op: 'greater_than', values: [0] },
        ],
      },
      'cut:Demo::Cross@wide',
      'htf_cut_cross_wide_abc',
      'HT Filter: cross [wide]',
    );

    expect(output.name).toBe('htf_cut_cross_wide_abc');
    expect(createdHelpers).toHaveLength(1);
    expect(createdHelpers[0]?.expression).toContain('Q1 == Q2');
    expect(createdHelpers[0]?.expression).toContain('!is.na(Q1) & !is.na(Q2)');
    expect(createdHelpers[0]?.expression).toContain('suppressWarnings(as.numeric(as.character(Q1))) > 0');
  });

  it('continues building row-plan primary when one row materialization fails', () => {
    const diagnostics: string[] = [];
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildTablePrimaryFromRows: htBuildTablePrimaryFromRows };`,
    )((message: string) => diagnostics.push(message), { report: { appendTable: () => ({}) } }) as {
      htBuildTablePrimaryFromRows: (
        dataFile: Record<string, unknown>,
        questionId: string,
        tableId: string,
        rowPlans: unknown[],
      ) => { name: string };
    };

    let duplicateCount = 0;
    const setQuestionCalls: Array<{ name: string; type: string; vars: Array<{ name: string }> }> = [];
    const sourceVariable = {
      name: 'Q1',
      label: 'Q1',
      duplicate() {
        duplicateCount += 1;
        return {
          name: `Q1_dup_${duplicateCount}`,
          variableType: 'Categorical',
          question: {
            valueAttributes: {
              knownValues: [1, 2],
              setCountThisValue() {},
            },
          },
        };
      },
    };

    const dataFile = {
      getVariableByName(name: string) {
        if (name === 'Q1') return sourceVariable;
        return null;
      },
      getQuestionByName() {
        return null;
      },
      setQuestion(name: string, type: string, vars: Array<{ name: string }>) {
        setQuestionCalls.push({ name, type, vars });
        return { name };
      },
    };

    const primary = runtime.htBuildTablePrimaryFromRows(dataFile, 'Q1', 't1', [
      {
        rowIndex: 0,
        variable: 'MISSING',
        strategy: 'duplicate_value_attributes',
        selectedValues: [1],
        label: 'Missing row',
      },
      {
        rowIndex: 1,
        variable: 'Q1',
        strategy: 'duplicate_value_attributes',
        selectedValues: [2],
        label: 'Valid row',
        effectiveLabel: 'Valid row',
        labelSource: 'row_label',
      },
    ]);

    expect(primary.name).toBe('HT_Primary_t1');
    expect(setQuestionCalls).toHaveLength(1);
    expect(setQuestionCalls[0]?.type).toBe('Pick Any');
    expect(setQuestionCalls[0]?.vars).toHaveLength(1);
    expect(setQuestionCalls[0]?.vars[0]?.name).toBe('Q1_dup_1');
    expect(diagnostics.some((entry) => entry.startsWith('HT_ROW_PRIMARY_BUILD_DIAG:'))).toBe(true);
  });

  it('applies distinct count-this-value selections for duplicated categorical rows (s1 shape)', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildTablePrimaryFromRows: htBuildTablePrimaryFromRows };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htBuildTablePrimaryFromRows: (
        dataFile: Record<string, unknown>,
        questionId: string,
        tableId: string,
        rowPlans: unknown[],
        primaryStrategy?: string,
      ) => { name: string };
    };

    let duplicateCount = 0;
    const countCallsByVariable = new Map<string, Array<{ value: unknown; enabled: boolean }>>();
    const sourceVariable = {
      name: 'S1',
      duplicate() {
        duplicateCount += 1;
        const name = `S1_dup_${duplicateCount}`;
        const calls: Array<{ value: unknown; enabled: boolean }> = [];
        countCallsByVariable.set(name, calls);
        return {
          name,
          variableType: 'Categorical',
          question: {
            valueAttributes: {
              knownValues: [1, 2, 3],
              setCountThisValue(value: unknown, enabled: boolean) {
                calls.push({ value, enabled });
              },
            },
          },
        };
      },
    };

    const setQuestionCalls: Array<{ name: string; type: string; vars: Array<{ name: string }> }> = [];
    const dataFile = {
      getVariableByName(name: string) {
        if (name === 'S1') return sourceVariable;
        return null;
      },
      getQuestionByName() {
        return null;
      },
      setQuestion(name: string, type: string, vars: Array<{ name: string }>) {
        setQuestionCalls.push({ name, type, vars });
        return { name };
      },
    };

    const primary = runtime.htBuildTablePrimaryFromRows(dataFile, 'S1', 's1', [
      {
        rowIndex: 0,
        variable: 'S1',
        strategy: 'duplicate_value_attributes',
        selectedValues: [1],
        label: 'Proceed (confidential)',
        effectiveLabel: 'Proceed (confidential)',
        labelSource: 'row_label',
      },
      {
        rowIndex: 1,
        variable: 'S1',
        strategy: 'duplicate_value_attributes',
        selectedValues: [2],
        label: 'Proceed (waive confidentiality)',
        effectiveLabel: 'Proceed (waive confidentiality)',
        labelSource: 'row_label',
      },
    ], 'row_plan_primary');

    expect(primary.name).toBe('HT_Primary_s1');
    expect(duplicateCount).toBe(2);
    expect(setQuestionCalls.some((call) => call.name === 'HT_Primary_s1' && call.type === 'Pick Any')).toBe(true);

    const firstRowCalls = countCallsByVariable.get('S1_dup_1') ?? [];
    const secondRowCalls = countCallsByVariable.get('S1_dup_2') ?? [];
    expect(firstRowCalls.some((call) => call.enabled === true && call.value === 1)).toBe(true);
    expect(firstRowCalls.some((call) => call.enabled === true && call.value === 2)).toBe(false);
    expect(secondRowCalls.some((call) => call.enabled === true && call.value === 2)).toBe(true);
    expect(secondRowCalls.some((call) => call.enabled === true && call.value === 1)).toBe(false);
  });

  it('falls back to deterministic synthetic row when count-this-value cannot be applied', () => {
    const diagnostics: string[] = [];
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildTablePrimaryFromRows: htBuildTablePrimaryFromRows };`,
    )((message: string) => diagnostics.push(message), { report: { appendTable: () => ({}) } }) as {
      htBuildTablePrimaryFromRows: (
        dataFile: Record<string, unknown>,
        questionId: string,
        tableId: string,
        rowPlans: unknown[],
        primaryStrategy?: string,
      ) => { name: string };
    };

    const variables = new Map<string, { name: string; variableType: string; question?: { valueAttributes: { knownValues: unknown[]; setCountThisValue: (value: unknown, enabled: boolean) => void } } }>();
    const sourceVariable = {
      name: 'Q1',
      duplicate() {
        return {
          name: 'Q1_dup_1',
          variableType: 'Categorical',
          question: {
            valueAttributes: {
              knownValues: [1, 2],
              setCountThisValue() {},
            },
          },
        };
      },
    };
    variables.set('Q1', sourceVariable as never);

    const setQuestionCalls: Array<{ name: string; type: string; vars: Array<{ name: string }> }> = [];
    const dataFile = {
      getVariableByName(name: string) {
        return variables.get(name) || null;
      },
      getQuestionByName() {
        return null;
      },
      newRVariable(expression: string, name: string) {
        variables.set(name, { name, variableType: 'Categorical' });
        expect(expression).toContain('as.character(`Q1`) == "01"');
      },
      setQuestion(name: string, type: string, vars: Array<{ name: string }>) {
        setQuestionCalls.push({ name, type, vars });
        return { name };
      },
    };

    const primary = runtime.htBuildTablePrimaryFromRows(dataFile, 'Q1', 't1', [
      {
        rowIndex: 0,
        variable: 'Q1',
        strategy: 'duplicate_value_attributes',
        selectedValues: ['01'],
        label: 'Leading zero row',
        effectiveLabel: 'Leading zero row',
        labelSource: 'row_label',
      },
    ], 'row_plan_primary');

    expect(primary.name).toBe('HT_Primary_t1');
    expect(setQuestionCalls.some((call) => call.vars.some((item) => item.name.startsWith('HT_Row_t1_Q1_0')))).toBe(true);
    expect(diagnostics.some((entry) => entry.includes('HT_ROW_COUNT_FALLBACK_DIAG:'))).toBe(true);
    expect(diagnostics.some((entry) => entry.includes('"fallbackUsed":true'))).toBe(true);
  });

  it('builds synthetic fallback rows even when row label collides with existing question names', () => {
    const diagnostics: string[] = [];
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildTablePrimaryFromRows: htBuildTablePrimaryFromRows };`,
    )((message: string) => diagnostics.push(message), { report: { appendTable: () => ({}) } }) as {
      htBuildTablePrimaryFromRows: (
        dataFile: Record<string, unknown>,
        questionId: string,
        tableId: string,
        rowPlans: unknown[],
        primaryStrategy?: string,
      ) => { name: string };
    };

    const variables = new Map<string, { name: string; variableType: string }>();
    const sourceVariable = {
      name: 'S2',
      duplicate() {
        return {
          name: 'S2_dup_1',
          variableType: 'Categorical',
          question: {
            valueAttributes: {
              knownValues: [99],
              setCountThisValue() {
                throw new Error('count-fail');
              },
            },
          },
        };
      },
    };
    variables.set('S2', sourceVariable as never);

    const createdHelpers: Array<{ expression: string; name: string; a3: unknown; a4: unknown }> = [];
    const setQuestionCalls: Array<{ type: string; vars: Array<{ name: string }> }> = [];
    const dataFile = {
      getVariableByName(name: string) {
        return variables.get(name) || null;
      },
      getQuestionByName() {
        return null;
      },
      newRVariable(expression: string, name: string, a3: unknown, a4: unknown) {
        // Simulate Q collision on row-label-based question name ("Other").
        if (a3 === 'Other') {
          throw new Error("variable_label: There is already a question with the name 'Other'.");
        }
        createdHelpers.push({ expression, name, a3, a4 });
        variables.set(name, { name, variableType: 'Categorical' });
      },
      setQuestion(_name: string, type: string, vars: Array<{ name: string }>) {
        setQuestionCalls.push({ type, vars });
        return { name: 'HT_Primary_s2' };
      },
    };

    const primary = runtime.htBuildTablePrimaryFromRows(dataFile, 'S2', 's2', [
      {
        rowIndex: 0,
        variable: 'S2',
        strategy: 'duplicate_value_attributes',
        selectedValues: [99],
        label: 'Other',
        effectiveLabel: 'Other',
        labelSource: 'row_label',
      },
    ], 'row_plan_primary');

    expect(primary.name).toBe('HT_Primary_s2');
    expect(createdHelpers).toHaveLength(1);
    expect(String(createdHelpers[0]?.a3)).toContain('HT_RowQ_s2_0_S2');
    expect(setQuestionCalls).toHaveLength(1);
    expect(setQuestionCalls[0]?.vars[0]?.name).toMatch(/^HT_Row_s2_S2_0/);
    expect(diagnostics.some((entry) => entry.includes('HT_ROW_COUNT_FALLBACK_DIAG:'))).toBe(true);
    expect(diagnostics.some((entry) => entry.includes('"fallbackUsed":true'))).toBe(true);
  });

  it('builds mean tables using numeric primary strategy without Pick Any coercion', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildTablePrimaryFromRows: htBuildTablePrimaryFromRows };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htBuildTablePrimaryFromRows: (
        dataFile: Record<string, unknown>,
        questionId: string,
        tableId: string,
        rowPlans: unknown[],
        primaryStrategy?: string,
      ) => { name: string };
    };

    const sourceVariables = new Map<string, { name: string; variableType: string; duplicate: () => { name: string; variableType: string } }>();
    sourceVariables.set('A6r1', {
      name: 'A6r1',
      variableType: 'Numeric',
      duplicate() {
        return { name: 'A6r1_dup', variableType: 'Numeric' };
      },
    });
    sourceVariables.set('A6r2', {
      name: 'A6r2',
      variableType: 'Numeric',
      duplicate() {
        return { name: 'A6r2_dup', variableType: 'Numeric' };
      },
    });

    const setQuestionCalls: Array<{ name: string; type: string; vars: Array<{ name: string; variableType: string }> }> = [];
    const dataFile = {
      getVariableByName(name: string) {
        return sourceVariables.get(name) || null;
      },
      getQuestionByName() {
        return null;
      },
      setQuestion(name: string, type: string, vars: Array<{ name: string; variableType: string }>) {
        setQuestionCalls.push({ name, type, vars });
        return { name };
      },
    };

    const primary = runtime.htBuildTablePrimaryFromRows(dataFile, 'A6', 'a6', [
      {
        rowIndex: 1,
        variable: 'A6r1',
        strategy: 'direct_source_variable',
        selectedValues: [],
        label: 'Path 1',
        effectiveLabel: 'Path 1',
        labelSource: 'row_label',
      },
      {
        rowIndex: 2,
        variable: 'A6r2',
        strategy: 'direct_source_variable',
        selectedValues: [],
        label: 'Path 2',
        effectiveLabel: 'Path 2',
        labelSource: 'row_label',
      },
    ], 'numeric_row_plan_primary');

    expect(primary.name).toBe('HT_Primary_a6');
    expect(setQuestionCalls).toHaveLength(1);
    expect(setQuestionCalls[0]?.type).toBe('Number - Multi');
    expect(setQuestionCalls[0]?.vars.map((item) => item.name)).toEqual(['A6r1_dup', 'A6r2_dup']);
  });

  it('applies _CAT_ header rows into deterministic table metadata notes', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htApplyTableHeaderMetadata: htApplyTableHeaderMetadata };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htApplyTableHeaderMetadata: (
        tableObj: Record<string, unknown>,
        tableId: string,
        headerRows: Array<{ rowIndex: number; label: string; filterValue: string; indent: number }>,
      ) => void;
    };

    const tableObj: Record<string, unknown> = {};
    runtime.htApplyTableHeaderMetadata(tableObj, 'a6', [
      { rowIndex: 0, label: 'Ezetimibe & Nexletol/Nexlizet', filterValue: '_HEADER_', indent: 0 },
      { rowIndex: 4, label: 'PCSK9i', filterValue: '_HEADER_', indent: 0 },
    ]);

    expect(tableObj.notes).toContain('Sections:');
    expect(tableObj.notes).toContain('Ezetimibe & Nexletol/Nexlizet');
    expect(tableObj.notes).toContain('PCSK9i');
    expect(tableObj.description).toContain('Sections:');
  });

  it('uses direct resolver fallback when row plans are empty', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htBuildTablePrimaryFromRows: htBuildTablePrimaryFromRows };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htBuildTablePrimaryFromRows: (
        dataFile: Record<string, unknown>,
        questionId: string,
        tableId: string,
        rowPlans: unknown[],
      ) => unknown;
    };

    let prefixLookupCalls = 0;
    const dataFile = {
      getQuestionByName() {
        return null;
      },
      getVariableByName() {
        return null;
      },
      getVariablesByName() {
        prefixLookupCalls += 1;
        return [{ name: 'A1r1' }];
      },
    };

    expect(() => runtime.htBuildTablePrimaryFromRows(dataFile, 'A1', 't1', [])).toThrow(
      "Unable to resolve question/variable 'A1'",
    );
    expect(prefixLookupCalls).toBe(0);
  });

  it('avoids destructive count reset when selected values do not match known values', () => {
    const diagnostics: string[] = [];
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htApplyRowCountThisValue: htApplyRowCountThisValue };`,
    )((message: string) => diagnostics.push(message), { report: { appendTable: () => ({}) } }) as {
      htApplyRowCountThisValue: (
        valueAttributes: Record<string, unknown>,
        selectedValues: unknown[],
      ) => void;
    };

    const calls: Array<{ value: unknown; enabled: boolean }> = [];
    const valueAttributes = {
      knownValues: [1, 2],
      setCountThisValue(value: unknown, enabled: boolean) {
        calls.push({ value, enabled });
      },
    };

    runtime.htApplyRowCountThisValue(valueAttributes, ['01']);
    expect(calls).toHaveLength(0);
    expect(diagnostics.some((entry) => entry.includes('"reasonCode":"no_matching_known_values"'))).toBe(true);
  });

  it('applies row labels even when label is inherited from prototype', () => {
    const diagnostics: string[] = [];
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htApplyRowLabel: htApplyRowLabel };`,
    )((message: string) => diagnostics.push(message), { report: { appendTable: () => ({}) } }) as {
      htApplyRowLabel: (
        rowVariable: Record<string, unknown>,
        rowQuestion: Record<string, unknown>,
        rowPlan: Record<string, unknown>,
        tableId: string,
      ) => void;
    };

    const rowVariable = Object.create({ label: 'proto-variable' }) as Record<string, unknown>;
    const rowQuestion = Object.create({ label: 'proto-question' }) as Record<string, unknown>;

    runtime.htApplyRowLabel(
      rowVariable,
      rowQuestion,
      {
        rowIndex: 0,
        variable: 'Q1',
        strategy: 'duplicate_value_attributes',
        effectiveLabel: 'Applied Label',
        labelSource: 'row_label',
      },
      't1',
    );

    expect(rowVariable.label).toBe('Applied Label');
    expect(rowQuestion.label).toBe('Applied Label');
    expect(diagnostics.some((entry) => entry.startsWith('HT_ROW_LABEL_DIAG:'))).toBe(true);
  });

  it('resolves primary question/variable using case-normalized candidates', () => {
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htResolveQuestionOrVariable: htResolveQuestionOrVariable };`,
    )(() => {}, { report: { appendTable: () => ({}) } }) as {
      htResolveQuestionOrVariable: (
        dataFile: Record<string, unknown>,
        name: string,
        contextLabel: string,
      ) => { name: string };
    };

    const dataFile = {
      getQuestionByName(_name: string) {
        return null;
      },
      getVariableByName(name: string) {
        if (name === 'A1') return { name: 'A1' };
        return null;
      },
    };

    const resolved = runtime.htResolveQuestionOrVariable(dataFile, 'a1', 'table a1 primary');
    expect(resolved).toMatchObject({ name: 'A1' });
  });

  it('synthesizes table primary with caching when parent question is unavailable', () => {
    const diagnostics: string[] = [];
    const runtime = new Function(
      'log',
      'project',
      `${NATIVE_QSCRIPT_HELPER_RUNTIME_SOURCE}
return { htResolveTablePrimary: htResolveTablePrimary };`,
    )((message: string) => diagnostics.push(message), { report: { appendTable: () => ({}) } }) as {
      htResolveTablePrimary: (
        dataFile: Record<string, unknown>,
        questionId: string,
        tableId: string,
      ) => { name: string };
    };

    const fallbackVars = [
      { name: 'A1r1', variableType: 'Numeric', label: 'Row 1' },
      { name: 'A1r2', variableType: 'Numeric', label: 'Row 2' },
      { name: 'A10', variableType: 'Numeric', label: 'Other' },
    ];
    const setQuestionCalls: Array<{ name: string; type: string; vars: unknown[] }> = [];
    const dataFile = {
      getQuestionByName(_name: string) { return null; },
      getVariableByName(_name: string) { return null; },
      getVariablesByName(prefix: string) {
        if (prefix === 'A1' || prefix === 'A1r' || prefix === 'A1_') return fallbackVars;
        return [];
      },
      setQuestion(name: string, type: string, vars: Array<{ name: string }>) {
        setQuestionCalls.push({ name, type, vars });
        return { name };
      },
    };

    // First call: creates synthetic question from ORIGINAL variables (preserves categorical metadata)
    const resolved1 = runtime.htResolveTablePrimary(dataFile, 'A1', 'a1');
    expect(resolved1).toMatchObject({ name: 'HT_Primary_A1' });
    expect(setQuestionCalls).toHaveLength(1);
    expect(setQuestionCalls[0]?.type).toBe('Pick One - Multi');
    // Should receive ORIGINAL variables, not copies — preserves value labels and factor structure
    expect(setQuestionCalls[0]?.vars).toHaveLength(2); // A1r1 and A1r2 (A10 filtered by name pattern)
    expect(setQuestionCalls[0]?.vars[0]).toMatchObject({ name: 'A1r1' });
    expect(setQuestionCalls[0]?.vars[1]).toMatchObject({ name: 'A1r2' });

    // Second call with same questionId: returns cached question (no extra setQuestion call)
    const resolved2 = runtime.htResolveTablePrimary(dataFile, 'A1', 'a2');
    expect(resolved2).toMatchObject({ name: 'HT_Primary_A1' });
    expect(setQuestionCalls).toHaveLength(1); // Still 1 — cached, no variable stealing

    const diag = diagnostics
      .filter((entry) => entry.startsWith('HT_TABLE_PRIMARY_DIAG:'))
      .map((entry) => JSON.parse(entry.slice('HT_TABLE_PRIMARY_DIAG:'.length)));
    expect(diag).toHaveLength(2);
    expect(diag[0]).toMatchObject({
      tableId: 'a1',
      questionId: 'A1',
      strategy: 'synthetic_set_question',
      syntheticType: 'Pick One - Multi',
      fallbackCandidateCount: 2,
      blockedReason: null,
    });
    expect(diag[1]).toMatchObject({
      tableId: 'a2',
      questionId: 'A1',
      strategy: 'synthetic_cached',
    });
  });
});
