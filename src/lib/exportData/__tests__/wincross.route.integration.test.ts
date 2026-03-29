import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  generateWinCrossExportPackage: vi.fn(),
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

vi.mock('@/lib/exportData/wincross/service', () => ({
  generateWinCrossExportPackage: mocks.generateWinCrossExportPackage,
}));

describe('WinCross export route integration', () => {
  let POST: typeof import('@/app/api/runs/[runId]/exports/wincross/route').POST;
  let GET: typeof import('@/app/api/runs/[runId]/exports/wincross/route').GET;

  beforeEach(async () => {
    if (!POST) {
      ({ POST, GET } = await import('@/app/api/runs/[runId]/exports/wincross/route'));
    }
    vi.clearAllMocks();
  });

  it('returns 404 when run not found', async () => {
    mocks.query.mockResolvedValueOnce(null);

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 when org mismatch', async () => {
    // Convex query returns null when orgId doesn't match (enforced at query level)
    mocks.query.mockResolvedValueOnce(null);

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('maps service errors to correct HTTP status codes', async () => {
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      result: {},
    });

    const { WinCrossExportServiceError } = await import('@/lib/exportData/wincross/types');
    mocks.generateWinCrossExportPackage.mockRejectedValueOnce(
      new WinCrossExportServiceError('export_not_ready', 'Not ready', 409, ['r2_not_finalized']),
    );

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(409);
    expect(payload.error).toBe('export_not_ready');
  });

  it('returns 410 when run artifacts are expired', async () => {
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      expiredAt: Date.UTC(2026, 3, 20),
      result: {},
    });

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(410);
    expect(mocks.generateWinCrossExportPackage).not.toHaveBeenCalled();
  });

  it('persists descriptor on success', async () => {
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      result: {},
    });

    mocks.generateWinCrossExportPackage.mockResolvedValueOnce({
      cached: false,
      descriptor: {
        packageId: 'pkg-1',
        exporterVersion: 'wincross-exporter.v1',
        manifestVersion: 'wincross.phase1.v1',
        generatedAt: '2026-03-19T00:00:00.000Z',
        manifestHash: 'mhash',
        jobHash: 'jhash',
        profileDigest: 'pdigest',
        sourceDigest: 'sdigest',
        serializerContractVersion: 'wincross-serializer.v2',
        files: { 'wincross/export.job': 'r2/key' },
      },
      downloadUrls: { 'wincross/export.job': 'https://example.com' },
      manifest: {
        supportSummary: { supported: 1, warning: 0, blocked: 0 },
        blockedCount: 0,
        blockedItems: [],
        warnings: [],
      },
      diagnostics: { warnings: [], errors: [], sectionNames: [], encoding: 'unknown' },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0][1]).toMatchObject({
      platform: 'wincross',
      descriptor: {
        packageId: 'pkg-1',
        supportSummary: { supported: 1, warning: 0, blocked: 0 },
        blockedCount: 0,
        warningCount: 0,
        primaryDownloadPath: 'wincross/export.zip',
        parseDiagnostics: { warnings: [], errors: [], sectionNames: [], encoding: 'unknown' },
      },
    });
  });

  it('returns 200 for cache hit, 201 for fresh generation', async () => {
    // Fresh
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      result: {},
    });
    mocks.generateWinCrossExportPackage.mockResolvedValueOnce({
      cached: false,
      descriptor: {
        packageId: 'pkg-1',
        exporterVersion: 'v1',
        manifestVersion: 'v1',
        generatedAt: 'now',
        manifestHash: 'h',
        jobHash: 'j',
        profileDigest: 'p',
        sourceDigest: 's',
        serializerContractVersion: 'v2',
        files: {},
      },
      downloadUrls: {},
      manifest: { supportSummary: { supported: 0, warning: 0, blocked: 0 }, blockedCount: 0, blockedItems: [], warnings: [] },
      diagnostics: { warnings: [], errors: [], sectionNames: [], encoding: 'unknown' },
    });

    const freshResponse = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(freshResponse.status).toBe(201);

    // Cached
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      result: {},
    });
    mocks.generateWinCrossExportPackage.mockResolvedValueOnce({
      cached: true,
      descriptor: {
        packageId: 'pkg-1',
        exporterVersion: 'v1',
        manifestVersion: 'v1',
        generatedAt: 'now',
        manifestHash: 'h',
        jobHash: 'j',
        profileDigest: 'p',
        sourceDigest: 's',
        serializerContractVersion: 'v2',
        files: {},
      },
      downloadUrls: {},
      manifest: { supportSummary: { supported: 0, warning: 0, blocked: 0 }, blockedCount: 0, blockedItems: [], warnings: [] },
      diagnostics: { warnings: [], errors: [], sectionNames: [], encoding: 'unknown' },
    });

    const cachedResponse = await GET(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'GET' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(cachedResponse.status).toBe(200);
  });

  it('extracts preferenceSource from body variants', async () => {
    const testCases = [
      {
        name: 'empty body → default',
        body: null,
        expectedKind: 'default',
      },
      {
        name: 'preferenceSource default → explicit default',
        body: { preferenceSource: 'default' },
        expectedKind: 'default',
      },
      {
        name: 'embedded_reference:hcp_vaccines → embedded_reference',
        body: { preferenceSource: 'embedded_reference:hcp_vaccines' },
        expectedKind: 'embedded_reference',
      },
      {
        name: 'preferenceJobText → inline_job',
        body: { preferenceJobText: '[VERSION]\n25.0\n' },
        expectedKind: 'inline_job',
      },
      {
        name: 'preferenceJobBase64 → inline_job',
        body: { preferenceJobBase64: Buffer.from('[VERSION]\n25.0\n').toString('base64') },
        expectedKind: 'inline_job',
      },
    ];

    for (const tc of testCases) {
      vi.clearAllMocks();
      mocks.query.mockResolvedValueOnce({
        orgId: 'org-1',
        projectId: 'proj-1',
        result: {},
      });
      mocks.generateWinCrossExportPackage.mockResolvedValueOnce({
        cached: false,
        descriptor: {
          packageId: 'pkg-1',
          exporterVersion: 'v1',
          manifestVersion: 'v1',
          generatedAt: 'now',
          manifestHash: 'h',
          jobHash: 'j',
          profileDigest: 'p',
          sourceDigest: 's',
          serializerContractVersion: 'v2',
          files: {},
        },
        downloadUrls: {},
        manifest: { supportSummary: { supported: 0, warning: 0, blocked: 0 }, blockedCount: 0, blockedItems: [], warnings: [] },
        diagnostics: { warnings: [], errors: [], sectionNames: [], encoding: 'unknown' },
      });

      const req = tc.body
        ? new NextRequest('http://localhost/api/runs/run-1/exports/wincross', {
            method: 'POST',
            body: JSON.stringify(tc.body),
            headers: { 'Content-Type': 'application/json' },
          })
        : new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' });

      await POST(req, { params: Promise.resolve({ runId: 'run-1' }) });

      const call = mocks.generateWinCrossExportPackage.mock.calls[0]?.[0] as Record<string, unknown>;
      const source = call?.preferenceSource as Record<string, unknown>;
      expect(source?.kind).toBe(tc.expectedKind);
    }
  });

  it('allows explicit default to override a stored project profile', async () => {
    mocks.query
      .mockResolvedValueOnce({
        orgId: 'org-1',
        projectId: 'proj-1',
        config: { wincrossProfileId: 'profile-123' },
        result: {},
      });
    mocks.generateWinCrossExportPackage.mockResolvedValueOnce({
      cached: false,
      descriptor: {
        packageId: 'pkg-1',
        exporterVersion: 'v1',
        manifestVersion: 'v1',
        generatedAt: 'now',
        manifestHash: 'h',
        jobHash: 'j',
        profileDigest: 'p',
        sourceDigest: 's',
        serializerContractVersion: 'v2',
        files: {},
      },
      downloadUrls: {},
      manifest: { supportSummary: { supported: 0, warning: 0, blocked: 0 }, blockedCount: 0, blockedItems: [], warnings: [] },
      diagnostics: { warnings: [], errors: [], sectionNames: [], encoding: 'unknown' },
    });

    const request = new NextRequest('http://localhost/api/runs/run-1/exports/wincross', {
      method: 'POST',
      body: JSON.stringify({ preferenceSource: 'default' }),
      headers: { 'Content-Type': 'application/json' },
    });

    await POST(request, { params: Promise.resolve({ runId: 'run-1' }) });

    const call = mocks.generateWinCrossExportPackage.mock.calls[0]?.[0] as Record<string, unknown>;
    const source = call?.preferenceSource as Record<string, unknown>;
    expect(source?.kind).toBe('default');
  });

  it('reports blockedCount from manifest.blockedCount', async () => {
    mocks.query.mockResolvedValueOnce({
      orgId: 'org-1',
      projectId: 'proj-1',
      result: {},
    });
    mocks.generateWinCrossExportPackage.mockResolvedValueOnce({
      cached: false,
      descriptor: {
        packageId: 'pkg-1',
        exporterVersion: 'v1',
        manifestVersion: 'v1',
        generatedAt: 'now',
        manifestHash: 'h',
        jobHash: 'j',
        profileDigest: 'p',
        sourceDigest: 's',
        serializerContractVersion: 'v2',
        files: {},
      },
      downloadUrls: {},
      manifest: {
        supportSummary: { supported: 0, warning: 0, blocked: 2 },
        blockedCount: 2,
        blockedItems: [],
        warnings: [],
      },
      diagnostics: { warnings: [], errors: [], sectionNames: [], encoding: 'unknown' },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/exports/wincross', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(payload.blockedCount).toBe(2);
  });
});
