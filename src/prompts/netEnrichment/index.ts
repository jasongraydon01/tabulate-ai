// NET Enrichment Agent prompt selector
import { NET_ENRICHMENT_AGENT_INSTRUCTIONS_PRODUCTION } from './production';

export const getNetEnrichmentPrompt = (version?: string): string => {
  const promptVersion = version || process.env.NET_ENRICHMENT_PROMPT_VERSION || 'production';

  switch (promptVersion) {
    case 'production':
    default:
      return NET_ENRICHMENT_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { NET_ENRICHMENT_AGENT_INSTRUCTIONS_PRODUCTION };
