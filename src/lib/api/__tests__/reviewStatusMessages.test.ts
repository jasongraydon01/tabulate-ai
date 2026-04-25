import { describe, expect, it } from 'vitest';

import {
  getPendingReviewMessage,
  getPreparingReviewMessage,
} from '@/lib/api/reviewStatusMessages';

describe('review status messages', () => {
  it('uses preparing review copy before the run pauses', () => {
    expect(getPreparingReviewMessage(29)).toBe(
      'Preparing review (29 columns flagged) — completing table assembly...',
    );
  });

  it('uses review required copy only after the run is ready to pause', () => {
    expect(getPendingReviewMessage(29)).toBe(
      'Review required - 29 columns pending confirmation',
    );
  });
});
