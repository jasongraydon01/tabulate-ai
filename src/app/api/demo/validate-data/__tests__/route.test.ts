import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockApplyRateLimit = vi.fn();
const mockValidate = vi.fn();
const mockCaptureException = vi.fn();

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: mockApplyRateLimit,
}));

vi.mock('@/lib/validation/ValidationRunner', () => ({
  validate: mockValidate,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
}));

describe('demo validate-data route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApplyRateLimit.mockReturnValue(null);
  });

  it('validates an uploaded .sav file without auth and returns the validation payload', async () => {
    mockValidate.mockResolvedValue({
      processingResult: { verbose: [{ column: 'Q1' }] },
      dataFileStats: { rowCount: 250 },
      weightDetection: { candidates: [{ column: 'wt', label: 'Weight', score: 0.91, mean: 1.01 }] },
      fillRateResults: [],
      warnings: [],
      errors: [],
      canProceed: true,
    });

    const { POST } = await import('../route');

    const formData = new FormData();
    formData.append('dataFile', new File(['fake'], 'study.sav', { type: 'application/octet-stream' }));

    const request = new NextRequest('http://localhost/api/demo/validate-data', {
      method: 'POST',
      body: formData,
      headers: { 'x-forwarded-for': '198.51.100.10' },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockApplyRateLimit).toHaveBeenCalledWith('198.51.100.10', 'demo', 'demo/validate-data');
    expect(mockValidate).toHaveBeenCalledWith(
      expect.objectContaining({
        skipLoopDetection: true,
      }),
    );
    expect(body).toEqual({
      rowCount: 250,
      columnCount: 1,
      weightCandidates: [{ column: 'wt', label: 'Weight', score: 0.91, mean: 1.01 }],
      isStacked: false,
      stackedWarning: null,
      errors: [],
      canProceed: true,
    });
  });
});
