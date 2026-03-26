import { mkdtemp, readFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeLocalWinCrossArtifacts } from '@/lib/exportData/localExports';
import type { WinCrossExportManifest } from '@/lib/exportData/types';

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
});
