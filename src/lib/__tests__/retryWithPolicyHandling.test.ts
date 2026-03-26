import { describe, it, expect, vi, afterEach } from 'vitest';

import { retryWithPolicyHandling } from '../retryWithPolicyHandling';

afterEach(() => {
  vi.useRealTimers();
});

describe('retryWithPolicyHandling', () => {
  it('retries up to maxAttempts and succeeds', async () => {
    vi.useFakeTimers();

    let calls = 0;
    const p = retryWithPolicyHandling(
      async () => {
        calls++;
        if (calls < 3) throw new Error('timeout');
        return 'ok';
      },
      {
        maxAttempts: 5,
        delayMs: 1000,
        maxDelayMs: 1000,
        rateLimitDelayMs: 1000,
        rateLimitMaxDelayMs: 1000,
        random: () => 1,
      }
    );

    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.result).toBe('ok');
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('returns cancelled when aborted before first attempt', async () => {
    const ac = new AbortController();
    ac.abort();

    const result = await retryWithPolicyHandling(
      async () => 'ok',
      { abortSignal: ac.signal }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Operation was cancelled');
    expect(result.attempts).toBe(0);
  });

  it('uses exponential backoff with cap (transient)', async () => {
    vi.useFakeTimers();

    const delays: number[] = [];
    let calls = 0;

    const p = retryWithPolicyHandling(
      async () => {
        calls++;
        if (calls < 4) throw new Error('timeout');
        return 'ok';
      },
      {
        maxAttempts: 6,
        delayMs: 1000,
        maxDelayMs: 2500,
        rateLimitDelayMs: 99999,
        rateLimitMaxDelayMs: 99999,
        random: () => 1,
        onRetryWithContext: (_ctx, _err, nextDelayMs) => delays.push(nextDelayMs),
      }
    );

    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(4);
    expect(delays).toEqual([1000, 2000, 2500]);
  });

  it('uses rateLimitDelayMs for rate limits', async () => {
    vi.useFakeTimers();

    const delays: number[] = [];
    let calls = 0;

    const p = retryWithPolicyHandling(
      async () => {
        calls++;
        if (calls < 3) throw new Error('429 too many requests');
        return 'ok';
      },
      {
        maxAttempts: 5,
        delayMs: 1000,
        maxDelayMs: 1000,
        rateLimitDelayMs: 5000,
        rateLimitMaxDelayMs: 5000,
        random: () => 1,
        onRetryWithContext: (_ctx, _err, nextDelayMs) => delays.push(nextDelayMs),
      }
    );

    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([5000, 5000]);
  });

  it('cancels when aborted during sleep', async () => {
    vi.useFakeTimers();

    const ac = new AbortController();
    let calls = 0;

    const p = retryWithPolicyHandling(
      async () => {
        calls++;
        throw new Error('timeout');
      },
      {
        maxAttempts: 10,
        delayMs: 1000,
        maxDelayMs: 1000,
        rateLimitDelayMs: 1000,
        rateLimitMaxDelayMs: 1000,
        random: () => 1,
        abortSignal: ac.signal,
        onRetryWithContext: () => {
          // Abort after the first failure, during the sleep before retry 2.
          if (!ac.signal.aborted) ac.abort();
        },
      }
    );

    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Operation was cancelled');
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it('keeps retrying policy errors when policyRetryMode is default (ai)', async () => {
    vi.useFakeTimers();

    let calls = 0;
    const p = retryWithPolicyHandling(
      async () => {
        calls++;
        if (calls < 3) {
          throw new Error('Request was flagged as potentially violating our policy');
        }
        return 'ok';
      },
      {
        maxAttempts: 5,
        policyDelayMs: 100,
        policyMaxDelayMs: 100,
        random: () => 1,
      },
    );

    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.result).toBe('ok');
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('fails fast on policy errors when policyRetryMode is deterministic', async () => {
    let calls = 0;
    const result = await retryWithPolicyHandling(
      async () => {
        calls++;
        throw new Error('Request was flagged as potentially violating our policy');
      },
      {
        maxAttempts: 5,
        policyRetryMode: 'deterministic',
      },
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.wasPolicyError).toBe(true);
    expect(result.finalClassification).toBe('policy');
    expect(calls).toBe(1);
  });

  it('retries invalid-variable validation failures as output validation', async () => {
    vi.useFakeTimers();

    let calls = 0;
    const p = retryWithPolicyHandling(
      async () => {
        calls++;
        if (calls < 3) {
          throw new Error('INVALID VARIABLES: hS18b_B_. Use ONLY variables from the survey questions; do not synthesize names.');
        }
        return 'ok';
      },
      {
        maxAttempts: 5,
        delayMs: 100,
        maxDelayMs: 100,
        random: () => 1,
      },
    );

    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.result).toBe('ok');
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('retries malformed JSON body provider failures as transient', async () => {
    vi.useFakeTimers();

    let calls = 0;
    const p = retryWithPolicyHandling(
      async () => {
        calls++;
        if (calls < 3) {
          throw new Error('We could not parse the JSON body of your request. The OpenAI API expects a JSON payload.');
        }
        return 'ok';
      },
      {
        maxAttempts: 5,
        delayMs: 100,
        maxDelayMs: 100,
        random: () => 1,
      },
    );

    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.result).toBe('ok');
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });
});
