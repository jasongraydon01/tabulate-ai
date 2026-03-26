import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  generateQExportPackage: vi.fn(),
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
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/exportData/q/service', () => ({
  generateQExportPackage: mocks.generateQExportPackage,
}));

const originalEnableFlag = process.env.ENABLE_Q_EXPORT_PHASE2;

describe('Q export route integration', () => {
  let POST: typeof import('@/app/api/runs/[runId]/exports/q/route').POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import('@/app/api/runs/[runId]/exports/q/route'));
    }
    vi.clearAllMocks();
    process.env.ENABLE_Q_EXPORT_PHASE2 = 'true';
  });

  it('returns 404 when feature flag is disabled', async () => {
    process.env.ENABLE_Q_EXPORT_PHASE2 = 'false';

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/q', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 when native-qscript flag is explicitly disabled', async () => {
    process.env.ENABLE_Q_EXPORT_NATIVE_QSCRIPT = 'false';

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/q', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('maps service readiness failures to deterministic API errors', async () => {
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      result: {},
    });

    const { QExportServiceError } = await import('@/lib/exportData/q/types');
    mocks.generateQExportPackage.mockRejectedValueOnce(
      new QExportServiceError('export_not_ready', 'Not ready', 409, ['r2_not_finalized']),
    );

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/q', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(409);
    expect(payload.error).toBe('export_not_ready');
  });

  it('persists q descriptor on successful generation', async () => {
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      result: {},
    });

    mocks.generateQExportPackage.mockResolvedValueOnce({
      cached: false,
      descriptor: {
        packageId: 'pkg-1',
        exporterVersion: 'q-exporter.v17',
        manifestVersion: 'q.phase2.native.v3',
        runtimeContractVersion: 'qscript-native.v5',
        helperRuntimeHash: 'h'.repeat(64),
        generatedAt: '2026-02-27T00:00:00.000Z',
        manifestHash: 'manifest',
        scriptHash: 'script',
        files: { 'q/q-export-manifest.json': 'r2/key' },
      },
      downloadUrls: { 'q/q-export-manifest.json': 'https://example.com' },
      manifest: {
        supportSummary: { supported: 1, warning: 0, blocked: 0 },
        blockedItems: [],
        warnings: [],
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/q', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0][1]).toMatchObject({
      platform: 'q',
      descriptor: {
        packageId: 'pkg-1',
        supportSummary: { supported: 1, warning: 0, blocked: 0 },
        blockedCount: 0,
        warningCount: 0,
        primaryDownloadPath: 'q/setup-project.QScript',
      },
    });
  });
});

afterEach(() => {
  process.env.ENABLE_Q_EXPORT_PHASE2 = originalEnableFlag;
  delete process.env.ENABLE_Q_EXPORT_NATIVE_QSCRIPT;
});
