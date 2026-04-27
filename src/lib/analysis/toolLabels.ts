/**
 * Human-readable labels for analysis tool calls that appear in the thinking
 * disclosure.
 *
 * `tool-fetchTable` plays two roles: it is the data source for inline table
 * card rendering AND it appears as an activity chip in the thinking trace.
 * The settled renderer resolves explicit render parts against this-turn's
 * fetchTable results.
 */
export const ANALYSIS_TOOL_ACTIVITY_LABELS: Record<string, string> = {
  "tool-searchRunCatalog": "Searching run catalog",
  "tool-fetchTable": "Fetching table",
  "tool-getQuestionContext": "Checking question metadata",
  "tool-listBannerCuts": "Listing available cuts",
  "tool-confirmCitation": "Confirming cell",
  "tool-proposeDerivedRun": "Preparing derived run proposal",
  "tool-proposeRowRollup": "Preparing derived table proposal",
  "tool-proposeSelectedTableCut": "Preparing derived table proposal",
};

export const FETCH_TABLE_TOOL_TYPE = "tool-fetchTable";
export const CONFIRM_CITATION_TOOL_TYPE = "tool-confirmCitation";
export const SUBMIT_ANSWER_TOOL_NAME = "submitAnswer";
export const SUBMIT_ANSWER_TOOL_TYPE = "tool-submitAnswer";

export function getAnalysisToolActivityLabel(toolType: string): string | null {
  return ANALYSIS_TOOL_ACTIVITY_LABELS[toolType] ?? null;
}

export function isRenderableAnalysisToolType(toolType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANALYSIS_TOOL_ACTIVITY_LABELS, toolType);
}
