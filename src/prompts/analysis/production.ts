import { ANALYSIS_AGENT_INSTRUCTIONS_ALTERNATIVE } from "./alternative";

// Slice C made the fetch/render/cite workflow the live analysis contract.
// Keep the legacy "production" selector aligned with that same prompt surface
// so environments that rely on the default prompt version cannot drift back to
// the pre-hard-cut tool vocabulary.
export const ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION =
  ANALYSIS_AGENT_INSTRUCTIONS_ALTERNATIVE;
