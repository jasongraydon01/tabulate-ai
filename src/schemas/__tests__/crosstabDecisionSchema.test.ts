import { describe, expect, it } from 'vitest';
import {
  GroupHintSchema,
  ReviewSubmissionSchema,
  CrosstabDecisionSchema,
  CrosstabDecisionsArraySchema,
} from '@/schemas/crosstabDecisionSchema';

describe('GroupHintSchema', () => {
  it('accepts valid group hint', () => {
    const result = GroupHintSchema.safeParse({
      groupName: 'Demographics',
      hint: 'Use hLOCATION1 | hLOCATION2 for all location cuts',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty groupName', () => {
    const result = GroupHintSchema.safeParse({
      groupName: '',
      hint: 'some hint',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty hint', () => {
    const result = GroupHintSchema.safeParse({
      groupName: 'Demographics',
      hint: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects groupName exceeding 500 chars', () => {
    const result = GroupHintSchema.safeParse({
      groupName: 'x'.repeat(501),
      hint: 'valid hint',
    });
    expect(result.success).toBe(false);
  });

  it('accepts groupName at exactly 500 chars', () => {
    const result = GroupHintSchema.safeParse({
      groupName: 'x'.repeat(500),
      hint: 'valid hint',
    });
    expect(result.success).toBe(true);
  });

  it('rejects hint exceeding 1000 chars', () => {
    const result = GroupHintSchema.safeParse({
      groupName: 'Demographics',
      hint: 'x'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts hint at exactly 1000 chars', () => {
    const result = GroupHintSchema.safeParse({
      groupName: 'Demographics',
      hint: 'x'.repeat(1000),
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(GroupHintSchema.safeParse({}).success).toBe(false);
    expect(GroupHintSchema.safeParse({ groupName: 'G1' }).success).toBe(false);
    expect(GroupHintSchema.safeParse({ hint: 'h' }).success).toBe(false);
  });
});

describe('ReviewSubmissionSchema', () => {
  const validDecision = {
    groupName: 'G1',
    columnName: 'Q1',
    action: 'approve' as const,
  };

  it('accepts decisions without groupHints', () => {
    const result = ReviewSubmissionSchema.safeParse({
      decisions: [validDecision],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupHints).toBeUndefined();
    }
  });

  it('accepts decisions with empty groupHints array', () => {
    const result = ReviewSubmissionSchema.safeParse({
      decisions: [validDecision],
      groupHints: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts decisions with valid groupHints', () => {
    const result = ReviewSubmissionSchema.safeParse({
      decisions: [validDecision],
      groupHints: [{ groupName: 'G1', hint: 'Use different variables' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupHints).toHaveLength(1);
    }
  });

  it('rejects groupHints array exceeding 50 items', () => {
    const groupHints = Array.from({ length: 51 }, (_, i) => ({
      groupName: `Group${i}`,
      hint: 'hint',
    }));
    const result = ReviewSubmissionSchema.safeParse({
      decisions: [validDecision],
      groupHints,
    });
    expect(result.success).toBe(false);
  });

  it('accepts groupHints array at exactly 50 items', () => {
    const groupHints = Array.from({ length: 50 }, (_, i) => ({
      groupName: `Group${i}`,
      hint: 'hint',
    }));
    const result = ReviewSubmissionSchema.safeParse({
      decisions: [validDecision],
      groupHints,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty decisions array', () => {
    const result = ReviewSubmissionSchema.safeParse({
      decisions: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid groupHint inside array', () => {
    const result = ReviewSubmissionSchema.safeParse({
      decisions: [validDecision],
      groupHints: [{ groupName: '', hint: '' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('CrosstabDecisionSchema', () => {
  it('accepts all valid actions', () => {
    const actions = ['approve', 'select_alternative', 'provide_hint', 'edit', 'skip'] as const;
    for (const action of actions) {
      const result = CrosstabDecisionSchema.safeParse({
        groupName: 'G1',
        columnName: 'Q1',
        action,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid action', () => {
    const result = CrosstabDecisionSchema.safeParse({
      groupName: 'G1',
      columnName: 'Q1',
      action: 'delete',
    });
    expect(result.success).toBe(false);
  });

  it('validates hint max length (1000)', () => {
    const result = CrosstabDecisionSchema.safeParse({
      groupName: 'G1',
      columnName: 'Q1',
      action: 'provide_hint',
      hint: 'x'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('validates editedExpression max length (2000)', () => {
    const result = CrosstabDecisionSchema.safeParse({
      groupName: 'G1',
      columnName: 'Q1',
      action: 'edit',
      editedExpression: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('validates selectedAlternative is non-negative integer', () => {
    expect(CrosstabDecisionSchema.safeParse({
      groupName: 'G1', columnName: 'Q1', action: 'select_alternative', selectedAlternative: -1,
    }).success).toBe(false);

    expect(CrosstabDecisionSchema.safeParse({
      groupName: 'G1', columnName: 'Q1', action: 'select_alternative', selectedAlternative: 1.5,
    }).success).toBe(false);

    expect(CrosstabDecisionSchema.safeParse({
      groupName: 'G1', columnName: 'Q1', action: 'select_alternative', selectedAlternative: 0,
    }).success).toBe(true);
  });
});

describe('CrosstabDecisionsArraySchema', () => {
  it('enforces max 500 decisions', () => {
    const decisions = Array.from({ length: 501 }, (_, i) => ({
      groupName: 'G1',
      columnName: `Q${i}`,
      action: 'approve' as const,
    }));
    expect(CrosstabDecisionsArraySchema.safeParse(decisions).success).toBe(false);
  });
});
