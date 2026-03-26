// Survey Cleanup Agent prompt selector
import { SURVEY_CLEANUP_AGENT_INSTRUCTIONS_PRODUCTION } from './production';

export const getSurveyCleanupPrompt = (version?: string): string => {
  const promptVersion = version || process.env.SURVEY_CLEANUP_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'production':
    default:
      return SURVEY_CLEANUP_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { SURVEY_CLEANUP_AGENT_INSTRUCTIONS_PRODUCTION };
