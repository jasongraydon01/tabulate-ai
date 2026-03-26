// Loop Gate Agent prompt selector
import { LOOP_GATE_AGENT_INSTRUCTIONS_PRODUCTION } from './production';

export const getLoopGatePrompt = (version?: string): string => {
  const promptVersion = version || process.env.LOOP_GATE_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'production':
    default:
      return LOOP_GATE_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { LOOP_GATE_AGENT_INSTRUCTIONS_PRODUCTION };
