/**
 * zeroBaseRetryNarrative
 *
 * Builds a narrative context string for retrying a zero-base filter.
 * Follows the CrosstabAgent pattern: rich context, not "error redo."
 */

/**
 * @deprecated Not needed — no AI filter retry logic in deterministic pipeline.
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

import type { TableFilter } from '../../schemas/skipLogicSchema';
import type { FilterBaseCount } from './ZeroBaseValidator';

function warnDeprecatedNarrativeUsage(): void {
  console.warn('[DEPRECATED] buildZeroBaseRetryNarrative() called — this should not be invoked in the active pipeline. Use DeterministicBaseEngine instead.');
}

export interface ZeroBaseRetryContext {
  /** The filter that produced zero respondents */
  filter: TableFilter;
  /** The zero-base count result from validation */
  baseCount: FilterBaseCount;
}

/**
 * Build a narrative prompt section for retrying a zero-base filter expression.
 *
 * The narrative includes:
 * - Prior expression and reasoning (verbatim from agent output)
 * - Alternatives the agent already proposed (if any)
 * - Zero-base evidence with actual counts
 * - Common fix patterns
 * - Clear instruction for revision
 */
export function buildZeroBaseRetryNarrative(ctx: ZeroBaseRetryContext): string {
  warnDeprecatedNarrativeUsage();
  const { filter, baseCount } = ctx;
  const parts: string[] = [];

  // Prior expression and reasoning
  parts.push(`<zero_base_retry>`);
  parts.push(`Your prior expression for "${filter.questionId}" (rule ${filter.ruleId}) was:`);
  parts.push(`  Expression: ${filter.filterExpression || '(empty)'}`);
  parts.push(`  Reasoning: "${filter.reasoning}"`);
  parts.push(`  Confidence: ${filter.confidence}`);

  // Alternatives already proposed
  if (filter.alternatives && filter.alternatives.length > 0) {
    parts.push('');
    parts.push('You already proposed these alternatives:');
    for (const alt of filter.alternatives) {
      parts.push(`  Rank ${alt.rank}: ${alt.expression} (${alt.userSummary})`);
    }
  }

  // Zero-base evidence
  parts.push('');
  parts.push(`ZERO-BASE EVIDENCE: Your expression \`${baseCount.expression}\` matched 0 out of ${baseCount.totalN} respondents when tested against the actual data.`);
  parts.push('A zero-base filter is never valid — it produces an empty table that cannot appear in output.');

  // Common fix patterns
  parts.push('');
  parts.push(`<common_filter_fixes>`);
  parts.push('Consider these common causes of zero-base filters:');
  parts.push('1. Wrong column in a multi-column grid (e.g., c1 vs c2) — check column descriptions in the datamap');
  parts.push('2. Wrong value code — verify against datamap value labels');
  parts.push('3. Overly restrictive compound condition — consider relaxing to fewer conditions');
  parts.push('4. Retrospective column when forward-looking was intended (or vice versa)');
  parts.push('5. If you provided alternatives, check whether promoting one would produce nonzero respondents');
  parts.push('</common_filter_fixes>');

  // Instruction
  parts.push('');
  parts.push('Revise the expression to produce a nonzero base. If your alternatives included a viable option, promote it. If not, re-examine the datamap for the correct variable/column.');
  parts.push('Do NOT return the same expression that produced zero respondents.');
  parts.push('</zero_base_retry>');

  return parts.join('\n');
}
