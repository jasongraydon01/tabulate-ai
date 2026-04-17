import { Database, MessageSquareText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AnalysisEmptyStateProps {
  hasSession: boolean;
}

export function AnalysisEmptyState({
  hasSession,
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
  return null;
}
