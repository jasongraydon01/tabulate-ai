"use client";

import { useState, startTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AnalysisEmptyState } from "@/components/analysis/AnalysisEmptyState";
import { AnalysisSessionList } from "@/components/analysis/AnalysisSessionList";
import { AnalysisThread } from "@/components/analysis/AnalysisThread";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { persistedAnalysisMessagesToUIMessages } from "@/lib/analysis/messages";
import { useAuthContext } from "@/providers/auth-provider";

interface AnalysisWorkspaceProps {
  projectId: string;
  projectName: string;
  runId: string;
  runStatus: string;
}

function statusLabel(status: string): string {
  switch (status) {
    case "success":
      return "Complete";
    case "partial":
      return "Partial";
    case "pending_review":
      return "Pending review";
    case "in_progress":
      return "In progress";
    case "resuming":
      return "Resuming";
    case "error":
      return "Error";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "success":
      return "border-tab-teal/30 bg-tab-teal/10 text-tab-teal";
    case "partial":
    case "pending_review":
      return "border-tab-amber/30 bg-tab-amber/10 text-tab-amber";
    case "error":
      return "border-tab-rose/30 bg-tab-rose/10 text-tab-rose";
    default:
      return "border-tab-blue/30 bg-tab-blue/10 text-tab-blue";
  }
}

export function AnalysisWorkspace({
  projectId,
  projectName,
  runId,
  runStatus,
}: AnalysisWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { convexOrgId } = useAuthContext();
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const sessions = useQuery(
    api.analysisSessions.listByRun,
    convexOrgId ? {
      orgId: convexOrgId as Id<"organizations">,
      runId: runId as Id<"runs">,
    } : "skip",
  );

  const sessionIdFromUrl = searchParams.get("sessionId");
  const selectedSession = sessions?.find((session) => String(session._id) === sessionIdFromUrl)
    ?? sessions?.[0]
    ?? null;

  const messages = useQuery(
    api.analysisMessages.listBySession,
    convexOrgId && selectedSession ? {
      orgId: convexOrgId as Id<"organizations">,
      sessionId: selectedSession._id,
    } : "skip",
  );

  const artifacts = useQuery(
    api.analysisArtifacts.listBySession,
    convexOrgId && selectedSession ? {
      orgId: convexOrgId as Id<"organizations">,
      sessionId: selectedSession._id,
    } : "skip",
  );

  async function handleCreateSession() {
    setIsCreatingSession(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/analysis/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; sessionId?: string };
      if (!response.ok || !payload.sessionId) {
        throw new Error(payload.error ?? "Failed to create analysis session");
      }

      startTransition(() => {
        router.replace(`${pathname}?sessionId=${encodeURIComponent(payload.sessionId as string)}`);
      });
      toast.success("Analysis session created");
    } catch (error) {
      toast.error("Failed to create analysis session", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCreatingSession(false);
    }
  }

  function handleSelectSession(sessionId: string) {
    startTransition(() => {
      router.replace(`${pathname}?sessionId=${encodeURIComponent(sessionId)}`);
    });
  }

  return (
    <div className="space-y-6 py-8">
      <div className="space-y-4">
        <AppBreadcrumbs
          segments={[
            { label: "Projects", href: "/dashboard" },
            { label: projectName, href: `/projects/${encodeURIComponent(projectId)}` },
            { label: "Analysis" },
          ]}
        />

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Run-scoped analysis
            </p>
            <h1 className="font-serif text-4xl tracking-tight">Chat with your data</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Analysis sessions are attached to this run so TabulateAI can keep durable history,
              grounded messages, and rendered artifacts in one place.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              Run {runId}
            </Badge>
            <Badge variant="outline" className={statusBadgeClass(runStatus)}>
              {statusLabel(runStatus)}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <AnalysisSessionList
          sessions={(sessions ?? []).map((session) => ({
            _id: String(session._id),
            title: session.title,
            status: session.status,
            createdAt: session.createdAt,
            lastMessageAt: session.lastMessageAt,
          }))}
          selectedSessionId={selectedSession ? String(selectedSession._id) : null}
          isLoading={sessions === undefined}
          isCreating={isCreatingSession}
          onCreateSession={handleCreateSession}
          onSelectSession={handleSelectSession}
        />

        {sessions === undefined ? (
          <Card className="border-border/80 bg-card/90">
            <CardContent className="flex min-h-[420px] items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading analysis workspace...
            </CardContent>
          </Card>
        ) : selectedSession ? (
          messages === undefined || artifacts === undefined ? (
            <Card className="border-border/80 bg-card/90">
              <CardContent className="flex min-h-[420px] items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading session state...
              </CardContent>
            </Card>
          ) : (
            <AnalysisThread
              key={String(selectedSession._id)}
              runId={runId}
              sessionId={String(selectedSession._id)}
              sessionTitle={selectedSession.title}
              initialMessages={persistedAnalysisMessagesToUIMessages(
                messages.map((message) => ({
                  _id: String(message._id),
                  role: message.role,
                  content: message.content,
                  parts: message.parts?.map((part) => ({
                    type: part.type,
                    text: part.text,
                    state: part.state,
                    artifactId: part.artifactId ? String(part.artifactId) : undefined,
                    label: part.label,
                  })),
                })),
                artifacts.map((artifact) => ({
                  _id: String(artifact._id),
                  artifactType: artifact.artifactType,
                  payload: artifact.payload,
                })),
              )}
            />
          )
        ) : (
          <AnalysisEmptyState hasSession={false} />
        )}
      </div>
    </div>
  );
}
