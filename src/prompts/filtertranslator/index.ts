/**
 * @deprecated Prompt selector for FilterTranslatorAgent which is deprecated.
 * Replaced by DeterministicBaseEngine (src/lib/bases/).
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

// FilterTranslator Agent prompt selector
import { FILTER_TRANSLATOR_AGENT_INSTRUCTIONS_PRODUCTION } from './production';
import { FILTER_TRANSLATOR_AGENT_INSTRUCTIONS_ALTERNATIVE } from './alternative';

export const getFilterTranslatorPrompt = (version?: string): string => {
  const promptVersion = version || process.env.FILTERTRANSLATOR_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'alternative':
      return FILTER_TRANSLATOR_AGENT_INSTRUCTIONS_ALTERNATIVE;
    case 'production':
    default:
      return FILTER_TRANSLATOR_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { FILTER_TRANSLATOR_AGENT_INSTRUCTIONS_PRODUCTION };
