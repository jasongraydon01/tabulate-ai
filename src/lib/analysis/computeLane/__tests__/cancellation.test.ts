import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('@/lib/convex', () => ({
  getConvexClient: () => ({ query: mocks.query }),
}));

describe('assertAnalysisRunNotCancelled', () => {
  let assertAnalysisRunNotCancelled: typeof import('../cancellation').assertAnalysisRunNotCancelled;

  beforeEach(async () => {
    if (!assertAnalysisRunNotCancelled) {
      ({ assertAnalysisRunNotCancelled } = await import('../cancellation'));
    }
    vi.clearAllMocks();
  });

  it('throws AbortError when the abort signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(assertAnalysisRunNotCancelled({
      runId: 'run-1',
      orgId: 'org-1',
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('throws AbortError when Convex marks the run cancelled', async () => {
    mocks.query.mockResolvedValueOnce({ cancelRequested: true, status: 'cancelled' });

    await expect(assertAnalysisRunNotCancelled({
      runId: 'run-1',
      orgId: 'org-1',
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not fail the compute run when the cancellation probe itself fails', async () => {
    mocks.query.mockRejectedValueOnce(new Error('Convex unavailable'));

    await expect(assertAnalysisRunNotCancelled({
      runId: 'run-1',
      orgId: 'org-1',
    })).resolves.toBeUndefined();
  });
});
