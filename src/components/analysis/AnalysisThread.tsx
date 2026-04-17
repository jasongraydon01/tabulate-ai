"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { AlertCircle } from "lucide-react";

import { AnalysisMessage } from "@/components/analysis/AnalysisMessage";
import { PromptComposer } from "@/components/analysis/PromptComposer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  sessionTitle,
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
    <div className="flex min-h-[680px] flex-col gap-4">
      <Card className="border-border/80 bg-card/90">
        <CardHeader className="border-b border-border/80">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="font-serif text-2xl tracking-tight">
                {sessionTitle}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Persistent conversation for this run with grounded lookup against the published artifacts.
              </p>
            </div>
            <Badge variant="outline" className="font-mono">
              {messages.length} {messages.length === 1 ? "message" : "messages"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[520px]">
            <div className="space-y-4 p-6">
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6">
                  <Badge variant="outline" className="mb-3 border-tab-blue/30 text-tab-blue">
                    New session
                  </Badge>
                  <h2 className="font-serif text-2xl tracking-tight">
                    Start the conversation
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Ask for interpretation help, how to approach a subgroup cut, how to explain a finding,
                    or how to frame the next analytical question for this run.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <AnalysisMessage key={message.id} message={message} />
                ))
              )}

              {isBusy && (
                <div className="flex w-full justify-start">
                  <div className="rounded-2xl border border-border/80 bg-card/80 px-4 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
                        TabulateAI
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <GridLoader size="sm" />
                      Thinking through the response...
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
        </CardContent>
      </Card>

      <PromptComposer
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        isBusy={isBusy}
      />
    </div>
  );
}
