// Table Context Agent prompt selector
import { TABLE_CONTEXT_AGENT_INSTRUCTIONS_PRODUCTION } from './production';

export const getTableContextPrompt = (version?: string): string => {
  const promptVersion = version || process.env.TABLE_CONTEXT_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'production':
    default:
      return TABLE_CONTEXT_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { TABLE_CONTEXT_AGENT_INSTRUCTIONS_PRODUCTION };
