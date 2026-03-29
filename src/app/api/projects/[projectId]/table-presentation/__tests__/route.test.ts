import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  getUsedSlots: vi.fn(),
  rebuildRun: vi.fn(),
  generateQ: vi.fn(),
  generateWinCross: vi.fn(),
  requireConvexAuth: vi.fn(async () => ({
    convexOrgId: 'org-1',
    convexUserId: 'user-1',
    role: 'admin',
  })),
}));

vi.mock('@/lib/requireConvexAuth', () => ({
  requireConvexAuth: mocks.requireConvexAuth,
  AuthenticationError: class AuthenticationError extends Error {},
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}));

vi.mock('@/lib/convex', () => ({
  getConvexClient: () => ({ query: mocks.query }),
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/tablePresentation/rebuildService', () => ({
  getRunTablePresentationUsedSlots: mocks.getUsedSlots,
  rebuildRunTablePresentation: mocks.rebuildRun,
}));

vi.mock('@/lib/exportData/q/service', () => ({
  generateQExportPackage: mocks.generateQ,
}));

vi.mock('@/lib/exportData/wincross/service', () => ({
  generateWinCrossExportPackage: mocks.generateWinCross,
}));

describe('table presentation route', () => {
  let GET: typeof import('@/app/api/projects/[projectId]/table-presentation/route').GET;
  let PATCH: typeof import('@/app/api/projects/[projectId]/table-presentation/route').PATCH;

  beforeEach(async () => {
    if (!GET) {
      ({ GET, PATCH } = await import('@/app/api/projects/[projectId]/table-presentation/route'));
    }
    vi.clearAllMocks();
  });

  it('returns the current vocabulary and used slots for the latest completed run', async () => {
    mocks.query
      .mockResolvedValueOnce({
        _id: 'project-1',
        config: {
          tablePresentation: {
            labelVocabulary: {
              meanLabel: 'Average',
            },
          },
        },
      })
      .mockResolvedValueOnce([
        {
          _id: 'run-1',
          status: 'success',
          result: {
            r2Files: {
              outputs: {
                'tables/13d-table-canonical.json': 'org/project/run/tables/13d-table-canonical.json',
              },
            },
          },
        },
      ]);
    mocks.getUsedSlots.mockResolvedValueOnce(['rankFormat', 'meanLabel', 'baseLabel', 'totalLabel']);

    const response = await GET(
      new NextRequest('http://localhost/api/projects/project-1/table-presentation'),
      { params: Promise.resolve({ projectId: 'project_1' }) },
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.usedSlots).toEqual(['rankFormat', 'meanLabel', 'baseLabel', 'totalLabel']);
    expect(payload.latestRun).toEqual({
      runId: 'run-1',
      status: 'success',
      canRebuild: true,
    });
    expect(payload.labelVocabulary).toMatchObject({
      meanLabel: 'Average',
    });
  });

  it('marks expired runs as not rebuildable', async () => {
    mocks.query
      .mockResolvedValueOnce({
        _id: 'project-1',
        config: {},
      })
      .mockResolvedValueOnce([
        {
          _id: 'run-1',
          status: 'success',
          expiredAt: Date.UTC(2026, 3, 20),
          result: {
            r2Files: {
              outputs: {
                'tables/13d-table-canonical.json': 'org/project/run/tables/13d-table-canonical.json',
              },
            },
          },
        },
      ]);

    const response = await GET(
      new NextRequest('http://localhost/api/projects/project-1/table-presentation'),
      { params: Promise.resolve({ projectId: 'project_1' }) },
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.latestRun).toEqual({
      runId: 'run-1',
      status: 'success',
      canRebuild: false,
    });
    expect(mocks.getUsedSlots).not.toHaveBeenCalled();
  });

  it('updates project config and rebuilds the latest run outputs', async () => {
    mocks.query
      .mockResolvedValueOnce({
        _id: 'project-1',
        config: {
          exportFormats: ['excel', 'q'],
          displayMode: 'frequency',
          theme: 'classic',
        },
      })
      .mockResolvedValueOnce([
        {
          _id: 'run-1',
          status: 'success',
          config: {
            exportFormats: ['excel', 'q'],
            displayMode: 'frequency',
            theme: 'classic',
          },
          result: {
            r2Files: {
              outputs: {
                'tables/13d-table-canonical.json': 'org/project/run/tables/13d-table-canonical.json',
                'results/tables.json': 'org/project/run/results/tables.json',
                'results/crosstabs.xlsx': 'org/project/run/results/crosstabs.xlsx',
              },
            },
            exportReadiness: {
              reexport: { ready: true, reasonCodes: ['ready'] },
            },
            exportArtifacts: {
              metadataPath: 'export/manifest.json',
              r2Refs: { artifacts: {} },
            },
          },
        },
      ]);
    mocks.rebuildRun.mockResolvedValueOnce({
      usedSlots: ['topBoxFormat', 'baseLabel', 'totalLabel'],
      updatedArtifactPaths: ['tables/13d-table-canonical.json', 'results/tables.json'],
      rebuiltWorkbookPaths: ['results/crosstabs.xlsx'],
      exportPackagesShouldRefresh: true,
    });
    mocks.generateQ.mockResolvedValueOnce({
      descriptor: {
        packageId: 'q-1',
        files: {
          'q/setup-project.QScript': 'org/project/run/exports/q/setup-project.QScript',
        },
      },
      manifest: {
        supportSummary: { supported: 12, warning: 0, blocked: 0 },
        blockedItems: [],
        warnings: [],
      },
    });

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects/project-1/table-presentation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labelVocabulary: {
            rankFormat: 'Rank #{N}',
            topBoxFormat: 'T{N}B',
            bottomBoxFormat: 'Bottom {N} Box',
            meanLabel: 'Average',
            medianLabel: 'Median',
            stddevLabel: 'Std Dev',
            stderrLabel: 'Std Err',
            totalLabel: 'All Respondents',
            baseLabel: 'Base (n)',
            netPrefix: 'NET: ',
            middleBoxLabel: 'Middle',
            notRankedLabel: 'Not Ranked',
            npsScoreLabel: 'NPS Score',
            promotersLabel: 'Promoters',
            passivesLabel: 'Passives',
            detractorsLabel: 'Detractors',
          },
        }),
      }),
      { params: Promise.resolve({ projectId: 'project_1' }) },
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mocks.rebuildRun).toHaveBeenCalledTimes(1);
    expect(mocks.generateQ).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(4);
    expect(mocks.mutateInternal.mock.calls[0][1]).toMatchObject({
      projectId: 'project_1',
      orgId: 'org-1',
    });
    expect(mocks.mutateInternal.mock.calls[1][1]).toMatchObject({
      runId: 'run-1',
      orgId: 'org-1',
    });
    expect(mocks.mutateInternal.mock.calls[2][1]).toMatchObject({
      runId: 'run-1',
      orgId: 'org-1',
    });
    expect(mocks.mutateInternal.mock.calls[3][1]).toMatchObject({
      runId: 'run-1',
      platform: 'q',
      descriptor: expect.objectContaining({
        packageId: 'q-1',
        blockedCount: 0,
        warningCount: 0,
        primaryDownloadPath: 'q/setup-project.QScript',
      }),
    });
    expect(payload.usedSlots).toEqual(['topBoxFormat', 'baseLabel', 'totalLabel']);
    expect(payload.rebuild).toMatchObject({
      runId: 'run-1',
    });
  });

  it('saves future labels when the latest completed run artifacts expired', async () => {
    mocks.query
      .mockResolvedValueOnce({
        _id: 'project-1',
        config: {
          exportFormats: ['excel'],
          displayMode: 'frequency',
          theme: 'classic',
        },
      })
      .mockResolvedValueOnce([
        {
          _id: 'run-1',
          status: 'success',
          expiredAt: Date.UTC(2026, 3, 20),
          config: {
            exportFormats: ['excel'],
            displayMode: 'frequency',
            theme: 'classic',
          },
          result: {
            r2Files: {
              outputs: {
                'results/crosstabs.xlsx': 'org/project/run/results/crosstabs.xlsx',
              },
            },
          },
        },
      ]);

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects/project-1/table-presentation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labelVocabulary: {
            rankFormat: 'Rank #{N}',
            topBoxFormat: 'T{N}B',
            bottomBoxFormat: 'Bottom {N} Box',
            meanLabel: 'Average',
            medianLabel: 'Median',
            stddevLabel: 'Std Dev',
            stderrLabel: 'Std Err',
            totalLabel: 'All Respondents',
            baseLabel: 'Base (n)',
            netPrefix: 'NET: ',
            middleBoxLabel: 'Middle',
            notRankedLabel: 'Not Ranked',
            npsScoreLabel: 'NPS Score',
            promotersLabel: 'Promoters',
            passivesLabel: 'Passives',
            detractorsLabel: 'Detractors',
          },
        }),
      }),
      { params: Promise.resolve({ projectId: 'project_1' }) },
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.rebuildRun).not.toHaveBeenCalled();
    expect(payload.warnings).toEqual([
      'Latest completed run artifacts expired. The new labels will apply on the next run.',
    ]);
  });
});
