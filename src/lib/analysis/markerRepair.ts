import { convertToModelMessages, generateText, type ModelMessage, type UIMessage } from "ai";

import type { AnalysisCiteMarkerValidationIssue } from "@/lib/analysis/citeAnchors";
import type { AnalysisGroundingContext } from "@/lib/analysis/grounding";
import { getSanitizedConversationMessagesForModel } from "@/lib/analysis/messages";
import { getAnalysisModel, getAnalysisProviderOptions } from "@/lib/analysis/model";
import { buildAnalysisSystemMessage } from "@/lib/analysis/promptPrefix";
import type { AnalysisRenderMarkerValidationIssue } from "@/lib/analysis/renderAnchors";

// One-shot model repair when the assistant response carries invalid markers.
// Combines both marker families (render + cite) into a single instruction so
// we pay exactly one extra round trip per turn with any issues. Bounded to one
// attempt — if the repair still has invalid markers the caller strips them
// deterministically.
export async function attemptAnalysisMarkerRepair(params: {
  groundingContext: Pick<
    AnalysisGroundingContext,
    | "availability"
    | "missingArtifacts"
    | "questions"
    | "surveyQuestions"
    | "surveyMarkdown"
    | "bannerPlanGroups"
    | "projectContext"
  >;
  conversationMessages: UIMessage[];
  failedAssistantText: string;
  renderIssues: AnalysisRenderMarkerValidationIssue[];
  citeIssues: AnalysisCiteMarkerValidationIssue[];
  fetchedTableIds: string[];
  confirmedCellIds: string[];
  catalogSampleTableIds: string[];
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  if (params.renderIssues.length === 0 && params.citeIssues.length === 0) return null;

  const sections: string[] = ["Your previous response had invalid inline markers."];

  if (params.renderIssues.length > 0) {
    sections.push("");
    sections.push("Invalid `[[render tableId=…]]` markers:");
    for (const issue of params.renderIssues) {
      const reason = issue.reason === "not_in_run"
        ? "is not a real table in this run"
        : "was not fetched this turn via fetchTable";
      sections.push(`- \`${issue.raw}\` — tableId \`${issue.tableId}\` ${reason}`);
    }
    const fetchedSummary = params.fetchedTableIds.length > 0
      ? params.fetchedTableIds.join(", ")
      : "none fetched this turn";
    sections.push(`Fetched this turn: ${fetchedSummary}.`);
    const catalogSample = params.catalogSampleTableIds.slice(0, 40);
    sections.push(catalogSample.length > 0
      ? `Examples of real tableIds in this run: ${catalogSample.join(", ")}${params.catalogSampleTableIds.length > catalogSample.length ? ", …" : ""}.`
      : "The run has no computed tables.");
  }

  if (params.citeIssues.length > 0) {
    sections.push("");
    sections.push("Invalid `[[cite cellIds=…]]` markers:");
    for (const issue of params.citeIssues) {
      if (issue.reason === "empty") {
        sections.push(`- \`${issue.raw}\` — has no cellIds; either add confirmed cellIds or remove the marker.`);
      } else if (issue.reason === "partial_unconfirmed") {
        sections.push(`- \`${issue.raw}\` — some cellIds were not confirmed this turn: ${issue.unconfirmedCellIds.join(", ")}`);
      } else {
        sections.push(`- \`${issue.raw}\` — cellIds were not confirmed this turn via confirmCitation: ${issue.unconfirmedCellIds.join(", ")}`);
      }
    }
    sections.push(params.confirmedCellIds.length > 0
      ? `Confirmed this turn: ${params.confirmedCellIds.join(", ")}.`
      : "No cellIds were confirmed this turn.");
  }

  sections.push("");
  sections.push("Rewrite your previous response. Keep the analysis and interpretation intact, but:");
  sections.push("- Only emit `[[render tableId=…]]` markers for tables you actually fetched this turn.");
  sections.push("- Only emit `[[cite cellIds=…]]` markers for cellIds you confirmed this turn via confirmCitation.");
  sections.push("- If a marker referenced something unavailable in this turn, remove the marker. Keep the surrounding prose if it still reads sensibly; otherwise revise the sentence.");
  sections.push("- Do not call any tools in this repair — just produce the corrected text.");
  sections.push("");
  sections.push("Return only the corrected assistant text, no preamble.");

  const repairInstruction = sections.join("\n");

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
      system: buildAnalysisSystemMessage(params.groundingContext, {
        cacheControl: "ephemeral",
      }),
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

// Backwards-compat alias so the route's existing import keeps compiling in the
// same PR. Route will be updated to call `attemptAnalysisMarkerRepair` directly.
export { attemptAnalysisMarkerRepair as attemptAnalysisRenderMarkerRepair };
