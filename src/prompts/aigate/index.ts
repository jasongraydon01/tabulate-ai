// AI Gate Agent prompt selector
import { AIGATE_AGENT_INSTRUCTIONS_PRODUCTION } from './production';
import { AIGATE_AGENT_INSTRUCTIONS_ALTERNATIVE } from './alternative';

export const getAIGatePrompt = (version?: string): string => {
  const promptVersion = version || process.env.AIGATE_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'alternative':
      return AIGATE_AGENT_INSTRUCTIONS_ALTERNATIVE;
    case 'production':
    default:
      return AIGATE_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { AIGATE_AGENT_INSTRUCTIONS_PRODUCTION };
