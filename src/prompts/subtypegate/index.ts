// Subtype Gate Agent prompt selector
import { SUBTYPE_GATE_AGENT_INSTRUCTIONS_PRODUCTION } from './production';

export const getSubtypeGatePrompt = (version?: string): string => {
  const promptVersion = version || process.env.SUBTYPE_GATE_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'production':
    default:
      return SUBTYPE_GATE_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { SUBTYPE_GATE_AGENT_INSTRUCTIONS_PRODUCTION };
