"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  isReasoningUIPart,
  isToolUIPart,
} from "ai";

import { AnalysisAnswerBody } from "@/components/analysis/AnalysisAnswerBody";
import { AnalysisAnswerFooter } from "@/components/analysis/AnalysisAnswerFooter";
import { AnalysisUserMessage } from "@/components/analysis/AnalysisUserMessage";
import { useAnalysisAnswerReveal } from "@/components/analysis/useAnalysisAnswerReveal";
import {
  AnalysisWorkDisclosure,
  type AnalysisWorkActivityEntry,
} from "@/components/analysis/AnalysisWorkDisclosure";
import {
  getAnalysisMessageMetadata,
  getAnalysisUIMessageText,
} from "@/lib/analysis/messages";
import {
  buildSettledAnalysisAnswer,
  getSettledAnalysisVisibleEvidenceItems,
} from "@/lib/analysis/settledAnswer";
import { getAnalysisToolActivityLabel } from "@/lib/analysis/toolLabels";
import {
  isAnalysisStatusDataUIPart,
  type AnalysisUIMessage,
} from "@/lib/analysis/ui";
import {
  type AnalysisEvidenceItem,
  type AnalysisMessageFeedbackRecord,
  type AnalysisMessageFeedbackVote,
} from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

// Strip common markdown markers from reasoning summary text. OpenAI's
// Responses API emits reasoning-summary chunks containing things like
// `**Filtering bank data**` and `- step`, but the UI renders reasoning as
// plain text, so the markers show literally. Stripping is deterministic —
// keep the prompt out of this.
function stripReasoningMarkdown(text: string): string {
  return text
    // Images first (dropped entirely, including alt text).
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Links → keep label, drop url.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Code fences and inline code → keep inner text.
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-zA-Z]*\n?|```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    // Bold / italic via asterisk or underscore — strip the markers, keep text.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_(?!_)([^_\n]+)_(?!_)/g, "$1")
    // Strikethrough.
    .replace(/~~([^~]+)~~/g, "$1")
    // ATX headings at the start of a line.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // Blockquote markers.
    .replace(/^\s*>\s?/gm, "")
    // Unordered list bullets at the start of a line (only spaces/tabs, never
    // newlines — otherwise a leading blank line gets folded into the bullet).
    .replace(/^[ \t]*[-*+]\s+/gm, "")
    // Ordered list numerals at the start of a line.
    .replace(/^[ \t]*\d+\.\s+/gm, "")
    // Horizontal rules on their own line.
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, "");
}

function truncateReasoning(text: string, maxLength = 120): string {
  const stripped = stripReasoningMarkdown(text);
  const firstLine = stripped.split("\n")[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength).trim()}...`;
}

type TraceEntry =
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; state: string };

const MAX_ANALYSIS_REASONING_SUMMARY_UI_CHARS = 600;
const INTERNAL_ANALYSIS_TOOL_NAME_RE = /\b(?:tool-[A-Za-z0-9_-]+|submitAnswer|searchRunCatalog|fetchTable|getQuestionContext|listBannerCuts|confirmCitation|proposeDerivedRun|proposeRowRollup|proposeSelectedTableCut)\b/g;
const JSON_OBJECTISH_LINE_RE = /(?:\{[^\n]*(?:"|:)[^\n]*\}|\[[^\n]*(?:"|:)[^\n]*\])/g;

export function sanitizeAnalysisReasoningSummaryForUI(text: string): string {
  const sanitized = stripReasoningMarkdown(text)
    .replace(INTERNAL_ANALYSIS_TOOL_NAME_RE, "analysis step")
    .replace(JSON_OBJECTISH_LINE_RE, " [details hidden] ")
    .replace(/[<>]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (sanitized.length <= MAX_ANALYSIS_REASONING_SUMMARY_UI_CHARS) {
    return sanitized;
  }

  return `${sanitized.slice(0, MAX_ANALYSIS_REASONING_SUMMARY_UI_CHARS).trim()}...`;
}

export function getAnalysisTraceEntries(message: AnalysisUIMessage): TraceEntry[] {
  if (message.role === "user") {
    return [];
  }

  return message.parts.flatMap((part, index): TraceEntry[] => {
    if (isReasoningUIPart(part)) {
      const text = sanitizeAnalysisReasoningSummaryForUI(part.text);
      if (!text) return [];

      return [{
        kind: "reasoning",
        id: `${message.id}-reasoning-${index}`,
        text,
      }];
    }
    if (isToolUIPart(part)) {
      // `tool-fetchTable` plays two roles: it surfaces as a "Fetching table"
      // chip in the thinking trace here, AND its output data is resolved
      // inline wherever the prose emits a `[[render tableId=…]]` marker.
      // `buildAnalysisRenderableBlocks` handles the render path separately.
      const label = getAnalysisToolActivityLabel(part.type);
      if (!label) return [];
      return [{
        kind: "tool",
        id: part.toolCallId,
        label,
        state: part.state,
      }];
    }
    return [];
  });
}

export function getAnalysisValidationStatusLabel(message: AnalysisUIMessage): string | null {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (!part || !isAnalysisStatusDataUIPart(part)) continue;
    if (part.data.phase !== "validating_answer") continue;
    const label = part.data.label.trim();
    if (label.length > 0) return label;
  }

  return null;
}

export function getAnalysisTraceHeaderLabel(
  traceEntries: TraceEntry[],
  collapsedSummary: string | null,
  isExpanded: boolean,
): string {
  const hasReasoningSummary = traceEntries.some((entry) => entry.kind === "reasoning");
  if (hasReasoningSummary) {
    return isExpanded ? "Reasoning" : (collapsedSummary ?? "Reasoning");
  }

  return isExpanded ? "Analysis steps" : (collapsedSummary ?? "Analysis steps");
}

export function getAnalysisWorkStatusLabel(params: {
  traceEntries: TraceEntry[];
  validationStatusLabel: string | null;
  answerRevealBegins: boolean;
  isStreaming: boolean;
}): string | null {
  if (params.answerRevealBegins) {
    return params.traceEntries.length > 0 ? "Analysis steps" : null;
  }

  if (params.validationStatusLabel) {
    return params.validationStatusLabel;
  }

  for (let index = params.traceEntries.length - 1; index >= 0; index -= 1) {
    const entry = params.traceEntries[index];
    if (entry.kind === "tool") {
      const inProgress = params.isStreaming && entry.state !== "output-available";
      return `${entry.label}${inProgress ? "..." : ""}`;
    }
  }

  for (let index = params.traceEntries.length - 1; index >= 0; index -= 1) {
    const entry = params.traceEntries[index];
    if (entry.kind === "reasoning" && entry.text.trim().length > 0) {
      return truncateReasoning(entry.text);
    }
  }

  return params.traceEntries.length > 0 ? "Analysis steps" : null;
}

export function getAnalysisMessageEvidenceItems(message: AnalysisUIMessage): AnalysisEvidenceItem[] {
  return getAnalysisMessageMetadata(message)?.evidence ?? [];
}

export function getAnalysisMessageFollowUpItems(message: AnalysisUIMessage): string[] {
  return buildSettledAnalysisAnswer(message).followUpSuggestions;
}

export function getVisibleEvidenceItems(
  message: AnalysisUIMessage,
  evidenceItems: AnalysisEvidenceItem[],
): AnalysisEvidenceItem[] {
  return getSettledAnalysisVisibleEvidenceItems(message, evidenceItems);
}

export function resolveAnalysisFooterMessageId({
  explicitPersistedMessageId,
  settledPersistedMessageId,
  messageId,
}: {
  explicitPersistedMessageId?: string | null;
  settledPersistedMessageId?: string | null;
  messageId: string;
}): string {
  return explicitPersistedMessageId ?? settledPersistedMessageId ?? messageId;
}

export function AnalysisMessage({
  message,
  isStreaming = false,
  onSelectFollowUpSuggestion,
  composerHasDraft = false,
  feedback = null,
  onSubmitFeedback,
  onEditUserMessage,
  turnArtifacts = null,
  persistedMessageId: explicitPersistedMessageId = null,
}: {
  message: AnalysisUIMessage;
  isStreaming?: boolean;
  // Only passed when the thread is idle AND this is the tail assistant
  // message — so this prop doubles as the "show chips" signal.
  onSelectFollowUpSuggestion?: (suggestion: string) => void | Promise<void>;
  composerHasDraft?: boolean;
  feedback?: AnalysisMessageFeedbackRecord | null;
  onSubmitFeedback?: (input: {
    messageId: string;
    vote: AnalysisMessageFeedbackVote | null;
    correctionText?: string | null;
  }) => Promise<void>;
  // Passed on persisted user messages when editing is available. Called with
  // the new text — the thread owns the stop / truncate / resend choreography
  // so this can be invoked at any time, including during streaming.
  onEditUserMessage?: (input: { messageId: string; text: string }) => Promise<void>;
  turnArtifacts?: ReactNode;
  persistedMessageId?: string | null;
}) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const isUser = message.role === "user";
  const hasGroundedTableCard = !isUser && message.parts.some(
    (part) => isToolUIPart(part) && part.type === "tool-fetchTable",
  );
  const hasTouchedThinkingRef = useRef(false);
  const hasAutoCollapsedThinkingRef = useRef(false);

  const traceEntries = getAnalysisTraceEntries(message);
  const validationStatusLabel = isUser ? null : getAnalysisValidationStatusLabel(message);
  const rawAssistantText = isUser ? "" : getAnalysisUIMessageText(message);

  const settledAnswer = useMemo(
    () => buildSettledAnalysisAnswer(message, {
      isStreaming: !isUser && isStreaming,
    }),
    [isStreaming, isUser, message],
  );
  const {
    renderableBlocks,
    sourceItems,
    followUpSuggestions,
    persistenceWarning,
    persistedMessageId: settledPersistedMessageId,
  } = settledAnswer;
  const footerMessageId = resolveAnalysisFooterMessageId({
    explicitPersistedMessageId,
    settledPersistedMessageId,
    messageId: message.id,
  });
  const {
    answerRevealBegins,
    displayBlocks,
    isFooterReady,
    isRevealing,
  } = useAnalysisAnswerReveal({
    renderableBlocks,
    isStreaming,
  });
  const hasFooterContent = rawAssistantText.trim().length > 0
    || sourceItems.length > 0
    || Boolean(onSubmitFeedback)
    || Boolean(onSelectFollowUpSuggestion && followUpSuggestions.length > 0);
  const shouldReserveFooter = answerRevealBegins && hasFooterContent;
  const showWorkLoader = isStreaming && !answerRevealBegins;
  const workStatusLabel = getAnalysisWorkStatusLabel({
    traceEntries,
    validationStatusLabel,
    answerRevealBegins,
    isStreaming,
  });
  const shouldShowWorkDisclosure = !isUser && Boolean(workStatusLabel);

  useEffect(() => {
    if (!shouldShowWorkDisclosure || hasTouchedThinkingRef.current || hasAutoCollapsedThinkingRef.current) {
      return;
    }

    if (answerRevealBegins) {
      hasAutoCollapsedThinkingRef.current = true;
      setIsThinkingExpanded(false);
    }
  }, [answerRevealBegins, shouldShowWorkDisclosure]);

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0",
          hasGroundedTableCard ? "w-full max-w-full" : "max-w-[88%]",
        )}
      >
        {isUser ? (
          <AnalysisUserMessage
            message={message}
            onEditUserMessage={onEditUserMessage}
          />
        ) : (
          <div className="min-w-0 space-y-3">
            {shouldShowWorkDisclosure && workStatusLabel ? (
              <AnalysisWorkDisclosure
                entries={traceEntries as AnalysisWorkActivityEntry[]}
                statusLabel={workStatusLabel}
                isOpen={isThinkingExpanded}
                onOpenChange={(open) => {
                  hasTouchedThinkingRef.current = true;
                  setIsThinkingExpanded(open);
                }}
                showLoader={showWorkLoader}
              />
            ) : null}

            <AnalysisAnswerBody
              message={message}
              displayBlocks={displayBlocks}
              isRevealing={isRevealing}
            />

            {persistenceWarning ? (
              <div className="rounded-xl border border-ct-amber/30 bg-ct-amber-dim px-3 py-2 text-xs leading-5 text-foreground/85">
                {persistenceWarning}
              </div>
            ) : null}

            {turnArtifacts ? (
              <div className="space-y-3 pt-1">
                {turnArtifacts}
              </div>
            ) : null}

            <AnalysisAnswerFooter
              isReady={isFooterReady}
              reserveSpace={shouldReserveFooter}
              messageText={getAnalysisUIMessageText(message)}
              messageId={footerMessageId}
              sourceItems={sourceItems}
              feedback={feedback}
              onSubmitFeedback={onSubmitFeedback}
              followUpSuggestions={followUpSuggestions}
              onSelectFollowUpSuggestion={onSelectFollowUpSuggestion}
              composerHasDraft={composerHasDraft}
            />
          </div>
        )}
      </div>
    </div>
  );
}
