/**
 * Loop Semantics Policy prompt version selector
 */

import { LOOP_SEMANTICS_POLICY_INSTRUCTIONS_PRODUCTION } from './production';
import { LOOP_SEMANTICS_POLICY_INSTRUCTIONS_ALTERNATIVE } from './alternative';

export const getLoopSemanticsPrompt = (version?: string): string => {
  const promptVersion = version || process.env.LOOP_SEMANTICS_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'alternative':
      return LOOP_SEMANTICS_POLICY_INSTRUCTIONS_ALTERNATIVE;
    case 'production':
    default:
      return LOOP_SEMANTICS_POLICY_INSTRUCTIONS_PRODUCTION;
  }
};
