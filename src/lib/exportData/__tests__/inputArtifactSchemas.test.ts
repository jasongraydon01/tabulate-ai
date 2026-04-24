import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  CrosstabRawArtifactSchema,
  LoopSummaryArtifactSchema,
  ResultsTablesFinalContractSchema,
  ResultsTablesArtifactSchema,
  SortedFinalArtifactSchema,
} from '@/lib/exportData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'current-system');

async function readFixture(name: string): Promise<unknown> {
  const fixturePath = path.join(FIXTURE_DIR, name);
  return JSON.parse(await fs.readFile(fixturePath, 'utf-8')) as unknown;
}

describe('required input artifact schemas', () => {
  it('parses 07-sorted-final fixture and snapshots key shape', async () => {
    const fixture = await readFixture('07-sorted-final.fixture.json');
    const parsed = SortedFinalArtifactSchema.parse(fixture);
    expect({
      topLevelKeys: Object.keys(parsed).sort(),
      metadataKeys: Object.keys(parsed._metadata).sort(),
      tableCount: parsed.tables.length,
      firstTableKeys: Object.keys(parsed.tables[0] ?? {}).sort(),
    }).toMatchInlineSnapshot(`
      {
        "firstTableKeys": [
          "additionalFilter",
          "baseText",
          "exclude",
          "excludeReason",
          "filterReviewRequired",
          "isDerived",
          "lastModifiedBy",
          "questionId",
          "questionText",
          "rows",
          "sourceTableId",
          "splitFromTableId",
          "surveySection",
          "tableId",
          "tableSubtitle",
          "tableType",
          "userNote",
        ],
        "metadataKeys": [
          "previousStage",
          "previousTableCount",
          "stage",
          "stageNumber",
          "tableCount",
          "timestamp",
        ],
        "tableCount": 2,
        "topLevelKeys": [
          "_metadata",
          "tables",
        ],
      }
    `);
  });

  it('parses enriched 13e sorted-final tables with additive base metadata', () => {
    const parsed = SortedFinalArtifactSchema.parse({
      _metadata: {
        stage: '13e',
        tableCount: 1,
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
          baseText: 'Those who were shown Q1',
          userNote: 'Base varies by item (n=120-150)',
          baseDisclosure: {
            referenceBaseN: 150,
            itemBaseRange: [120, 150],
            defaultBaseText: 'Those who were shown Q1',
            defaultNoteTokens: ['anchor-base-varies-by-item', 'anchor-base-range'],
            rangeDisclosure: { min: 120, max: 150 },
            source: 'contract',
          },
          baseViewRole: 'anchor',
          plannerBaseComparability: 'varying_but_acceptable',
          plannerBaseSignals: ['varying-item-bases'],
          computeRiskSignals: ['row-base-varies-within-anchor-view'],
        },
      ],
    });

    expect(parsed.tables[0]).toMatchObject({
      baseViewRole: 'anchor',
      plannerBaseComparability: 'varying_but_acceptable',
      plannerBaseSignals: ['varying-item-bases'],
      computeRiskSignals: ['row-base-varies-within-anchor-view'],
    });
  });

  it('parses legacy results/tables fixture and snapshots key shape', async () => {
    const fixture = await readFixture('results-tables.fixture.json');
    const parsed = ResultsTablesArtifactSchema.parse(fixture);
    const firstTableId = Object.keys(parsed.tables)[0];
    expect({
      topLevelKeys: Object.keys(parsed).sort(),
      metadataKeys: Object.keys(parsed.metadata).sort(),
      tableCount: Object.keys(parsed.tables).length,
      firstTableKeys: Object.keys(parsed.tables[firstTableId] ?? {}).sort(),
    }).toMatchInlineSnapshot(`
      {
        "firstTableKeys": [
          "baseText",
          "data",
          "excludeReason",
          "excluded",
          "isDerived",
          "questionId",
          "questionText",
          "sourceTableId",
          "surveySection",
          "tableId",
          "tableSubtitle",
          "tableType",
          "userNote",
        ],
        "metadataKeys": [
          "bannerGroups",
          "comparisonGroups",
          "cutCount",
          "generatedAt",
          "meanSignificanceTest",
          "significanceLevel",
          "significanceTest",
          "significanceThresholds",
          "tableCount",
          "totalRespondents",
        ],
        "tableCount": 2,
        "topLevelKeys": [
          "metadata",
          "tables",
        ],
      }
    `);
  });

  it('parses the strict final-table contract shape for results/tables and snapshots key shape', () => {
    const parsed = ResultsTablesFinalContractSchema.parse({
      metadata: {
        generatedAt: '2026-04-24T00:00:00.000Z',
        tableCount: 1,
        cutCount: 2,
        bannerGroups: [
          {
            groupName: 'Gender',
            columns: [
              { name: 'Female', statLetter: 'A' },
            ],
          },
        ],
      },
      tables: {
        q1_overall: {
          tableId: 'q1_overall',
          questionId: 'Q1',
          questionText: 'Overall satisfaction',
          tableType: 'frequency',
          baseText: 'All respondents',
          tableSubtitle: 'Overall',
          data: {
            Total: {
              stat_letter: 'T',
              row_0_1: { label: 'Very satisfied', n: 120, count: 54, pct: 45, isNet: false, indent: 0 },
            },
            Female: {
              stat_letter: 'A',
              row_0_1: { label: 'Very satisfied', groupName: 'Gender', n: 70, count: 38, pct: 54.3, isNet: false, indent: 0 },
            },
          },
          columns: [
            {
              cutKey: '__total__::total',
              cutName: 'Total',
              groupKey: '__total__',
              groupName: 'Total',
              statLetter: 'T',
              baseN: 120,
              isTotal: true,
              order: 0,
            },
            {
              cutKey: 'group:gender::female',
              cutName: 'Female',
              groupKey: 'group:gender',
              groupName: 'Gender',
              statLetter: 'A',
              baseN: 70,
              isTotal: false,
              order: 1,
            },
          ],
          rows: [
            {
              rowKey: 'row_0_1',
              label: 'Very satisfied',
              rowKind: 'value',
              statType: null,
              indent: 0,
              isNet: false,
              valueType: 'pct',
              format: {
                kind: 'percent',
                decimals: 0,
              },
              cells: [
                {
                  cutKey: '__total__::total',
                  value: 45,
                  metrics: {
                    pct: 45,
                    count: 54,
                    n: 120,
                    mean: null,
                    median: null,
                    stddev: null,
                    stderr: null,
                  },
                  sigHigherThan: [],
                  sigVsTotal: null,
                },
                {
                  cutKey: 'group:gender::female',
                  value: 54.3,
                  metrics: {
                    pct: 54.3,
                    count: 38,
                    n: 70,
                    mean: null,
                    median: null,
                    stddev: null,
                    stderr: null,
                  },
                  sigHigherThan: [],
                  sigVsTotal: null,
                },
              ],
            },
          ],
        },
      },
    });
    const firstTableId = Object.keys(parsed.tables)[0];
    expect({
      topLevelKeys: Object.keys(parsed).sort(),
      metadataKeys: Object.keys(parsed.metadata).sort(),
      tableCount: Object.keys(parsed.tables).length,
      firstTableKeys: Object.keys(parsed.tables[firstTableId] ?? {}).sort(),
    }).toMatchInlineSnapshot(`
      {
        "firstTableKeys": [
          "baseText",
          "columns",
          "data",
          "questionId",
          "questionText",
          "rows",
          "tableId",
          "tableSubtitle",
          "tableType",
        ],
        "metadataKeys": [
          "bannerGroups",
          "cutCount",
          "generatedAt",
          "tableCount",
        ],
        "tableCount": 1,
        "topLevelKeys": [
          "metadata",
          "tables",
        ],
      }
    `);
  });

  it('accepts legacy results/tables entries that omit ordered columns and rows', () => {
    expect(() =>
      ResultsTablesArtifactSchema.parse({
        metadata: {},
        tables: {
          q1_overall: {
            tableId: 'q1_overall',
            data: {},
          },
        },
      }),
    ).not.toThrow();
  });

  it('rejects final-contract validation when ordered columns, rows, and cells are missing', () => {
    expect(() =>
      ResultsTablesFinalContractSchema.parse({
        metadata: {},
        tables: {
          q1_overall: {
            tableId: 'q1_overall',
            questionId: 'Q1',
            tableType: 'frequency',
            data: {},
          },
        },
      }),
    ).toThrow();
  });

  it('rejects final-contract validation when row cell order does not match columns', () => {
    expect(() =>
      ResultsTablesFinalContractSchema.parse({
        metadata: {},
        tables: {
          q1_overall: {
            tableId: 'q1_overall',
            questionId: 'Q1',
            tableType: 'frequency',
            data: {},
            columns: [
              {
                cutKey: '__total__::total',
                cutName: 'Total',
                groupKey: '__total__',
                groupName: 'Total',
                statLetter: 'T',
                baseN: 120,
                isTotal: true,
                order: 0,
              },
              {
                cutKey: 'group:gender::female',
                cutName: 'Female',
                groupKey: 'group:gender',
                groupName: 'Gender',
                statLetter: 'A',
                baseN: 70,
                isTotal: false,
                order: 1,
              },
            ],
            rows: [
              {
                rowKey: 'row_0_1',
                label: 'Very satisfied',
                rowKind: 'value',
                statType: null,
                indent: 0,
                isNet: false,
                valueType: 'pct',
                format: {
                  kind: 'percent',
                  decimals: 0,
                },
                cells: [
                  {
                    cutKey: 'group:gender::female',
                    value: 54.3,
                    metrics: {
                      pct: 54.3,
                      count: 38,
                      n: 70,
                      mean: null,
                      median: null,
                      stddev: null,
                      stderr: null,
                    },
                    sigHigherThan: [],
                    sigVsTotal: null,
                  },
                  {
                    cutKey: '__total__::total',
                    value: 45,
                    metrics: {
                      pct: 45,
                      count: 54,
                      n: 120,
                      mean: null,
                      median: null,
                      stddev: null,
                      stderr: null,
                    },
                    sigHigherThan: [],
                    sigVsTotal: null,
                  },
                ],
              },
            ],
          },
        },
      }),
    ).toThrow(/cell cut order/i);
  });

  it('parses crosstab-output-raw fixture and snapshots key shape', async () => {
    const fixture = await readFixture('crosstab-output-raw.fixture.json');
    const parsed = CrosstabRawArtifactSchema.parse(fixture);
    expect({
      topLevelKeys: Object.keys(parsed).sort(),
      groupCount: parsed.bannerCuts.length,
      firstGroupKeys: Object.keys(parsed.bannerCuts[0] ?? {}).sort(),
      firstColumnKeys: Object.keys(parsed.bannerCuts[0]?.columns[0] ?? {}).sort(),
    }).toMatchInlineSnapshot(`
      {
        "firstColumnKeys": [
          "adjusted",
          "alternatives",
          "confidence",
          "expressionType",
          "name",
          "reasoning",
          "uncertainties",
          "userSummary",
        ],
        "firstGroupKeys": [
          "columns",
          "groupName",
        ],
        "groupCount": 1,
        "topLevelKeys": [
          "bannerCuts",
        ],
      }
    `);
  });

  it('parses loop-summary fixture and snapshots key shape', async () => {
    const fixture = await readFixture('loop-summary.fixture.json');
    const parsed = LoopSummaryArtifactSchema.parse(fixture);
    expect({
      topLevelKeys: Object.keys(parsed).sort(),
      groupCount: parsed.groups.length,
      firstGroupKeys: Object.keys(parsed.groups[0] ?? {}).sort(),
      firstVariableKeys: Object.keys(parsed.groups[0]?.variables[0] ?? {}).sort(),
    }).toMatchInlineSnapshot(`
      {
        "firstGroupKeys": [
          "iterations",
          "skeleton",
          "stackedFrameName",
          "variableCount",
          "variables",
        ],
        "firstVariableKeys": [
          "baseName",
          "iterationColumns",
          "label",
        ],
        "groupCount": 1,
        "topLevelKeys": [
          "fillRateResults",
          "groups",
          "totalBaseVars",
          "totalIterationVars",
          "totalLoopGroups",
        ],
      }
    `);
  });
});
