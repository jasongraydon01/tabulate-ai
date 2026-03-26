/**
 * CrossTab Agent prompt selector.
 *
 * 'production' — V3-native rewrite with mission/posture/evidence hierarchy pattern (active)
 * 'alternative' — Prior production_v3 content preserved as fallback
 * 'production_v3' — Alias for 'alternative' (backwards compatibility)
 */

import { CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION } from './production';
import { CROSSTAB_VALIDATION_INSTRUCTIONS_ALTERNATIVE } from './alternative';

export const getCrosstabPrompt = (version?: string): string => {
  const promptVersion = version || process.env.CROSSTAB_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'alternative':
    case 'production_v3':
      return CROSSTAB_VALIDATION_INSTRUCTIONS_ALTERNATIVE;
    case 'production':
    default:
      return CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION;
  }
};
