import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
}));

describe('deprecated review tables page', () => {
  let Page: typeof import('@/app/(product)/projects/[projectId]/runs/[runId]/tables/page').default;

  beforeEach(async () => {
    if (!Page) {
      ({ default: Page } = await import('@/app/(product)/projects/[projectId]/runs/[runId]/tables/page'));
    }
    vi.clearAllMocks();
  });

  it('resolves to notFound immediately', () => {
    expect(() => Page()).toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
