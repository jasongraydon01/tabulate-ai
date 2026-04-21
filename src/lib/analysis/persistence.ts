import { isReasoningUIPart, isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import { sanitizeAnalysisAssistantMessageContent } from "@/lib/analysis/messages";
import {
  TABLE_CARD_TOOL_TYPE,
  isRenderableAnalysisToolType,
} from "@/lib/analysis/toolLabels";
import { isAnalysisTableCard, type AnalysisTableCard } from "@/lib/analysis/types";

export interface PersistedAnalysisPart {
  type: string;
  text?: string;
  state?: string;
  label?: string;
  toolCallId?: string;
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
 * Allowlist policy: text and reasoning parts always pass through (after
 * sanitization / whitespace-only filtering). Tool parts pass through only if
 * they are `tool-getTableCard` (handled via the artifact flow) or in the
 * renderable-tool allowlist. Unknown tool types are dropped so the UI never
 * has to render a chip it does not know how to label.
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

    if (!isToolUIPart(part)) continue;

    if (part.type === TABLE_CARD_TOOL_TYPE) {
      if (part.state === "output-available" && isAnalysisTableCard(part.output)) {
        pending.push({
          kind: "tableCard",
          template: {
            state: part.state,
            label: part.output.title,
            toolCallId: part.toolCallId,
          },
          artifact: {
            title: part.output.title,
            tableId: part.output.tableId,
            questionId: part.output.questionId ?? null,
            payload: part.output,
          },
        });
      }
      continue;
    }

    if (!isRenderableAnalysisToolType(part.type)) continue;

    pending.push({
      kind: "ready",
      part: {
        type: part.type,
        state: part.state,
        toolCallId: part.toolCallId,
      },
    });
  }

  return pending;
}
