import { ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION, buildAnalysisInstructions } from "./production";

export const getAnalysisPrompt = (version?: string): string => {
  const promptVersion = version || process.env.ANALYSIS_PROMPT_VERSION || "production";

  switch (promptVersion) {
    case "production":
    default:
      return ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export { ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION, buildAnalysisInstructions };
