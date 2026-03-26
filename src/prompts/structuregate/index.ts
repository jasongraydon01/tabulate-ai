// Structure Gate Agent prompt selector
import { STRUCTURE_GATE_AGENT_INSTRUCTIONS_PRODUCTION } from './production';

export const getStructureGatePrompt = (version?: string): string => {
  const promptVersion = version || process.env.STRUCTURE_GATE_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'production':
    default:
      return STRUCTURE_GATE_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { STRUCTURE_GATE_AGENT_INSTRUCTIONS_PRODUCTION };
