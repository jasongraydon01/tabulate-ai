import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assessPostV3Processing,
  finalizeResultsTablesArtifact,
  getRExecutionTimeoutMs,
} from '../postV3Processing';
import type { FinalTableContractComputeInput } from '../finalTableContract';

const originalTimeout = process.env.R_EXECUTION_TIMEOUT_MS;
const tempDirs: string[] = [];

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.R_EXECUTION_TIMEOUT_MS;
  } else {
    process.env.R_EXECUTION_TIMEOUT_MS = originalTimeout;
  }

  return Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))).then(() => {
    tempDirs.length = 0;
  });
});

describe('getRExecutionTimeoutMs', () => {
  it('uses the default floor for smaller workloads', () => {
    delete process.env.R_EXECUTION_TIMEOUT_MS;
    expect(getRExecutionTimeoutMs(100)).toBe(10 * 60 * 1000);
  });

  it('scales timeout with table count and caps it', () => {
    delete process.env.R_EXECUTION_TIMEOUT_MS;
    expect(getRExecutionTimeoutMs(537)).toBe(1611000);
    expect(getRExecutionTimeoutMs(1000)).toBe(30 * 60 * 1000);
  });

  it('honors the explicit environment override', () => {
    process.env.R_EXECUTION_TIMEOUT_MS = '420000';
    expect(getRExecutionTimeoutMs(537)).toBe(420000);
  });
});

describe('assessPostV3Processing', () => {
  it('classifies final-table materialization failure separately from R execution', () => {
    const assessment = assessPostV3Processing({
      masterRPath: '/tmp/master.R',
      rScriptSizeBytes: 10,
      rExecution: { attempted: true, success: true, durationMs: 100 },
      finalTableContract: {
        attempted: true,
        success: false,
        durationMs: 25,
        error: 'Final table contract mismatch',
      },
      excelExport: {
        attempted: false,
        success: false,
        durationMs: 0,
        skippedReason: 'Skipped because final table contract materialization failed.',
      },
    });

    expect(assessment).toEqual({
      status: 'partial',
      message: 'R execution succeeded but final table contract materialization failed.',
      finalStage: 'finalTableContract',
    });
  });

  it('classifies Excel failure after successful final-table materialization as partial', () => {
    const assessment = assessPostV3Processing({
      masterRPath: '/tmp/master.R',
      rScriptSizeBytes: 10,
      rExecution: { attempted: true, success: true, durationMs: 100 },
      finalTableContract: {
        attempted: true,
        success: true,
        durationMs: 25,
        outputTableCount: 12,
      },
      excelExport: {
        attempted: true,
        success: false,
        durationMs: 30,
        error: 'Workbook render failed',
      },
    });

    expect(assessment).toEqual({
      status: 'partial',
      message: 'Final table contract succeeded but Excel generation failed.',
      finalStage: 'excelExport',
    });
  });
});

async function writeJson(dir: string, fileName: string, value: unknown): Promise<string> {
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  return filePath;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf-8')) as T;
}

describe('finalizeResultsTablesArtifact', () => {
  it('finalizes derived demo banner rows from the settled stage-22 compute shape', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tabulate-post-v3-'));
    tempDirs.push(dir);

    const jsonPath = await writeJson(dir, 'tables.json', {
      metadata: {
        bannerGroups: [
          {
            groupName: 'Gender',
            columns: [
              { name: 'Female', statLetter: 'A' },
              { name: 'Male', statLetter: 'B' },
            ],
          },
        ],
      },
      tables: {
        _demo_banner_x_banner: {
          tableId: '_demo_banner_x_banner',
          questionId: '',
          questionText: 'Banner Profile',
          tableType: 'frequency',
          data: {
            Total: {
              stat_letter: 'T',
              row_0_Total: { label: 'Total', groupName: 'Total', pct: 100, n: 200 },
              row_1_T: { label: 'Total', groupName: 'Total', pct: 100, n: 200 },
              row_2_A: { label: 'Female', groupName: 'Gender', pct: 55, n: 200 },
              row_3_B: { label: 'Male', groupName: 'Gender', pct: 45, n: 200 },
            },
            Female: {
              stat_letter: 'A',
              row_0_Total: { label: 'Total', groupName: 'Total', pct: 100, n: 110 },
              row_1_T: { label: 'Total', groupName: 'Total', pct: 100, n: 110 },
              row_2_A: { label: 'Female', groupName: 'Gender', pct: 100, n: 110 },
              row_3_B: { label: 'Male', groupName: 'Gender', pct: 0, n: 110 },
            },
            Male: {
              stat_letter: 'B',
              row_0_Total: { label: 'Total', groupName: 'Total', pct: 100, n: 90 },
              row_1_T: { label: 'Total', groupName: 'Total', pct: 100, n: 90 },
              row_2_A: { label: 'Female', groupName: 'Gender', pct: 0, n: 90 },
              row_3_B: { label: 'Male', groupName: 'Gender', pct: 100, n: 90 },
            },
          },
        },
      },
    });

    const computeInput: FinalTableContractComputeInput = {
      tables: [],
      cuts: [
        { name: 'Total', statLetter: 'T', groupName: 'Total' },
        { name: 'Female', statLetter: 'A', groupName: 'Gender' },
        { name: 'Male', statLetter: 'B', groupName: 'Gender' },
      ],
    };

    await finalizeResultsTablesArtifact(jsonPath, computeInput);
    const finalized = await readJson<{
      tables: Record<string, { columns: Array<{ cutKey: string }>; rows: Array<{ label: string; cells: Array<{ value: number | null }> }> }>;
    }>(jsonPath);

    const table = finalized.tables._demo_banner_x_banner;
    expect(table.columns.map((column) => column.cutKey)).toEqual([
      '__total__::total',
      'group:gender::female',
      'group:gender::male',
    ]);
    expect(table.rows.map((row) => row.label)).toEqual(['Total', 'Total', 'Female', 'Male']);
    expect(table.rows[2]?.cells.map((cell) => cell.value)).toEqual([55, 100, 0]);
  });

  it('finalizes both weighted and unweighted results artifacts from the same compute layout', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tabulate-post-v3-'));
    tempDirs.push(dir);

    const rawResultsTables = {
      metadata: {
        bannerGroups: [
          {
            groupName: 'Segments',
            columns: [
              { name: 'Segment B', statLetter: 'B' },
              { name: 'Segment A', statLetter: 'A' },
            ],
          },
        ],
      },
      tables: {
        q5_mean_rows: {
          tableId: 'q5_mean_rows',
          questionId: 'Q5',
          questionText: 'Mean score by item',
          tableType: 'mean_rows',
          data: {
            'Segment B': {
              stat_letter: 'B',
              Q5_1: { label: 'Item A', groupName: 'Segments', n: 40, mean: 3.1, median: 3.0, sd: 1.2, std_err: 0.19 },
              Q5_2: { label: 'Item B', groupName: 'Segments', n: 40, mean: 4.4, median: 4.0, sd: 1.1, std_err: 0.17 },
            },
            Total: {
              stat_letter: 'T',
              Q5_1: { label: 'Item A', groupName: 'Total', n: 100, mean: 3.7, median: 4.0, sd: 1.0, std_err: 0.1 },
              Q5_2: { label: 'Item B', groupName: 'Total', n: 100, mean: 4.1, median: 4.0, sd: 0.9, std_err: 0.09 },
            },
            'Segment A': {
              stat_letter: 'A',
              Q5_1: { label: 'Item A', groupName: 'Segments', n: 60, mean: 4.0, median: 4.0, sd: 0.8, std_err: 0.1 },
              Q5_2: { label: 'Item B', groupName: 'Segments', n: 60, mean: 3.9, median: 4.0, sd: 0.7, std_err: 0.09 },
            },
          },
        },
      },
    };

    const weightedPath = await writeJson(dir, 'tables-weighted.json', rawResultsTables);
    const unweightedPath = await writeJson(dir, 'tables-unweighted.json', rawResultsTables);

    const computeInput: FinalTableContractComputeInput = {
      cuts: [
        { name: 'Total', statLetter: 'T', groupName: 'Total' },
        { name: 'Segment A', statLetter: 'A', groupName: 'Segments' },
        { name: 'Segment B', statLetter: 'B', groupName: 'Segments' },
      ],
      tables: [
        {
          tableId: 'q5_mean_rows',
          tableType: 'mean_rows',
          rows: [
            { label: 'Item A', rowKind: 'value', isNet: false, indent: 0 },
            { label: 'Item B', rowKind: 'value', isNet: false, indent: 0 },
          ],
        },
      ],
    };

    await finalizeResultsTablesArtifact(weightedPath, computeInput);
    await finalizeResultsTablesArtifact(unweightedPath, computeInput);

    const weighted = await readJson<{
      tables: Record<string, { columns: Array<{ cutName: string }>; rows: Array<{ valueType: string }> }>;
    }>(weightedPath);
    const unweighted = await readJson<{
      tables: Record<string, { columns: Array<{ cutName: string }>; rows: Array<{ valueType: string }> }>;
    }>(unweightedPath);

    expect(weighted.tables.q5_mean_rows.columns.map((column) => column.cutName)).toEqual([
      'Total',
      'Segment A',
      'Segment B',
    ]);
    expect(unweighted.tables.q5_mean_rows.columns.map((column) => column.cutName)).toEqual([
      'Total',
      'Segment A',
      'Segment B',
    ]);
    expect(weighted.tables.q5_mean_rows.rows.map((row) => row.valueType)).toEqual(['mean', 'mean']);
    expect(unweighted.tables.q5_mean_rows.rows.map((row) => row.valueType)).toEqual(['mean', 'mean']);
  });
});
