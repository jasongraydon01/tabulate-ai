"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { AlertCircle } from "lucide-react";

import { AnalysisMessage } from "@/components/analysis/AnalysisMessage";
import { PromptComposer } from "@/components/analysis/PromptComposer";
import { GridLoader } from "@/components/ui/grid-loader";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AnalysisThreadProps {
  runId: string;
  sessionId: string;
  sessionTitle: string;
  initialMessages: UIMessage[];
}

export function AnalysisThread({
  runId,
  sessionId,
  initialMessages,
}: AnalysisThreadProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function handleSubmit() {
    const nextInput = input.trim();
    if (!nextInput || isBusy) return;
    setInput("");
    await sendMessage(
      { text: nextInput },
      { body: { sessionId } },
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="min-w-0 space-y-4 px-1 py-2 pb-28">
          {messages.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Ask a question about your data to get started.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <AnalysisMessage key={message.id} message={message} />
            ))
          )}

          {isBusy && (
            <div className="flex w-full justify-start">
              <div className="px-1 py-2">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
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

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white/80 to-transparent px-4 pb-4 pt-10 dark:from-card dark:via-card/80">
        <div className="pointer-events-auto">
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
