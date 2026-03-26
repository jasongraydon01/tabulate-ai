/**
 * BannerGenerateAgent prompt selector.
 *
 * 'production' — V3-native rewrite with mission/posture/evidence hierarchy pattern (active)
 * 'alternative' — Prior production content preserved as fallback
 * 'production_v3' — Alias for 'alternative' (backwards compatibility)
 */

import {
  BANNER_GENERATE_SYSTEM_PROMPT_PRODUCTION,
  buildBannerGenerateUserPrompt as buildBannerGenerateUserPromptProduction,
  buildBannerGenerateUserPromptV3,
  type BannerGenerateUserPromptInput as BannerGenerateUserPromptInputProduction,
  type BannerGenerateUserPromptInputV3,
} from './production';
import {
  BANNER_GENERATE_SYSTEM_PROMPT_ALTERNATIVE,
  buildBannerGenerateUserPrompt as buildBannerGenerateUserPromptAlternative,
} from './alternative';

export type BannerGenerateUserPromptInput = BannerGenerateUserPromptInputProduction;
export type { BannerGenerateUserPromptInputV3 };

export const getBannerGeneratePrompt = (version?: string): string => {
  const promptVersion = version || process.env.BANNER_GENERATE_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'alternative':
    case 'production_v3':
      return BANNER_GENERATE_SYSTEM_PROMPT_ALTERNATIVE;
    case 'production':
    default:
      return BANNER_GENERATE_SYSTEM_PROMPT_PRODUCTION;
  }
};

export const buildBannerGenerateUserPrompt = (input: BannerGenerateUserPromptInput): string => {
  return buildBannerGenerateUserPromptProduction(input);
};

export { buildBannerGenerateUserPromptV3 };

export const buildBannerGenerateUserPromptForVersion = (
  input: BannerGenerateUserPromptInput,
  version?: string,
): string => {
  const promptVersion = version || process.env.BANNER_GENERATE_PROMPT_VERSION || 'production';
  if (promptVersion === 'alternative') {
    return buildBannerGenerateUserPromptAlternative(input);
  }
  return buildBannerGenerateUserPromptProduction(input);
};
