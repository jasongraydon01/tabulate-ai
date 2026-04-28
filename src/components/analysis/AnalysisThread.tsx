"use client";

import { useEffect, useMemo, useState } from "react";
import { DefaultChatTransport, isDataUIPart } from "ai";
import { useChat } from "@ai-sdk/react";
import { AlertCircle } from "lucide-react";

import { AnalysisComputeJobCard } from "@/components/analysis/AnalysisComputeJobCard";
import {
  AnalysisConversationShell,
  getNextAnalysisConversationScrollRequestKey,
} from "@/components/analysis/AnalysisConversationShell";
import { AnalysisMessage } from "@/components/analysis/AnalysisMessage";
import { AnalysisWorkDisclosure } from "@/components/analysis/AnalysisWorkDisclosure";
import { PromptComposer } from "@/components/analysis/PromptComposer";
import type { AnalysisComputeJobView } from "@/lib/analysis/computeLane/jobView";
import { getAnalysisMessageMetadata } from "@/lib/analysis/messages";
import {
  isAnalysisCiteDataUIPart,
  isAnalysisRenderDataUIPart,
  isAnalysisStatusDataUIPart,
  type AnalysisUIMessage,
} from "@/lib/analysis/ui";
import { getAnalysisToolActivityLabel } from "@/lib/analysis/toolLabels";
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
  onStartComputePreflight: (requestText: string, clientTurnId: string) => Promise<void>;
  onConfirmComputeJob: (job: AnalysisComputeJobView) => Promise<void>;
  onCancelComputeJob: (job: AnalysisComputeJobView) => Promise<void>;
  onContinueInDerivedRun: (job: AnalysisComputeJobView) => Promise<void>;
}

type AnalysisTimelineEntry =
  | { kind: "message"; key: string; createdAt: number; message: AnalysisUIMessage; messageIndex: number }
  | { kind: "compute-job"; key: string; createdAt: number; job: AnalysisComputeJobView };
type AnalysisMessageTimelineEntry = Extract<AnalysisTimelineEntry, { kind: "message" }>;
type AnalysisComputeJobTimelineEntry = Extract<AnalysisTimelineEntry, { kind: "compute-job" }>;

function createClientTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `turn-${crypto.randomUUID()}`;
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getMessageClientTurnId(message: AnalysisUIMessage): string | null {
  return getAnalysisMessageMetadata(message)?.clientTurnId ?? null;
}

function getMessagePersistedId(message: AnalysisUIMessage): string {
  return getAnalysisMessageMetadata(message)?.persistedMessageId ?? message.id;
}

export function buildAnalysisTimelineEntries(params: {
  messages: AnalysisUIMessage[];
  computeJobs: AnalysisComputeJobView[];
  messageCreatedAtById: Record<string, number>;
}): AnalysisTimelineEntry[] {
  const liveBase = Number.MAX_SAFE_INTEGER - params.messages.length - params.computeJobs.length - 1;
  const messageEntries = params.messages.map((message, messageIndex): AnalysisMessageTimelineEntry => ({
      kind: "message",
      key: `message-${message.id}`,
      createdAt: params.messageCreatedAtById[message.id] ?? liveBase + messageIndex,
      message,
      messageIndex,
  }));
  const messageByPersistedId = new Map(
    messageEntries.map((entry) => [getMessagePersistedId(entry.message), entry] as const),
  );
  const turnIdByMessageKey = new Map<string, string>();
  let activeTurnId: string | null = null;
  let syntheticTurnIndex = 0;

  for (const entry of messageEntries) {
    const explicitTurnId = getMessageClientTurnId(entry.message);
    if (entry.message.role === "user") {
      activeTurnId = explicitTurnId ?? `legacy-turn-${syntheticTurnIndex}`;
      syntheticTurnIndex += explicitTurnId ? 0 : 1;
    } else if (explicitTurnId) {
      activeTurnId = explicitTurnId;
    } else if (!activeTurnId) {
      activeTurnId = `legacy-turn-${syntheticTurnIndex}`;
      syntheticTurnIndex += 1;
    }
    turnIdByMessageKey.set(entry.key, activeTurnId);
  }
  const knownTurnIds = new Set(turnIdByMessageKey.values());

  const computeEntries = params.computeJobs.map((job): AnalysisComputeJobTimelineEntry => ({
      kind: "compute-job",
      key: `compute-job-${job.id}`,
      createdAt: job.createdAt,
      job,
  }));

  const jobsByTurnId = new Map<string, AnalysisComputeJobTimelineEntry[]>();
  const jobsByMessageKey = new Map<string, AnalysisComputeJobTimelineEntry[]>();
  const legacyJobs: AnalysisComputeJobTimelineEntry[] = [];

  function pushJob(turnId: string, jobEntry: AnalysisComputeJobTimelineEntry) {
    const jobs = jobsByTurnId.get(turnId) ?? [];
    jobs.push(jobEntry);
    jobsByTurnId.set(turnId, jobs);
  }

  function pushMessageJob(messageKey: string, jobEntry: AnalysisComputeJobTimelineEntry) {
    const jobs = jobsByMessageKey.get(messageKey) ?? [];
    jobs.push(jobEntry);
    jobsByMessageKey.set(messageKey, jobs);
  }

  for (const jobEntry of computeEntries) {
    const job = jobEntry.job;
    if (job.originAssistantMessageId) {
      const assistantEntry = messageByPersistedId.get(job.originAssistantMessageId);
      if (assistantEntry) {
        pushMessageJob(assistantEntry.key, jobEntry);
      }
      continue;
    }
    if (job.originUserMessageId) {
      const userEntry = messageByPersistedId.get(job.originUserMessageId);
      if (userEntry) {
        pushMessageJob(userEntry.key, jobEntry);
      }
      continue;
    }
    if (job.originClientTurnId) {
      if (knownTurnIds.has(job.originClientTurnId)) {
        pushJob(job.originClientTurnId, jobEntry);
      }
      continue;
    }
    legacyJobs.push(jobEntry);
  }

  for (const jobEntry of legacyJobs) {
    const previousMessage = [...messageEntries]
      .filter((entry) => entry.createdAt <= jobEntry.createdAt)
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    const fallbackTurnId = previousMessage ? turnIdByMessageKey.get(previousMessage.key) : null;
    if (fallbackTurnId) {
      pushJob(fallbackTurnId, jobEntry);
    } else {
      pushJob(`legacy-orphan-${jobEntry.key}`, jobEntry);
    }
  }

  const output: AnalysisTimelineEntry[] = [];
  const emittedTurnJobs = new Set<string>();
  const entriesByTurnId = new Map<string, AnalysisMessageTimelineEntry[]>();
  for (const entry of messageEntries) {
    const turnId = turnIdByMessageKey.get(entry.key);
    if (!turnId) continue;
    const entries = entriesByTurnId.get(turnId) ?? [];
    entries.push(entry);
    entriesByTurnId.set(turnId, entries);
  }

  for (const entry of messageEntries) {
    output.push(entry);
    const messageJobs = (jobsByMessageKey.get(entry.key) ?? [])
      .sort((left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key));
    output.push(...messageJobs);

    const turnId = turnIdByMessageKey.get(entry.key);
    if (!turnId || emittedTurnJobs.has(turnId)) continue;

    const turnEntries = entriesByTurnId.get(turnId) ?? [];
    const lastMessageForTurn = turnEntries[turnEntries.length - 1];
    if (lastMessageForTurn?.key !== entry.key) continue;

    const jobs = (jobsByTurnId.get(turnId) ?? [])
      .sort((left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key));
    output.push(...jobs);
    emittedTurnJobs.add(turnId);
  }

  for (const [turnId, jobs] of jobsByTurnId.entries()) {
    if (emittedTurnJobs.has(turnId)) continue;
    output.push(...jobs.sort((left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key)));
  }

  return output;
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

export function shouldRenderAnalysisComputeJobInAssistantTurnFooter(
  entries: AnalysisTimelineEntry[],
  entryIndex: number,
): boolean {
  const entry = entries[entryIndex];
  if (entry?.kind !== "compute-job") {
    return false;
  }

  for (let index = entryIndex - 1; index >= 0; index -= 1) {
    const previousEntry = entries[index];
    if (!previousEntry) return false;
    if (previousEntry.kind === "compute-job") continue;
    return previousEntry.message.role === "assistant";
  }

  return false;
}

export function getAnalysisAssistantTurnFooterJobs(
  entries: AnalysisTimelineEntry[],
  entryIndex: number,
): AnalysisComputeJobTimelineEntry[] {
  const entry = entries[entryIndex];
  if (entry?.kind !== "message" || entry.message.role !== "assistant") {
    return [];
  }

  const jobs: AnalysisComputeJobTimelineEntry[] = [];
  for (let index = entryIndex + 1; index < entries.length; index += 1) {
    const nextEntry = entries[index];
    if (nextEntry?.kind !== "compute-job") break;
    if (!shouldRenderAnalysisComputeJobInAssistantTurnFooter(entries, index)) break;
    jobs.push(nextEntry);
  }

  return jobs;
}

export function hasVisibleAnalysisMessageParts(message: AnalysisUIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return part.text.trim().length > 0;
    }

    if (isDataUIPart(part)) {
      return isAnalysisStatusDataUIPart(part)
        || isAnalysisRenderDataUIPart(part)
        || isAnalysisCiteDataUIPart(part);
    }

    return Boolean(getAnalysisToolActivityLabel(part.type));
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
  const summaryLabel = "TabulateAI is reading the run artifacts...";

  return (
    <div className="flex w-full justify-start">
      <AnalysisWorkDisclosure
        entries={[]}
        statusLabel={summaryLabel}
        isOpen={false}
        onOpenChange={() => {}}
        showLoader
      />
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
  const [scrollRequestKey, setScrollRequestKey] = useState(0);
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
      if (current.length < persistedMessages.length) return persistedMessages;
      if (current.length !== persistedMessages.length) return current;

      const currentSnapshot = JSON.stringify(current);
      const persistedSnapshot = JSON.stringify(persistedMessages);
      if (currentSnapshot === persistedSnapshot) {
        return current;
      }

      return current;
    });
  }, [persistedMessageIdsInOrder, persistedMessages, setMessages, status]);

  function requestScrollToLatest() {
    setScrollRequestKey((current) => getNextAnalysisConversationScrollRequestKey(current));
  }

  async function handleSubmit() {
    const nextInput = input.trim();
    if (!nextInput || isBusy || isComputePreflightPending) return;
    const clientTurnId = createClientTurnId();
    setInput("");
    requestScrollToLatest();
    await sendMessage(
      {
        text: nextInput,
        metadata: {
          clientTurnId,
        },
      },
      { body: { sessionId, clientTurnId } },
    );
  }

  async function handleComputeSubmit() {
    const nextInput = input.trim();
    if (!nextInput || isBusy || isComputePreflightPending) return;

    setIsComputePreflightPending(true);
    requestScrollToLatest();
    const clientTurnId = createClientTurnId();
    try {
      await onStartComputePreflight(nextInput, clientTurnId);
      setInput("");
    } finally {
      setIsComputePreflightPending(false);
    }
  }

  async function handleFollowUpSuggestion(suggestion: string) {
    const nextSuggestion = suggestion.trim();
    if (!nextSuggestion || isBusy) return;

    const clientTurnId = createClientTurnId();
    requestScrollToLatest();
    await sendMessage(
      {
        text: nextSuggestion,
        metadata: {
          clientTurnId,
        },
      },
      { body: { sessionId, clientTurnId } },
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

    requestScrollToLatest();
    const clientTurnId = createClientTurnId();
    await sendMessage(
      {
        text: input.text,
        metadata: {
          clientTurnId,
        },
      },
      { body: { sessionId, clientTurnId } },
    );
  }

  function resolvePersistedMessageId(message: AnalysisUIMessage, messageIndex: number): string | null {
    const metadataPersistedId = getAnalysisMessageMetadata(message)?.persistedMessageId;
    if (metadataPersistedId) return metadataPersistedId;
    if (message.role === "assistant" && persistedAssistantMessageIdSet.has(message.id)) return message.id;
    if (message.role === "user" && persistedUserMessageIdSet.has(message.id)) return message.id;

    const persistedAtIndex = persistedMessages[messageIndex];
    if (persistedAtIndex?.role === message.role) {
      return persistedAtIndex.id;
    }

    return null;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/60 px-5 py-3">
        <h2 className="w-full break-words text-sm font-medium leading-snug whitespace-normal text-foreground">
          {sessionTitle}
        </h2>
      </div>
      <AnalysisConversationShell
        scrollRequestKey={scrollRequestKey}
        composer={(
          <PromptComposer
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onComputeSubmit={handleComputeSubmit}
            onStop={stop}
            isBusy={isBusy}
            isComputeBusy={isComputePreflightPending}
          />
        )}
      >
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
            timelineEntries.map((entry, entryIndex) => {
              if (entry.kind === "compute-job") {
                if (shouldRenderAnalysisComputeJobInAssistantTurnFooter(timelineEntries, entryIndex)) {
                  return null;
                }

                return (
                  <div key={entry.key}>
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
              const persistedMessageId = resolvePersistedMessageId(message, index);
              const isPersistedAssistantMessage = message.role === "assistant" && Boolean(persistedMessageId);
              const isPersistedUserMessage = message.role === "user" && Boolean(persistedMessageId);
              const footerJobs = getAnalysisAssistantTurnFooterJobs(timelineEntries, entryIndex);
              return (
                <div key={entry.key}>
                  <AnalysisMessage
                    message={message}
                    isStreaming={isLastMessage && isBusy}
                    onSelectFollowUpSuggestion={showFollowUps ? handleFollowUpSuggestion : undefined}
                    composerHasDraft={input.trim().length > 0}
                    feedback={shouldShowMessageActions && isPersistedAssistantMessage && persistedMessageId
                      ? (messageFeedbackById[persistedMessageId] ?? null)
                      : null}
                    onSubmitFeedback={shouldShowMessageActions && isPersistedAssistantMessage
                      ? onSubmitMessageFeedback
                      : undefined}
                    onEditUserMessage={isPersistedUserMessage && persistedMessageId
                      ? (input) => handleEditUserMessage({ ...input, messageId: persistedMessageId })
                      : undefined}
                    persistedMessageId={persistedMessageId}
                    turnArtifacts={footerJobs.length > 0 ? footerJobs.map((jobEntry) => (
                      <AnalysisComputeJobCard
                        key={jobEntry.key}
                        job={jobEntry.job}
                        onConfirm={onConfirmComputeJob}
                        onCancel={onCancelComputeJob}
                        onContinue={onContinueInDerivedRun}
                        onRevise={setInput}
                      />
                    )) : null}
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
      </AnalysisConversationShell>
    </div>
  );
}
