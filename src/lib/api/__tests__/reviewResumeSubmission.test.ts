import { describe, expect, it } from 'vitest';

import { getApprovedReviewSubmission } from '@/lib/api/reviewCompletion';
import type { CrosstabReviewState } from '@/lib/api/types';

describe('getApprovedReviewSubmission', () => {
  it('returns persisted decisions and group hints for approved review resumes', () => {
    const reviewState = {
      status: 'approved',
      decisions: [
        {
          groupName: 'Audience',
          columnName: 'Teachers',
          action: 'approve',
        },
      ],
      groupHints: [
        {
          groupName: 'Audience',
          hint: 'Keep the direct audience cut.',
        },
      ],
    } as CrosstabReviewState;

    expect(getApprovedReviewSubmission(reviewState)).toEqual({
      decisions: [
        {
          groupName: 'Audience',
          columnName: 'Teachers',
          action: 'approve',
        },
      ],
      groupHints: [
        {
          groupName: 'Audience',
          hint: 'Keep the direct audience cut.',
        },
      ],
    });
  });

  it('throws when the worker resume payload is not approved or lacks decisions', () => {
    expect(() => getApprovedReviewSubmission({
      status: 'awaiting_review',
    } as CrosstabReviewState)).toThrow(/approved state/);

    expect(() => getApprovedReviewSubmission({
      status: 'approved',
      decisions: [],
    } as unknown as CrosstabReviewState)).toThrow(/missing persisted reviewer decisions/);
  });
});
