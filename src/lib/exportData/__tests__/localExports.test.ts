import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateLocalQAndWinCrossExports, writeLocalWinCrossArtifacts } from '@/lib/exportData/localExports';
import type { ExportManifestMetadata, WinCrossExportManifest } from '@/lib/exportData/types';

describe('local WinCross exports', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('writes the WinCross job using the exact serialized bytes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tabulate-local-export-'));
    tempDirs.push(dir);

    const jobPath = path.join(dir, 'results', 'crosstabs.job');
    const manifestPath = path.join(dir, 'export', 'wincross-export-manifest.local.json');
    const jobContent = Buffer.from([0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00]);
    const manifest: WinCrossExportManifest = {
      manifestVersion: 'wincross.phase1.v1',
      exporterVersion: 'wincross-exporter.v1',
      generatedAt: '2026-03-19T00:00:00.000Z',
      packageId: 'pkg-1',
      sourceManifestVersion: 'phase1.v1',
      integrityDigest: 'digest',
      tableCount: 1,
      useCount: 0,
      afCount: 0,
      blockedCount: 0,
      profileSource: 'default',
      profileDigest: 'profile',
      serializerContractVersion: 'wincross-serializer.v2',
      blockedItems: [],
      warnings: [],
      supportSummary: { supported: 1, warning: 0, blocked: 0 },
    };

    await writeLocalWinCrossArtifacts(jobPath, manifestPath, jobContent, manifest);

    const writtenJob = await readFile(jobPath);
    expect(writtenJob.equals(jobContent)).toBe(true);
  });

  it('blocks local export generation when local readiness is false', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tabulate-local-export-'));
    tempDirs.push(dir);

    const metadata: ExportManifestMetadata = {
      manifestVersion: 'phase1.v1',
      generatedAt: '2026-04-25T00:00:00.000Z',
      weighting: { weightVariable: null, mode: 'unweighted' },
      sourceSavNames: { uploaded: 'input.sav', runtime: 'dataFile.sav' },
      availableDataFiles: [],
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
      convexRefs: {},
      r2Refs: {
        finalized: false,
        artifacts: {},
        dataFiles: {},
      },
      warnings: [],
      readiness: {
        evaluatedAt: '2026-04-25T00:00:00.000Z',
        local: {
          ready: false,
          reasonCodes: ['invalid_results_tables_contract'],
          details: ['Invalid resultsTables contract at results/tables.json: tables.t1.questionId: Required'],
        },
        reexport: {
          ready: false,
          reasonCodes: ['invalid_results_tables_contract', 'r2_not_finalized'],
          details: ['Invalid resultsTables contract at results/tables.json: tables.t1.questionId: Required'],
        },
      },
    };

    await mkdir(path.join(dir, 'export'), { recursive: true });
    await writeFile(
      path.join(dir, 'export', 'export-metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );

    const result = await generateLocalQAndWinCrossExports(dir);
    expect(result.q.success).toBe(false);
    expect(result.wincross.success).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        format: 'q',
        stage: 'readiness',
        message: expect.stringContaining('invalid_results_tables_contract'),
      }),
      expect.objectContaining({
        format: 'wincross',
        stage: 'readiness',
        message: expect.stringContaining('results/tables.json'),
      }),
    ]));
  });
});
