import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueryInternal = vi.fn();
const mockMutateInternal = vi.fn();
const mockSendDemoOutputEmail = vi.fn();
const mockRm = vi.fn();

vi.mock('@/lib/convex', () => ({
  queryInternal: mockQueryInternal,
  mutateInternal: mockMutateInternal,
}));

vi.mock('../sendDemoEmails', () => ({
  sendDemoOutputEmail: mockSendDemoOutputEmail,
}));

vi.mock('fs', () => ({
  promises: {
    rm: mockRm,
  },
}));

describe('deliverDemoOutputIfReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims, sends, and cleans up a deliverable demo output', async () => {
    mockQueryInternal.mockResolvedValue({
      _id: 'demo-1',
      email: 'user@example.com',
      name: 'User',
      projectName: 'Demo Project',
      emailVerified: true,
      pipelineStatus: 'success',
      outputTempDir: '/tmp/demo-output',
      outputSentAt: undefined,
      outputDeliveryState: 'idle',
    });
    mockMutateInternal
      .mockResolvedValueOnce({ claimed: true })
      .mockResolvedValueOnce(undefined);
    mockSendDemoOutputEmail.mockResolvedValue(true);
    mockRm.mockResolvedValue(undefined);

    const { deliverDemoOutputIfReady } = await import('../delivery');
    const result = await deliverDemoOutputIfReady('demo-1' as never, {
      tableCount: 12,
      durationFormatted: '32s',
    });

    expect(result).toEqual({ sent: true, reason: 'sent' });
    expect(mockMutateInternal).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { demoRunId: 'demo-1' },
    );
    expect(mockSendDemoOutputEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        projectName: 'Demo Project',
        outputDir: '/tmp/demo-output',
        tableCount: 12,
        durationFormatted: '32s',
      }),
    );
    expect(mockRm).toHaveBeenCalledWith('/tmp/demo-output', { recursive: true, force: true });
    expect(mockMutateInternal).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        demoRunId: 'demo-1',
        outputDeletedAt: expect.any(Number),
      }),
    );
  });

  it('does not send when the demo run is not ready', async () => {
    mockQueryInternal.mockResolvedValue({
      _id: 'demo-2',
      emailVerified: false,
      pipelineStatus: 'success',
      outputTempDir: '/tmp/demo-output',
    });

    const { deliverDemoOutputIfReady } = await import('../delivery');
    const result = await deliverDemoOutputIfReady('demo-2' as never);

    expect(result).toEqual({ sent: false, reason: 'unverified' });
    expect(mockMutateInternal).not.toHaveBeenCalled();
    expect(mockSendDemoOutputEmail).not.toHaveBeenCalled();
  });

  it('releases the claim when email delivery fails', async () => {
    mockQueryInternal.mockResolvedValue({
      _id: 'demo-3',
      email: 'user@example.com',
      name: 'User',
      projectName: 'Demo Project',
      emailVerified: true,
      pipelineStatus: 'partial',
      outputTempDir: '/tmp/demo-output',
      outputSentAt: undefined,
      outputDeliveryState: 'idle',
    });
    mockMutateInternal
      .mockResolvedValueOnce({ claimed: true })
      .mockResolvedValueOnce(undefined);
    mockSendDemoOutputEmail.mockResolvedValue(false);

    const { deliverDemoOutputIfReady } = await import('../delivery');
    const result = await deliverDemoOutputIfReady('demo-3' as never);

    expect(result).toEqual({ sent: false, reason: 'email_send_failed' });
    expect(mockMutateInternal).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { demoRunId: 'demo-3' },
    );
    expect(mockRm).not.toHaveBeenCalled();
  });
});
