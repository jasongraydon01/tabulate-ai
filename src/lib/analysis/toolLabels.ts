/**
 * Human-readable labels for analysis tool calls that appear in the thinking
 * disclosure. The set of keys here doubles as the allowlist for persistence:
 * only these tool types survive to Convex, and only these types are
 * rehydrated from persisted records.
 *
 * `tool-getTableCard` is not listed here because it is rendered as a full
 * table card, not as a chip in the thinking trace, and it is persisted
 * through the `analysisArtifacts` flow rather than inline part fields.
 */
export const ANALYSIS_TOOL_ACTIVITY_LABELS: Record<string, string> = {
  "tool-searchRunCatalog": "Searching run catalog",
  "tool-viewTable": "Inspecting table",
  "tool-getQuestionContext": "Checking question metadata",
  "tool-getSurveyQuestion": "Reading survey wording",
  "tool-listBannerCuts": "Listing available cuts",
  "tool-getBannerPlanContext": "Reviewing banner plan",
  "tool-getRunContext": "Loading run context",
  "tool-scratchpad": "Reasoning",
};

export const TABLE_CARD_TOOL_TYPE = "tool-getTableCard";

export function getAnalysisToolActivityLabel(toolType: string): string | null {
  return ANALYSIS_TOOL_ACTIVITY_LABELS[toolType] ?? null;
}

export function isRenderableAnalysisToolType(toolType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANALYSIS_TOOL_ACTIVITY_LABELS, toolType);
}
