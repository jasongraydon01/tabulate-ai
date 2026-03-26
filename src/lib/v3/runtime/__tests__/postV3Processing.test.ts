import { afterEach, describe, expect, it } from 'vitest';

import { getRExecutionTimeoutMs } from '../postV3Processing';

const originalTimeout = process.env.R_EXECUTION_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.R_EXECUTION_TIMEOUT_MS;
  } else {
    process.env.R_EXECUTION_TIMEOUT_MS = originalTimeout;
  }
});

describe('getRExecutionTimeoutMs', () => {
  it('uses the default floor for smaller workloads', () => {
    delete process.env.R_EXECUTION_TIMEOUT_MS;
    expect(getRExecutionTimeoutMs(100)).toBe(10 * 60 * 1000);
  });

  it('scales timeout with table count and caps it', () => {
    delete process.env.R_EXECUTION_TIMEOUT_MS;
    expect(getRExecutionTimeoutMs(537)).toBe(1611000);
    expect(getRExecutionTimeoutMs(1000)).toBe(30 * 60 * 1000);
  });

  it('honors the explicit environment override', () => {
    process.env.R_EXECUTION_TIMEOUT_MS = '420000';
    expect(getRExecutionTimeoutMs(537)).toBe(420000);
  });
});
