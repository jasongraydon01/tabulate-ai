/**
 * @deprecated Prompt selector for SkipLogicAgent which is deprecated.
 * Replaced by DeterministicBaseEngine (src/lib/bases/).
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

// SkipLogic Agent prompt selector
import { SKIP_LOGIC_AGENT_INSTRUCTIONS_PRODUCTION, SKIP_LOGIC_CORE_INSTRUCTIONS } from './production';
import { SKIP_LOGIC_AGENT_INSTRUCTIONS_ALTERNATIVE, SKIP_LOGIC_CORE_INSTRUCTIONS_ALTERNATIVE } from './alternative';

export const getSkipLogicPrompt = (version?: string): string => {
  const promptVersion = version || process.env.SKIPLOGIC_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'alternative':
      return SKIP_LOGIC_AGENT_INSTRUCTIONS_ALTERNATIVE;
    case 'production':
    default:
      return SKIP_LOGIC_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

/**
 * Version-aware getter for core instructions (used by chunked mode in SkipLogicAgent).
 * Returns the core instructions (without scratchpad protocol) for the active prompt version.
 */
export const getSkipLogicCoreInstructions = (version?: string): string => {
  const v = version || process.env.SKIPLOGIC_PROMPT_VERSION || 'production';
  switch (v) {
    case 'alternative':
      return SKIP_LOGIC_CORE_INSTRUCTIONS_ALTERNATIVE;
    default:
      return SKIP_LOGIC_CORE_INSTRUCTIONS;
  }
};

export { SKIP_LOGIC_AGENT_INSTRUCTIONS_PRODUCTION };

// Composable prompt sections for chunked mode
export {
  SKIP_LOGIC_CORE_INSTRUCTIONS,
  SKIP_LOGIC_SCRATCHPAD_PROTOCOL,
} from './production';
