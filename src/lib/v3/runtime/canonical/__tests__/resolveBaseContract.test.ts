import { describe, expect, it } from 'vitest';

import { buildEntryBaseContract, projectTableBaseContract } from '../../baseContract';
import { resolveCanonicalBaseContract } from '../resolveBaseContract';
import type { CanonicalTable, CanonicalTableOutput, CanonicalRow } from '../types';

function makeRow(overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    variable: 'Q1_1',
    label: 'Yes',
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
    ...overrides,
  };
}

function makeTable(overrides: Partial<CanonicalTable> = {}): CanonicalTable {
  const basePolicy = overrides.basePolicy ?? 'total_base';
  const questionBase = overrides.questionBase ?? 200;
  const itemBase = overrides.itemBase ?? null;
  return {
    tableId: 'T1',
    questionId: 'Q1',
    familyRoot: 'Q1',
    sourceTableId: 'T1',
    splitFromTableId: '',
    tableKind: 'standard_overview',
    analyticalSubtype: 'standard',
    normalizedType: 'categorical_select',
    tableType: 'frequency',
    questionText: 'Question 1',
    rows: [makeRow()],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    wincrossDenominatorSemantic: 'answering_base',
    basePolicy,
    baseSource: 'question',
    questionBase,
    itemBase,
    baseContract: projectTableBaseContract(buildEntryBaseContract({
      totalN: 200,
      questionBase,
      itemBase,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy,
      questionBase,
      itemBase,
    }),
    baseText: '',
    isDerived: false,
    sortOrder: 0,
    sortBlock: 'A',
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
    lastModifiedBy: 'CanonicalAssembler',
    notes: [],
    ...overrides,
  };
}

function makeOutput(tables: CanonicalTable[]): CanonicalTableOutput {
  return {
    metadata: {
      generatedAt: '2026-04-01T00:00:00.000Z',
      assemblerVersion: '13d-test',
      dataset: 'test',
      inputPlanPath: '',
      inputQuestionIdPath: '',
      totalTables: tables.length,
    },
    summary: {
      byTableKind: {},
      byTableType: {},
      byAnalyticalSubtype: {},
      totalRows: 0,
    },
    tables,
  };
}

describe('resolveCanonicalBaseContract', () => {
  it('resolves overview tables to total_base with shared displayed base', () => {
    const result = resolveCanonicalBaseContract(makeOutput([
      makeTable({
        tableKind: 'standard_overview',
        basePolicy: 'total_base',
      }),
    ]));

    expect(result.tables[0]).toMatchObject({
      resolvedBaseMode: 'total_base',
      resolvedSplitPolicy: 'none',
      resolvedBaseTextTemplate: 'total_respondents',
      baseText: 'Total respondents',
      wincrossDenominatorSemantic: 'sample_base',
    });
    expect(result.tables[0]?.baseContract.policy).toMatchObject({
      effectiveBaseMode: 'table_mask_shared_n',
      rebasePolicy: 'none',
    });
  });

  it('resolves filtered shared-universe tables to shown_this_question', () => {
    const result = resolveCanonicalBaseContract(makeOutput([
      makeTable({
        tableKind: 'standard_overview',
        basePolicy: 'question_base_shared',
        questionBase: 150,
      }),
    ]));

    expect(result.tables[0]).toMatchObject({
      resolvedBaseMode: 'table_universe_base',
      resolvedBaseTextTemplate: 'shown_this_question',
      baseText: 'Respondents shown this question',
      wincrossDenominatorSemantic: 'sample_base',
    });
  });

  it('keeps meaningful item-level splits on shown_this_item', () => {
    const result = resolveCanonicalBaseContract(makeOutput([
      makeTable({
        tableKind: 'standard_item_detail',
        basePolicy: 'item_base',
        questionBase: 150,
        itemBase: 90,
        appliesToItem: 'Q1_1',
        rows: [
          makeRow({ variable: 'Q1_1', filterValue: '1' }),
          makeRow({ variable: 'Q1_1', filterValue: '2', label: 'No' }),
        ],
      }),
    ]));

    expect(result.tables[0]).toMatchObject({
      resolvedBaseMode: 'table_universe_base',
      resolvedSplitPolicy: 'required',
      resolvedBaseTextTemplate: 'shown_this_item',
      baseText: 'Respondents shown this item',
      wincrossDenominatorSemantic: 'answering_base',
    });
  });

  it('collapses tautological item-level splits back to shown_this_question', () => {
    const result = resolveCanonicalBaseContract(makeOutput([
      makeTable({
        tableKind: 'standard_item_detail',
        basePolicy: 'item_base',
        questionBase: 150,
        itemBase: 90,
        appliesToItem: 'Q1_1',
        rows: [makeRow({ variable: 'Q1_1', filterValue: '1' })],
      }),
    ]));

    expect(result.tables[0]).toMatchObject({
      resolvedBaseMode: 'table_universe_base',
      resolvedSplitPolicy: 'none',
      resolvedBaseTextTemplate: 'shown_this_question',
      baseText: 'Respondents shown this question',
    });
    expect(result.tables[0]?.resolvedBaseValidation).toMatchObject({
      tautologicalSplitForbidden: true,
      substantiveRebasingForbidden: true,
      requiresSharedDisplayedBase: true,
    });
  });

  it('removes implicit substantive rebasing from scale rollups', () => {
    const result = resolveCanonicalBaseContract(makeOutput([
      makeTable({
        tableKind: 'scale_overview_rollup_t2b',
        analyticalSubtype: 'scale',
        basePolicy: 'question_base_rebased_excluding_non_substantive_tail',
        questionBase: 177,
        statsSpec: {
          mean: false,
          meanWithoutOutliers: false,
          median: false,
          stdDev: false,
          stdErr: false,
          valueRange: null,
          excludeTailValues: [98],
        },
      }),
    ]));

    expect(result.tables[0]).toMatchObject({
      resolvedBaseMode: 'table_universe_base',
      resolvedBaseTextTemplate: 'shown_this_question',
      basePolicy: 'question_base_shared',
      wincrossDenominatorSemantic: 'sample_base',
      wincrossQualifiedCodes: undefined,
    });
    expect(result.tables[0]?.baseContract.policy).toMatchObject({
      effectiveBaseMode: 'table_mask_shared_n',
      rebasePolicy: 'none',
    });
  });

  it('marks model-derived families as model_base', () => {
    const result = resolveCanonicalBaseContract(makeOutput([
      makeTable({
        tableKind: 'maxdiff_api',
        analyticalSubtype: 'maxdiff',
        basePolicy: 'score_family_model_base',
      }),
    ]));

    expect(result.tables[0]).toMatchObject({
      resolvedBaseMode: 'model_base',
      resolvedBaseTextTemplate: 'model_derived',
      baseText: 'Model-derived base',
    });
    expect(result.tables[0]?.baseContract.policy.effectiveBaseMode).toBe('model');
  });
});
