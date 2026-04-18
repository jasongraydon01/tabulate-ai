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
import { persistedAnalysisMessagesToUIMessages } from "@/lib/analysis/messages";
import { useAuthContext } from "@/providers/auth-provider";

interface AnalysisWorkspaceProps {
  projectId: string;
  projectName: string;
  runId: string;
  runStatus: string;
}

export function AnalysisWorkspace({
  projectId,
  projectName,
  runId,
}: AnalysisWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { convexOrgId } = useAuthContext();
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
      toast.success("Chat created");
    } catch (error) {
      toast.error("Failed to create chat", {
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

  function renderThreadContent() {
    if (sessions === undefined) {
      return (
        <div className="flex min-h-[520px] items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      );
    }

    if (!selectedSession) {
      return <AnalysisEmptyState hasSession={false} />;
    }

    if (messages === undefined || artifacts === undefined) {
      return (
        <div className="flex min-h-[520px] items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      );
    }

    return (
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
    );
  }

  return (
    <div className="space-y-4 py-6">
      <AppBreadcrumbs
        segments={[
          { label: "Projects", href: "/dashboard" },
          { label: projectName, href: `/projects/${encodeURIComponent(projectId)}` },
          { label: "Analysis" },
        ]}
      />

      <div className="flex min-h-[700px] overflow-hidden rounded-xl border border-border/70 bg-white dark:bg-card">
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
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((open) => !open)}
          onCreateSession={handleCreateSession}
          onSelectSession={handleSelectSession}
        />

        <div className="flex min-w-0 flex-1 flex-col p-4">
          {renderThreadContent()}
        </div>
      </div>
    </div>
  );
}
