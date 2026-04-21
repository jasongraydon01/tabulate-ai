"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { AlertCircle } from "lucide-react";

import { AnalysisMessage } from "@/components/analysis/AnalysisMessage";
import { AnalysisTitleBadge } from "@/components/analysis/AnalysisTitleBadge";
import {
  isAnalysisThreadNearBottom,
  scrollAnalysisThreadToBottom,
  scrollAnalysisThreadToMessageStart,
} from "@/components/analysis/analysisThreadScroll";
import { PromptComposer } from "@/components/analysis/PromptComposer";
import { GridLoader } from "@/components/ui/grid-loader";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AnalysisThreadProps {
  runId: string;
  sessionId: string;
  sessionTitle: string;
  sessionTitleSource: "default" | "generated" | "manual";
  initialMessages: UIMessage[];
}

export function AnalysisThread({
  runId,
  sessionId,
  sessionTitle,
  sessionTitleSource,
  initialMessages,
}: AnalysisThreadProps) {
  const [input, setInput] = useState("");
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(initialMessages.length);
  const shouldStickToBottomRef = useRef(true);
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({
      api: `/api/runs/${encodeURIComponent(runId)}/analysis`,
    }),
    [runId],
  );

  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
  } = useChat<UIMessage>({
    id: sessionId,
    messages: initialMessages,
    transport,
  });

  const isBusy = status === "submitted" || status === "streaming";

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

      if (messages.length > prevMessageCountRef.current && lastMessageRef.current) {
        prevMessageCountRef.current = messages.length;
        if (shouldAutoScroll) {
          scrollAnalysisThreadToMessageStart(viewport, lastMessageRef.current);
        }
        return;
      }

      if (status === "streaming" && shouldStickToBottomRef.current) {
        scrollAnalysisThreadToBottom(viewport, "auto");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, status]);

  async function handleSubmit() {
    const nextInput = input.trim();
    if (!nextInput || isBusy) return;
    setInput("");
    shouldStickToBottomRef.current = true;
    await sendMessage(
      { text: nextInput },
      { body: { sessionId } },
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/60 px-5 py-3">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <h2 className="w-full break-words text-sm font-medium leading-snug whitespace-normal text-foreground">
            {sessionTitle}
          </h2>
          {sessionTitleSource === "generated" ? (
            <AnalysisTitleBadge className="shrink-0" />
          ) : null}
        </div>
      </div>
      <ScrollArea
        className="min-h-0 min-w-0 flex-1"
        viewportRef={viewportRef}
        viewportClassName="[&>div]:!block [&>div]:!w-full"
      >
        <div className="min-w-0 space-y-4 px-5 py-3 pb-24">
          {messages.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Ask a question about your data to get started.
              </p>
            </div>
          ) : (
            messages.map((message, index) => {
              const isLastMessage = index === messages.length - 1;
              return (
                <div key={message.id} ref={isLastMessage ? lastMessageRef : undefined}>
                  <AnalysisMessage
                    message={message}
                    isStreaming={isLastMessage && isBusy}
                  />
                </div>
              );
            })
          )}

          {isBusy && status === "submitted" && (
            <div className="flex w-full justify-start">
              <div className="px-1 py-2">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <GridLoader size="sm" />
                  Thinking...
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-tab-rose/30 bg-tab-rose/10 p-4 text-sm text-tab-rose">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Analysis response failed</p>
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
            onStop={stop}
            isBusy={isBusy}
          />
        </div>
      </div>
    </div>
  );
}
