"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, isDataUIPart } from "ai";
import { useChat } from "@ai-sdk/react";
import { AlertCircle } from "lucide-react";

import { AnalysisComputeJobCard } from "@/components/analysis/AnalysisComputeJobCard";
import { AnalysisMessage } from "@/components/analysis/AnalysisMessage";
import {
  isAnalysisThreadNearBottom,
  scrollAnalysisThreadForRevealEvent,
  scrollAnalysisThreadToBottom,
  scrollAnalysisThreadToMessageStart,
} from "@/components/analysis/analysisThreadScroll";
import { PromptComposer } from "@/components/analysis/PromptComposer";
import { GridLoader } from "@/components/ui/grid-loader";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnalysisComputeJobView } from "@/lib/analysis/computeLane/jobView";
import type { AnalysisUIMessage } from "@/lib/analysis/ui";
import type { AnalysisMessageFeedbackRecord, AnalysisMessageFeedbackVote } from "@/lib/analysis/types";

interface AnalysisThreadProps {
  runId: string;
  sessionId: string;
  sessionTitle: string;
  initialMessages: AnalysisUIMessage[];
  persistedMessages: AnalysisUIMessage[];
  persistedMessageCreatedAtById: Record<string, number>;
  computeJobs: AnalysisComputeJobView[];
  persistedAssistantMessageIds: string[];
  persistedUserMessageIds: string[];
  // Full message id list in the order Convex holds them for this session.
  // Used to reconcile useChat's client-generated ids with real Convex ids
  // after a turn finishes so the edit affordance lights up without a reload.
  persistedMessageIdsInOrder: string[];
  messageFeedbackById: Record<string, AnalysisMessageFeedbackRecord | null>;
  onSubmitMessageFeedback: (input: {
    messageId: string;
    vote: AnalysisMessageFeedbackVote;
    correctionText?: string | null;
  }) => Promise<void>;
  // Called with just the messageId to truncate. The thread owns the client
  // state dance (stop → setMessages truncate → resend) internally.
  onTruncateFromMessage: (messageId: string) => Promise<void>;
  onStartComputePreflight: (requestText: string) => Promise<void>;
  onConfirmComputeJob: (job: AnalysisComputeJobView) => Promise<void>;
  onCancelComputeJob: (job: AnalysisComputeJobView) => Promise<void>;
  onContinueInDerivedRun: (job: AnalysisComputeJobView) => Promise<void>;
}

type AnalysisTimelineEntry =
  | { kind: "message"; key: string; createdAt: number; message: AnalysisUIMessage; messageIndex: number }
  | { kind: "compute-job"; key: string; createdAt: number; job: AnalysisComputeJobView };

export function buildAnalysisTimelineEntries(params: {
  messages: AnalysisUIMessage[];
  computeJobs: AnalysisComputeJobView[];
  messageCreatedAtById: Record<string, number>;
}): AnalysisTimelineEntry[] {
  const liveBase = Number.MAX_SAFE_INTEGER - params.messages.length - params.computeJobs.length - 1;
  return [
    ...params.messages.map((message, messageIndex): AnalysisTimelineEntry => ({
      kind: "message",
      key: `message-${message.id}`,
      createdAt: params.messageCreatedAtById[message.id] ?? liveBase + messageIndex,
      message,
      messageIndex,
    })),
    ...params.computeJobs.map((job): AnalysisTimelineEntry => ({
      kind: "compute-job",
      key: `compute-job-${job.id}`,
      createdAt: job.createdAt,
      job,
    })),
  ].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    if (left.kind === right.kind) return left.key.localeCompare(right.key);
    return left.kind === "message" ? -1 : 1;
  });
}

export function shouldShowAnalysisMessageActions(
  messages: AnalysisUIMessage[],
  messageIndex: number,
): boolean {
  const message = messages[messageIndex];
  if (!message || message.role !== "assistant") {
    return false;
  }

  const latestAssistantIndex = messages.findLastIndex((entry) => entry.role === "assistant");
  if (latestAssistantIndex !== messageIndex) {
    return false;
  }

  return !messages.slice(messageIndex + 1).some((entry) => entry.role === "user");
}

export function hasVisibleAnalysisMessageParts(message: AnalysisUIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return part.text.trim().length > 0;
    }

    if (isDataUIPart(part)) {
      return true;
    }

    return part.type.startsWith("tool-");
  });
}

export function shouldShowAnalysisPendingState(
  messages: AnalysisUIMessage[],
  status: "submitted" | "streaming" | "ready" | "error",
): boolean {
  if (status !== "submitted" && status !== "streaming") {
    return false;
  }

  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return true;
  }

  if (lastMessage.role !== "assistant") {
    return true;
  }

  return !hasVisibleAnalysisMessageParts(lastMessage);
}

export function PendingAnalysisMessage() {
  const summaryLabel = "TabulateAI is analyzing the artifacts...";

  return (
    <div className="flex w-full justify-start">
      <div className="min-w-0 max-w-[88%]">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <GridLoader size="sm" />
          <span className="min-w-0 truncate italic">{summaryLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function AnalysisThread({
  runId,
  sessionId,
  sessionTitle,
  initialMessages,
  persistedMessages,
  persistedMessageCreatedAtById,
  computeJobs,
  persistedAssistantMessageIds,
  persistedUserMessageIds,
  persistedMessageIdsInOrder,
  messageFeedbackById,
  onSubmitMessageFeedback,
  onTruncateFromMessage,
  onStartComputePreflight,
  onConfirmComputeJob,
  onCancelComputeJob,
  onContinueInDerivedRun,
}: AnalysisThreadProps) {
  const [input, setInput] = useState("");
  const [isComputePreflightPending, setIsComputePreflightPending] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(initialMessages.length);
  const shouldStickToBottomRef = useRef(true);
  const persistedAssistantMessageIdSet = useMemo(
    () => new Set(persistedAssistantMessageIds),
    [persistedAssistantMessageIds],
  );
  const persistedUserMessageIdSet = useMemo(
    () => new Set(persistedUserMessageIds),
    [persistedUserMessageIds],
  );
  const transport = useMemo(
    () => new DefaultChatTransport<AnalysisUIMessage>({
      api: `/api/runs/${encodeURIComponent(runId)}/analysis`,
    }),
    [runId],
  );

  const {
    messages,
    sendMessage,
    setMessages,
    status,
    error,
    stop,
  } = useChat<AnalysisUIMessage>({
    id: sessionId,
    messages: initialMessages,
    transport,
  });

  const isBusy = status === "submitted" || status === "streaming";
  const shouldShowPendingState = shouldShowAnalysisPendingState(messages, status);
  const timelineEntries = useMemo(
    () => buildAnalysisTimelineEntries({
      messages,
      computeJobs,
      messageCreatedAtById: persistedMessageCreatedAtById,
    }),
    [computeJobs, messages, persistedMessageCreatedAtById],
  );

  // Once the turn is settled and Convex has replayed the canonical message
  // shape, snap the chat state to the persisted session so current-turn and
  // reload behavior stay aligned.
  useEffect(() => {
    if (status !== "ready") return;
    if (persistedMessages.length === 0 || persistedMessageIdsInOrder.length === 0) return;

    setMessages((current) => {
      if (current.length !== persistedMessages.length) return current;

      const currentSnapshot = JSON.stringify(current);
      const persistedSnapshot = JSON.stringify(persistedMessages);
      if (currentSnapshot === persistedSnapshot) {
        return current;
      }

      return persistedMessages;
    });
  }, [persistedMessageIdsInOrder, persistedMessages, setMessages, status]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const syncStickiness = () => {
      shouldStickToBottomRef.current = isAnalysisThreadNearBottom(viewport);
    };

    syncStickiness();
    viewport.addEventListener("scroll", syncStickiness, { passive: true });
    return () => viewport.removeEventListener("scroll", syncStickiness);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const frame = window.requestAnimationFrame(() => {
      const shouldAutoScroll = shouldStickToBottomRef.current;

      if (timelineEntries.length > prevMessageCountRef.current && lastMessageRef.current) {
        prevMessageCountRef.current = timelineEntries.length;
        if (shouldAutoScroll) {
          scrollAnalysisThreadToMessageStart(viewport, lastMessageRef.current);
        }
        return;
      }

      if (status === "streaming" && shouldStickToBottomRef.current && shouldShowPendingState) {
        scrollAnalysisThreadToBottom(viewport, "auto");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [shouldShowPendingState, status, timelineEntries.length]);

  async function handleSubmit() {
    const nextInput = input.trim();
    if (!nextInput || isBusy || isComputePreflightPending) return;
    setInput("");
    shouldStickToBottomRef.current = true;
    await sendMessage(
      { text: nextInput },
      { body: { sessionId } },
    );
  }

  async function handleComputeSubmit() {
    const nextInput = input.trim();
    if (!nextInput || isBusy || isComputePreflightPending) return;

    setIsComputePreflightPending(true);
    shouldStickToBottomRef.current = true;
    try {
      await onStartComputePreflight(nextInput);
      setInput("");
    } finally {
      setIsComputePreflightPending(false);
    }
  }

  async function handleFollowUpSuggestion(suggestion: string) {
    const nextSuggestion = suggestion.trim();
    if (!nextSuggestion || isBusy) return;

    shouldStickToBottomRef.current = true;
    await sendMessage(
      { text: nextSuggestion },
      { body: { sessionId } },
    );
  }

  async function handleEditUserMessage(input: { messageId: string; text: string }) {
    // Abort any in-flight turn before truncating so the aborted response
    // doesn't race with the subsequent send.
    if (isBusy) {
      stop();
    }

    const targetIndex = messages.findIndex((entry) => entry.id === input.messageId);
    if (targetIndex === -1) {
      throw new Error("Edited message not found in thread");
    }

    // Truncate the local message state so the edited turn doesn't briefly
    // appear alongside the original before the new response streams.
    setMessages(messages.slice(0, targetIndex));

    // Server truncation (messages, artifacts, feedback) so the next POST
    // doesn't see stale context.
    await onTruncateFromMessage(input.messageId);

    shouldStickToBottomRef.current = true;
    await sendMessage(
      { text: input.text },
      { body: { sessionId } },
    );
  }

  function handleAssistantRevealProgress(event: "answer-start" | "text-step" | "table-shell" | "table-ready") {
    const viewport = viewportRef.current;
    const lastMessage = lastMessageRef.current;
    if (!viewport || !lastMessage || !shouldStickToBottomRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollAnalysisThreadForRevealEvent(viewport, lastMessage, event);
    });
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/60 px-5 py-3">
        <h2 className="w-full break-words text-sm font-medium leading-snug whitespace-normal text-foreground">
          {sessionTitle}
        </h2>
      </div>
      <ScrollArea
        className="min-h-0 min-w-0 flex-1"
        viewportRef={viewportRef}
        viewportClassName="[&>div]:!block [&>div]:!w-full"
      >
        <div className="min-w-0 space-y-4 px-5 py-3 pb-24">
          {timelineEntries.length === 0 ? (
            <div className="flex min-h-[calc(100vh-18rem)] items-center justify-center px-6 py-10">
              <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
                <h3 className="font-serif text-3xl tracking-tight text-foreground sm:text-4xl">
                  Start with a grounded question
                </h3>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  Ask for the overall story first, then narrow into a subgroup, banner cut, or question wording when something needs a closer read.
                </p>
              </div>
            </div>
          ) : (
            timelineEntries.map((entry, timelineIndex) => {
              const isLastEntry = timelineIndex === timelineEntries.length - 1;
              if (entry.kind === "compute-job") {
                return (
                  <div key={entry.key} ref={isLastEntry ? lastMessageRef : undefined}>
                    <AnalysisComputeJobCard
                      job={entry.job}
                      onConfirm={onConfirmComputeJob}
                      onCancel={onCancelComputeJob}
                      onContinue={onContinueInDerivedRun}
                      onRevise={setInput}
                    />
                  </div>
                );
              }

              const { message, messageIndex: index } = entry;
              const isLastMessage = index === messages.length - 1;
              const isPendingAssistantShell = isBusy
                && isLastMessage
                && message.role === "assistant"
                && !hasVisibleAnalysisMessageParts(message);
              if (isPendingAssistantShell) {
                return null;
              }

              const shouldShowMessageActions = shouldShowAnalysisMessageActions(messages, index);
              const showFollowUps = shouldShowMessageActions && !isBusy;
              const isPersistedUserMessage = message.role === "user"
                && persistedUserMessageIdSet.has(message.id);
              return (
                <div key={entry.key} ref={isLastEntry ? lastMessageRef : undefined}>
                  <AnalysisMessage
                    message={message}
                    isStreaming={isLastMessage && isBusy}
                    onRevealProgress={isLastMessage && message.role === "assistant"
                      ? handleAssistantRevealProgress
                      : undefined}
                    onSelectFollowUpSuggestion={showFollowUps ? handleFollowUpSuggestion : undefined}
                    feedback={shouldShowMessageActions && persistedAssistantMessageIdSet.has(message.id)
                      ? (messageFeedbackById[message.id] ?? null)
                      : null}
                    onSubmitFeedback={shouldShowMessageActions && persistedAssistantMessageIdSet.has(message.id)
                      ? onSubmitMessageFeedback
                      : undefined}
                    onEditUserMessage={isPersistedUserMessage ? handleEditUserMessage : undefined}
                  />
                </div>
              );
            })
          )}

          {shouldShowPendingState ? <PendingAnalysisMessage /> : null}

          {error && (
            <div className="rounded-2xl border border-tab-rose/30 bg-tab-rose/10 p-4 text-sm text-tab-rose">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">TabulateAI could not finish this answer</p>
                  <p className="mt-1 text-sm/6 text-foreground/80">
                    {error.message}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="relative z-10 -mt-10 shrink-0 px-5 pb-4 pt-8">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-white via-white/88 to-transparent dark:from-card dark:via-card/84" />
        <div className="relative">
          <PromptComposer
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onComputeSubmit={handleComputeSubmit}
            onStop={stop}
            isBusy={isBusy}
            isComputeBusy={isComputePreflightPending}
          />
        </div>
      </div>
    </div>
  );
}
