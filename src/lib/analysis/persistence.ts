import { isReasoningUIPart, isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import { sanitizeGroundingToolOutput } from "@/lib/analysis/grounding";
import { sanitizeAnalysisAssistantMessageContent } from "@/lib/analysis/messages";
import {
  CONFIRM_CITATION_TOOL_TYPE,
  FETCH_TABLE_TOOL_TYPE,
} from "@/lib/analysis/toolLabels";
import {
  isAnalysisCellSummary,
  isAnalysisTableCard,
  type AnalysisCellSummary,
  type AnalysisTableCard,
} from "@/lib/analysis/types";

export interface PersistedAnalysisPart {
  type: string;
  text?: string;
  state?: string;
  label?: string;
  toolCallId?: string;
  cellSummary?: AnalysisCellSummary;
  input?: unknown;
  output?: unknown;
}

export interface PendingTableCardArtifact {
  title: string;
  tableId: string;
  questionId: string | null;
  payload: AnalysisTableCard;
}

export interface PendingTableCardTemplate {
  state: string;
  label: string;
  toolCallId?: string;
  input?: unknown;
}

export type PendingAnalysisPart =
  | { kind: "ready"; part: PersistedAnalysisPart }
  | {
      kind: "tableCard";
      template: PendingTableCardTemplate;
      artifact: PendingTableCardArtifact;
    };

/**
 * Pure transform from an AI SDK UI message's parts into persistence-ready
 * entries. The caller is responsible for creating `analysisArtifacts` records
 * for `tableCard` entries and stamping the resulting `artifactId` onto the
 * corresponding persisted part before handing the final array to the message
 * `create` mutation.
 *
 * Transport policy: text and reasoning parts persist after sanitization /
 * whitespace-only filtering. Tool parts persist in their standard AI SDK
 * shape so prior tool-use / tool-result history can survive reloads. Successful
 * `tool-fetchTable` outputs still flow through `analysisArtifacts` to avoid
 * duplicating large table payloads inline.
 */
export function buildPersistedAnalysisParts(parts: UIMessage["parts"]): PendingAnalysisPart[] {
  const pending: PendingAnalysisPart[] = [];

  for (const part of parts) {
    if (isTextUIPart(part)) {
      const text = sanitizeAnalysisAssistantMessageContent(part.text);
      if (!text) continue;
      pending.push({
        kind: "ready",
        part: {
          type: "text",
          text,
          ...(part.state ? { state: part.state } : {}),
        },
      });
      continue;
    }

    if (isReasoningUIPart(part)) {
      const text = sanitizeAnalysisAssistantMessageContent(part.text ?? "");
      if (!text) continue;
      pending.push({
        kind: "ready",
        part: {
          type: "reasoning",
          text,
          state: part.state ?? "done",
        },
      });
      continue;
    }

    if (!isToolUIPart(part) || !part.toolCallId) continue;

    if (part.type === FETCH_TABLE_TOOL_TYPE) {
      if (part.state === "output-available" && isAnalysisTableCard(part.output)) {
        const tableCard = part.output as AnalysisTableCard;
        pending.push({
          kind: "tableCard",
          template: {
            state: part.state,
            label: tableCard.title,
            toolCallId: part.toolCallId,
            input: "input" in part ? sanitizeGroundingToolOutput(part.input) : {
              tableId: tableCard.tableId,
              rowFilter: tableCard.requestedRowFilter,
              cutFilter: tableCard.requestedCutFilter,
              valueMode: tableCard.valueMode,
            },
          },
          artifact: {
            title: tableCard.title,
            tableId: tableCard.tableId,
            questionId: tableCard.questionId ?? null,
            payload: tableCard,
          },
        });
        continue;
      }
    }

    if (part.type === CONFIRM_CITATION_TOOL_TYPE) {
      const cellSummary = part.state === "output-available" && isAnalysisCellSummary(part.output)
        ? (part.output as AnalysisCellSummary)
        : null;
      pending.push({
        kind: "ready",
        part: {
          type: part.type,
          state: part.state,
          toolCallId: part.toolCallId,
          ...(cellSummary ? { label: `${cellSummary.rowLabel} / ${cellSummary.cutName}`, cellSummary } : {}),
          ...("input" in part ? { input: sanitizeGroundingToolOutput(part.input) } : {}),
          ...(cellSummary
            ? { output: { status: "confirmed", ...cellSummary } }
            : "output" in part
              ? { output: sanitizeGroundingToolOutput(part.output) }
              : {}),
        },
      });
      continue;
    }

    pending.push({
      kind: "ready",
      part: {
        type: part.type,
        state: part.state,
        toolCallId: part.toolCallId,
        ...("input" in part ? { input: sanitizeGroundingToolOutput(part.input) } : {}),
        ...("output" in part ? { output: sanitizeGroundingToolOutput(part.output) } : {}),
      },
    });
  }

  return pending;
}
