import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getDownloadUrl: vi.fn(),
}));

vi.mock('@/lib/requireConvexAuth', () => ({
  requireConvexAuth: vi.fn(async () => ({ convexOrgId: 'org-1', role: 'admin' })),
  AuthenticationError: class AuthenticationError extends Error {},
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}));

vi.mock('@/lib/convex', () => ({
  getConvexClient: () => ({ query: mocks.query }),
}));

vi.mock('@/lib/r2/R2FileManager', () => ({
  getDownloadUrl: mocks.getDownloadUrl,
}));

vi.mock('@/schemas/runResultSchema', () => ({
  parseRunResult: vi.fn((value: unknown) => value),
}));

describe('Download route', () => {
  let GET: typeof import('@/app/api/runs/[runId]/download/[...filename]/route').GET;

  beforeEach(async () => {
    if (!GET) {
      ({ GET } = await import('@/app/api/runs/[runId]/download/[...filename]/route'));
    }
    vi.clearAllMocks();
    mocks.getDownloadUrl.mockResolvedValue('https://signed.example.com/download');
  });

  it('downloads nested package artifacts by exact relative path', async () => {
    mocks.query
      .mockResolvedValueOnce({
        _creationTime: Date.UTC(2026, 2, 20),
        orgId: 'org-1',
        projectId: 'proj-1',
        result: {
          exportPackages: {
            q: {
              files: {
                'q/export.zip': 'r2/q-export-zip',
              },
            },
            wincross: {
              files: {
                'wincross/export.zip': 'r2/wincross-export-zip',
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ name: 'Sample Study' });

    const response = await GET(
      new NextRequest('http://localhost/api/runs/run-1/download/q/export.zip'),
      { params: Promise.resolve({ runId: 'run-1', filename: ['q', 'export.zip'] }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://signed.example.com/download');
    expect(mocks.getDownloadUrl).toHaveBeenCalledWith(
      'r2/q-export-zip',
      3600,
      'attachment; filename="TabulateAI - Sample Study - 2026-03-20 (Q Export).zip"',
    );
  });

  it('uses descriptive filenames for WinCross package artifacts', async () => {
    mocks.query
      .mockResolvedValueOnce({
        _creationTime: Date.UTC(2026, 2, 20),
        orgId: 'org-1',
        projectId: 'proj-1',
        result: {
          exportPackages: {
            wincross: {
              files: {
                'wincross/export.job': 'r2/wincross-job',
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ name: 'Sample Study' });

    const response = await GET(
      new NextRequest('http://localhost/api/runs/run-1/download/wincross/export.job'),
      { params: Promise.resolve({ runId: 'run-1', filename: ['wincross', 'export.job'] }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://signed.example.com/download');
    expect(mocks.getDownloadUrl).toHaveBeenCalledWith(
      'r2/wincross-job',
      3600,
      'attachment; filename="TabulateAI - Sample Study - 2026-03-20 (WinCross).job"',
    );
  });

  it('keeps basename aliases for excel outputs', async () => {
    mocks.query
      .mockResolvedValueOnce({
        _creationTime: Date.UTC(2026, 2, 20),
        orgId: 'org-1',
        projectId: 'proj-1',
        result: {
          r2Files: {
            outputs: {
              'results/crosstabs.xlsx': 'r2/excel',
            },
          },
        },
      })
      .mockResolvedValueOnce({ name: 'Sample Study' });

    const response = await GET(
      new NextRequest('http://localhost/api/runs/run-1/download/crosstabs.xlsx'),
      { params: Promise.resolve({ runId: 'run-1', filename: ['crosstabs.xlsx'] }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://signed.example.com/download');
    expect(mocks.getDownloadUrl).toHaveBeenCalledWith(
      'r2/excel',
      3600,
      expect.stringContaining('.xlsx'),
    );
  });

  it('returns 410 when run artifacts are expired', async () => {
    mocks.query.mockResolvedValueOnce({
      _creationTime: Date.UTC(2026, 2, 20),
      orgId: 'org-1',
      projectId: 'proj-1',
      expiredAt: Date.UTC(2026, 3, 20),
      result: {
        r2Files: {
          outputs: {
            'results/crosstabs.xlsx': 'r2/excel',
          },
        },
      },
    });

    const response = await GET(
      new NextRequest('http://localhost/api/runs/run-1/download/crosstabs.xlsx'),
      { params: Promise.resolve({ runId: 'run-1', filename: ['crosstabs.xlsx'] }) },
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'Run artifacts have been removed after the 30-day retention period.',
    });
    expect(mocks.getDownloadUrl).not.toHaveBeenCalled();
  });
});
