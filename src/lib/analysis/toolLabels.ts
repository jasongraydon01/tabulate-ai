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
};

export const HIDDEN_ANALYSIS_PROPOSAL_TOOL_TYPES = new Set([
  "tool-proposeDerivedRun",
  "tool-proposeRowRollup",
  "tool-proposeSelectedTableCut",
]);

export const HIDDEN_ANALYSIS_PROPOSAL_TOOL_NAMES = new Set([
  "proposeDerivedRun",
  "proposeRowRollup",
  "proposeSelectedTableCut",
]);

export const HIDDEN_ANALYSIS_TOOL_ACTIVITY_TYPES = new Set([
  "tool-submitAnswer",
  ...HIDDEN_ANALYSIS_PROPOSAL_TOOL_TYPES,
]);

export const HIDDEN_ANALYSIS_TOOL_ACTIVITY_NAMES = new Set([
  "submitAnswer",
  ...HIDDEN_ANALYSIS_PROPOSAL_TOOL_NAMES,
]);

export const ALLOWED_ANALYSIS_TOOL_ACTIVITY_TYPES = new Set(
  Object.keys(ANALYSIS_TOOL_ACTIVITY_LABELS),
);

export const ALLOWED_ANALYSIS_TOOL_ACTIVITY_NAMES = new Set(
  [...ALLOWED_ANALYSIS_TOOL_ACTIVITY_TYPES].map((toolType) => toolType.replace(/^tool-/, "")),
);

export const FETCH_TABLE_TOOL_TYPE = "tool-fetchTable";
export const CONFIRM_CITATION_TOOL_TYPE = "tool-confirmCitation";
export const SUBMIT_ANSWER_TOOL_NAME = "submitAnswer";
export const SUBMIT_ANSWER_TOOL_TYPE = "tool-submitAnswer";

export function getAnalysisToolActivityLabel(toolType: string): string | null {
  if (HIDDEN_ANALYSIS_TOOL_ACTIVITY_TYPES.has(toolType)) return null;
  return ANALYSIS_TOOL_ACTIVITY_LABELS[toolType] ?? null;
}

export function isRenderableAnalysisToolType(toolType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ANALYSIS_TOOL_ACTIVITY_LABELS, toolType);
}

export function isAllowedAnalysisToolType(toolType: string): boolean {
  return ALLOWED_ANALYSIS_TOOL_ACTIVITY_TYPES.has(toolType);
}

export function isAllowedAnalysisToolName(toolName: string): boolean {
  return ALLOWED_ANALYSIS_TOOL_ACTIVITY_NAMES.has(toolName);
}

export function isHiddenAnalysisToolType(toolType: string): boolean {
  return HIDDEN_ANALYSIS_TOOL_ACTIVITY_TYPES.has(toolType);
}

export function isHiddenAnalysisToolName(toolName: string): boolean {
  return HIDDEN_ANALYSIS_TOOL_ACTIVITY_NAMES.has(toolName);
}
