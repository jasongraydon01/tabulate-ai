// BannerAgent prompt selector
import { BANNER_EXTRACTION_PROMPT_PRODUCTION } from './production';
import { BANNER_EXTRACTION_PROMPT_ALTERNATIVE } from './alternative';

export const getBannerPrompt = (version?: string): string => {
  const promptVersion = version || process.env.BANNER_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'alternative':
      return BANNER_EXTRACTION_PROMPT_ALTERNATIVE;
    case 'production':
    default:
      return BANNER_EXTRACTION_PROMPT_PRODUCTION;
  }
};
