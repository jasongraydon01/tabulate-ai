import { describe, expect, it } from 'vitest';

import { isNonSubstantiveTail } from '../nonSubstantive';

describe('isNonSubstantiveTail', () => {
  it('matches common non-substantive labels', () => {
    const labels = [
      "Don't Know",
      'Refused',
      'Prefer not to answer/say',
      'N/A',
      'None of the above',
      'Not applicable',
    ];

    for (const label of labels) {
      expect(isNonSubstantiveTail(label)).toBe(true);
    }
  });

  it('does not match substantive labels', () => {
    const labels = [
      'T2B: Favorable',
      'Mean: Overall',
      'Strongly agree',
      '10 - Extremely likely',
    ];

    for (const label of labels) {
      expect(isNonSubstantiveTail(label)).toBe(false);
    }
  });
});
