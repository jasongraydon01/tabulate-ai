import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  uploadWinCrossExportPackageArtifacts: vi.fn(),
  getDownloadUrlsForArtifactMap: vi.fn(),
}));

vi.mock('@/lib/r2/r2', () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock('@/lib/r2/R2FileManager', () => ({
  uploadWinCrossExportPackageArtifacts: mocks.uploadWinCrossExportPackageArtifacts,
  getDownloadUrlsForArtifactMap: mocks.getDownloadUrlsForArtifactMap,
}));

import { generateWinCrossExportPackage } from '@/lib/exportData/wincross/service';
import { WinCrossExportServiceError, WINCROSS_SERIALIZER_CONTRACT_VERSION } from '@/lib/exportData/wincross/types';
import type { ExportDataFileRef, ExportManifestMetadata } from '@/lib/exportData/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createArtifacts(): any {
  const metadata = {
    manifestVersion: 'phase1.v1',
    generatedAt: '2026-03-19T00:00:00.000Z',
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
    convexRefs: { runId: 'run-1', projectId: 'proj-1', orgId: 'org-1' },
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
      integrityDigest: 'digest-abc',
      jobs: {},
    },
  };

  return {
    metadata,
    tableRouting: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      totalTables: 1,
      tableToDataFrameRef: { t1: 'wide' },
      countsByDataFrameRef: { wide: 1 },
    },
    jobRouting: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      totalJobs: 1,
      totalTables: 1,
      jobs: [{
        jobId: 'wide.job',
        dataFrameRef: 'wide',
        dataFileRelativePath: 'export/data/wide.sav',
        tableIds: ['t1'],
      }],
      tableToJobId: { t1: 'wide.job' },
    },
    loopPolicy: {
      policyVersion: '1.0',
      bannerGroups: [],
      warnings: [],
      reasoning: 'ok',
      fallbackApplied: false,
      fallbackReason: '',
    },
    support: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      manifestVersion: 'phase1.v1',
      expressionSummary: { total: 0, parsed: 0, blocked: 0 },
      expressions: [],
      supportItems: [],
      summary: {
        q: { supported: 1, warning: 0, blocked: 0 },
        wincross: { supported: 1, warning: 0, blocked: 0 },
      },
    },
    sortedFinal: {
      _metadata: {},
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: 'SEG == 1',
          rows: [
            { variable: 'Q1', label: 'Yes', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    },
    results: {
      metadata: {},
      tables: {},
    },
    crosstab: {
      bannerCuts: [
        { groupName: 'Demo', columns: [{ name: 'Male', adjusted: 'SEX == 1' }] },
      ],
    },
    loopSummary: {
      totalLoopGroups: 0,
      totalIterationVars: 0,
      totalBaseVars: 0,
      groups: [],
    },
  };
}

function createRunResult(ready: boolean): Record<string, unknown> {
  return {
    exportReadiness: {
      reexport: {
        ready,
        reasonCodes: ready ? ['ready'] : ['r2_not_finalized'],
      },
    },
    exportArtifacts: {
      metadataPath: 'export/export-metadata.json',
      r2Refs: {
        artifacts: {
          'export/export-metadata.json': 'r2/meta',
        },
      },
    },
    r2Files: {
      outputs: {
        'tables/13e-table-enriched.json': 'r2/sorted-final',
        'results/tables.json': 'r2/results',
        'planning/21-crosstab-plan.json': 'r2/crosstab',
        'enrichment/loop-summary.json': 'r2/loop-summary',
      },
    },
  };
}

describe('WinCross export service integration', () => {
  const payloadByKey = new Map<string, unknown>();

  beforeEach(() => {
    vi.clearAllMocks();
    payloadByKey.clear();

    mocks.downloadFile.mockImplementation(async (key: string) => {
      const payload = payloadByKey.get(key);
      if (payload === undefined) {
        throw new Error(`Missing mock payload for key: ${key}`);
      }
      if (Buffer.isBuffer(payload)) return payload;
      if (typeof payload === 'string') return Buffer.from(payload);
      return Buffer.from(JSON.stringify(payload));
    });

    mocks.uploadWinCrossExportPackageArtifacts.mockImplementation(async (
      _orgId: string,
      _projectId: string,
      _runId: string,
      _packageId: string,
      artifacts: Record<string, string | Buffer>,
    ) => {
      const uploaded: Record<string, string> = {};
      for (const relativePath of Object.keys(artifacts)) {
        uploaded[relativePath] = `r2/package/${relativePath}`;
      }
      return uploaded;
    });

    mocks.getDownloadUrlsForArtifactMap.mockImplementation(async (files: Record<string, string>) => {
      const urls: Record<string, string> = {};
      for (const [relativePath, key] of Object.entries(files)) {
        urls[relativePath] = `https://example.com/${encodeURIComponent(key)}`;
      }
      return urls;
    });
  });

  function seedPayloads() {
    const artifacts = createArtifacts();
    payloadByKey.set('r2/meta', artifacts.metadata);
    payloadByKey.set('r2/table-routing', artifacts.tableRouting);
    payloadByKey.set('r2/job-routing', artifacts.jobRouting);
    payloadByKey.set('r2/loop-policy', artifacts.loopPolicy);
    payloadByKey.set('r2/support', artifacts.support);
    payloadByKey.set('r2/sorted-final', artifacts.sortedFinal);
    payloadByKey.set('r2/results', artifacts.results);
    payloadByKey.set('r2/crosstab', artifacts.crosstab);
    payloadByKey.set('r2/loop-summary', artifacts.loopSummary);
    payloadByKey.set('r2/wide', Buffer.from('SAVDATA_WIDE'));
    return artifacts;
  }

  it('rejects export when re-export readiness is false', async () => {
    const runResult = createRunResult(false);

    await expect(generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    })).rejects.toBeInstanceOf(WinCrossExportServiceError);
  });

  it('generates a package and reuses cached descriptor', async () => {
    seedPayloads();
    const runResult = createRunResult(true);

    const first = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    expect(first.cached).toBe(false);
    expect(first.descriptor.packageId).toHaveLength(64);
    expect(first.descriptor.profileDigest).toHaveLength(64);
    expect(first.descriptor.serializerContractVersion).toBe(WINCROSS_SERIALIZER_CONTRACT_VERSION);
    expect(first.descriptor.archivePath).toBe('wincross/export.zip');
    expect(first.descriptor.archiveHash).toHaveLength(64);
    expect(first.descriptor.entrypointPath).toBe('wincross/export.job');
    expect(first.descriptor.files['wincross/export.job']).toBeDefined();
    expect(first.descriptor.files['wincross/support-report.json']).toBeDefined();
    expect(first.descriptor.files['wincross/table-routing.json']).toBeDefined();
    expect(first.descriptor.files['wincross/job-routing-manifest.json']).toBeDefined();
    expect(first.descriptor.files['wincross/export.zip']).toBeDefined();
    expect(first.descriptor.files['wincross/data/wide.sav']).toBeDefined();
    expect(first.resolvedPreference.source.kind).toBe('default');
    expect(first.manifest.applicationDiagnostics?.banner.templateKind).toBe('none');
    expect(first.manifest.applicationDiagnostics?.banner.status).toBe('not_requested');
    expect((first.manifest.applicationDiagnostics?.tables.length ?? 0)).toBeGreaterThan(0);
    expect(first.manifest.applicationDiagnostics?.tables[0]?.displayTemplateKind).toBeDefined();
    expect(Array.isArray(first.manifest.applicationDiagnostics?.tables[0]?.appliedStyleHints)).toBe(true);
    expect(mocks.uploadWinCrossExportPackageArtifacts).toHaveBeenCalledTimes(1);

    // Set up cached manifest for retrieval
    payloadByKey.set(first.descriptor.files['wincross/wincross-export-manifest.json'], first.manifest);

    const second = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: first.descriptor,
      preferenceSource: { kind: 'default' },
    });

    expect(second.cached).toBe(true);
    expect(second.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadWinCrossExportPackageArtifacts).toHaveBeenCalledTimes(1);
  });

  it('recovers when R2 metadata is stale but run-level refs still point to the data file', async () => {
    const artifacts = seedPayloads();
    const staleMetadata = JSON.parse(JSON.stringify(artifacts.metadata)) as ExportManifestMetadata;
    staleMetadata.availableDataFiles = staleMetadata.availableDataFiles.map(({ r2Key: _r2Key, ...file }: ExportDataFileRef) => file);
    staleMetadata.r2Refs.dataFiles = {} as Record<string, string>;
    payloadByKey.set('r2/meta', staleMetadata);

    const runResult = createRunResult(true);
    ((runResult.exportArtifacts as Record<string, unknown>).r2Refs as Record<string, unknown>).dataFiles = {
      'export/data/wide.sav': 'r2/wide',
    };
    ((runResult.r2Files as Record<string, unknown>).outputs as Record<string, string>)['export/data/wide.sav'] = 'r2/wide';

    const result = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    expect(result.cached).toBe(false);
    expect(result.descriptor.files['wincross/data/wide.sav']).toBeDefined();
  });

  it('cache busts on profile change (default vs embedded)', async () => {
    seedPayloads();
    const runResult = createRunResult(true);

    const defaultResult = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    const embeddedResult = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: defaultResult.descriptor,
      preferenceSource: { kind: 'embedded_reference', referenceId: 'hcp_vaccines' },
    });

    expect(embeddedResult.cached).toBe(false);
    expect(embeddedResult.descriptor.packageId).not.toBe(defaultResult.descriptor.packageId);
    expect(embeddedResult.descriptor.profileDigest).not.toBe(defaultResult.descriptor.profileDigest);
    expect(mocks.uploadWinCrossExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('dynamic preference validation: same artifacts, different prefs → different .job', async () => {
    seedPayloads();
    const runResult = createRunResult(true);

    const defaultResult = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    const embeddedResult = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'embedded_reference', referenceId: 'hcp_vaccines' },
    });

    // Different profiles mean different job hashes
    expect(defaultResult.descriptor.jobHash).not.toBe(embeddedResult.descriptor.jobHash);
  });

  it('blocked table reporting', async () => {
    const artifacts = createArtifacts();
    // Add an empty-rows table
    artifacts.sortedFinal.tables.push({
      tableId: 't2',
      questionId: 'Q2',
      questionText: 'Empty',
      tableType: 'frequency',
      additionalFilter: '',
      rows: [],
    });
    (artifacts.tableRouting.tableToDataFrameRef as Record<string, string>).t2 = 'wide';
    artifacts.tableRouting.totalTables = 2;

    payloadByKey.set('r2/meta', artifacts.metadata);
    payloadByKey.set('r2/table-routing', artifacts.tableRouting);
    payloadByKey.set('r2/job-routing', artifacts.jobRouting);
    payloadByKey.set('r2/loop-policy', artifacts.loopPolicy);
    payloadByKey.set('r2/support', artifacts.support);
    payloadByKey.set('r2/sorted-final', artifacts.sortedFinal);
    payloadByKey.set('r2/results', artifacts.results);
    payloadByKey.set('r2/crosstab', artifacts.crosstab);
    payloadByKey.set('r2/loop-summary', artifacts.loopSummary);
    payloadByKey.set('r2/wide', Buffer.from('SAVDATA_WIDE'));

    const runResult = createRunResult(true);
    const result = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    expect(result.manifest.blockedCount).toBe(1);
    expect(result.manifest.blockedItems).toHaveLength(1);
    expect(result.manifest.blockedItems[0]).toMatchObject({
      itemType: 'table',
      itemId: 't2',
    });
    expect(result.manifest.warnings.some((w) => w.includes('no rows'))).toBe(true);
  });

  it('rebuilds when cached descriptor is missing a routed data file', async () => {
    seedPayloads();
    const runResult = createRunResult(true);

    const first = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    const staleDescriptor = {
      ...first.descriptor,
      files: Object.fromEntries(
        Object.entries(first.descriptor.files).filter(([key]) => key !== 'wincross/data/wide.sav'),
      ),
    };

    const rebuilt = await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: staleDescriptor,
      preferenceSource: { kind: 'default' },
    });

    expect(rebuilt.cached).toBe(false);
    expect(mocks.uploadWinCrossExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('archive hash determinism: same inputs at same time → same archiveHash', async () => {
    seedPayloads();
    const runResult = createRunResult(true);

    // Mock Date.toISOString to return a stable value so generatedAt is identical
    const fixedIso = '2026-03-19T12:00:00.000Z';
    const originalToISOString = Date.prototype.toISOString;
    Date.prototype.toISOString = () => fixedIso;

    try {
      const first = await generateWinCrossExportPackage({
        runId: 'run-1',
        orgId: 'org-1',
        projectId: 'proj-1',
        runResult,
        preferenceSource: { kind: 'default' },
      });

      const second = await generateWinCrossExportPackage({
        runId: 'run-1',
        orgId: 'org-1',
        projectId: 'proj-1',
        runResult,
        preferenceSource: { kind: 'default' },
      });

      expect(first.descriptor.archiveHash).toBe(second.descriptor.archiveHash);
    } finally {
      Date.prototype.toISOString = originalToISOString;
    }
  });

  it('archive contains expected files', async () => {
    seedPayloads();
    const runResult = createRunResult(true);

    await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    const uploadCall = mocks.uploadWinCrossExportPackageArtifacts.mock.calls[0];
    const uploadedArtifacts = uploadCall?.[4] as Record<string, string | Buffer>;

    expect(uploadedArtifacts['wincross/export.job']).toBeDefined();
    expect(uploadedArtifacts['wincross/support-report.json']).toBeDefined();
    expect(uploadedArtifacts['wincross/table-routing.json']).toBeDefined();
    expect(uploadedArtifacts['wincross/job-routing-manifest.json']).toBeDefined();
    expect(uploadedArtifacts['wincross/export.zip']).toBeDefined();
    expect(uploadedArtifacts['wincross/data/wide.sav']).toBeDefined();
    expect(Buffer.isBuffer(uploadedArtifacts['wincross/data/wide.sav'])).toBe(true);

    const jobBuffer = uploadedArtifacts['wincross/export.job'] as Buffer;
    const jobText = jobBuffer.subarray(2).toString('utf16le');
    expect(jobText).toContain('SEX (1)');

    const archiveBuffer = uploadedArtifacts['wincross/export.zip'] as Buffer;
    const zip = await JSZip.loadAsync(archiveBuffer);
    const zipPaths = Object.keys(zip.files).sort();
    expect(zipPaths).toContain('wincross/export.job');
    expect(zipPaths).toContain('wincross/README.md');
    expect(zipPaths).toContain('wincross/data/wide.sav');
    expect(zipPaths).not.toContain('wincross/support-report.json');
    expect(zipPaths).not.toContain('wincross/table-routing.json');
    expect(zipPaths).not.toContain('wincross/job-routing-manifest.json');
  });

  it('archive includes only wide.sav when export.job uses INDEX-based stacked logic', async () => {
    const artifacts = createArtifacts();
    artifacts.metadata.availableDataFiles = [
      {
        dataFrameRef: 'wide',
        fileName: 'wide.sav',
        relativePath: 'export/data/wide.sav',
        exists: true,
        r2Key: 'r2/wide',
      },
      {
        dataFrameRef: 'stacked_loop1',
        fileName: 'stacked_loop1.sav',
        relativePath: 'export/data/stacked_loop1.sav',
        exists: true,
        r2Key: 'r2/stacked',
      },
    ];
    (artifacts.metadata.r2Refs.dataFiles as Record<string, string>)['export/data/stacked_loop1.sav'] = 'r2/stacked';
    artifacts.tableRouting = {
      ...artifacts.tableRouting,
      totalTables: 2,
      tableToDataFrameRef: { ...artifacts.tableRouting.tableToDataFrameRef, t2: 'stacked_loop1' },
      countsByDataFrameRef: { ...artifacts.tableRouting.countsByDataFrameRef, stacked_loop1: 1 },
    };
    artifacts.jobRouting = {
      ...artifacts.jobRouting,
      totalJobs: 2,
      totalTables: 2,
      jobs: [
        {
          jobId: 'wide.job',
          dataFrameRef: 'wide',
          dataFileRelativePath: 'export/data/wide.sav',
          tableIds: ['t1'],
        },
        {
          jobId: 'stacked.job',
          dataFrameRef: 'stacked_loop1',
          dataFileRelativePath: 'export/data/stacked_loop1.sav',
          tableIds: ['t2'],
        },
      ],
      tableToJobId: { ...artifacts.jobRouting.tableToJobId, t2: 'stacked.job' },
    };
    artifacts.sortedFinal.tables.push({
      tableId: 't2',
      questionId: 'Q2_1',
      questionText: 'Question 2',
      tableType: 'frequency',
      additionalFilter: '',
      rows: [
        { variable: 'Q2_1', label: 'No', filterValue: '0', rowKind: 'value', isNet: false, netComponents: [] },
      ],
    });
    artifacts.loopSummary = {
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
              label: 'Question 2',
              iterationColumns: {
                '1': 'Q2_1',
                '2': 'Q2_2',
              },
            },
          ],
        },
      ],
    };

    payloadByKey.set('r2/meta', artifacts.metadata);
    payloadByKey.set('r2/table-routing', artifacts.tableRouting);
    payloadByKey.set('r2/job-routing', artifacts.jobRouting);
    payloadByKey.set('r2/loop-policy', artifacts.loopPolicy);
    payloadByKey.set('r2/support', artifacts.support);
    payloadByKey.set('r2/sorted-final', artifacts.sortedFinal);
    payloadByKey.set('r2/results', artifacts.results);
    payloadByKey.set('r2/crosstab', artifacts.crosstab);
    payloadByKey.set('r2/loop-summary', artifacts.loopSummary);
    payloadByKey.set('r2/wide', Buffer.from('SAVDATA_WIDE'));
    payloadByKey.set('r2/stacked', Buffer.from('SAVDATA_STACKED'));

    const runResult = createRunResult(true);
    await generateWinCrossExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      preferenceSource: { kind: 'default' },
    });

    const uploadCall = mocks.uploadWinCrossExportPackageArtifacts.mock.calls[0];
    const uploadedArtifacts = uploadCall?.[4] as Record<string, string | Buffer>;
    const archiveBuffer = uploadedArtifacts['wincross/export.zip'] as Buffer;
    const zip = await JSZip.loadAsync(archiveBuffer);

    const zipPaths = Object.keys(zip.files).sort();
    expect(zipPaths).toContain('wincross/export.job');
    expect(zipPaths).toContain('wincross/data/wide.sav');
    // Stacked .sav files should NOT be included — INDEX mode uses wide.sav only.
    expect(zipPaths).not.toContain('wincross/data/stacked_loop1.sav');

    const zippedJobBuffer = await zip.file('wincross/export.job')!.async('nodebuffer');
    const zippedJobText = zippedJobBuffer.subarray(2).toString('utf16le');
    expect(zippedJobText).toContain('INDEX {Q2_1}');
    expect(zippedJobText).toContain('INDEX {Q2_2}');
    expect(zippedJobText).toContain('AF=IDX(1)');
    expect(zippedJobText).not.toContain('DATA=');
  });
});
