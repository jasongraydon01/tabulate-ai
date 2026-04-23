/**
 * Human-readable labels for analysis tool calls that appear in the thinking
 * disclosure. The set of keys here doubles as the allowlist for persistence:
 * only these tool types survive to Convex, and only these types are
 * rehydrated from persisted records.
 *
 * `tool-fetchTable` plays two roles: it is the data source for inline table
 * card rendering (via `[[render tableId=…]]` prose markers) AND it appears as
 * an activity chip in the thinking trace. The renderer resolves markers
 * against this-turn's fetchTable results.
 */
export const ANALYSIS_TOOL_ACTIVITY_LABELS: Record<string, string> = {
  "tool-searchRunCatalog": "Searching run catalog",
  "tool-fetchTable": "Fetching table",
  "tool-getQuestionContext": "Checking question metadata",
  "tool-listBannerCuts": "Listing available cuts",
};

export const FETCH_TABLE_TOOL_TYPE = "tool-fetchTable";

export function getAnalysisToolActivityLabel(toolType: string): string | null {
  return ANALYSIS_TOOL_ACTIVITY_LABELS[toolType] ?? null;
}

export function isRenderableAnalysisToolType(toolType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANALYSIS_TOOL_ACTIVITY_LABELS, toolType);
}
