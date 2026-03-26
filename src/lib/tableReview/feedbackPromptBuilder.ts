/**
 * @deprecated Legacy Review Tables backend removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not invoke from active code.
 */
/**
 * Build VerificationAgent prompts with reviewer feedback injected.
 *
 * Follows the reviewer-feedback authority pattern: feedback is sanitized,
 * length-truncated, wrapped in XML delimiters, and positioned for the
 * agent to take seriously while validating against the datamap.
 */
import { sanitizeForAzureContentFilter } from '@/lib/promptSanitization';

const MAX_FEEDBACK_LENGTH = 2000;

/**
 * Sanitize reviewer feedback for safe injection into AI prompts.
 *
 * Processing:
 * 1. Azure content filter sanitization
 * 2. Strip angle brackets (prevent XML tag injection)
 * 3. Collapse whitespace
 * 4. Truncate to max length
 */
export function sanitizeFeedback(rawFeedback: string): string {
  if (!rawFeedback) return '';

  return sanitizeForAzureContentFilter(rawFeedback)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_FEEDBACK_LENGTH)
    .trim();
}

/**
 * Build the feedback section to append to the VerificationAgent user prompt.
 *
 * The feedback is wrapped in `<reviewer-feedback>` XML tags so the agent
 * can distinguish it from the table definition and system instructions.
 */
export function buildFeedbackPromptSection(rawFeedback: string): string {
  const sanitized = sanitizeFeedback(rawFeedback);
  if (!sanitized) return '';

  return `
<reviewer-feedback>
A domain expert has reviewed this table and provided the following feedback.
Take this feedback seriously - lean toward incorporating it, but validate
logically against the datamap (e.g., do the referenced variables exist?).
The structured output schema is the enforcement boundary.

"${sanitized}"
</reviewer-feedback>
`;
}
