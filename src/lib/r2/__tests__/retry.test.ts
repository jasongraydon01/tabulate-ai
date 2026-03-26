import { describe, expect, it, vi, beforeEach } from 'vitest';
import { retryR2Operation, _isTransientError } from '../retry';

describe('retryR2Operation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('succeeds on first try without retries', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const promise = retryR2Operation(op, { label: 'test' });
    const result = await promise;

    expect(result).toEqual({ result: 'ok', retriesUsed: 0 });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors with exponential backoff', async () => {
    const transientError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const op = vi.fn()
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('recovered');

    const promise = retryR2Operation(op, { baseDelayMs: 100, label: 'test' });

    // First retry after 100ms
    await vi.advanceTimersByTimeAsync(100);
    // Second retry after 200ms
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toEqual({ result: 'recovered', retriesUsed: 2 });
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-transient errors', async () => {
    const permanentError = new Error('AccessDenied: bucket not found');
    const op = vi.fn().mockRejectedValue(permanentError);

    await expect(retryR2Operation(op, { label: 'test' })).rejects.toThrow('AccessDenied');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting all retries', async () => {
    vi.useRealTimers();
    const transientError = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const op = vi.fn().mockRejectedValue(transientError);

    await expect(
      retryR2Operation(op, { maxRetries: 2, baseDelayMs: 10, label: 'test-key' }),
    ).rejects.toThrow(/failed after 3 attempts/);
    expect(op).toHaveBeenCalledTimes(3); // initial + 2 retries
    vi.useFakeTimers();
  });

  it('respects maxRetries=0 (no retries)', async () => {
    vi.useRealTimers();
    const transientError = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const op = vi.fn().mockRejectedValue(transientError);

    await expect(retryR2Operation(op, { maxRetries: 0, label: 'test' })).rejects.toThrow(/failed after 1 attempts/);
    expect(op).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
  });

  it('uses default options when none provided', async () => {
    const transientError = Object.assign(new Error('slow'), { code: 'ETIMEDOUT' });
    const op = vi.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('ok');

    const promise = retryR2Operation(op);

    // Default base delay is 1000ms
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.retriesUsed).toBe(1);
  });
});

describe('isTransientError', () => {
  it('detects ECONNRESET', () => {
    const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    expect(_isTransientError(err)).toBe(true);
  });

  it('detects ETIMEDOUT', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    expect(_isTransientError(err)).toBe(true);
  });

  it('detects 503 status code from AWS SDK', () => {
    const err = { $metadata: { httpStatusCode: 503 }, message: 'Service Unavailable' };
    expect(_isTransientError(err)).toBe(true);
  });

  it('detects 429 rate limit from AWS SDK', () => {
    const err = { $metadata: { httpStatusCode: 429 }, message: 'Too Many Requests' };
    expect(_isTransientError(err)).toBe(true);
  });

  it('detects 500 internal server error', () => {
    const err = { $metadata: { httpStatusCode: 500 }, message: 'Internal Server Error' };
    expect(_isTransientError(err)).toBe(true);
  });

  it('detects SlowDown error name', () => {
    const err = { name: 'SlowDown', message: 'Reduce your request rate' };
    expect(_isTransientError(err)).toBe(true);
  });

  it('does NOT treat 403 as transient', () => {
    const err = { $metadata: { httpStatusCode: 403 }, message: 'Forbidden' };
    expect(_isTransientError(err)).toBe(false);
  });

  it('does NOT treat 404 as transient', () => {
    const err = { $metadata: { httpStatusCode: 404 }, message: 'Not Found' };
    expect(_isTransientError(err)).toBe(false);
  });

  it('does NOT treat generic errors as transient', () => {
    expect(_isTransientError(new Error('AccessDenied'))).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(_isTransientError(null)).toBe(false);
    expect(_isTransientError(undefined)).toBe(false);
  });
});
