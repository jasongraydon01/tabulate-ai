/**
 * @deprecated Tests for deprecated zeroBaseRetryNarrative. Kept passing for reference.
 * Retained for reference. Do not invoke from active pipeline code.
 */

import { describe, it, expect } from 'vitest';
import { buildZeroBaseRetryNarrative, type ZeroBaseRetryContext } from '../zeroBaseRetryNarrative';
import type { TableFilter } from '../../../schemas/skipLogicSchema';
import type { FilterBaseCount } from '../ZeroBaseValidator';

function makeFilter(overrides: Partial<TableFilter> = {}): TableFilter {
  return {
    ruleId: 'rule1',
    questionId: 'Q5',
    action: 'filter',
    filterExpression: 'Q3c1 == 1',
    baseText: 'Users who selected Q3 = Yes',
    splits: [],
    columnSplits: [],
    alternatives: [],
    confidence: 0.75,
    reasoning: 'Mapped Q3 column 1 to value 1 based on datamap',
    ...overrides,
  };
}

function makeBaseCount(overrides: Partial<FilterBaseCount> = {}): FilterBaseCount {
  return {
    filterId: 'rule1::Q5',
    questionId: 'Q5',
    ruleId: 'rule1',
    expression: 'Q3c1 == 1',
    respondentCount: 0,
    totalN: 200,
    isZeroBase: true,
    ...overrides,
  };
}

describe('buildZeroBaseRetryNarrative', () => {
  it('includes expression and reasoning', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter(),
      baseCount: makeBaseCount(),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).toContain('Q3c1 == 1');
    expect(narrative).toContain('Mapped Q3 column 1 to value 1');
    expect(narrative).toContain('0.75');
  });

  it('includes zero-base evidence with counts', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter(),
      baseCount: makeBaseCount({ totalN: 300 }),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).toContain('matched 0 out of 300 respondents');
    expect(narrative).toContain('zero-base filter is never valid');
  });

  it('includes alternatives when present', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter({
        alternatives: [
          { expression: 'Q3c2 == 1', rank: 2, userSummary: 'Column 2 might be the actual response' },
          { expression: 'Q3c1 >= 1', rank: 3, userSummary: 'Maybe any value above 0' },
        ],
      }),
      baseCount: makeBaseCount(),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).toContain('Rank 2: Q3c2 == 1');
    expect(narrative).toContain('Rank 3: Q3c1 >= 1');
    expect(narrative).toContain('Column 2 might be the actual response');
  });

  it('does not include alternatives section when none exist', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter({ alternatives: [] }),
      baseCount: makeBaseCount(),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).not.toContain('already proposed these alternatives');
  });

  it('includes common fix patterns', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter(),
      baseCount: makeBaseCount(),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).toContain('Wrong column in a multi-column grid');
    expect(narrative).toContain('Wrong value code');
    expect(narrative).toContain('Overly restrictive compound condition');
    expect(narrative).toContain('Retrospective column when forward-looking');
  });

  it('wraps in XML delimiters', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter(),
      baseCount: makeBaseCount(),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).toMatch(/^<zero_base_retry>/);
    expect(narrative).toMatch(/<\/zero_base_retry>$/);
  });

  it('includes revision instruction', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter(),
      baseCount: makeBaseCount(),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).toContain('Revise the expression to produce a nonzero base');
    expect(narrative).toContain('Do NOT return the same expression');
  });

  it('handles empty expression gracefully', () => {
    const ctx: ZeroBaseRetryContext = {
      filter: makeFilter({ filterExpression: '' }),
      baseCount: makeBaseCount({ expression: '' }),
    };

    const narrative = buildZeroBaseRetryNarrative(ctx);

    expect(narrative).toContain('(empty)');
  });
});
