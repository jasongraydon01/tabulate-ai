"use client";

import { useMemo, useState, startTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AnalysisEmptyState } from "@/components/analysis/AnalysisEmptyState";
import { AnalysisRouteSidebarCollapse } from "@/components/analysis/AnalysisRouteSidebarCollapse";
import { AnalysisSessionList } from "@/components/analysis/AnalysisSessionList";
import { AnalysisThread } from "@/components/analysis/AnalysisThread";
import {
  normalizePersistedAnalysisArtifactRecord,
  normalizePersistedAnalysisMessageRecord,
  persistedAnalysisMessagesToUIMessages,
} from "@/lib/analysis/messages";
import type { AnalysisComputeJobView } from "@/lib/analysis/computeLane/jobView";
import type { AnalysisMessageFeedbackRecord, AnalysisMessageFeedbackVote } from "@/lib/analysis/types";
import { useAuthContext } from "@/providers/auth-provider";

interface AnalysisWorkspaceProps {
  projectId: string;
  projectName: string;
  runId: string;
  runStatus: string;
}

function isDerivedTableJob(job: AnalysisComputeJobView): boolean {
  return job.jobType === "table_rollup_derivation" || job.jobType === "selected_table_cut_derivation";
}

export function AnalysisWorkspace({
  projectId,
  projectName,
  runId,
}: AnalysisWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { convexOrgId, convexUserId } = useAuthContext();
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
  const hasSessions = (sessions?.length ?? 0) > 0;

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

  const feedback = useQuery(
    api.analysisMessageFeedback.listBySessionForUser,
    convexOrgId && convexUserId && selectedSession ? {
      orgId: convexOrgId as Id<"organizations">,
      sessionId: selectedSession._id,
      userId: convexUserId as Id<"users">,
    } : "skip",
  );

  const computeJobs = useQuery(
    api.analysisComputeJobs.listForSession,
    convexOrgId && selectedSession ? {
      orgId: convexOrgId as Id<"organizations">,
      sessionId: selectedSession._id,
      parentRunId: runId as Id<"runs">,
    } : "skip",
  );

  const feedbackByMessageId = Object.fromEntries(
    (feedback ?? []).map((entry) => [
      String(entry.messageId),
      {
        messageId: String(entry.messageId),
        vote: entry.vote,
        correctionText: entry.correctionText ?? null,
        updatedAt: entry.updatedAt,
      } satisfies AnalysisMessageFeedbackRecord,
    ]),
  ) as Record<string, AnalysisMessageFeedbackRecord>;

  // Convex-authoritative message ids in order. Handed down so the thread
  // can reconcile useChat's client-generated message ids against the real
  // Convex ids once a turn persists — otherwise the edit icon never shows
  // on messages sent in the current session (they only match by id after
  // a page reload).
  const persistedMessageIdsInOrder = useMemo(
    () => (messages ?? []).map((message) => String(message._id)),
    [messages],
  );
  const persistedUIMessages = useMemo(
    () => persistedAnalysisMessagesToUIMessages(
      (messages ?? []).map((message) => normalizePersistedAnalysisMessageRecord(message)),
      (artifacts ?? []).map((artifact) => normalizePersistedAnalysisArtifactRecord(artifact)),
    ),
    [artifacts, messages],
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

  async function handleRenameSession(sessionId: string, title: string) {
    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/analysis/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      },
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to rename analysis session");
    }

    toast.success("Chat renamed");
  }

  async function handleDeleteSession(sessionId: string) {
    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/analysis/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
      },
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to delete analysis session");
    }

    const remainingSessions = (sessions ?? []).filter((session) => String(session._id) !== sessionId);
    const nextSessionId = remainingSessions[0] ? String(remainingSessions[0]._id) : null;
    startTransition(() => {
      router.replace(nextSessionId ? `${pathname}?sessionId=${encodeURIComponent(nextSessionId)}` : pathname);
    });
    toast.success("Chat deleted");
  }

  async function handleSubmitMessageFeedback(input: {
    messageId: string;
    vote: AnalysisMessageFeedbackVote;
    correctionText?: string | null;
  }) {
    if (!selectedSession) {
      throw new Error("No active analysis session");
    }

    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/analysis/messages/${encodeURIComponent(input.messageId)}/feedback`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: String(selectedSession._id),
          vote: input.vote,
          correctionText: input.correctionText ?? "",
        }),
      },
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to save message feedback");
    }
  }

  async function handleTruncateFromMessage(messageId: string) {
    if (!selectedSession) {
      throw new Error("No active analysis session");
    }

    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/analysis/messages/${encodeURIComponent(messageId)}/truncate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: String(selectedSession._id),
        }),
      },
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to edit message");
    }
  }

  async function handleStartComputePreflight(requestText: string, clientTurnId: string) {
    if (!selectedSession) {
      throw new Error("No active analysis session");
    }

    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/analysis/compute/preflight`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: String(selectedSession._id),
        requestText,
        clientTurnId,
      }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to prepare derived run");
    }

    toast.success("Derived run proposal created");
  }

  async function handleConfirmComputeJob(job: AnalysisComputeJobView) {
    if (!job.confirmToken) {
      throw new Error("This proposed group is not ready to confirm");
    }

    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/analysis/compute/jobs/${encodeURIComponent(job.id)}/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fingerprint: job.confirmToken }),
      },
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to queue derived run");
    }

    toast.success(isDerivedTableJob(job) ? "Derived table queued" : "Derived run queued");
  }

  async function handleCancelComputeJob(job: AnalysisComputeJobView) {
    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/analysis/compute/jobs/${encodeURIComponent(job.id)}/cancel`,
      { method: "POST" },
    );
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to cancel derived run");
    }

    toast.success(isDerivedTableJob(job) ? "Derived table cancelled" : "Derived run cancelled");
  }

  async function handleContinueInDerivedRun(job: AnalysisComputeJobView) {
    if (!job.childRun) {
      throw new Error("Derived run is not available yet");
    }

    if (job.childRun.analysisSessionId) {
      router.push(`${job.childRun.analysisUrl}?sessionId=${encodeURIComponent(job.childRun.analysisSessionId)}`);
      return;
    }

    const response = await fetch(`/api/runs/${encodeURIComponent(job.childRun.id)}/analysis/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Derived run analysis" }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; sessionId?: string };
    if (!response.ok || !payload.sessionId) {
      throw new Error(payload.error ?? "Failed to create derived run chat");
    }

    router.push(`${job.childRun.analysisUrl}?sessionId=${encodeURIComponent(payload.sessionId)}`);
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
      return (
        <AnalysisEmptyState
          onCreateSession={handleCreateSession}
          isCreating={isCreatingSession}
        />
      );
    }

    if (
      messages === undefined
      || artifacts === undefined
      || computeJobs === undefined
      || (convexUserId && feedback === undefined)
    ) {
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
        computeJobs={(computeJobs ?? []) as AnalysisComputeJobView[]}
        persistedMessages={persistedUIMessages}
        persistedMessageCreatedAtById={Object.fromEntries(
          (messages ?? []).map((message) => [String(message._id), message.createdAt]),
        )}
        persistedAssistantMessageIds={messages
          .filter((message) => message.role === "assistant")
          .map((message) => String(message._id))}
        persistedUserMessageIds={messages
          .filter((message) => message.role === "user")
          .map((message) => String(message._id))}
        persistedMessageIdsInOrder={persistedMessageIdsInOrder}
        messageFeedbackById={feedbackByMessageId}
        onSubmitMessageFeedback={async (input) => {
          try {
            await handleSubmitMessageFeedback(input);
          } catch (error) {
            toast.error("Failed to save feedback", {
              description: error instanceof Error ? error.message : "Unknown error",
            });
            throw error;
          }
        }}
        onTruncateFromMessage={async (messageId) => {
          try {
            await handleTruncateFromMessage(messageId);
          } catch (error) {
            toast.error("Failed to edit message", {
              description: error instanceof Error ? error.message : "Unknown error",
            });
            throw error;
          }
        }}
        onStartComputePreflight={async (requestText, clientTurnId) => {
          try {
            await handleStartComputePreflight(requestText, clientTurnId);
          } catch (error) {
            toast.error("Failed to prepare derived run", {
              description: error instanceof Error ? error.message : "Unknown error",
            });
            throw error;
          }
        }}
        onConfirmComputeJob={async (job) => {
          try {
            await handleConfirmComputeJob(job);
          } catch (error) {
            toast.error(isDerivedTableJob(job) ? "Failed to queue derived table" : "Failed to queue derived run", {
              description: error instanceof Error ? error.message : "Unknown error",
            });
            throw error;
          }
        }}
        onCancelComputeJob={async (job) => {
          try {
            await handleCancelComputeJob(job);
          } catch (error) {
            toast.error(isDerivedTableJob(job) ? "Failed to cancel derived table" : "Failed to cancel derived run", {
              description: error instanceof Error ? error.message : "Unknown error",
            });
            throw error;
          }
        }}
        onContinueInDerivedRun={async (job) => {
          try {
            await handleContinueInDerivedRun(job);
          } catch (error) {
            toast.error("Failed to open derived run", {
              description: error instanceof Error ? error.message : "Unknown error",
            });
            throw error;
          }
        }}
        initialMessages={persistedUIMessages}
      />
    );
  }

  return (
    <div className="space-y-2 py-2">
      <AnalysisRouteSidebarCollapse />

      <AppBreadcrumbs
        segments={[
          { label: "Projects", href: "/dashboard" },
          { label: projectName, href: `/projects/${encodeURIComponent(projectId)}` },
          { label: "Analysis" },
        ]}
      />

      {hasSessions ? (
        <div className="flex overflow-hidden rounded-xl border border-border/70 bg-white dark:bg-card" style={{ height: "calc(100vh - 10rem)" }}>
          <AnalysisSessionList
            sessions={(sessions ?? []).map((session) => ({
              _id: String(session._id),
              title: session.title,
              titleSource: session.titleSource,
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
            onRenameSession={async (sessionId, title) => {
              try {
                await handleRenameSession(sessionId, title);
              } catch (error) {
                toast.error("Failed to rename chat", {
                  description: error instanceof Error ? error.message : "Unknown error",
                });
                throw error;
              }
            }}
            onDeleteSession={async (sessionId) => {
              try {
                await handleDeleteSession(sessionId);
              } catch (error) {
                toast.error("Failed to delete chat", {
                  description: error instanceof Error ? error.message : "Unknown error",
                });
                throw error;
              }
            }}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {renderThreadContent()}
          </div>
        </div>
      ) : (
        renderThreadContent()
      )}
    </div>
  );
}
