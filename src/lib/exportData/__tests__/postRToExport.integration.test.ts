import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeRow, makeTable } from '@/lib/__tests__/fixtures';
import { buildPhase1Manifest, persistPhase0Artifacts } from '@/lib/exportData';
import { generateLocalQAndWinCrossExports } from '@/lib/exportData/localExports';
import { finalizeResultsTablesArtifact } from '@/lib/v3/runtime/postV3Processing';
import type { FinalTableContractComputeInput } from '@/lib/v3/runtime/finalTableContract';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempOutputDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tabulate-postr-export-'));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(outputDir: string, relativePath: string, value: unknown): Promise<void> {
  const absolutePath = path.join(outputDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(value, null, 2), 'utf8');
}

async function readJson<T>(outputDir: string, relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(outputDir, relativePath), 'utf8')) as T;
}

function buildSortedFinalArtifact() {
  return {
    _metadata: {
      stage: 'sorted-final',
      stageNumber: 7,
      tableCount: 1,
      timestamp: new Date().toISOString(),
    },
    tables: [
      makeTable({
        tableId: 't1',
        questionId: 'Q1',
        questionText: 'Question 1',
        tableType: 'frequency',
        additionalFilter: 'SEG == 1',
        rows: [
          makeRow({ variable: 'Q1', label: 'Yes', filterValue: '1' }),
          makeRow({ variable: 'Q1', label: 'No', filterValue: '0' }),
        ],
      }),
    ],
  };
}

function buildCrosstabRawArtifact() {
  return {
    bannerCuts: [
      {
        groupName: 'Demo',
        columns: [
          { name: 'Male', adjusted: 'GENDER == 1', expressionType: 'direct_variable' },
        ],
      },
    ],
  };
}

function buildRawResultsTablesArtifact() {
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      tableCount: 1,
      cutCount: 2,
      bannerGroups: [
        {
          groupName: 'Demo',
          columns: [
            { name: 'Male', statLetter: 'A' },
          ],
        },
      ],
    },
    tables: {
      t1: {
        tableId: 't1',
        questionId: 'Q1',
        questionText: 'Question 1',
        tableType: 'frequency',
        data: {
          Total: {
            stat_letter: 'T',
            row_yes: { label: 'Yes', groupName: 'Total', pct: 60, count: 60, n: 100 },
            row_no: { label: 'No', groupName: 'Total', pct: 40, count: 40, n: 100 },
          },
          Male: {
            stat_letter: 'A',
            row_yes: { label: 'Yes', groupName: 'Demo', pct: 70, count: 35, n: 50 },
            row_no: { label: 'No', groupName: 'Demo', pct: 30, count: 15, n: 50 },
          },
        },
      },
    },
  };
}

const computeInput: FinalTableContractComputeInput = {
  cuts: [
    { name: 'Total', statLetter: 'T', groupName: 'Total' },
    { name: 'Male', statLetter: 'A', groupName: 'Demo' },
  ],
  tables: [
    {
      tableId: 't1',
      tableType: 'frequency',
      rows: [
        { label: 'Yes', rowKind: 'value', isNet: false, indent: 0 },
        { label: 'No', rowKind: 'value', isNet: false, indent: 0 },
      ],
    },
  ],
};

async function seedArtifactFlowInputs(outputDir: string): Promise<void> {
  await writeJson(outputDir, 'tables/07-sorted-final.json', buildSortedFinalArtifact());
  await writeJson(outputDir, 'crosstab/crosstab-output-raw.json', buildCrosstabRawArtifact());
  await mkdir(path.join(outputDir, 'export/data'), { recursive: true });
  await writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf8');
}

describe('post-R to export artifact flow', () => {
  it('finalizes unweighted results tables and generates fresh local Q and WinCross exports', async () => {
    const outputDir = await makeTempOutputDir();
    await seedArtifactFlowInputs(outputDir);
    await writeJson(outputDir, 'results/tables.json', buildRawResultsTablesArtifact());

    await finalizeResultsTablesArtifact(
      path.join(outputDir, 'results/tables.json'),
      computeInput,
    );

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [{ ...buildSortedFinalArtifact().tables[0], loopDataFrame: '' }],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const phase1 = await buildPhase1Manifest(outputDir);
    expect(phase1.metadata.artifactPaths.inputs.resultsTables).toBe('results/tables.json');
    expect(phase1.metadata.readiness?.local.ready).toBe(true);

    const localExportResult = await generateLocalQAndWinCrossExports(outputDir);
    expect(localExportResult.errors).toEqual([]);
    expect(localExportResult.q.success).toBe(true);
    expect(localExportResult.wincross.success).toBe(true);

    const qManifest = await readJson<{
      artifacts: { resultsTablesPath: string };
      jobs: unknown[];
    }>(outputDir, 'export/q-export-manifest.local.json');
    const winCrossManifest = await readJson<{
      sourceManifestVersion: string;
      tableCount: number;
      blockedCount: number;
    }>(outputDir, 'export/wincross-export-manifest.local.json');

    expect(qManifest.artifacts.resultsTablesPath).toBe('results/tables.json');
    expect(qManifest.jobs.length).toBeGreaterThan(0);
    expect(winCrossManifest.sourceManifestVersion).toBe('phase1.v1');
    expect(winCrossManifest.tableCount).toBeGreaterThan(0);
    expect(winCrossManifest.blockedCount).toBe(0);

    await expect(readFile(path.join(outputDir, 'results', 'crosstabs.qscript'), 'utf8')).resolves.toContain('TabulateAI Q Export Script');
    await expect(readFile(path.join(outputDir, 'results', 'crosstabs.job'))).resolves.toBeInstanceOf(Buffer);
  });

  it('uses the weighted finalized artifact as the canonical export input for dual-output runs', async () => {
    const outputDir = await makeTempOutputDir();
    await seedArtifactFlowInputs(outputDir);
    const rawResultsTables = buildRawResultsTablesArtifact();
    await writeJson(outputDir, 'results/tables-weighted.json', rawResultsTables);
    await writeJson(outputDir, 'results/tables-unweighted.json', rawResultsTables);

    await finalizeResultsTablesArtifact(
      path.join(outputDir, 'results/tables-weighted.json'),
      computeInput,
    );
    await finalizeResultsTablesArtifact(
      path.join(outputDir, 'results/tables-unweighted.json'),
      computeInput,
    );

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [{ ...buildSortedFinalArtifact().tables[0], loopDataFrame: '' }],
      loopMappings: [],
      weightVariable: 'wt',
      hasDualWeightOutputs: true,
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const phase1 = await buildPhase1Manifest(outputDir);
    expect(phase1.metadata.weighting.mode).toBe('both');
    expect(phase1.metadata.artifactPaths.inputs.resultsTables).toBe('results/tables-weighted.json');
    expect(phase1.metadata.readiness?.local.ready).toBe(true);

    const localExportResult = await generateLocalQAndWinCrossExports(outputDir);
    expect(localExportResult.errors).toEqual([]);
    expect(localExportResult.q.success).toBe(true);
    expect(localExportResult.wincross.success).toBe(true);

    const qManifest = await readJson<{
      artifacts: { resultsTablesPath: string };
    }>(outputDir, 'export/q-export-manifest.local.json');

    expect(qManifest.artifacts.resultsTablesPath).toBe('results/tables-weighted.json');
  });
});
