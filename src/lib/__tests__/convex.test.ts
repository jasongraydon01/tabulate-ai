import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const instances: any[] = [];
  const queryPlans: any[] = [];
  const mutationPlans: any[] = [];

  class MockConvexHttpClient {
    url: string;
    queryImpl: any;
    mutationImpl: any;
    setAdminAuth = vi.fn();

    constructor(url: string) {
      this.url = url;
      this.queryImpl = queryPlans.shift() ?? vi.fn();
      this.mutationImpl = mutationPlans.shift() ?? vi.fn();
      instances.push(this);
    }

    query(...args: unknown[]) {
      return this.queryImpl(...args);
    }

    mutation(...args: unknown[]) {
      return this.mutationImpl(...args);
    }
  }

  return {
    MockConvexHttpClient,
    instances,
    queryPlans,
    mutationPlans,
  };
});

vi.mock('convex/browser', () => ({
  ConvexHttpClient: mocks.MockConvexHttpClient,
}));

describe('convex client recovery', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    process.env.CONVEX_URL = 'https://test.convex.cloud';
    process.env.CONVEX_DEPLOY_KEY = 'deploy-key-123';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    mocks.instances.length = 0;
    mocks.queryPlans.length = 0;
    mocks.mutationPlans.length = 0;
    vi.clearAllMocks();

    const convex = await import('../convex');
    convex._resetConvexClientForTests();
  });

  afterEach(async () => {
    process.env = originalEnv;
    const convex = await import('../convex');
    convex._resetConvexClientForTests();
  });

  it('creates a client with admin auth', async () => {
    const convex = await import('../convex');

    const client = convex.getConvexClient();

    expect(client).toBeTruthy();
    expect(mocks.instances).toHaveLength(1);
    expect(mocks.instances[0]?.url).toBe('https://test.convex.cloud');
    expect(mocks.instances[0]?.setAdminAuth).toHaveBeenCalledWith('deploy-key-123');
  });

  it('retries transient query failures once with a fresh client', async () => {
    const convex = await import('../convex');
    const firstQuery = vi.fn().mockRejectedValueOnce(
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(
          new Error('getaddrinfo ENOTFOUND fastidious-impala-242.convex.cloud'),
          { code: 'ENOTFOUND' },
        ),
      }),
    );
    const secondQuery = vi.fn().mockResolvedValueOnce({ ok: true });
    mocks.queryPlans.push(firstQuery, secondQuery);

    const result = await convex.queryInternal('runs:get', { limit: 1 });

    expect(result).toEqual({ ok: true });
    expect(firstQuery).toHaveBeenCalledTimes(1);
    expect(secondQuery).toHaveBeenCalledTimes(1);
    expect(mocks.instances).toHaveLength(2);
  });

  it('does not retry transient mutation failures', async () => {
    const convex = await import('../convex');
    const firstMutation = vi.fn().mockRejectedValueOnce(
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      }),
    );
    const secondMutation = vi.fn().mockResolvedValueOnce({ ok: true });
    mocks.mutationPlans.push(firstMutation, secondMutation);

    await expect(convex.mutateInternal('runs:update', { runId: 'run-1' })).rejects.toThrow(
      'fetch failed',
    );

    const result = await convex.mutateInternal('runs:update', { runId: 'run-1' });

    expect(result).toEqual({ ok: true });
    expect(firstMutation).toHaveBeenCalledTimes(1);
    expect(secondMutation).toHaveBeenCalledTimes(1);
    expect(mocks.instances).toHaveLength(2);
  });

  it('recreates the client when the Convex URL changes', async () => {
    const convex = await import('../convex');

    const firstClient = convex.getConvexClient();
    process.env.CONVEX_URL = 'https://second.convex.cloud';
    const secondClient = convex.getConvexClient();

    expect(firstClient).not.toBe(secondClient);
    expect(mocks.instances).toHaveLength(2);
    expect(mocks.instances[0]?.url).toBe('https://test.convex.cloud');
    expect(mocks.instances[1]?.url).toBe('https://second.convex.cloud');
  });

  it('detects transient transport errors from nested causes', async () => {
    const convex = await import('../convex');
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND fastidious-impala-242.convex.cloud'), {
        code: 'ENOTFOUND',
        hostname: 'fastidious-impala-242.convex.cloud',
      }),
    });

    expect(convex.isTransientConvexError(error)).toBe(true);
  });
});
