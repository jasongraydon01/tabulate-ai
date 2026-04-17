import { Database, MessageSquareText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GridLoader } from "@/components/ui/grid-loader";
import { Textarea } from "@/components/ui/textarea";

interface AnalysisEmptyStateProps {
  hasSession: boolean;
  sessionTitle?: string;
  artifactCount?: number;
}

export function AnalysisEmptyState({
  hasSession,
  sessionTitle,
  artifactCount = 0,
}: AnalysisEmptyStateProps) {
  if (!hasSession) {
    return (
      <Card className="border-border/80 bg-card/90 backdrop-blur">
        <CardHeader className="space-y-4">
          <Badge variant="outline" className="w-fit border-tab-blue/30 text-tab-blue">
            Chat with your data
          </Badge>
          <div className="space-y-2">
            <CardTitle className="font-serif text-3xl tracking-tight">
              Start an analysis session for this run
            </CardTitle>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              TabulateAI will keep each session tied to this run so future questions,
              grounded answers, and rendered analysis artifacts stay attached to the same set
              of tabs.
            </p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border/80 bg-muted/30 p-4">
            <Database className="h-5 w-5 text-tab-blue" />
            <p className="mt-3 text-sm font-medium">Run-scoped context</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sessions stay anchored to this specific run and its validated outputs.
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-muted/30 p-4">
            <MessageSquareText className="h-5 w-5 text-tab-teal" />
            <p className="mt-3 text-sm font-medium">Durable history</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Conversation history, messages, and artifacts persist in Convex from the start.
            </p>
          </div>
          <div className="rounded-xl border border-border/80 bg-muted/30 p-4">
            <Sparkles className="h-5 w-5 text-tab-amber" />
            <p className="mt-3 text-sm font-medium">Built to extend</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The session model is ready for live responses, grounded lookup, and rendered results.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border/80 bg-card/90 backdrop-blur">
        <CardHeader className="border-b border-border/80 bg-gradient-to-br from-tab-blue-dim via-transparent to-tab-teal-dim">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="outline" className="w-fit border-tab-teal/30 text-tab-teal">
                Session ready
              </Badge>
              <CardTitle className="font-serif text-3xl tracking-tight">
                {sessionTitle ?? "Analysis session"}
              </CardTitle>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                This thread is ready. Messages, grounded results, and durable analysis artifacts
                will appear here once the chat transport is connected.
              </p>
            </div>
            <div className="hidden rounded-xl border border-border/80 bg-background/70 p-3 text-right md:block">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Artifacts saved
              </p>
              <p className="mt-1 font-mono text-xl">{artifactCount}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
            <GridLoader size="sm" />
            Live assistant responses are not connected yet. Session persistence and run selection
            are already in place.
          </div>

          <div className="rounded-2xl border border-border/80 bg-background/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Prompt composer</p>
              <Badge variant="secondary">Coming next</Badge>
            </div>
            <Textarea
              value=""
              readOnly
              disabled
              className="min-h-28 resize-none border-border/80 bg-muted/20"
              placeholder="Ask about key findings, subgroup differences, bases, or table structure..."
            />
            <div className="mt-3 flex justify-end">
              <Button disabled>Send</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
