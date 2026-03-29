import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rm: vi.fn(),
  queryInternal: vi.fn(),
  mutateInternal: vi.fn(),
  deletePrefix: vi.fn(),
  parseRunResult: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    rm: mocks.rm,
  },
}));

vi.mock('@/lib/convex', () => ({
  queryInternal: mocks.queryInternal,
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/r2/r2', () => ({
  deletePrefix: mocks.deletePrefix,
}));

vi.mock('@/schemas/runResultSchema', () => ({
  parseRunResult: mocks.parseRunResult,
}));

describe('artifact cleanup', () => {
  let cleanupPendingArtifactRuns: typeof import('@/lib/worker/artifactCleanup').cleanupPendingArtifactRuns;

  beforeEach(async () => {
    if (!cleanupPendingArtifactRuns) {
      ({ cleanupPendingArtifactRuns } = await import('@/lib/worker/artifactCleanup'));
    }
    vi.clearAllMocks();
    mocks.parseRunResult.mockReturnValue({
      outputDir: `${process.cwd()}/outputs/study/pipeline-1`,
    });
  });

  it('marks runs purged after deleting R2 and local artifacts', async () => {
    mocks.queryInternal.mockResolvedValueOnce([
      {
        _id: 'run-1',
        orgId: 'org-1',
        projectId: 'project-1',
        result: {},
      },
    ]);
    mocks.deletePrefix.mockResolvedValueOnce({ deleted: 3, errors: 0 });

    const summary = await cleanupPendingArtifactRuns(5);

    expect(summary).toEqual({ processed: 1, purged: 1, failed: 0 });
    expect(mocks.deletePrefix).toHaveBeenCalledWith('org-1/project-1/runs/run-1/');
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining('/outputs/study/pipeline-1'),
      { recursive: true, force: true },
    );
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining('/outputs/_recovered/run-1'),
      { recursive: true, force: true },
    );
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0][1]).toEqual({ runId: 'run-1' });
  });

  it('records a failure when R2 deletion reports errors', async () => {
    mocks.queryInternal.mockResolvedValueOnce([
      {
        _id: 'run-1',
        orgId: 'org-1',
        projectId: 'project-1',
        result: {},
      },
    ]);
    mocks.deletePrefix.mockResolvedValueOnce({ deleted: 2, errors: 1 });

    const summary = await cleanupPendingArtifactRuns(5);

    expect(summary).toEqual({ processed: 1, purged: 0, failed: 1 });
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0][1]).toMatchObject({
      runId: 'run-1',
      error: expect.stringContaining('R2 deletion failed for 1 object'),
    });
  });
});
