import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  uploadQExportPackageArtifacts: vi.fn(),
  getDownloadUrlsForArtifactMap: vi.fn(),
}));

vi.mock('@/lib/r2/r2', () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock('@/lib/r2/R2FileManager', () => ({
  uploadQExportPackageArtifacts: mocks.uploadQExportPackageArtifacts,
  getDownloadUrlsForArtifactMap: mocks.getDownloadUrlsForArtifactMap,
}));

import { generateQExportPackage } from '@/lib/exportData/q/service';
import { QExportServiceError, Q_EXPORT_RUNTIME_CONTRACT } from '@/lib/exportData/q/types';
import type { ExportManifestMetadata } from '@/lib/exportData/types';

function createArtifacts() {
  const metadata = {
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
      jobs: {
        'q:wide.job': 'job-hash',
      },
    },
  };

  return {
    metadata,
    tableRouting: {
      generatedAt: '2026-02-27T00:00:00.000Z',
      totalTables: 1,
      tableToDataFrameRef: { t1: 'wide' },
      countsByDataFrameRef: { wide: 1 },
    },
    jobRouting: {
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
      tableToJobId: { t1: 'wide.job' },
    },
    loopPolicy: {
      policyVersion: '1.0',
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
      ],
      warnings: [],
      reasoning: 'ok',
      fallbackApplied: false,
      fallbackReason: '',
    },
    support: {
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
          rows: [{ variable: 'Q1', label: 'Yes', filterValue: '1' }],
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
    results: {
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
    crosstab: {
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
        'tables/07-sorted-final.json': 'r2/sorted-final',
        'results/tables.json': 'r2/results',
        'crosstab/crosstab-output-raw.json': 'r2/crosstab',
        'stages/loop-summary.json': 'r2/loop-summary',
      },
    },
  };
}

describe('Q export service integration', () => {
  const payloadByKey = new Map<string, unknown>();

  beforeEach(() => {
    vi.clearAllMocks();
    payloadByKey.clear();
    vi.useRealTimers();

    mocks.downloadFile.mockImplementation(async (key: string) => {
      const payload = payloadByKey.get(key);
      if (payload === undefined) {
        throw new Error(`Missing mock payload for key: ${key}`);
      }
      if (Buffer.isBuffer(payload)) {
        return payload;
      }
      if (typeof payload === 'string') {
        return Buffer.from(payload);
      }
      return Buffer.from(JSON.stringify(payload));
    });

    mocks.uploadQExportPackageArtifacts.mockImplementation(async (
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

  it('rejects export when re-export readiness is false', async () => {
    const runResult = createRunResult(false);

    await expect(generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    })).rejects.toBeInstanceOf(QExportServiceError);
  });

  it('honors native-qscript feature flag toggle', async () => {
    const previous = process.env.ENABLE_Q_EXPORT_NATIVE_QSCRIPT;
    process.env.ENABLE_Q_EXPORT_NATIVE_QSCRIPT = 'false';
    try {
      await expect(generateQExportPackage({
        runId: 'run-1',
        orgId: 'org-1',
        projectId: 'proj-1',
        runResult: {},
      })).rejects.toMatchObject({
        code: 'native_qscript_disabled',
      });
    } finally {
      if (previous === undefined) {
        delete process.env.ENABLE_Q_EXPORT_NATIVE_QSCRIPT;
      } else {
        process.env.ENABLE_Q_EXPORT_NATIVE_QSCRIPT = previous;
      }
    }
  });

  it('generates a package and reuses the cached descriptor on repeated requests', async () => {
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

    const runResult = createRunResult(true);

    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    expect(first.cached).toBe(false);
    expect(first.descriptor.packageId).toHaveLength(64);
    expect(first.descriptor.manifestVersion).toBe('q.phase2.native.v3');
    expect(first.descriptor.runtimeContractVersion).toBe(Q_EXPORT_RUNTIME_CONTRACT.contractVersion);
    expect(first.descriptor.helperRuntimeHash).toHaveLength(64);
    expect(first.descriptor.archivePath).toBe('q/export.zip');
    expect(first.descriptor.archiveHash).toHaveLength(64);
    expect(first.descriptor.files['q/runtime-contract.json']).toBeDefined();
    expect(first.descriptor.files['q/filter-bindings.json']).toBeDefined();
    expect(first.descriptor.files['q/runtime-binding-strategy.json']).toBeDefined();
    expect(first.descriptor.files['q/row-label-audit.json']).toBeDefined();
    expect(first.descriptor.files['q/header-row-audit.json']).toBeDefined();
    expect(first.descriptor.files['q/export.zip']).toBeDefined();
    expect(first.descriptor.files['data/wide.sav']).toBeDefined();
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(1);
    const uploadedArtifacts = mocks.uploadQExportPackageArtifacts.mock.calls[0]?.[4] as Record<string, string | Buffer> | undefined;
    const filterBindings = JSON.parse(String(uploadedArtifacts?.['q/filter-bindings.json'] ?? '[]')) as Array<Record<string, unknown>>;
    const runtimeBindingStrategy = JSON.parse(String(uploadedArtifacts?.['q/runtime-binding-strategy.json'] ?? '{}')) as Record<string, unknown>;
    const rowLabelAudit = JSON.parse(String(uploadedArtifacts?.['q/row-label-audit.json'] ?? '{}')) as Record<string, unknown>;
    const headerRowAudit = JSON.parse(String(uploadedArtifacts?.['q/header-row-audit.json'] ?? '{}')) as Record<string, unknown>;
    expect(filterBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filterId: 'table:t1:additionalFilter',
        bindPath: 'table_filters_variable',
        runtimeBindingResolution: 'pending_q_runtime_preflight',
        runtimeSelectionFrameRef: 'wide',
        runtimeSelectionLogTag: 'HT_FRAME_BINDING_STRATEGY',
      }),
    ]));
    expect(runtimeBindingStrategy).toMatchObject({
      runtimeSelection: {
        status: 'pending_q_runtime_preflight',
        frameLogTag: 'HT_FRAME_BINDING_STRATEGY',
        summaryLogTag: 'HT_RUNTIME_BINDING_SUMMARY',
      },
    });
    expect(rowLabelAudit).toMatchObject({
      summary: {
        totalRows: 1,
        fallbackRows: 0,
        generatedPlaceholderRows: 0,
      },
      rows: [
        expect.objectContaining({
          tableId: 't1',
          rowIndex: 0,
          effectiveLabel: 'Yes',
          labelSource: 'row_label',
        }),
      ],
    });
    expect(headerRowAudit).toMatchObject({
      summary: {
        totalHeaderRows: 0,
        tablesWithHeaders: 0,
      },
    });
    expect(Buffer.isBuffer(uploadedArtifacts?.['q/export.zip'])).toBe(true);

    payloadByKey.set(first.descriptor.files['q/q-export-manifest.json'], first.manifest);

    const second = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: first.descriptor,
    });

    expect(second.cached).toBe(true);
    expect(second.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when cached descriptor is missing new zip/data artifacts', async () => {
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

    const runResult = createRunResult(true);
    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    const legacyDescriptor = {
      ...first.descriptor,
      files: {
        'q/setup-project.QScript': first.descriptor.files['q/setup-project.QScript'],
        'q/q-export-manifest.json': first.descriptor.files['q/q-export-manifest.json'],
      },
    };

    const rebuilt = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: legacyDescriptor,
    });

    expect(rebuilt.cached).toBe(false);
    expect(rebuilt.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when cached descriptor is missing filter-bindings artifact', async () => {
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

    const runResult = createRunResult(true);
    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    const filesWithoutBindings = Object.fromEntries(
      Object.entries(first.descriptor.files).filter(([relativePath]) => relativePath !== 'q/filter-bindings.json'),
    );
    const staleDescriptor = {
      ...first.descriptor,
      files: filesWithoutBindings,
    };

    const rebuilt = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: staleDescriptor,
    });

    expect(rebuilt.cached).toBe(false);
    expect(rebuilt.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when cached descriptor is missing runtime-binding-strategy artifact', async () => {
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

    const runResult = createRunResult(true);
    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    const filesWithoutRuntimeBindingStrategy = Object.fromEntries(
      Object.entries(first.descriptor.files).filter(([relativePath]) => relativePath !== 'q/runtime-binding-strategy.json'),
    );
    const staleDescriptor = {
      ...first.descriptor,
      files: filesWithoutRuntimeBindingStrategy,
    };

    const rebuilt = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: staleDescriptor,
    });

    expect(rebuilt.cached).toBe(false);
    expect(rebuilt.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when cached descriptor is missing row-label-audit artifact', async () => {
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

    const runResult = createRunResult(true);
    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    const filesWithoutRowLabelAudit = Object.fromEntries(
      Object.entries(first.descriptor.files).filter(([relativePath]) => relativePath !== 'q/row-label-audit.json'),
    );
    const staleDescriptor = {
      ...first.descriptor,
      files: filesWithoutRowLabelAudit,
    };

    const rebuilt = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: staleDescriptor,
    });

    expect(rebuilt.cached).toBe(false);
    expect(rebuilt.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when cached descriptor is missing header-row-audit artifact', async () => {
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

    const runResult = createRunResult(true);
    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    const filesWithoutHeaderRowAudit = Object.fromEntries(
      Object.entries(first.descriptor.files).filter(([relativePath]) => relativePath !== 'q/header-row-audit.json'),
    );
    const staleDescriptor = {
      ...first.descriptor,
      files: filesWithoutHeaderRowAudit,
    };

    const rebuilt = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: staleDescriptor,
    });

    expect(rebuilt.cached).toBe(false);
    expect(rebuilt.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('remains deterministic across rebuilds for the same manifest inputs', async () => {
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

    const runResult = createRunResult(true);
    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    const second = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    expect(second.cached).toBe(false);
    expect(second.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(second.descriptor.manifestHash).toBe(first.descriptor.manifestHash);
    expect(second.descriptor.scriptHash).toBe(first.descriptor.scriptHash);
    expect(second.descriptor.generatedAt).toBe(first.descriptor.generatedAt);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('falls back to rebuild when cached descriptor artifacts are stale', async () => {
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

    const runResult = createRunResult(true);
    const first = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    const rebuilt = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
      existingDescriptor: first.descriptor,
    });

    expect(rebuilt.cached).toBe(false);
    expect(rebuilt.descriptor.packageId).toBe(first.descriptor.packageId);
    expect(mocks.uploadQExportPackageArtifacts).toHaveBeenCalledTimes(2);
  });

  it('integrates derived-variable lowering end-to-end for cross-variable filters', async () => {
    const artifacts = createArtifacts();
    artifacts.crosstab.bannerCuts = [
      {
        groupName: 'Parity',
        columns: [{ name: 'Delta', adjusted: 'A4r2c2 > A4r2c1', expressionType: 'direct_variable' }],
      },
    ];
    artifacts.sortedFinal.tables[0].additionalFilter = '(A4r2c2 != A3r2) | (A4r3c2 != A3r3) | (A4r4c2 != A3r4)';
    artifacts.support.supportItems = [
      {
        itemType: 'cut',
        itemId: 'cut:Parity::Delta',
        q: { status: 'warning', reasonCodes: ['cross_variable_comparison'] },
        wincross: { status: 'warning', reasonCodes: ['cross_variable_comparison'] },
      },
      {
        itemType: 'table',
        itemId: 'table:t1',
        q: { status: 'warning', reasonCodes: ['cross_variable_comparison'] },
        wincross: { status: 'warning', reasonCodes: ['cross_variable_comparison'] },
      },
    ];
    artifacts.support.summary = {
      q: { supported: 0, warning: 2, blocked: 0 },
      wincross: { supported: 0, warning: 2, blocked: 0 },
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

    const runResult = createRunResult(true);
    const generated = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    expect(generated.manifest.blockedItems).toHaveLength(0);
    expect(generated.manifest.filters.map((filter) => filter.loweringStrategy).sort()).toEqual([
      'derived_variable',
      'derived_variable',
    ]);
    expect(generated.manifest.supportSummary).toEqual({ supported: 0, warning: 2, blocked: 0 });
    expect(generated.manifest.runtimeContract.contractVersion).toBe(Q_EXPORT_RUNTIME_CONTRACT.contractVersion);

    const uploadedArtifacts = mocks.uploadQExportPackageArtifacts.mock.calls[0]?.[4] as Record<string, string | Buffer> | undefined;
    expect(typeof uploadedArtifacts?.['q/setup-project.QScript']).toBe('string');
    expect(uploadedArtifacts?.['q/setup-project.QScript']).toContain('htPersistFilterVariable');
    expect(uploadedArtifacts?.['q/setup-project.QScript']).not.toContain('newJavaScriptVariable');
    expect(Buffer.isBuffer(uploadedArtifacts?.['q/export.zip'])).toBe(true);
  });

  it('fails hard when required job data refs are missing', async () => {
    const artifacts = createArtifacts();
    artifacts.metadata.r2Refs.dataFiles['export/data/wide.sav'] = '';
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

    await expect(generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    })).rejects.toMatchObject({
      code: 'missing_required_r2_data_file_ref',
    });
  });

  it('recovers when R2 metadata is stale but run-level refs still point to the data file', async () => {
    const artifacts = createArtifacts();
    const staleMetadata = JSON.parse(JSON.stringify(artifacts.metadata)) as ExportManifestMetadata;
    staleMetadata.availableDataFiles = staleMetadata.availableDataFiles.map(({ r2Key: _r2Key, ...file }) => file);
    staleMetadata.r2Refs.dataFiles = {} as Record<string, string>;

    payloadByKey.set('r2/meta', staleMetadata);
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
    ((runResult.exportArtifacts as Record<string, unknown>).r2Refs as Record<string, unknown>).dataFiles = {
      'export/data/wide.sav': 'r2/wide',
    };
    ((runResult.r2Files as Record<string, unknown>).outputs as Record<string, string>)['export/data/wide.sav'] = 'r2/wide';

    const result = await generateQExportPackage({
      runId: 'run-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      runResult,
    });

    expect(result.cached).toBe(false);
    expect(result.descriptor.files['data/wide.sav']).toBeDefined();
  });
});
