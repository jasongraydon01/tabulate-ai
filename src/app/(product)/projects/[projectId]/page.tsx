'use client';

import React, { useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import posthog from 'posthog-js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { PipelineTimeline } from '@/components/pipeline-timeline';
// TODO: PipelineDecisions and TableLabelsEditor are ready but not yet wired into the page layout.
// import { PipelineDecisions } from '@/components/PipelineDecisions';
// import { TableLabelsEditor } from '@/components/TableLabelsEditor';
import { ExportSection } from '@/components/ExportSection';
import { ReviewVerification } from '@/components/ReviewVerification';
import { LoadingTimeoutFallback } from '@/components/ErrorFallback';
import { useAuthContext } from '@/providers/auth-provider';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { canPerform } from '@/lib/permissions';
import {
  getCheckpointRetryAvailability,
  getCheckpointRetryLabel,
  isCheckpointRetryEnabled,
} from '@/lib/runs/checkpointRetry';
import { parseRunResult } from '@/schemas/runResultSchema';
import {
  deriveMethodologyFromLegacy,
  ProjectConfigSchema,
  type ProjectConfig,
} from '@/schemas/projectConfigSchema';
import { formatDuration } from '@/lib/utils/formatDuration';
import {
  CheckCircle,
  AlertCircle,
  Clock,
  Copy,
  FileText,
  Loader2,
  Table,
  BarChart3,
  Layers,
  Play,
  XCircle,
  MessageSquare,
  X,
  Settings2,
  Trash2,
} from 'lucide-react';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { GridLoader } from '@/components/ui/grid-loader';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';

function formatDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}


function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return (
        <Badge variant="secondary" className="bg-tab-teal/10 text-tab-teal">
          <CheckCircle className="h-3 w-3 mr-1" />
          Complete
        </Badge>
      );
    case 'partial':
      return (
        <Badge variant="secondary" className="bg-tab-amber/10 text-tab-amber">
          <AlertCircle className="h-3 w-3 mr-1" />
          Partial
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="secondary" className="bg-tab-rose/10 text-tab-rose">
          <AlertCircle className="h-3 w-3 mr-1" />
          Error
        </Badge>
      );
    case 'in_progress':
    case 'resuming':
      return (
        <Badge variant="secondary" className="bg-tab-blue/10 text-tab-blue">
          <Clock className="h-3 w-3 mr-1" />
          In Progress
        </Badge>
      );
    case 'pending_review':
      return (
        <Badge variant="secondary" className="bg-tab-amber/10 text-tab-amber">
          Review Required
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          Cancelled
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="bg-tab-blue/10 text-tab-blue">
          <Clock className="h-3 w-3 mr-1" />
          Processing
        </Badge>
      );
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

interface ProjectIntakeSummary {
  dataFile?: string | null;
  bannerPlan?: string | null;
  survey?: string | null;
  messageList?: string | null;
}

interface ConfigEntry {
  key: string;
  label: string;
  value: unknown;
}

interface ConfigSection {
  key: string;
  title: string;
  entries: ConfigEntry[];
}

function buildConfigSections(
  config: ProjectConfig,
  intake?: ProjectIntakeSummary,
): ConfigSection[] {
  const { studyMethodology, analysisMethod } = deriveMethodologyFromLegacy(config);
  const sections: ConfigSection[] = [
    {
      key: 'project',
      title: 'Project',
      entries: [
        {
          key: 'studyMethodology',
          label: 'Study Methodology',
          value: formatMethodologyLabel(studyMethodology),
        },
        {
          key: 'analysisMethod',
          label: 'Analysis Method',
          value: formatAnalysisMethodLabel(analysisMethod),
        },
        {
          key: 'waveStudy',
          label: 'Wave Study',
          value: config.isWaveStudy ? 'Yes' : 'No',
        },
        {
          key: 'bannerMode',
          label: 'Banner Source',
          value: formatBannerModeLabel(config.bannerMode),
        },
      ],
    },
    {
      key: 'files',
      title: 'Files',
      entries: [
        {
          key: 'dataFile',
          label: 'Data File',
          value: formatFileLabel(intake?.dataFile),
        },
        {
          key: 'survey',
          label: 'Survey Instrument',
          value: formatFileLabel(intake?.survey),
        },
        {
          key: 'bannerPlan',
          label: 'Banner Plan',
          value: config.bannerMode === 'auto_generate'
            ? 'Auto-generated during planning'
            : formatFileLabel(intake?.bannerPlan),
        },
        {
          key: 'messageList',
          label: 'Message List',
          value: formatFileLabel(intake?.messageList),
        },
      ],
    },
    {
      key: 'analysis',
      title: 'Analysis',
      entries: [
        {
          key: 'displayMode',
          label: 'Display Mode',
          value: formatDisplayModeLabel(config.displayMode),
        },
        {
          key: 'theme',
          label: 'Excel Theme',
          value: config.theme,
        },
        {
          key: 'statTesting',
          label: 'Stat Testing',
          value: formatStatTestingValue(config),
        },
        {
          key: 'weightVariable',
          label: 'Weight Variable',
          value: config.weightVariable || 'Not applied',
        },
        {
          key: 'loopStatTestingMode',
          label: 'Loop Stat Testing',
          value: config.loopStatTestingMode
            ? formatLoopStatTestingLabel(config.loopStatTestingMode)
            : 'Default handling',
        },
        {
          key: 'separateWorkbooks',
          label: 'Separate Workbooks',
          value: config.separateWorkbooks ? 'Yes' : 'No',
        },
        {
          key: 'hideExcludedTables',
          label: 'Hide Excluded Tables',
          value: config.hideExcludedTables ? 'Yes' : 'No',
        },
      ],
    },
    {
      key: 'export',
      title: 'Export',
      entries: [
        {
          key: 'exportFormats',
          label: 'Export Formats',
          value: (config.exportFormats ?? ['excel']).map(formatExportFormatLabel).join(', '),
        },
        {
          key: 'wincrossProfileId',
          label: 'WinCross Profile',
          value: config.wincrossProfileId || 'Default profile',
        },
      ],
    },
  ];
  return sections.filter((section) => section.entries.length > 0);
}

function formatStatTestingValue(config: ProjectConfig): string {
  const thresholds = config.statTesting.thresholds?.join(', ') ?? '90';
  const parts = [`${thresholds}% confidence`];
  if (config.statTesting.minBase > 0) parts.push(`min base ${config.statTesting.minBase}`);
  return parts.join(', ');
}

function formatMethodologyLabel(value: string): string {
  switch (value) {
    case 'message_testing':
      return 'Message Testing';
    case 'concept_testing':
      return 'Concept Testing';
    case 'segmentation':
      return 'Segmentation';
    default:
      return 'Standard';
  }
}

function formatAnalysisMethodLabel(value: string): string {
  return value === 'maxdiff' ? 'MaxDiff' : 'Standard Crosstab';
}

function formatBannerModeLabel(value: ProjectConfig['bannerMode']): string {
  return value === 'auto_generate' ? 'Auto-generated' : 'Uploaded banner plan';
}

function formatDisplayModeLabel(value: ProjectConfig['displayMode']): string {
  switch (value) {
    case 'frequency':
      return 'Percentages';
    case 'counts':
      return 'Counts';
    default:
      return 'Counts and percentages';
  }
}

function formatExportFormatLabel(value: string): string {
  switch (value) {
    case 'q':
      return 'Q';
    case 'wincross':
      return 'WinCross';
    default:
      return 'Excel';
  }
}

function formatLoopStatTestingLabel(value: NonNullable<ProjectConfig['loopStatTestingMode']>): string {
  return value === 'suppress' ? 'Suppress duplicate tests' : 'Complement main tests';
}

function formatFileLabel(value: string | null | undefined): string {
  if (!value) return 'Not provided';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function buildRunArtifactDebugPath(
  orgId: string,
  projectId: string,
  runId: string,
): string {
  return `${orgId}/${projectId}/runs/${runId}`;
}

function ConfigValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">Not set</span>;
  }
  if (typeof value === 'boolean') {
    return <span>{value ? 'Yes' : 'No'}</span>;
  }
  return <span className="text-sm leading-5 break-words">{String(value)}</span>;
}

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const { role, convexOrgId } = useAuthContext();
  const canCancel = canPerform(role, 'cancel_run');
  const canDelete = canPerform(role, 'delete_project');
  const _canEditProject = canPerform(role, 'edit_project');
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetryingCheckpoint, setIsRetryingCheckpoint] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [feedbackRating, setFeedbackRating] = useState('0');
  const [tableIdInput, setTableIdInput] = useState('');
  const [tableIds, setTableIds] = useState<string[]>([]);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // Convex subscriptions — real-time, no polling (org-scoped to prevent cross-tenant leakage)
  const project = useQuery(api.projects.get, convexOrgId
    ? { projectId: projectId as Id<"projects">, orgId: convexOrgId as Id<"organizations"> }
    : 'skip');
  const runs = useQuery(api.runs.getByProject, convexOrgId
    ? { projectId: projectId as Id<"projects">, orgId: convexOrgId as Id<"organizations"> }
    : 'skip');
  const isLoading = project === undefined || runs === undefined;
  const loadingTimedOut = useLoadingTimeout(isLoading);

  // Latest run (runs are sorted desc)
  const latestRun = runs?.[0];
  const runResult = parseRunResult(latestRun?.result);
  const summary = runResult?.summary;
  const r2Files = runResult?.r2Files;
  const reviewDiff = runResult?.reviewDiff;
  const _pipelineDecisions = runResult?.pipelineDecisions;
  const _decisionsSummary = runResult?.decisionsSummary;
  const exportPackages = runResult?.exportPackages;
  const exportReadiness = asRecord(runResult?.exportReadiness);
  const exportErrors = runResult?.exportErrors;
  const showR2ArtifactDebugPath = process.env.NEXT_PUBLIC_ENABLE_R2_ARTIFACT_DEBUG_PATH === 'true';
  const runArtifactDebugPath = convexOrgId && latestRun
    ? buildRunArtifactDebugPath(String(convexOrgId), projectId, String(latestRun._id))
    : null;
  const checkpointRetryEnabled = isCheckpointRetryEnabled();
  const checkpointRetryAvailability = getCheckpointRetryAvailability(latestRun ? {
    status: latestRun.status,
    expiredAt: latestRun.expiredAt,
    executionState: latestRun.executionState,
    executionPayload: latestRun.executionPayload,
    recoveryManifest: latestRun.recoveryManifest,
  } : null);
  const canRetryCheckpoint = checkpointRetryEnabled && checkpointRetryAvailability.eligible && canCancel;
  const checkpointRetryLabel = getCheckpointRetryLabel(latestRun?.recoveryManifest);

  const addTableIdsFromInput = () => {
    const raw = tableIdInput.trim();
    if (!raw) return;
    const parsed = raw
      .split(/[\n,\t ]+/g)
      .map(s => s.trim())
      .filter(Boolean);

    const next = new Set<string>(tableIds);
    for (const id of parsed) next.add(id);
    setTableIds(Array.from(next));
    setTableIdInput('');
  };

  const removeTableId = (id: string) => {
    setTableIds(tableIds.filter(t => t !== id));
  };

  const submitFeedback = async () => {
    if (!latestRun || isSubmittingFeedback) return;
    const runIdStr = String(latestRun._id);

    setIsSubmittingFeedback(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runIdStr)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: Number(feedbackRating) || 0,
          notes: feedbackNotes,
          tableIds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to submit feedback');
      }

      toast.success('Feedback submitted', {
        description: 'Thanks — this helps us improve the pipeline.',
      });

      // Track feedback submission
      posthog.capture('feedback_submitted', {
        project_id: projectId,
        run_id: runIdStr,
        rating: Number(feedbackRating) || 0,
        has_notes: feedbackNotes.trim().length > 0,
        table_ids_count: tableIds.length,
      });

      setFeedbackNotes('');
      setFeedbackRating('0');
      setTableIds([]);
      setTableIdInput('');
    } catch (err) {
      toast.error('Failed to submit feedback', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleCancel = async () => {
    if (!latestRun) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(String(latestRun._id))}/cancel`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to cancel pipeline');
      }

      // Track pipeline cancellation
      posthog.capture('pipeline_cancelled', {
        project_id: projectId,
        run_id: String(latestRun._id),
        previous_status: latestRun.status,
      });

      // Status update will come through Convex subscription
    } catch (err) {
      toast.error('Failed to cancel', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
      setIsCancelling(false);
    }
  };

  const handleCheckpointRetry = async () => {
    if (!latestRun) return;
    setIsRetryingCheckpoint(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(String(latestRun._id))}/retry`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to queue checkpoint retry');
      }

      toast.success('Checkpoint retry queued', {
        description: checkpointRetryLabel,
      });

      posthog.capture('pipeline_checkpoint_retry_queued', {
        project_id: projectId,
        run_id: String(latestRun._id),
        recovery_boundary: latestRun.recoveryManifest?.boundary,
        resume_stage: latestRun.recoveryManifest?.resumeStage,
      });
    } catch (err) {
      toast.error('Failed to queue checkpoint retry', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsRetryingCheckpoint(false);
    }
  };

  const handleDeleteProject = async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error('Failed to delete project', {
        description: data?.error || 'Unknown error',
      });
      throw new Error(data?.error || 'Failed to delete project');
    }
    posthog.capture('project_deleted', { project_id: projectId });
    toast.success('Project deleted');
    router.push('/dashboard');
  };

  const handleCopyRunArtifactDebugPath = async () => {
    if (!runArtifactDebugPath) return;

    try {
      await navigator.clipboard.writeText(runArtifactDebugPath);
      toast.success('R2 artifact path copied', {
        description: 'Use this prefix to pull the run artifacts from R2.',
      });
    } catch (error) {
      toast.error('Could not copy R2 artifact path', {
        description: error instanceof Error ? error.message : 'Clipboard write failed',
      });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="py-12">
        <div className="max-w-4xl mx-auto">
          {loadingTimedOut ? (
            <LoadingTimeoutFallback pageName="Project Detail" />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <GridLoader size="lg" />
              <p className="text-xs text-muted-foreground font-mono">Loading project</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Not found
  if (project === null) {
    return (
      <div className="py-12">
        <div className="max-w-4xl mx-auto">
          <AppBreadcrumbs
            segments={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Not Found' },
            ]}
          />
          <div className="text-center mt-8">
            <h1 className="font-serif text-3xl font-light tracking-tight mb-2">Project Not Found</h1>
            <p className="text-muted-foreground">
              The requested project could not be found.
            </p>
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')} className="mt-4">
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const status = latestRun?.status || 'pending';
  const isActive = status === 'in_progress' || status === 'pending_review' || status === 'resuming';
  const hasOutputs = (summary?.tables ?? 0) > 0 || (summary?.cuts ?? 0) > 0;
  const feedbackAvailable = !isActive && (status === 'success' || status === 'partial');
  const analysisAvailable = Boolean(
    latestRun
    && !latestRun.expiredAt
    && hasOutputs
    && (status === 'success' || status === 'partial'),
  );
  const analysisHref = latestRun
    ? `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(String(latestRun._id))}/analysis`
    : null;
  const parsedConfigResult = ProjectConfigSchema.safeParse(project.config);
  const projectConfig = parsedConfigResult.success ? parsedConfigResult.data : undefined;
  const configSections = projectConfig ? buildConfigSections(projectConfig, project.intake) : [];
  const requestedExportFormats = projectConfig?.exportFormats ?? ['excel'];
  return (
    <div>
      <AppBreadcrumbs
        segments={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: project.name },
        ]}
      />

      <div className="max-w-4xl mt-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-light tracking-tight mb-2">
            {project.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            Created on {formatDate(project._creationTime)}
          </p>
        </div>

        {/* Status and Duration */}
        <div className="flex items-center gap-4 mb-8">
          <StatusBadge status={status} />
          {/* Duration shown in Summary Statistics section */}
          {latestRun?.progress !== undefined && isActive && (
            <Badge variant="outline">
              {latestRun.progress}%
            </Badge>
          )}
          {/* Internal Quality UI removed from user-facing surface */}
        </div>

        {/* Pipeline Progress Timeline (replaces old Processing Banner) */}
        {(status === 'in_progress' || status === 'resuming' || status === 'pending_review') && (
          <Card className="mb-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Pipeline Progress</CardTitle>
                {(status === 'in_progress' || status === 'resuming') && canCancel && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    disabled={isCancelling}
                  >
                    {isCancelling ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Cancelling...
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 mr-2" />
                        Cancel
                      </>
                    )}
                  </Button>
                )}
                {status === 'pending_review' && (
                  <Button
                    size="sm"
                    onClick={() => router.push(`/projects/${encodeURIComponent(projectId)}/review`)}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Review Now
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <PipelineTimeline
                stage={latestRun?.stage ?? undefined}
                status={status}
                message={latestRun?.message ?? undefined}
                progress={latestRun?.progress ?? undefined}
                reviewDiff={reviewDiff}
              />
            </CardContent>
          </Card>
        )}

        {/* Review Required Banner (if not showing timeline) */}
        {/* Timeline handles review state above, so this is only needed as a legacy fallback */}

        {/* Review Summary (shown on completed runs that went through review) */}
        {!isActive && (status === 'success' || status === 'partial') && reviewDiff && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg">Review Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <ReviewVerification reviewDiff={reviewDiff} />
            </CardContent>
          </Card>
        )}

        {/* Cancelled Banner */}
        {status === 'cancelled' && (
          <Card className="mb-8 border-muted-foreground/20 bg-muted/30 relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                {/* Fractured grid motif */}
                <div className="relative w-10 h-10 flex-shrink-0 opacity-30">
                  <div className="absolute inset-0" style={{
                    backgroundImage: `
                      linear-gradient(to right, var(--muted-foreground) 1px, transparent 1px),
                      linear-gradient(to bottom, var(--muted-foreground) 1px, transparent 1px)
                    `,
                    backgroundSize: '10px 10px',
                    maskImage: 'linear-gradient(135deg, black 40%, transparent 60%)',
                    WebkitMaskImage: 'linear-gradient(135deg, black 40%, transparent 60%)',
                  }} />
                </div>
                <div>
                  <p className="font-medium">Pipeline Cancelled</p>
                  <p className="text-sm text-muted-foreground">
                    This pipeline was cancelled and did not complete processing.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error Banner */}
        {status === 'error' && (
          <Card className="mb-8 border-tab-rose/30 bg-tab-rose-dim relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                {/* Fractured grid with red accent */}
                  <div className="relative w-10 h-10 flex-shrink-0">
                    <div className="absolute inset-0 opacity-20" style={{
                      backgroundImage: `
                        linear-gradient(to right, var(--tab-rose) 1px, transparent 1px),
                        linear-gradient(to bottom, var(--tab-rose) 1px, transparent 1px)
                      `,
                      backgroundSize: '10px 10px',
                      maskImage: 'linear-gradient(135deg, black 30%, transparent 70%)',
                      WebkitMaskImage: 'linear-gradient(135deg, black 30%, transparent 70%)',
                    }} />
                    <XCircle className="h-5 w-5 text-tab-rose absolute bottom-0 right-0" />
                  </div>
                  <div>
                    <p className="font-medium text-tab-rose">Pipeline Error</p>
                    <p className="text-sm text-muted-foreground">
                      {latestRun?.error || 'An error occurred during processing.'}
                    </p>
                  </div>
                </div>
                {canRetryCheckpoint && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckpointRetry}
                    disabled={isRetryingCheckpoint}
                  >
                    {isRetryingCheckpoint ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Queueing...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        {checkpointRetryLabel}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Stats */}
        {(hasOutputs || (!isActive && status !== 'cancelled' && status !== 'error')) && summary && (
          <Card className={`mb-8 ${status === 'success' ? 'glow-teal' : ''}`}>
            <CardHeader>
              <CardTitle className="text-lg">Summary Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <Table className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-serif font-semibold">
                    <AnimatedNumber value={summary.tables ?? 0} />
                  </p>
                  <p className="text-xs text-muted-foreground">Tables</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <BarChart3 className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-serif font-semibold">
                    <AnimatedNumber value={summary.cuts ?? 0} />
                  </p>
                  <p className="text-xs text-muted-foreground">Crosstabs</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <Layers className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-serif font-semibold">
                    <AnimatedNumber value={summary.bannerGroups ?? 0} />
                  </p>
                  <p className="text-xs text-muted-foreground">Banner Groups</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <FileText className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <p className="text-2xl font-serif font-semibold">{(summary.durationMs ?? 0) > 0 ? formatDuration(summary.durationMs ?? 0) : '-'}</p>
                  <p className="text-xs text-muted-foreground">Duration</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* TODO: Pipeline Decisions and Table Labels are hidden for now.
            Both need UX redesign before re-enabling:
            - Pipeline Decisions: replace block cards with a concise AI-generated summary paragraph
            - Table Labels: clarify user flow, reduce visual weight, add guidance
            The components and data fetching remain intact — just not rendered. */}

        <Card className="mb-8">
          <CardHeader>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  Analysis Workspace
                </CardTitle>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Open a Chat with your data conversation in TabulateAI tied to this output so you can
                  explore findings, summarize results, and surface grounded insights from the run.
                </p>
              </div>

              {analysisAvailable && analysisHref ? (
                <Button asChild>
                  <Link href={analysisHref}>Chat with your data</Link>
                </Button>
              ) : (
                <Badge variant="outline" className="w-fit">
                  Not available yet
                </Badge>
              )}
            </div>
          </CardHeader>
          {!analysisAvailable && (
            <CardContent>
              {latestRun?.expiredAt ? (
              <p className="text-sm text-muted-foreground">
                Analysis is unavailable because this run&apos;s artifacts have expired.
              </p>
            ) : latestRun ? (
              <p className="text-sm text-muted-foreground">
                Analysis becomes available after TabulateAI finishes this run and the output artifacts are ready.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Analysis will appear here once this project has a completed run with output artifacts.
              </p>
            )}
            </CardContent>
          )}
        </Card>

        {/* Downloads */}
        {latestRun ? (
          <>
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="text-lg">Downloads</CardTitle>
              </CardHeader>
              <CardContent>
                <ExportSection
                  runId={String(latestRun._id)}
                  projectId={projectId}
                  projectName={project.name}
                  runCreatedAt={latestRun._creationTime}
                  status={status}
                  expiredAt={latestRun.expiredAt}
                  r2Outputs={r2Files?.outputs}
                  exportPackages={exportPackages}
                  exportReadiness={exportReadiness}
                  exportErrors={exportErrors}
                  requestedFormats={requestedExportFormats}
                  defaultWinCrossProfileId={projectConfig?.wincrossProfileId}
                />
              </CardContent>
            </Card>

            {showR2ArtifactDebugPath && runArtifactDebugPath && (
              <Card className="mb-8 border-dashed">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-lg">R2 Artifact Path</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyRunArtifactDebugPath}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Path
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Debug view for pulling this run&apos;s uploaded artifacts from R2.
                  </p>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
                    {runArtifactDebugPath}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg">Downloads</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Run downloads will appear here once this project has a completed pipeline run.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Output Feedback */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  Output Feedback
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Tell us what was wrong or missing in this output. This does not re-run anything; it&apos;s for improving future runs.
                </p>
              </div>
              <Button
                variant={showFeedbackForm ? 'outline' : 'default'}
                onClick={() => setShowFeedbackForm(v => !v)}
                disabled={!feedbackAvailable}
              >
                {showFeedbackForm ? 'Hide' : 'Leave Feedback'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!feedbackAvailable && (
              <p className="text-sm text-muted-foreground">
                Feedback becomes available once the pipeline completes.
              </p>
            )}

            {showFeedbackForm && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Overall quality (optional)</Label>
                    <Select value={feedbackRating} onValueChange={setFeedbackRating} disabled={!feedbackAvailable || isSubmittingFeedback}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Not sure" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Not sure</SelectItem>
                        <SelectItem value="1">1 - Very poor</SelectItem>
                        <SelectItem value="2">2 - Poor</SelectItem>
                        <SelectItem value="3">3 - OK</SelectItem>
                        <SelectItem value="4">4 - Good</SelectItem>
                        <SelectItem value="5">5 - Great</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Table IDs (optional)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={tableIdInput}
                        onChange={(e) => setTableIdInput(e.target.value)}
                        placeholder="Paste one or more table IDs"
                        disabled={!feedbackAvailable || isSubmittingFeedback}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTableIdsFromInput();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addTableIdsFromInput}
                        disabled={!feedbackAvailable || isSubmittingFeedback || tableIdInput.trim().length === 0}
                      >
                        Add
                      </Button>
                    </div>
                    {tableIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {tableIds.map((id) => (
                          <Badge key={id} variant="secondary" className="flex items-center gap-1">
                            <span>{id}</span>
                            <button
                              type="button"
                              className="ml-1 opacity-70 hover:opacity-100"
                              onClick={() => removeTableId(id)}
                              aria-label={`Remove ${id}`}
                              disabled={!feedbackAvailable || isSubmittingFeedback}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={feedbackNotes}
                    onChange={(e) => setFeedbackNotes(e.target.value)}
                    placeholder="e.g., missing NETs, wrong table structure, tables that should be excluded, bad labels..."
                    disabled={!feedbackAvailable || isSubmittingFeedback}
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowFeedbackForm(false)}
                    disabled={isSubmittingFeedback}
                  >
                    Close
                  </Button>
                  <Button
                    onClick={submitFeedback}
                    disabled={!feedbackAvailable || isSubmittingFeedback}
                  >
                    {isSubmittingFeedback ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Submit Feedback'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>


        {/* Config Summary */}
        {configSections.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-muted-foreground" />
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {configSections.map((section) => (
                  <section key={section.key} className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">{section.title}</h3>
                    </div>
                    <dl className="space-y-3 text-sm">
                      {section.entries.map(({ key, label, value }) => (
                        <div key={key} className="flex items-start justify-between gap-4">
                          <dt className="min-w-0 text-muted-foreground">{label}</dt>
                          <dd className="max-w-[60%] text-right font-medium">
                            <ConfigValue value={value} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Danger Zone (admin only) */}
        {canDelete && (
          <Card className="border-red-500/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-red-500">
                <Trash2 className="h-5 w-5" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Delete this project</p>
                  <p className="text-xs text-muted-foreground">
                    Permanently removes this project, all its runs, and associated files. This action cannot be undone.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  Delete Project
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <ConfirmDestructiveDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          title="Delete project"
          description={`This will permanently delete "${project.name}" and all its runs and files. This action cannot be undone.`}
          confirmText={project.name}
          confirmLabel="Type the project name to confirm"
          destructiveLabel="Delete Project"
          onConfirm={handleDeleteProject}
        />
      </div>
    </div>
  );
}
