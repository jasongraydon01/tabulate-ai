import { z } from 'zod';

/**
 * Zod schema for CrosstabDecision — validates review decisions from the UI
 * before they flow to applyDecisions() and downstream AI/R execution.
 *
 * Security context:
 * - `hint` flows to AI prompts (prompt injection vector) — length-limited
 * - `editedExpression` flows to R execution — length-limited here, sanitized in applyDecisions()
 * - `selectedAlternative` is used as an array index — must be non-negative integer
 */
export const CrosstabDecisionSchema = z.object({
  groupName: z.string().min(1).max(500),
  columnName: z.string().min(1).max(500),
  action: z.enum(['approve', 'select_alternative', 'provide_hint', 'edit', 'skip']),
  selectedAlternative: z.number().int().min(0).max(100).optional(),
  hint: z.string().max(1000).optional(),
  editedExpression: z.string().max(2000).optional(),
});

export const CrosstabDecisionsArraySchema = z.array(CrosstabDecisionSchema).min(1).max(500);

export type CrosstabDecision = z.infer<typeof CrosstabDecisionSchema>;

export const GroupHintSchema = z.object({
  groupName: z.string().min(1).max(500),
  hint: z.string().min(1).max(1000),
});

export const ReviewSubmissionSchema = z.object({
  decisions: CrosstabDecisionsArraySchema,
  groupHints: z.array(GroupHintSchema).max(50).optional(),
});

export type GroupHint = z.infer<typeof GroupHintSchema>;
export type ReviewSubmission = z.infer<typeof ReviewSubmissionSchema>;
