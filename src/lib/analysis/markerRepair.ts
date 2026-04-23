import { convertToModelMessages, generateText, type ModelMessage, type UIMessage } from "ai";

import { getSanitizedConversationMessagesForModel } from "@/lib/analysis/messages";
import { getAnalysisModel, getAnalysisProviderOptions } from "@/lib/analysis/model";
import type { AnalysisRenderMarkerValidationIssue } from "@/lib/analysis/renderAnchors";

// One-shot model repair when the assistant's response contains render markers
// that reference either an unfetched table (should fetch first) or a table
// that doesn't exist in this run. We hand the model its own failed text plus
// a structured list of the problems and ask it to produce a corrected reply.
//
// Bounded to one attempt — if the repair still has invalid markers the caller
// strips them deterministically.
export async function attemptAnalysisRenderMarkerRepair(params: {
  systemPrompt: string;
  conversationMessages: UIMessage[];
  failedAssistantText: string;
  issues: AnalysisRenderMarkerValidationIssue[];
  fetchedTableIds: string[];
  catalogSampleTableIds: string[];
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  if (params.issues.length === 0) return null;

  const issueLines = params.issues.map((issue) => {
    const reason = issue.reason === "not_in_run"
      ? "is not a real table in this run"
      : "was not fetched this turn via fetchTable";
    return `- \`${issue.raw}\` — tableId \`${issue.tableId}\` ${reason}`;
  });

  const fetchedSummary = params.fetchedTableIds.length > 0
    ? params.fetchedTableIds.join(", ")
    : "none fetched this turn";

  const catalogSample = params.catalogSampleTableIds.slice(0, 40);
  const catalogLine = catalogSample.length > 0
    ? `Examples of real tableIds in this run: ${catalogSample.join(", ")}${params.catalogSampleTableIds.length > catalogSample.length ? ", …" : ""}.`
    : "The run has no computed tables.";

  const repairInstruction = [
    "Your previous response had invalid `[[render tableId=…]]` markers:",
    ...issueLines,
    "",
    `Fetched this turn: ${fetchedSummary}.`,
    catalogLine,
    "",
    "Rewrite your previous response. Keep the analysis and interpretation intact, but:",
    "- Only emit `[[render tableId=…]]` markers for tables you actually fetched this turn.",
    "- If a marker referenced a table that doesn't exist in this run, remove it and say plainly that the table isn't available.",
    "- Do not call any tools in this repair — just produce the corrected text.",
    "",
    "Return only the corrected assistant text, no preamble.",
  ].join("\n");

  const sanitizedHistory = getSanitizedConversationMessagesForModel(params.conversationMessages);
  const baseMessages = await convertToModelMessages(sanitizedHistory);
  const attemptMessages: ModelMessage[] = [
    ...baseMessages,
    { role: "assistant", content: params.failedAssistantText },
    { role: "user", content: repairInstruction },
  ];

  try {
    const result = await generateText({
      model: getAnalysisModel(),
      system: params.systemPrompt,
      messages: attemptMessages,
      abortSignal: params.abortSignal,
      ...(getAnalysisProviderOptions() ? { providerOptions: getAnalysisProviderOptions() } : {}),
    });

    const text = result.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (error) {
    console.warn("[markerRepair] Repair attempt failed:", error);
    return null;
  }
}
