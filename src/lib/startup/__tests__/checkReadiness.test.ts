import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetCache } from '../checkReadiness';

// Store original env
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  _resetCache();
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

function setValidEnv() {
  process.env.AI_PROVIDER = 'azure';
  process.env.AZURE_API_KEY = 'test-azure-key-12345';
  process.env.AZURE_RESOURCE_NAME = 'my-resource';
  process.env.CONVEX_URL = 'https://test.convex.cloud';
  process.env.CONVEX_DEPLOY_KEY = 'deploy-key-123';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.AUTH_BYPASS = 'true';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
}

// Mock findRscriptAsync to avoid spawning real processes
vi.mock('../findRscriptBinary', () => ({
  findRscriptAsync: vi.fn().mockResolvedValue({ path: '/usr/bin/Rscript', version: 'R scripting front-end version 4.3.1' }),
}));

// Mock @aws-sdk/client-s3 to avoid real R2 calls
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class MockS3Client {
      send = vi.fn().mockResolvedValue({});
    },
    HeadBucketCommand: class MockHeadBucketCommand {
      constructor(public input: Record<string, unknown>) {}
    },
  };
});

describe('checkReadiness', () => {
  it('returns ready=true when all checks pass', async () => {
    setValidEnv();
    // Mock fetch for Convex check
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { checkReadiness } = await import('../checkReadiness');
    const result = await checkReadiness();

    expect(result.ready).toBe(true);
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('returns ready=false when Convex is unreachable', async () => {
    setValidEnv();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    _resetCache();
    const { checkReadiness } = await import('../checkReadiness');
    const result = await checkReadiness();

    expect(result.ready).toBe(false);
    const convexCheck = result.checks.find((c) => c.name === 'convex');
    expect(convexCheck?.status).toBe('fail');
    expect(convexCheck?.error).toContain('Connection refused');
  });

  it('returns ready=false when env validation fails', async () => {
    setValidEnv();
    delete process.env.AZURE_API_KEY; // break env validation
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    _resetCache();
    const { checkReadiness } = await import('../checkReadiness');
    const result = await checkReadiness();

    expect(result.ready).toBe(false);
    const envCheck = result.checks.find((c) => c.name === 'env_validation');
    expect(envCheck?.status).toBe('fail');
  });

  it('returns ready=false when Rscript is not found', async () => {
    setValidEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    // Override Rscript mock for this test
    const { findRscriptAsync } = await import('../findRscriptBinary');
    vi.mocked(findRscriptAsync).mockResolvedValueOnce(null);

    _resetCache();
    const { checkReadiness } = await import('../checkReadiness');
    const result = await checkReadiness();

    expect(result.ready).toBe(false);
    const rCheck = result.checks.find((c) => c.name === 'rscript');
    expect(rCheck?.status).toBe('fail');
  });

  it('returns cached result on rapid successive calls', async () => {
    setValidEnv();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    _resetCache();
    const { checkReadiness } = await import('../checkReadiness');

    const result1 = await checkReadiness();
    const result2 = await checkReadiness();

    // Second call should return cached result — fetch only called once
    expect(result1).toBe(result2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('includes latency in each check', async () => {
    setValidEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    _resetCache();
    const { checkReadiness } = await import('../checkReadiness');
    const result = await checkReadiness();

    for (const check of result.checks) {
      expect(typeof check.latencyMs).toBe('number');
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats Convex 405 as healthy', async () => {
    setValidEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 405 }));

    _resetCache();
    const { checkReadiness } = await import('../checkReadiness');
    const result = await checkReadiness();

    const convexCheck = result.checks.find((c) => c.name === 'convex');
    expect(convexCheck?.status).toBe('pass');
  });
});
