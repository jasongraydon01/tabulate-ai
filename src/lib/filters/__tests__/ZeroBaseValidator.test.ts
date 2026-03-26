/**
 * @deprecated Tests for deprecated ZeroBaseValidator. Kept passing for reference.
 * Retained for reference. Do not invoke from active pipeline code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TableFilter } from '../../../schemas/skipLogicSchema';

// Mock child_process before importing the module
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock fs sync operations
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// We need to import after mocks are set up
import { validateFilterBases, collectFilterExpressions } from '../ZeroBaseValidator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFilter(overrides: Partial<TableFilter> = {}): TableFilter {
  return {
    ruleId: 'rule1',
    questionId: 'Q5',
    action: 'filter',
    filterExpression: 'Q3 == 1',
    baseText: 'Q3 = Yes',
    splits: [],
    columnSplits: [],
    alternatives: [],
    confidence: 0.85,
    reasoning: 'Mapped Q3 to value 1',
    ...overrides,
  };
}

/** Creates a mock child process that resolves with given stdout */
function createMockProcess(stdout: string, exitCode = 0, stderr = '') {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockProc = {
    stdout: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers[`stdout:${event}`]) handlers[`stdout:${event}`] = [];
        handlers[`stdout:${event}`].push(handler);
      },
    },
    stderr: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers[`stderr:${event}`]) handlers[`stderr:${event}`] = [];
        handlers[`stderr:${event}`].push(handler);
      },
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    },
    // Trigger the events after setup
    _emit: () => {
      // Emit stdout
      for (const h of handlers['stdout:data'] || []) h(Buffer.from(stdout));
      // Emit stderr
      if (stderr) {
        for (const h of handlers['stderr:data'] || []) h(Buffer.from(stderr));
      }
      // Emit close
      setTimeout(() => {
        for (const h of handlers['close'] || []) h(exitCode);
      }, 0);
    },
    _emitError: (err: Error) => {
      setTimeout(() => {
        for (const h of handlers['error'] || []) h(err);
      }, 0);
    },
  };
  return mockProc;
}

// ---------------------------------------------------------------------------
// Tests: collectFilterExpressions
// ---------------------------------------------------------------------------

describe('collectFilterExpressions', () => {
  it('collects primary filter expressions', () => {
    const filters = [makeFilter({ ruleId: 'r1', questionId: 'Q5', filterExpression: 'Q3 == 1' })];
    const entries = collectFilterExpressions(filters);
    expect(entries).toHaveLength(1);
    expect(entries[0].filterId).toBe('r1::Q5');
    expect(entries[0].expression).toBe('Q3 == 1');
    expect(entries[0].isSplit).toBe(false);
  });

  it('skips empty expressions', () => {
    const filters = [makeFilter({ filterExpression: '' })];
    expect(collectFilterExpressions(filters)).toHaveLength(0);
  });

  it('collects split expressions', () => {
    const filters = [makeFilter({
      filterExpression: '',
      action: 'split',
      splits: [
        { splitLabel: 'Product A', filterExpression: 'Q3 == 1', baseText: 'Product A users', rowVariables: ['Q5r1'] },
        { splitLabel: 'Product B', filterExpression: 'Q3 == 2', baseText: 'Product B users', rowVariables: ['Q5r2'] },
      ],
    })];
    const entries = collectFilterExpressions(filters);
    expect(entries).toHaveLength(2);
    expect(entries[0].isSplit).toBe(true);
    expect(entries[1].isSplit).toBe(true);
  });

  it('collects column-split expressions', () => {
    const filters = [makeFilter({
      filterExpression: '',
      action: 'column-split',
      columnSplits: [
        { columnVariables: ['Q5_1'], filterExpression: 'Q2 == 1', baseText: 'Group 1', splitLabel: 'Group 1' },
        { columnVariables: ['Q5_2'], filterExpression: '', baseText: 'Always shown', splitLabel: 'Always' },
      ],
    })];
    const entries = collectFilterExpressions(filters);
    // Only the non-empty one
    expect(entries).toHaveLength(1);
    expect(entries[0].isSplit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: validateFilterBases
// ---------------------------------------------------------------------------

describe('validateFilterBases', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty result for empty filters', async () => {
    const result = await validateFilterBases([], '/tmp/test.sav', '/tmp/out');
    expect(result.counts).toHaveLength(0);
    expect(result.zeroBaseFilters).toHaveLength(0);
  });

  it('returns empty result for filters with no expressions', async () => {
    const filters = [makeFilter({ filterExpression: '' })];
    const result = await validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    expect(result.counts).toHaveLength(0);
    expect(result.zeroBaseFilters).toHaveLength(0);
  });

  it('detects zero-base filter', async () => {
    const filters = [makeFilter({ ruleId: 'r1', questionId: 'Q5', filterExpression: 'Q3 == 1' })];

    const rOutput = JSON.stringify({
      totalN: 200,
      results: [{ index: 0, filterId: 'r1::Q5', respondentCount: 0, totalN: 200, error: '' }],
    });

    const proc = createMockProcess(rOutput);
    mockSpawn.mockReturnValue(proc);

    const resultPromise = validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    proc._emit();
    const result = await resultPromise;

    expect(result.counts).toHaveLength(1);
    expect(result.counts[0].respondentCount).toBe(0);
    expect(result.counts[0].isZeroBase).toBe(true);
    expect(result.zeroBaseFilters).toHaveLength(1);
    expect(result.zeroBaseFilters[0].filterId).toBe('r1::Q5');
  });

  it('passes non-zero-base filter', async () => {
    const filters = [makeFilter({ filterExpression: 'Q3 == 1' })];

    const rOutput = JSON.stringify({
      totalN: 200,
      results: [{ index: 0, filterId: 'rule1::Q5', respondentCount: 123, totalN: 200, error: '' }],
    });

    const proc = createMockProcess(rOutput);
    mockSpawn.mockReturnValue(proc);

    const resultPromise = validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    proc._emit();
    const result = await resultPromise;

    expect(result.counts).toHaveLength(1);
    expect(result.counts[0].respondentCount).toBe(123);
    expect(result.counts[0].isZeroBase).toBe(false);
    expect(result.zeroBaseFilters).toHaveLength(0);
  });

  it('returns -1 when R process fails', async () => {
    const filters = [makeFilter({ filterExpression: 'Q3 == 1' })];

    const proc = createMockProcess('', 1, 'R crashed');
    mockSpawn.mockReturnValue(proc);

    const resultPromise = validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    proc._emit();
    const result = await resultPromise;

    expect(result.counts).toHaveLength(1);
    expect(result.counts[0].respondentCount).toBe(-1);
    expect(result.zeroBaseFilters).toHaveLength(0);
  });

  it('returns -1 when R process spawn errors', async () => {
    const filters = [makeFilter({ filterExpression: 'Q3 == 1' })];

    const proc = createMockProcess('');
    mockSpawn.mockReturnValue(proc);

    const resultPromise = validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    proc._emitError(new Error('Rscript not found'));
    const result = await resultPromise;

    expect(result.counts).toHaveLength(1);
    expect(result.counts[0].respondentCount).toBe(-1);
    expect(result.zeroBaseFilters).toHaveLength(0);
  });

  it('skips unsafe expressions with -1', async () => {
    // system() is blocked by sanitizeRExpression
    const filters = [makeFilter({ filterExpression: 'system("rm -rf /")' })];

    const result = await validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');

    // Should not spawn R at all — unsafe expression is skipped
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(result.counts).toHaveLength(1);
    expect(result.counts[0].respondentCount).toBe(-1);
  });

  it('handles split filters — flags only when ALL splits are zero', async () => {
    const filters = [makeFilter({
      ruleId: 'r2',
      questionId: 'Q7',
      filterExpression: '',
      action: 'split',
      splits: [
        { splitLabel: 'Product A', filterExpression: 'Q4 == 1', baseText: 'A users', rowVariables: ['Q7r1'] },
        { splitLabel: 'Product B', filterExpression: 'Q4 == 2', baseText: 'B users', rowVariables: ['Q7r2'] },
      ],
    })];

    // Product A has respondents, Product B doesn't
    const rOutput = JSON.stringify({
      totalN: 200,
      results: [
        { index: 0, filterId: 'r2::Q7::split::Product A', respondentCount: 50, totalN: 200, error: '' },
        { index: 1, filterId: 'r2::Q7::split::Product B', respondentCount: 0, totalN: 200, error: '' },
      ],
    });

    const proc = createMockProcess(rOutput);
    mockSpawn.mockReturnValue(proc);

    const resultPromise = validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    proc._emit();
    const result = await resultPromise;

    // Product B is zero but not ALL splits are zero, so no zero-base flag
    expect(result.zeroBaseFilters).toHaveLength(0);
  });

  it('flags split filters when ALL splits are zero', async () => {
    const filters = [makeFilter({
      ruleId: 'r3',
      questionId: 'Q9',
      filterExpression: '',
      action: 'split',
      splits: [
        { splitLabel: 'Product A', filterExpression: 'Q4 == 1', baseText: 'A users', rowVariables: ['Q9r1'] },
        { splitLabel: 'Product B', filterExpression: 'Q4 == 2', baseText: 'B users', rowVariables: ['Q9r2'] },
      ],
    })];

    const rOutput = JSON.stringify({
      totalN: 200,
      results: [
        { index: 0, filterId: 'r3::Q9::split::Product A', respondentCount: 0, totalN: 200, error: '' },
        { index: 1, filterId: 'r3::Q9::split::Product B', respondentCount: 0, totalN: 200, error: '' },
      ],
    });

    const proc = createMockProcess(rOutput);
    mockSpawn.mockReturnValue(proc);

    const resultPromise = validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    proc._emit();
    const result = await resultPromise;

    expect(result.zeroBaseFilters).toHaveLength(2);
  });

  it('handles multiple filters in a single batch', async () => {
    const filters = [
      makeFilter({ ruleId: 'r1', questionId: 'Q5', filterExpression: 'Q3 == 1' }),
      makeFilter({ ruleId: 'r2', questionId: 'Q8', filterExpression: 'Q6 == 2' }),
    ];

    const rOutput = JSON.stringify({
      totalN: 200,
      results: [
        { index: 0, filterId: 'r1::Q5', respondentCount: 100, totalN: 200, error: '' },
        { index: 1, filterId: 'r2::Q8', respondentCount: 0, totalN: 200, error: '' },
      ],
    });

    const proc = createMockProcess(rOutput);
    mockSpawn.mockReturnValue(proc);

    const resultPromise = validateFilterBases(filters, '/tmp/test.sav', '/tmp/out');
    proc._emit();
    const result = await resultPromise;

    expect(result.counts).toHaveLength(2);
    expect(result.zeroBaseFilters).toHaveLength(1);
    expect(result.zeroBaseFilters[0].filterId).toBe('r2::Q8');
  });
});
