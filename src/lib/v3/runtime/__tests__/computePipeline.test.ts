import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { CutsSpec } from '@/lib/tables/CutsSpec';
import type { StatTestingConfig } from '@/lib/env';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import {
  V3_CHECKPOINT_FILENAME,
  V3_STAGE_ARTIFACTS,
  createPipelineCheckpoint,
  recordStageCompletion,
} from '../contracts';
import {
  V3_STAGE_ORDER,
  V3_STAGE_PHASES,
  V3_STAGE_NAMES,
  getStageRange,
  getNextStage,
} from '../stageOrder';

import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import { buildEntryBaseContract, projectTableBaseContract } from '../baseContract';
import { resolveStatConfig } from '../compute/resolveStatConfig';
import { buildComputePackage, buildComputePackageFromPlan } from '../compute/buildComputePackage';
import { canonicalToComputeTables } from '../compute/canonicalToComputeTables';
import { runPostRQc } from '../compute/postRQc';
import { runComputePipeline } from '../compute/runComputePipeline';
import type { CanonicalTable } from '../canonical/types';

import type {
  ComputeChainInput,
  WizardStatTestingOverrides,
} from '../compute/types';

// =============================================================================
// Test Fixtures
// =============================================================================

const tempDirs: string[] = [];

async function makeTempOutputDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-pipeline-'));
  tempDirs.push(dir);
  return dir;
}

function makeTables(): TableWithLoopFrame[] {
  return [
    {
      tableId: 'Q1',
      title: 'Question 1',
      section: 'Main',
      questionText: 'What is your preference?',
      sourceTableId: 'Q1',
      splitFromTableId: '',
      lastModifiedBy: 'canonical-assembly',
      exclude: false,
      baseText: 'All respondents',
      baseN: 100,
      loopDataFrame: '',
      rows: [
        {
          variable: 'Q1_1',
          label: 'Option A',
          indent: 0,
          isNet: false,
          netMembers: [],
        },
        {
          variable: 'Q1_2',
          label: 'Option B',
          indent: 0,
          isNet: false,
          netMembers: [],
        },
      ],
    } as unknown as TableWithLoopFrame,
  ];
}

function makeCrosstabPlan(): ValidationResultType {
  return {
    bannerCuts: [
      {
        groupName: 'Gender',
        columns: [
          {
            name: 'Male',
            adjusted: 'Q2 == 1',
            confidence: 0.95,
            reasoning: 'Direct mapping',
            userSummary: 'Male respondents',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable',
          },
          {
            name: 'Female',
            adjusted: 'Q2 == 2',
            confidence: 0.95,
            reasoning: 'Direct mapping',
            userSummary: 'Female respondents',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable',
          },
        ],
      },
      {
        groupName: 'Age',
        columns: [
          {
            name: '18-34',
            adjusted: 'Q3 >= 1 & Q3 <= 2',
            confidence: 0.90,
            reasoning: 'Range mapping',
            userSummary: '18-34 age group',
            alternatives: [],
            uncertainties: [],
            expressionType: 'comparison',
          },
        ],
      },
    ],
  };
}

function makeStatConfig(): StatTestingConfig {
  return {
    thresholds: [0.10],
    proportionTest: 'unpooled_z',
    meanTest: 'welch_t',
    minBase: 0,
  };
}

function makeCutsSpec(): CutsSpec {
  return buildCutsSpec(makeCrosstabPlan());
}

function makeComputeInput(outputDir: string): ComputeChainInput {
  return {
    tables: makeTables(),
    crosstabPlan: makeCrosstabPlan(),
    outputDir,
    pipelineId: 'compute-test-pipeline',
    dataset: 'test-dataset',
  };
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

// =============================================================================
// Stage Order / Phase Membership Tests
// =============================================================================

describe('compute stages in V3 stage order', () => {
  it('stages 22 and 14 are in V3_STAGE_ORDER', () => {
    expect(V3_STAGE_ORDER).toContain('22');
    expect(V3_STAGE_ORDER).toContain('14');
  });

  it('stage 22 comes after stage 21', () => {
    const idx21 = V3_STAGE_ORDER.indexOf('21');
    const idx22 = V3_STAGE_ORDER.indexOf('22');
    expect(idx22).toBe(idx21 + 1);
  });

  it('stage 14 comes after stage 22', () => {
    const idx22 = V3_STAGE_ORDER.indexOf('22');
    const idx14 = V3_STAGE_ORDER.indexOf('14');
    expect(idx14).toBe(idx22 + 1);
  });

  it('stage 14 is the last stage', () => {
    expect(V3_STAGE_ORDER[V3_STAGE_ORDER.length - 1]).toBe('14');
    expect(getNextStage('14')).toBeNull();
  });

  it('stages 22 and 14 belong to compute phase', () => {
    expect(V3_STAGE_PHASES['22']).toBe('compute');
    expect(V3_STAGE_PHASES['14']).toBe('compute');
  });

  it('getStageRange("22", "14") returns [22, 14]', () => {
    expect(getStageRange('22', '14')).toEqual(['22', '14']);
  });

  it('stage names are defined', () => {
    expect(V3_STAGE_NAMES['22']).toBe('r-compute-input');
    expect(V3_STAGE_NAMES['14']).toBe('post-r-validation-qc');
  });
});

// =============================================================================
// Artifact Contract Tests
// =============================================================================

describe('compute artifact contracts', () => {
  it('stage 22 artifact is compute/22-compute-package.json', () => {
    expect(V3_STAGE_ARTIFACTS['22']).toBe('compute/22-compute-package.json');
  });

  it('stage 14 has no artifact (null)', () => {
    expect(V3_STAGE_ARTIFACTS['14']).toBeNull();
  });
});

// =============================================================================
// resolveStatConfig Tests
// =============================================================================

describe('resolveStatConfig', () => {
  it('returns explicit config as-is when provided', () => {
    const explicit: StatTestingConfig = {
      thresholds: [0.05],
      proportionTest: 'pooled_z',
      meanTest: 'student_t',
      minBase: 30,
    };

    const result = resolveStatConfig({ explicit });
    expect(result).toEqual(explicit);
  });

  it('converts wizard overrides from confidence % to raw thresholds', () => {
    const wizard: WizardStatTestingOverrides = {
      thresholds: [95, 90],
      minBase: 25,
    };

    const result = resolveStatConfig({ wizard });
    expect(result.thresholds).toEqual([0.05, 0.10]);
    expect(result.minBase).toBe(25);
    expect(result.proportionTest).toBe('unpooled_z');
    expect(result.meanTest).toBe('welch_t');
  });

  it('wizard single threshold converts correctly', () => {
    const result = resolveStatConfig({
      wizard: { thresholds: [90], minBase: 0 },
    });
    expect(result.thresholds).toEqual([0.10]);
  });

  it('explicit takes priority over wizard', () => {
    const explicit: StatTestingConfig = {
      thresholds: [0.01],
      proportionTest: 'pooled_z',
      meanTest: 'student_t',
      minBase: 50,
    };
    const wizard: WizardStatTestingOverrides = {
      thresholds: [95],
      minBase: 10,
    };

    const result = resolveStatConfig({ explicit, wizard });
    expect(result).toEqual(explicit);
  });

  it('falls back to env defaults when no overrides', () => {
    const result = resolveStatConfig();
    // Env defaults from getStatTestingConfig()
    expect(result.thresholds).toBeDefined();
    expect(result.proportionTest).toBeDefined();
    expect(result.meanTest).toBeDefined();
    expect(typeof result.minBase).toBe('number');
  });

  it('CLI overrides merge with env defaults', () => {
    const result = resolveStatConfig({
      cli: { thresholds: [0.05, 0.10] },
    });
    expect(result.thresholds).toEqual([0.05, 0.10]);
    // Other fields come from env defaults
    expect(result.proportionTest).toBeDefined();
    expect(result.meanTest).toBeDefined();
  });
});

// =============================================================================
// buildComputePackage Tests
// =============================================================================

describe('buildComputePackage', () => {
  it('assembles R script input from cutsSpec and stat config', () => {
    const cutsSpec = makeCutsSpec();
    const statConfig = makeStatConfig();
    const tables = makeTables();

    const result = buildComputePackage({
      tables,
      cutsSpec,
      statTestingConfig: statConfig,
    });

    expect(result.rScriptInput.tables).toBe(tables);
    expect(result.rScriptInput.cuts).toBe(cutsSpec.cuts);
    expect(result.rScriptInput.cutGroups).toBe(cutsSpec.groups);
    expect(result.rScriptInput.statTestingConfig).toBe(statConfig);
    expect(result.rScriptInput.significanceThresholds).toEqual(statConfig.thresholds);
  });

  it('includes loop mappings when provided', () => {
    const cutsSpec = makeCutsSpec();
    const statConfig = makeStatConfig();
    const loopMappings = [{
      stackedFrameName: 'loop_data',
      skeleton: 'Q{N}',
      iterations: [1, 2],
      variables: ['Q1_1', 'Q1_2'],
      variableCount: 2,
    }] as unknown as import('@/lib/validation/LoopCollapser').LoopGroupMapping[];

    const result = buildComputePackage({
      tables: makeTables(),
      cutsSpec,
      statTestingConfig: statConfig,
      loopMappings,
    });

    expect(result.rScriptInput.loopMappings).toBe(loopMappings);
  });

  it('omits loopMappings when passed an empty array', () => {
    const result = buildComputePackage({
      tables: makeTables(),
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
      loopMappings: [],
    });

    expect(result.rScriptInput.loopMappings).toBeUndefined();
  });

  it('omits optional fields when not provided', () => {
    const result = buildComputePackage({
      tables: makeTables(),
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
    });

    expect(result.rScriptInput.loopMappings).toBeUndefined();
    expect(result.rScriptInput.loopSemanticsPolicy).toBeUndefined();
    expect(result.rScriptInput.loopStatTestingMode).toBeUndefined();
    expect(result.rScriptInput.weightVariable).toBeUndefined();
  });

  it('includes weight variable when provided', () => {
    const result = buildComputePackage({
      tables: makeTables(),
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
      weightVariable: 'wt',
    });

    expect(result.rScriptInput.weightVariable).toBe('wt');
  });

  it('produces route metadata with correct counts', () => {
    const tables = makeTables();
    const cutsSpec = makeCutsSpec();

    const result = buildComputePackage({
      tables,
      cutsSpec,
      statTestingConfig: makeStatConfig(),
    });

    expect(result.routeMetadata.tableCount).toBe(tables.length);
    expect(result.routeMetadata.cutCount).toBe(cutsSpec.cuts.length);
    expect(result.routeMetadata.cutGroupCount).toBe(cutsSpec.groups.length);
    expect(result.routeMetadata.generatedAt).toBeDefined();
    expect(result.routeMetadata.totalStatLetter).toBe('T');
  });

  it('passes through cutsSpec as-is', () => {
    const cutsSpec = makeCutsSpec();

    const result = buildComputePackage({
      tables: makeTables(),
      cutsSpec,
      statTestingConfig: makeStatConfig(),
    });

    expect(result.cutsSpec).toBe(cutsSpec);
  });

  it('propagates totalStatLetter from cutsSpec', () => {
    const base = makeCutsSpec();
    const customTotal = {
      ...(base.totalCut as NonNullable<CutsSpec['totalCut']>),
      statLetter: 'Z',
    };
    const customCutsSpec: CutsSpec = {
      cuts: [customTotal, ...base.cuts.slice(1)],
      groups: [{ groupName: 'Total', cuts: [customTotal] }, ...base.groups.slice(1)],
      totalCut: customTotal,
    };

    const result = buildComputePackage({
      tables: makeTables(),
      cutsSpec: customCutsSpec,
      statTestingConfig: makeStatConfig(),
    });

    expect(result.rScriptInput.totalStatLetter).toBe('Z');
  });
});

describe('canonicalToComputeTables', () => {
  it('adapts canonical tables to TableWithLoopFrame with safe defaults', () => {
    const canonicalTables: CanonicalTable[] = [
      {
        tableId: 'Q1',
        questionId: 'Q1',
        familyRoot: 'Q1',
        sourceTableId: 'Q1',
        splitFromTableId: '',
        tableKind: 'standard_overview',
        analyticalSubtype: 'standard',
        normalizedType: 'single_select',
        tableType: 'frequency',
        questionText: 'Question 1',
        rows: [
          {
            variable: 'Q1_1',
            label: 'Option A',
            filterValue: '1',
            rowKind: 'value',
            isNet: false,
            indent: 0,
            netLabel: '',
            netComponents: [],
            statType: '',
            binRange: null,
            binLabel: '',
            rankLevel: null,
            topKLevel: null,
            excludeFromStats: false,
            rollupConfig: null,
          },
        ],
        statsSpec: null,
        derivationHint: null,
        statTestSpec: null,
        basePolicy: 'question_base_shared',
        baseSource: 'questionBase',
        questionBase: 100,
        itemBase: null,
        baseContract: projectTableBaseContract(buildEntryBaseContract({
          totalN: 100,
          questionBase: 100,
          itemBase: null,
          itemBaseRange: null,
          hasVariableItemBases: false,
          variableBaseReason: null,
          rankingDetail: null,
          exclusionReason: null,
        }), {
          basePolicy: 'question_base_shared',
          questionBase: 100,
          itemBase: null,
        }),
        baseText: 'All respondents',
        isDerived: false,
        sortOrder: 0,
        sortBlock: 'Q1',
        surveySection: 'MAIN',
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
        lastModifiedBy: 'TableBlockAssembler',
        notes: [],
      },
    ];

    const adapted = canonicalToComputeTables(canonicalTables);

    expect(adapted).toHaveLength(1);
    expect(adapted[0]!.tableId).toBe('Q1');
    expect(adapted[0]!.sortOrder).toBe(0);
    expect(adapted[0]!.loopDataFrame).toBe('');
    expect(adapted[0]!.lastModifiedBy).toBe('TableBlockAssembler');
    expect(adapted[0]!.rows[0]).toMatchObject({
      variable: 'Q1_1',
      label: 'Option A',
      filterValue: '1',
      isNet: false,
      netComponents: [],
      indent: 0,
    });
    expect(adapted[0]!.computeContext).toMatchObject({
      referenceUniverse: 'total',
      tableMaskIntent: 'none',
      tableMaskRecipe: { kind: 'none' },
      effectiveBaseMode: 'table_mask_then_row_observed_n',
    });
    expect(adapted[0]!.rows[0]!.computeContext).toMatchObject({
      aggregationMode: 'none',
      universeMode: 'masked_row_observed_n',
      sourceVariable: 'Q1_1',
    });
    // Default: no tail exclusions
    expect(adapted[0]!.excludeTailValues).toEqual([]);
  });

  it('passes excludeTailValues from statsSpec to compute table', () => {
    const canonicalTables: CanonicalTable[] = [
      {
        tableId: 'Q5_mean',
        questionId: 'Q5',
        familyRoot: 'Q5',
        sourceTableId: 'Q5',
        splitFromTableId: '',
        tableKind: 'scale_overview_rollup_mean',
        analyticalSubtype: 'scale',
        normalizedType: 'ordinal',
        tableType: 'mean_rows',
        questionText: 'Rate your satisfaction',
        rows: [
          {
            variable: 'Q5_1',
            label: 'Item A',
            filterValue: '',
            rowKind: 'value',
            isNet: false,
            indent: 0,
            netLabel: '',
            netComponents: [],
            statType: '',
            binRange: null,
            binLabel: '',
            rankLevel: null,
            topKLevel: null,
            excludeFromStats: false,
            rollupConfig: null,
          },
        ],
        statsSpec: {
          mean: true,
          meanWithoutOutliers: false,
          median: false,
          stdDev: false,
          stdErr: false,
          valueRange: [1, 7],
          excludeTailValues: [98, 99],
        },
        derivationHint: null,
        statTestSpec: null,
        basePolicy: 'question_base_shared',
        baseSource: 'questionBase',
        baseContract: projectTableBaseContract(buildEntryBaseContract({
          totalN: 100,
          questionBase: 100,
          itemBase: null,
          itemBaseRange: null,
          hasVariableItemBases: false,
          variableBaseReason: null,
          rankingDetail: null,
          exclusionReason: null,
        }), {
          basePolicy: 'question_base_shared',
          questionBase: 100,
          itemBase: null,
        }),
        questionBase: 100,
        itemBase: null,
        baseText: 'All respondents (n=100)',
        isDerived: false,
        sortOrder: 0,
        sortBlock: 'Q5',
        surveySection: 'MAIN',
        userNote: 'Scale: 1 = Very dissatisfied to 7 = Very satisfied',
        tableSubtitle: 'Mean Summary',
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
        lastModifiedBy: 'TableBlockAssembler',
        notes: [],
      },
    ];

    const adapted = canonicalToComputeTables(canonicalTables);

    expect(adapted).toHaveLength(1);
    expect(adapted[0]!.excludeTailValues).toEqual([98, 99]);
    expect(adapted[0]!.computeContext?.rebaseExcludedValues).toEqual([98, 99]);
  });

  it('preserves resolved base contract and WinCross denominator metadata', () => {
    const canonicalTables: CanonicalTable[] = [
      {
        tableId: 'A100a_t2b',
        questionId: 'A100a',
        familyRoot: 'A100a',
        sourceTableId: 'A100a_t2b',
        splitFromTableId: '',
        tableKind: 'scale_overview_rollup_t2b',
        analyticalSubtype: 'scale',
        normalizedType: 'ordinal',
        tableType: 'frequency',
        questionText: 'Top 2 Box summary',
        rows: [
          {
            variable: 'A100a',
            label: 'Vaxneuvance',
            filterValue: '6,7',
            rowKind: 'value',
            isNet: false,
            indent: 0,
            netLabel: '',
            netComponents: [],
            statType: '',
            binRange: null,
            binLabel: '',
            rankLevel: null,
            topKLevel: null,
            excludeFromStats: false,
            rollupConfig: null,
          },
        ],
        statsSpec: {
          mean: false,
          meanWithoutOutliers: false,
          median: false,
          stdDev: false,
          stdErr: false,
          valueRange: null,
          excludeTailValues: [98],
        },
        derivationHint: null,
        statTestSpec: null,
        wincrossDenominatorSemantic: 'sample_base',
        wincrossQualifiedCodes: undefined,
        wincrossFilteredTotalExpr: null,
        resolvedBaseMode: 'table_universe_base',
        resolvedSplitPolicy: 'none',
        resolvedBaseTextTemplate: 'shown_this_question',
        resolvedBaseValidation: {
          tautologicalSplitForbidden: false,
          substantiveRebasingForbidden: true,
          requiresSharedDisplayedBase: true,
        },
        basePolicy: 'question_base_shared',
        baseSource: 'questionBase',
        questionBase: 177,
        itemBase: null,
        baseContract: projectTableBaseContract(buildEntryBaseContract({
          totalN: 177,
          questionBase: 177,
          itemBase: null,
          itemBaseRange: null,
          hasVariableItemBases: false,
          variableBaseReason: null,
          rankingDetail: null,
          exclusionReason: null,
        }), {
          basePolicy: 'question_base_shared',
          questionBase: 177,
          itemBase: null,
        }),
        baseText: 'Respondents shown this question',
        isDerived: true,
        sortOrder: 0,
        sortBlock: 'A100a',
        surveySection: 'SECTION A',
        userNote: '',
        tableSubtitle: 'Top 2 Box Summary',
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
        lastModifiedBy: 'DeterministicBaseEngine',
        notes: [],
      },
    ];

    const adapted = canonicalToComputeTables(canonicalTables);

    expect(adapted[0]).toMatchObject({
      tableKind: 'scale_overview_rollup_t2b',
      wincrossDenominatorSemantic: 'sample_base',
      resolvedBaseMode: 'table_universe_base',
      resolvedSplitPolicy: 'none',
      resolvedBaseTextTemplate: 'shown_this_question',
    });
    expect(adapted[0]!.computeContext).toMatchObject({
      effectiveBaseMode: 'table_mask_shared_n',
      rebasePolicy: 'none',
    });
    expect(adapted[0]!.rows[0]!.computeContext?.universeMode).toBe('masked_shared_table_n');
  });

  it('derives question-universe and precision-item mask recipes deterministically', () => {
    const entryContract = buildEntryBaseContract({
      totalN: 200,
      questionBase: 120,
      itemBase: 75,
      itemBaseRange: [75, 120],
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      rankingDetail: null,
      exclusionReason: null,
    });

    const anchorTable: CanonicalTable = {
      tableId: 'Q7_anchor',
      questionId: 'Q7',
      familyRoot: 'Q7',
      sourceTableId: 'Q7_anchor',
      splitFromTableId: '',
      tableKind: 'standard_overview',
      analyticalSubtype: 'standard',
      normalizedType: 'binary_flag',
      tableType: 'frequency',
      questionText: 'Which items were shown?',
      rows: [
        {
          variable: 'Q7r1',
          label: 'Item A',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
        {
          variable: 'Q7r2',
          label: 'Item B',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      questionBase: 120,
      itemBase: null,
      baseContract: projectTableBaseContract(entryContract, {
        basePolicy: 'question_base_shared',
        questionBase: 120,
        itemBase: null,
      }),
      baseViewRole: 'anchor',
      plannerBaseComparability: 'varying_but_acceptable',
      plannerBaseSignals: ['filtered-base', 'varying-item-bases', 'compute-mask-required'],
      computeRiskSignals: ['compute-mask-required', 'row-base-varies-within-anchor-view'],
      baseDisclosure: {
        referenceBaseN: 120,
        itemBaseRange: [75, 120],
        defaultBaseText: 'Those who were shown Q7',
        defaultNoteTokens: ['anchor-base-varies-by-item'],
        rangeDisclosure: { min: 75, max: 120 },
        source: 'contract',
      },
      baseText: 'Those who were shown Q7',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'Q7',
      surveySection: 'MAIN',
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
      lastModifiedBy: 'TableBlockAssembler',
      notes: [],
    };

    const precisionTable: CanonicalTable = {
      ...anchorTable,
      tableId: 'Q7_item_a',
      sourceTableId: 'Q7_item_a',
      baseViewRole: 'precision',
      appliesToItem: 'Q7r1',
      computeMaskAnchorVariable: 'Q7r1',
      appliesToColumn: 'Q7r1',
      itemBase: 75,
      baseDisclosure: {
        ...anchorTable.baseDisclosure!,
        referenceBaseN: 75,
      },
    };

    const adapted = canonicalToComputeTables([anchorTable, precisionTable]);

    expect(adapted[0]!.computeContext).toMatchObject({
      tableMaskIntent: 'question_universe',
      tableMaskRecipe: { kind: 'any_answered', variables: ['Q7r1', 'Q7r2'] },
      referenceBaseN: 120,
      itemBaseRange: [75, 120],
    });
    expect(adapted[1]!.computeContext).toMatchObject({
      tableMaskIntent: 'precision_item',
      tableMaskRecipe: { kind: 'variable_answered', variable: 'Q7r1' },
      referenceBaseN: 75,
    });
  });

  it('synthesizes a sum-to-100 validity mask for allocation row slices only', () => {
    const entryContract = buildEntryBaseContract({
      totalN: 180,
      questionBase: 180,
      itemBase: 141,
      itemBaseRange: [131, 177],
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      rankingDetail: null,
      exclusionReason: null,
    });

    const baseTable: CanonicalTable = {
      tableId: 'A3a_row_r1',
      questionId: 'A3a',
      familyRoot: 'A3a',
      sourceTableId: 'A3a_row_r1',
      splitFromTableId: '',
      tableKind: 'grid_row_detail',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      tableType: 'mean_rows',
      questionText: 'Allocation row',
      rows: [
        {
          variable: 'A3ar1c1',
          label: 'In addition to statin',
          filterValue: '',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
        {
          variable: 'A3ar1c2',
          label: 'Without a statin',
          filterValue: '',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'item_base',
      baseSource: 'questionBase',
      questionBase: 180,
      itemBase: 141,
      baseContract: projectTableBaseContract(entryContract, {
        basePolicy: 'item_base',
        questionBase: 180,
        itemBase: 141,
      }),
      baseViewRole: 'precision',
      plannerBaseComparability: 'split_recommended',
      plannerBaseSignals: ['varying-item-bases'],
      computeRiskSignals: [],
      sumConstraint: {
        detected: true,
        constraintValue: 100,
        constraintAxis: 'across-cols',
        confidence: 1,
      },
      baseDisclosure: {
        referenceBaseN: 141,
        itemBaseRange: [131, 177],
        defaultBaseText: 'Respondents who reported using the therapy',
        defaultNoteTokens: [],
        rangeDisclosure: { min: 131, max: 177 },
        source: 'contract',
      },
      baseText: 'Respondents who reported using the therapy',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'A3a',
      surveySection: 'MAIN',
      userNote: 'Allocations sum to 100%',
      tableSubtitle: 'Product A (generic)',
      splitReason: null,
      appliesToItem: 'r1',
      computeMaskAnchorVariable: 'A3ar1c1',
      appliesToColumn: 'A3ar1c1,A3ar1c2',
      stimuliSetSlice: null,
      binarySide: null,
      additionalFilter: '',
      exclude: false,
      excludeReason: '',
      filterReviewRequired: false,
      lastModifiedBy: 'TableBlockAssembler',
      notes: [],
    };

    const colTable: CanonicalTable = {
      ...baseTable,
      tableId: 'A3a_col_c2',
      sourceTableId: 'A3a_col_c2',
      tableKind: 'grid_col_detail',
      appliesToItem: 'c2',
      computeMaskAnchorVariable: 'A3ar1c2',
      appliesToColumn: 'A3ar1c2,A3ar2c2,A3ar3c2,A3ar4c2,A3ar5c2',
      tableSubtitle: 'Without a statin',
      rows: [
        { ...baseTable.rows[0]!, variable: 'A3ar1c2', label: 'Product A (generic)' },
        { ...baseTable.rows[0]!, variable: 'A3ar2c2', label: 'Product B (generic)' },
      ],
    };

    const adapted = canonicalToComputeTables([baseTable, colTable]);

    expect(adapted[0]!.computeContext).toMatchObject({
      validityPolicy: 'legacy_expression',
      validityExpression: '(!is.na(`A3ar1c1`) & !is.na(`A3ar1c2`)) & (abs((as.numeric(`A3ar1c1`) + as.numeric(`A3ar1c2`)) - 100) <= 5)',
    });
    expect(adapted[1]!.computeContext).toMatchObject({
      validityPolicy: 'none',
      validityExpression: null,
    });
  });

  it('prefers explicit compute mask anchors for precision grid slices', () => {
    const contract = projectTableBaseContract(buildEntryBaseContract({
      totalN: 177,
      questionBase: 86,
      itemBase: 43,
      itemBaseRange: [0, 86],
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'item_base',
      questionBase: 86,
      itemBase: 43,
    });

    const table: CanonicalTable = {
      tableId: 'D300b_r1',
      questionId: 'D300b',
      familyRoot: 'D300b',
      sourceTableId: 'D300b_r1',
      splitFromTableId: '',
      tableKind: 'grid_row_detail',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      tableType: 'frequency',
      questionText: 'Allocation grid',
      rows: [
        {
          variable: 'D300br1c1',
          label: 'Original',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
        {
          variable: 'D300br1c2',
          label: 'Story',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'item_base',
      baseSource: 'items[].itemBase',
      questionBase: 86,
      itemBase: 43,
      baseContract: contract,
      baseViewRole: 'precision',
      plannerBaseComparability: 'split_recommended',
      plannerBaseSignals: ['filtered-base', 'varying-item-bases', 'low-base'],
      computeRiskSignals: ['compute-mask-required'],
      baseDisclosure: {
        referenceBaseN: 43,
        itemBaseRange: [0, 86],
        defaultBaseText: 'Respondents shown selected item',
        defaultNoteTokens: ['low-base-caution'],
        rangeDisclosure: null,
        source: 'contract',
      },
      baseText: 'Respondents shown selected item',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'D300b',
      surveySection: 'MAIN',
      userNote: '',
      tableSubtitle: 'r1',
      splitReason: 'genuine_variable_item_bases',
      appliesToItem: 'r1',
      computeMaskAnchorVariable: 'D300br1c1',
      appliesToColumn: 'D300br1c1,D300br1c2',
      stimuliSetSlice: null,
      binarySide: null,
      additionalFilter: '',
      exclude: false,
      excludeReason: '',
      filterReviewRequired: false,
      lastModifiedBy: 'TableBlockAssembler',
      notes: [],
    };

    const adapted = canonicalToComputeTables([table]);
    expect(adapted[0]!.computeContext).toMatchObject({
      tableMaskIntent: 'precision_item',
      tableMaskRecipe: { kind: 'variable_answered', variable: 'D300br1c1' },
      referenceBaseN: 43,
    });
  });

  it('uses shared question universes for ranking-artifact precision tables', () => {
    const contract = projectTableBaseContract(buildEntryBaseContract({
      totalN: 177,
      questionBase: 177,
      itemBase: 67,
      itemBaseRange: [45, 89],
      hasVariableItemBases: true,
      variableBaseReason: 'ranking-artifact',
      rankingDetail: { K: 5 },
      exclusionReason: null,
    }), {
      basePolicy: 'question_base_shared',
      questionBase: 177,
      itemBase: 67,
    });

    const table: CanonicalTable = {
      tableId: 'B500_1_item_r101',
      questionId: 'B500_1',
      familyRoot: 'B500_1',
      sourceTableId: 'B500_1_item_r101',
      splitFromTableId: '',
      tableKind: 'ranking_item_rank',
      analyticalSubtype: 'ranking',
      normalizedType: 'categorical_select',
      tableType: 'frequency',
      questionText: 'Rank your top 5 messages',
      rows: [
        {
          variable: 'B500_1r101',
          label: 'Ranked 1st',
          filterValue: '1',
          rowKind: 'rank',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: 1,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
        {
          variable: 'B500_1r101',
          label: 'Top 2',
          filterValue: '1-2',
          rowKind: 'topk',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: 2,
          excludeFromStats: false,
          rollupConfig: null,
        },
        {
          variable: 'B500_1r101',
          label: 'Not Ranked',
          filterValue: '',
          rowKind: 'not_answered',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      questionBase: 177,
      itemBase: 67,
      baseContract: contract,
      baseViewRole: 'precision',
      plannerBaseComparability: 'varying_but_acceptable',
      plannerBaseSignals: ['varying-item-bases', 'ranking-artifact'],
      computeRiskSignals: ['compute-mask-required'],
      baseDisclosure: {
        referenceBaseN: 177,
        itemBaseRange: [45, 89],
        defaultBaseText: 'Total respondents',
        defaultNoteTokens: [],
        rangeDisclosure: null,
        source: 'contract',
      },
      baseText: 'Total respondents',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'B500_1',
      surveySection: 'MAIN',
      userNote: '',
      tableSubtitle: 'Message 101',
      splitReason: 'ranking_artifact_variable_bases',
      appliesToItem: 'B500_1r101',
      computeMaskAnchorVariable: 'B500_1r101',
      appliesToColumn: 'B500_1r101',
      stimuliSetSlice: null,
      binarySide: null,
      additionalFilter: '',
      exclude: false,
      excludeReason: '',
      filterReviewRequired: false,
      lastModifiedBy: 'TableBlockAssembler',
      notes: [],
    };

    const adapted = canonicalToComputeTables([table]);

    expect(adapted[0]!.computeContext).toMatchObject({
      tableMaskIntent: 'none',
      tableMaskRecipe: { kind: 'none' },
      referenceBaseN: 177,
    });
    expect(adapted[0]!.rows.map(row => row.computeContext?.universeMode)).toEqual([
      'masked_shared_table_n',
      'masked_shared_table_n',
      'masked_shared_table_n',
    ]);
  });

  it('falls back to the first structural variable for legacy precision grid slices and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const contract = projectTableBaseContract(buildEntryBaseContract({
      totalN: 177,
      questionBase: 86,
      itemBase: 43,
      itemBaseRange: [0, 86],
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'item_base',
      questionBase: 86,
      itemBase: 43,
    });

    const table: CanonicalTable = {
      tableId: 'D300b_legacy_r1',
      questionId: 'D300b',
      familyRoot: 'D300b',
      sourceTableId: 'D300b_legacy_r1',
      splitFromTableId: '',
      tableKind: 'grid_row_detail',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      tableType: 'frequency',
      questionText: 'Allocation grid',
      rows: [
        {
          variable: 'D300br1c1',
          label: 'Original',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
        {
          variable: 'D300br1c2',
          label: 'Story',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'item_base',
      baseSource: 'items[].itemBase',
      questionBase: 86,
      itemBase: 43,
      baseContract: contract,
      baseViewRole: 'precision',
      plannerBaseComparability: 'split_recommended',
      plannerBaseSignals: ['filtered-base', 'varying-item-bases', 'low-base'],
      computeRiskSignals: ['compute-mask-required'],
      baseDisclosure: {
        referenceBaseN: 43,
        itemBaseRange: [0, 86],
        defaultBaseText: 'Respondents shown selected item',
        defaultNoteTokens: ['low-base-caution'],
        rangeDisclosure: null,
        source: 'contract',
      },
      baseText: 'Respondents shown selected item',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'D300b',
      surveySection: 'MAIN',
      userNote: '',
      tableSubtitle: 'r1',
      splitReason: 'genuine_variable_item_bases',
      appliesToItem: 'r1',
      computeMaskAnchorVariable: null,
      appliesToColumn: 'D300br1c1,D300br1c2',
      stimuliSetSlice: null,
      binarySide: null,
      additionalFilter: '',
      exclude: false,
      excludeReason: '',
      filterReviewRequired: false,
      lastModifiedBy: 'TableBlockAssembler',
      notes: [],
    };

    const adapted = canonicalToComputeTables([table]);

    expect(adapted[0]!.computeContext?.tableMaskRecipe).toEqual({
      kind: 'variable_answered',
      variable: 'D300br1c1',
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing an explicit mask anchor'));
    warnSpy.mockRestore();
  });

  it('marks model-derived tables with model masks and model row universes', () => {
    const contract = projectTableBaseContract(buildEntryBaseContract({
      totalN: 100,
      questionBase: 100,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'score_family_model_base',
      questionBase: 100,
      itemBase: null,
    });

    const table: CanonicalTable = {
      tableId: 'MODEL_1',
      questionId: 'MODEL_1',
      familyRoot: 'MODEL_1',
      sourceTableId: 'MODEL_1',
      splitFromTableId: '',
      tableKind: 'maxdiff_api',
      analyticalSubtype: 'maxdiff',
      normalizedType: 'score_model',
      tableType: 'mean_rows',
      questionText: 'Model output',
      rows: [
        {
          variable: 'MODEL_SCORE',
          label: 'API',
          filterValue: '',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'score_family_model_base',
      baseSource: 'model',
      questionBase: 100,
      itemBase: null,
      baseContract: contract,
      baseViewRole: 'anchor',
      plannerBaseComparability: 'shared',
      plannerBaseSignals: ['model-derived-base'],
      computeRiskSignals: [],
      baseDisclosure: {
        referenceBaseN: 100,
        itemBaseRange: null,
        defaultBaseText: 'Model-derived base',
        defaultNoteTokens: [],
        rangeDisclosure: null,
        source: 'contract',
      },
      baseText: 'Model-derived base',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'MODEL',
      surveySection: 'MODEL',
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
      lastModifiedBy: 'TableBlockAssembler',
      notes: [],
    };

    const adapted = canonicalToComputeTables([table]);
    expect(adapted[0]!.computeContext).toMatchObject({
      referenceUniverse: 'model',
      tableMaskIntent: 'model',
      tableMaskRecipe: { kind: 'model' },
      effectiveBaseMode: 'model',
    });
    expect(adapted[0]!.rows[0]!.computeContext?.universeMode).toBe('model');
  });
});

describe('buildComputePackageFromPlan', () => {
  it('derives cutsSpec from crosstab plan and assembles package', () => {
    const crosstabPlan = makeCrosstabPlan();
    const tables = makeTables();
    const statConfig = makeStatConfig();

    const result = buildComputePackageFromPlan(crosstabPlan, tables, statConfig);

    // Should have Total + 3 banner columns (2 Gender + 1 Age)
    expect(result.rScriptInput.cuts.length).toBe(4); // Total + Male + Female + 18-34
    expect(result.rScriptInput.cuts[0].name).toBe('Total');
    expect(result.cutsSpec.totalCut).toBeDefined();
    expect(result.cutsSpec.totalCut?.statLetter).toBe('T');
    expect(result.routeMetadata.tableCount).toBe(tables.length);
  });

  it('passes optional loop/weight parameters through', () => {
    const result = buildComputePackageFromPlan(
      makeCrosstabPlan(),
      makeTables(),
      makeStatConfig(),
      { weightVariable: 'wt', loopStatTestingMode: 'suppress' },
    );

    expect(result.rScriptInput.weightVariable).toBe('wt');
    expect(result.rScriptInput.loopStatTestingMode).toBe('suppress');
  });

  it('handles empty crosstab plan with Total-only cuts', () => {
    const result = buildComputePackageFromPlan(
      { bannerCuts: [] },
      makeTables(),
      makeStatConfig(),
    );

    expect(result.rScriptInput.cuts).toHaveLength(1);
    expect(result.rScriptInput.cuts[0].name).toBe('Total');
    expect(result.rScriptInput.cutGroups).toHaveLength(1);
    expect(result.rScriptInput.cutGroups?.[0].groupName).toBe('Total');
  });

  it('filters out zero-confidence columns via buildCutsSpec', () => {
    const result = buildComputePackageFromPlan(
      {
        bannerCuts: [
          {
            groupName: 'Gender',
            columns: [
              {
                name: 'Male',
                adjusted: 'Q2 == 1',
                confidence: 0.95,
                reasoning: 'Direct mapping',
                userSummary: 'Male respondents',
                alternatives: [],
                uncertainties: [],
                expressionType: 'direct_variable',
              },
              {
                name: 'Female',
                adjusted: 'Q2 == 2',
                confidence: 0,
                reasoning: 'Failed mapping',
                userSummary: 'Female respondents',
                alternatives: [],
                uncertainties: [],
                expressionType: 'direct_variable',
              },
            ],
          },
        ],
      },
      makeTables(),
      makeStatConfig(),
    );

    expect(result.rScriptInput.cuts.map(c => c.name)).toEqual(['Total', 'Male']);
    expect(result.rScriptInput.cutGroups).toHaveLength(2); // Total + Gender
    expect(result.rScriptInput.cutGroups?.[1].cuts).toHaveLength(1);
  });
});

// =============================================================================
// runPostRQc Tests
// =============================================================================

describe('runPostRQc', () => {
  it('passes when compute package is valid', () => {
    const pkg = buildComputePackage({
      tables: makeTables(),
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error when no tables', () => {
    const pkg = buildComputePackage({
      tables: [] as unknown as TableWithLoopFrame[],
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No tables in compute package');
  });

  it('warns when only Total cut present', () => {
    const cutsSpec: CutsSpec = {
      cuts: [{ id: 'total.total', name: 'Total', rExpression: 'rep(TRUE, nrow(data))', statLetter: 'T', groupName: 'Total', groupIndex: 0, reviewAction: 'ai_original', reviewHint: '', preReviewExpression: '' }],
      groups: [{ groupName: 'Total', cuts: [{ id: 'total.total', name: 'Total', rExpression: 'rep(TRUE, nrow(data))', statLetter: 'T', groupName: 'Total', groupIndex: 0, reviewAction: 'ai_original', reviewHint: '', preReviewExpression: '' }] }],
      totalCut: { id: 'total.total', name: 'Total', rExpression: 'rep(TRUE, nrow(data))', statLetter: 'T', groupName: 'Total', groupIndex: 0, reviewAction: 'ai_original', reviewHint: '', preReviewExpression: '' },
    };

    const pkg = buildComputePackage({
      tables: makeTables(),
      cutsSpec,
      statTestingConfig: makeStatConfig(),
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Only Total cut'))).toBe(true);
  });

  it('reports error for invalid thresholds', () => {
    const badConfig: StatTestingConfig = {
      thresholds: [1.5],
      proportionTest: 'unpooled_z',
      meanTest: 'welch_t',
      minBase: 0,
    };

    const pkg = buildComputePackage({
      tables: makeTables(),
      cutsSpec: makeCutsSpec(),
      statTestingConfig: badConfig,
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid significance threshold'))).toBe(true);
  });

  it('does not warn on duplicate stat letters when a banner exceeds 19 non-total cuts', () => {
    const largeBannerPlan: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Large Banner',
          columns: Array.from({ length: 21 }, (_, index) => ({
            name: `Column ${index + 1}`,
            adjusted: `Q2 == ${index + 1}`,
            confidence: 0.95,
            reasoning: 'Direct mapping',
            userSummary: `Column ${index + 1}`,
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable' as const,
          })),
        },
      ],
    };

    const cutsSpec = buildCutsSpec(largeBannerPlan);
    const pkg = buildComputePackage({
      tables: makeTables(),
      cutsSpec,
      statTestingConfig: makeStatConfig(),
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Duplicate stat letters detected'))).toBe(false);
    expect(new Set(pkg.rScriptInput.cuts.map(c => c.statLetter)).size).toBe(pkg.rScriptInput.cuts.length);
  });

  it('fails when a compute-mask-required table has no mask recipe', () => {
    const table = {
      ...makeTables()[0]!,
      computeContext: {
        version: 1,
        referenceUniverse: 'question',
        effectiveBaseMode: 'table_mask_then_row_observed_n',
        tableMaskIntent: 'precision_item',
        tableMaskRecipe: null,
        rebasePolicy: 'none',
        rebaseSourceVariables: [],
        rebaseExcludedValues: [],
        validityPolicy: 'none',
        validityExpression: null,
        referenceBaseN: 100,
        itemBaseRange: [60, 100] as [number, number],
        baseViewRole: 'precision',
        plannerBaseComparability: 'split_recommended',
        plannerBaseSignals: ['filtered-base'],
        computeRiskSignals: ['compute-mask-required'],
        legacyCompatibility: {
          basePolicy: 'item_base',
          additionalFilter: '',
        },
      },
    } as TableWithLoopFrame;

    const pkg = buildComputePackage({
      tables: [table],
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('requires a compute mask'))).toBe(true);
  });

  it('passes post-R QC for compute-mask-required precision grid slices with explicit anchors', () => {
    const contract = projectTableBaseContract(buildEntryBaseContract({
      totalN: 177,
      questionBase: 86,
      itemBase: 43,
      itemBaseRange: [0, 86],
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'item_base',
      questionBase: 86,
      itemBase: 43,
    });

    const canonicalTable: CanonicalTable = {
      tableId: 'D300b_r1',
      questionId: 'D300b',
      familyRoot: 'D300b',
      sourceTableId: 'D300b_r1',
      splitFromTableId: '',
      tableKind: 'grid_row_detail',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      tableType: 'frequency',
      questionText: 'Allocation grid',
      rows: [
        {
          variable: 'D300br1c1',
          label: 'Original',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
        {
          variable: 'D300br1c2',
          label: 'Story',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'item_base',
      baseSource: 'items[].itemBase',
      questionBase: 86,
      itemBase: 43,
      baseContract: contract,
      baseViewRole: 'precision',
      plannerBaseComparability: 'split_recommended',
      plannerBaseSignals: ['filtered-base', 'varying-item-bases', 'low-base'],
      computeRiskSignals: ['compute-mask-required'],
      baseDisclosure: {
        referenceBaseN: 43,
        itemBaseRange: [0, 86],
        defaultBaseText: 'Respondents shown selected item',
        defaultNoteTokens: ['low-base-caution'],
        rangeDisclosure: null,
        source: 'contract',
      },
      baseText: 'Respondents shown selected item',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'D300b',
      surveySection: 'MAIN',
      userNote: '',
      tableSubtitle: 'r1',
      splitReason: 'genuine_variable_item_bases',
      appliesToItem: 'r1',
      computeMaskAnchorVariable: 'D300br1c1',
      appliesToColumn: 'D300br1c1,D300br1c2',
      stimuliSetSlice: null,
      binarySide: null,
      additionalFilter: '',
      exclude: false,
      excludeReason: '',
      filterReviewRequired: false,
      lastModifiedBy: 'TableBlockAssembler',
      notes: [],
    };

    const adapted = canonicalToComputeTables([canonicalTable]);
    const pkg = buildComputePackage({
      tables: adapted,
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects simplified-base tables that still carry hidden denominator drift signals', () => {
    const table = {
      ...makeTables()[0]!,
      tableId: 'A100a_t2b',
      questionId: 'A100a',
      baseText: 'Base varies by item',
      tableKind: 'scale_overview_rollup_t2b',
      resolvedBaseMode: 'table_universe_base',
      resolvedSplitPolicy: 'none',
      resolvedBaseTextTemplate: 'shown_this_question',
      resolvedBaseValidation: {
        tautologicalSplitForbidden: false,
        substantiveRebasingForbidden: true,
        requiresSharedDisplayedBase: true,
      },
      computeContext: {
        version: 1,
        referenceUniverse: 'question',
        effectiveBaseMode: 'table_mask_then_row_observed_n',
        tableMaskIntent: 'question_universe',
        tableMaskRecipe: { kind: 'any_answered', variables: ['A100a'] },
        rebasePolicy: 'exclude_non_substantive_tail',
        rebaseSourceVariables: ['A100a'],
        rebaseExcludedValues: [98],
        validityPolicy: 'none',
        validityExpression: null,
        referenceBaseN: 177,
        itemBaseRange: null,
        baseViewRole: 'anchor',
        plannerBaseComparability: 'shared',
        plannerBaseSignals: [],
        computeRiskSignals: [],
        legacyCompatibility: {
          basePolicy: 'question_base_shared',
          additionalFilter: '',
        },
      },
    } as unknown as TableWithLoopFrame;

    const pkg = buildComputePackage({
      tables: [table],
      cutsSpec: makeCutsSpec(),
      statTestingConfig: makeStatConfig(),
    });

    const result = runPostRQc({
      rScriptInput: pkg.rScriptInput,
      cutsSpec: pkg.cutsSpec,
      outputDir: '/tmp/test',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Table "A100a_t2b" violates shared displayed base contract',
      'Table "A100a_t2b" still carries a substantive rebase policy',
      'Table "A100a_t2b" uses legacy base text that conflicts with the simplified base contract',
    ]));
  });
});

// =============================================================================
// runComputePipeline Orchestrator Tests
// =============================================================================

describe('runComputePipeline orchestrator', () => {
  it('runs stages 22 -> 14, writes artifacts, and records checkpoint progression', async () => {
    const outputDir = await makeTempOutputDir();
    const input = makeComputeInput(outputDir);

    const result = await runComputePipeline(input);

    // Verify result shape
    expect(result.rScriptInput).toBeDefined();
    expect(result.rScriptInput.tables).toHaveLength(1);
    expect(result.rScriptInput.cuts.length).toBeGreaterThan(0);
    expect(result.cutsSpec).toBeDefined();
    expect(result.statTestingConfig).toBeDefined();
    expect(result.routeMetadata).toBeDefined();

    // Verify canonical artifact written (22-compute-package.json for stage 22)
    const computeDir = path.join(outputDir, 'compute');
    const rScriptInputArtifact = JSON.parse(
      await fs.readFile(path.join(computeDir, '22-compute-package.json'), 'utf-8'),
    );
    expect(rScriptInputArtifact.tables).toHaveLength(1);
    expect(rScriptInputArtifact.cuts.length).toBeGreaterThan(0);

    // Verify supplementary artifacts
    const cutsSpecArtifact = JSON.parse(
      await fs.readFile(path.join(computeDir, 'cuts-spec.json'), 'utf-8'),
    );
    expect(cutsSpecArtifact.cuts).toBeDefined();
    expect(cutsSpecArtifact.groups).toBeDefined();

    const statConfigArtifact = JSON.parse(
      await fs.readFile(path.join(computeDir, 'stat-testing-config.json'), 'utf-8'),
    );
    expect(statConfigArtifact.thresholds).toBeDefined();

    const routeMetaArtifact = JSON.parse(
      await fs.readFile(path.join(computeDir, 'compute-route-metadata.json'), 'utf-8'),
    );
    expect(routeMetaArtifact.tableCount).toBe(1);

    // Verify post-R QC report written
    const qcReport = JSON.parse(
      await fs.readFile(path.join(computeDir, 'post-r-qc-report.json'), 'utf-8'),
    );
    expect(qcReport.valid).toBe(true);

    // Verify checkpoint
    const checkpoint = JSON.parse(
      await fs.readFile(path.join(outputDir, V3_CHECKPOINT_FILENAME), 'utf-8'),
    );
    expect(checkpoint.lastCompletedStage).toBe('14');
    expect(checkpoint.nextStage).toBeNull();
    expect(checkpoint.completedStages.map((s: { completedStage: string }) => s.completedStage)).toEqual(['22', '14']);
  });

  it('uses wizard stat testing overrides when provided', async () => {
    const outputDir = await makeTempOutputDir();
    const input = makeComputeInput(outputDir);
    input.wizardStatTesting = { thresholds: [95, 90], minBase: 25 };

    const result = await runComputePipeline(input);

    expect(result.statTestingConfig.thresholds).toEqual([0.05, 0.10]);
    expect(result.statTestingConfig.minBase).toBe(25);
    expect(result.rScriptInput.significanceThresholds).toEqual([0.05, 0.10]);
  });

  it('uses explicit stat config when provided', async () => {
    const outputDir = await makeTempOutputDir();
    const input = makeComputeInput(outputDir);
    input.statTestingConfig = {
      thresholds: [0.01],
      proportionTest: 'pooled_z',
      meanTest: 'student_t',
      minBase: 50,
    };

    const result = await runComputePipeline(input);

    expect(result.statTestingConfig.thresholds).toEqual([0.01]);
    expect(result.statTestingConfig.proportionTest).toBe('pooled_z');
  });

  it('resumes from stage 22 artifact and skips to stage 14', async () => {
    const outputDir = await makeTempOutputDir();
    const computeDir = path.join(outputDir, 'compute');
    await fs.mkdir(computeDir, { recursive: true });

    // Write stage 22 artifacts
    const pkg = buildComputePackageFromPlan(
      makeCrosstabPlan(),
      makeTables(),
      makeStatConfig(),
    );

    await fs.writeFile(
      path.join(computeDir, '22-compute-package.json'),
      JSON.stringify(pkg.rScriptInput, null, 2),
      'utf-8',
    );
    await fs.writeFile(
      path.join(computeDir, 'cuts-spec.json'),
      JSON.stringify(pkg.cutsSpec, null, 2),
      'utf-8',
    );
    await fs.writeFile(
      path.join(computeDir, 'compute-route-metadata.json'),
      JSON.stringify(pkg.routeMetadata, null, 2),
      'utf-8',
    );

    // Write checkpoint for stage 22 complete
    let checkpoint = createPipelineCheckpoint('compute-test', 'test-dataset');
    checkpoint = recordStageCompletion(
      checkpoint,
      '22',
      100,
      path.join(computeDir, '22-compute-package.json'),
    );
    await fs.writeFile(
      path.join(outputDir, V3_CHECKPOINT_FILENAME),
      JSON.stringify(checkpoint, null, 2),
      'utf-8',
    );

    const input = makeComputeInput(outputDir);
    const result = await runComputePipeline(input);

    // Should have completed stage 14 after resuming from 22
    expect(result.checkpoint.lastCompletedStage).toBe('14');
    expect(result.checkpoint.nextStage).toBeNull();

    // rScriptInput should be restored from artifact
    expect(result.rScriptInput.tables).toHaveLength(1);
    expect(result.rScriptInput.cuts.length).toBeGreaterThan(0);
  });

  it('resumes from stage 14 (all stages complete)', async () => {
    const outputDir = await makeTempOutputDir();
    const computeDir = path.join(outputDir, 'compute');
    await fs.mkdir(computeDir, { recursive: true });

    // Write both stage artifacts
    const pkg = buildComputePackageFromPlan(
      makeCrosstabPlan(),
      makeTables(),
      makeStatConfig(),
    );

    await fs.writeFile(
      path.join(computeDir, '22-compute-package.json'),
      JSON.stringify(pkg.rScriptInput, null, 2),
      'utf-8',
    );
    await fs.writeFile(
      path.join(computeDir, 'cuts-spec.json'),
      JSON.stringify(pkg.cutsSpec, null, 2),
      'utf-8',
    );
    await fs.writeFile(
      path.join(computeDir, 'post-r-qc-report.json'),
      JSON.stringify({ valid: true, warnings: [], errors: [] }, null, 2),
      'utf-8',
    );

    let checkpoint = createPipelineCheckpoint('compute-test', 'test-dataset');
    checkpoint = recordStageCompletion(checkpoint, '22', 100, path.join(computeDir, '22-compute-package.json'));
    checkpoint = recordStageCompletion(checkpoint, '14', 50, computeDir);
    await fs.writeFile(
      path.join(outputDir, V3_CHECKPOINT_FILENAME),
      JSON.stringify(checkpoint, null, 2),
      'utf-8',
    );

    const input = makeComputeInput(outputDir);
    const result = await runComputePipeline(input);

    // All stages already complete — no stages executed, result constructed from artifacts
    expect(result.checkpoint.lastCompletedStage).toBe('14');
    expect(result.rScriptInput).toBeDefined();
  });

  it('restarts from stage 22 when checkpoint says complete but artifact is missing', async () => {
    const outputDir = await makeTempOutputDir();

    // Write checkpoint claiming stage 22 complete, but don't write the artifact
    let checkpoint = createPipelineCheckpoint('compute-test', 'test-dataset');
    checkpoint = recordStageCompletion(
      checkpoint,
      '22',
      100,
      path.join(outputDir, 'compute', '22-compute-package.json'),
    );
    await fs.writeFile(
      path.join(outputDir, V3_CHECKPOINT_FILENAME),
      JSON.stringify(checkpoint, null, 2),
      'utf-8',
    );

    const input = makeComputeInput(outputDir);
    const result = await runComputePipeline(input);

    // Should have re-executed both stages
    expect(result.checkpoint.completedStages.map(
      (s: { completedStage: string }) => s.completedStage,
    )).toEqual(['22', '14']);
    expect(result.rScriptInput).toBeDefined();
  });

  it('handles abort signal before stage 14', async () => {
    const outputDir = await makeTempOutputDir();
    const controller = new AbortController();

    const input = makeComputeInput(outputDir);
    input.abortSignal = controller.signal;

    // Abort after stage 22 would complete but before stage 14 starts
    // We'll abort immediately — stage 22 may or may not complete
    // depending on timing, but the pipeline should not throw
    controller.abort();

    await expect(runComputePipeline(input)).rejects.toThrow(
      'Compute pipeline incomplete',
    );
  });

  it('includes loop and weight context in compute output', async () => {
    const outputDir = await makeTempOutputDir();
    const input = makeComputeInput(outputDir);
    input.weightVariable = 'wt';
    input.loopStatTestingMode = 'suppress';

    const result = await runComputePipeline(input);

    expect(result.rScriptInput.weightVariable).toBe('wt');
    expect(result.rScriptInput.loopStatTestingMode).toBe('suppress');
  });

  it('assigns loopDataFrame during stage 22 without changing canonicalToComputeTables defaults', async () => {
    const outputDir = await makeTempOutputDir();
    const canonicalTable: CanonicalTable = {
      tableId: 'A2_standard_overview',
      questionId: 'A2',
      familyRoot: 'A2',
      sourceTableId: 'A2_1_standard_overview',
      splitFromTableId: '',
      tableKind: 'standard_overview',
      analyticalSubtype: 'standard',
      normalizedType: 'single_select',
      tableType: 'frequency',
      questionText: 'Looped question A2',
      rows: [
        {
          variable: 'A2',
          label: 'Option 1',
          filterValue: '1',
          rowKind: 'value',
          isNet: false,
          indent: 0,
          netLabel: '',
          netComponents: [],
          statType: '',
          binRange: null,
          binLabel: '',
          rankLevel: null,
          topKLevel: null,
          excludeFromStats: false,
          rollupConfig: null,
        },
      ],
      statsSpec: null,
      derivationHint: null,
      statTestSpec: null,
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      questionBase: 7420,
      itemBase: null,
      baseContract: projectTableBaseContract(buildEntryBaseContract({
        totalN: 7420,
        questionBase: 7420,
        itemBase: null,
        itemBaseRange: null,
        hasVariableItemBases: false,
        variableBaseReason: null,
        rankingDetail: null,
        exclusionReason: null,
      }), {
        basePolicy: 'question_base_shared',
        questionBase: 7420,
        itemBase: null,
      }),
      baseText: 'Those shown A2 across loop iterations',
      isDerived: false,
      sortOrder: 0,
      sortBlock: 'A2',
      surveySection: 'MAIN',
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
      lastModifiedBy: 'canonical-assembly',
      notes: [],
    };

    const adapted = canonicalToComputeTables([canonicalTable]);
    expect(adapted).toHaveLength(1);
    expect(adapted[0]!.loopDataFrame).toBe('');

    const loopMappings: LoopGroupMapping[] = [
      {
        familyBase: 'A2',
        stackedFrameName: 'stacked_loop_1',
        skeleton: 'A2_{N}',
        iterations: ['1', '2'],
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
    ];

    const input: ComputeChainInput = {
      ...makeComputeInput(outputDir),
      tables: adapted,
      loopMappings,
    };

    const result = await runComputePipeline(input);

    expect(result.rScriptInput.tables).toHaveLength(1);
    expect(result.rScriptInput.tables[0]!.loopDataFrame).toBe('stacked_loop_1');
    expect(result.rScriptInput.tables[0]!.rows[0]!.variable).toBe('A2');
  });
});

// =============================================================================
// Checkpoint Progression Tests
// =============================================================================

describe('checkpoint progression through 22 -> 14 boundary', () => {
  it('checkpoint after stage 22 has nextStage = 14', async () => {
    let checkpoint = createPipelineCheckpoint('test', 'dataset');
    checkpoint = recordStageCompletion(checkpoint, '22', 100);
    expect(checkpoint.nextStage).toBe('14');
    expect(checkpoint.lastCompletedStage).toBe('22');
  });

  it('checkpoint after stage 14 has nextStage = null (pipeline complete)', async () => {
    let checkpoint = createPipelineCheckpoint('test', 'dataset');
    checkpoint = recordStageCompletion(checkpoint, '22', 100);
    checkpoint = recordStageCompletion(checkpoint, '14', 50);
    expect(checkpoint.nextStage).toBeNull();
    expect(checkpoint.lastCompletedStage).toBe('14');
  });

  it('full pipeline checkpoint progresses through all stages correctly', async () => {
    const outputDir = await makeTempOutputDir();
    const input = makeComputeInput(outputDir);

    const result = await runComputePipeline(input);

    const stages = result.checkpoint.completedStages.map(
      (s: { completedStage: string }) => s.completedStage,
    );
    expect(stages).toEqual(['22', '14']);

    // Each stage has duration
    for (const stage of result.checkpoint.completedStages) {
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
