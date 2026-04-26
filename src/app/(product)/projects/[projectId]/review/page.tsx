'use client';

import { useState, use, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import posthog from 'posthog-js';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/PageHeader';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import {
  CheckCircle,
  SkipForward,
  Loader2,
  Play,
  XCircle,
  Lightbulb,
  ListOrdered,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { parseRunResult } from '@/schemas/runResultSchema';
import { api } from '../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { useAuthContext } from '@/providers/auth-provider';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { LoadingTimeoutFallback } from '@/components/ErrorFallback';
import { V3_STAGE_NAMES, isV3StageId } from '@/lib/v3/runtime/stageOrder';
import { selectPrimaryProjectRun } from '@/lib/runs/selectPrimaryRun';

function stripEmojis(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatReviewTimestamp(value?: string): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString();
}

function formatLastCompletedStage(stageId?: string): string | null {
  if (!stageId) return null;
  return isV3StageId(stageId) ? `${stageId} (${V3_STAGE_NAMES[stageId]})` : stageId;
}

interface Alternative {
  expression: string;
  rank: number;
  userSummary: string;
  selectable: boolean;
  nonSelectableReason?: string;
  source?: 'model_alternative' | 'literal_original';
}

interface FlaggedCrosstabColumn {
  groupName: string;
  columnName: string;
  original: string;
  proposed: string;
  confidence: number;
  reasoning: string;
  userSummary: string;
  alternatives: Alternative[];
  uncertainties: string[];
  expressionType?: string;
}

interface CrosstabDecision {
  action: 'approve' | 'select_alternative' | 'provide_hint' | 'skip';
  selectedAlternative?: number;
  hint?: string;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  let colorClass = 'bg-tab-teal/10 text-tab-teal';

  if (percent < 70) {
    colorClass = 'bg-tab-amber/10 text-tab-amber';
  } else if (percent < 85) {
    colorClass = 'bg-tab-blue/10 text-tab-blue';
  }

  return (
    <Badge variant="secondary" className={colorClass}>
      {percent}%
    </Badge>
  );
}

function CrosstabColumnCard({
  column,
  decision,
  onDecisionChange,
}: {
  column: FlaggedCrosstabColumn;
  decision: CrosstabDecision;
  onDecisionChange: (decision: CrosstabDecision) => void;
}) {
  const [hintValue, setHintValue] = useState('');
  const [showConcerns, setShowConcerns] = useState(false);

  const handleActionChange = (action: CrosstabDecision['action']) => {
    const newDecision: CrosstabDecision = { action };

    switch (action) {
      case 'provide_hint':
        newDecision.hint = hintValue;
        break;
      case 'select_alternative':
        newDecision.selectedAlternative = 0;
        break;
    }

    onDecisionChange(newDecision);
  };

  const handleHintChange = (value: string) => {
    setHintValue(value);
    if (decision.action === 'provide_hint') {
      onDecisionChange({ action: 'provide_hint', hint: value });
    }
  };

  const handleSelectAlternative = (index: number) => {
    if (!column.alternatives[index]?.selectable) return;
    onDecisionChange({ action: 'select_alternative', selectedAlternative: index });
  };

  const getSelectedExpression = () => {
    if (decision.action === 'select_alternative' && decision.selectedAlternative !== undefined) {
      return column.alternatives[decision.selectedAlternative]?.expression || column.proposed;
    }
    return column.proposed;
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{column.columnName}</CardTitle>
          <ConfidenceBadge confidence={column.confidence} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {column.userSummary && (
          <p className="text-sm text-muted-foreground">{stripEmojis(column.userSummary)}</p>
        )}

        <div className="space-y-2">
          <div className="flex items-baseline gap-3">
            <Label className="text-xs text-muted-foreground w-24 shrink-0">Original:</Label>
            <div className="p-2 bg-muted rounded text-sm font-mono break-all flex-1">
              {column.original || <span className="text-muted-foreground italic">Empty</span>}
            </div>
          </div>
          <div className="flex items-baseline gap-3">
            <Label className="text-xs text-muted-foreground w-24 shrink-0">Suggested:</Label>
            <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded text-sm font-mono break-all flex-1 border border-blue-200 dark:border-blue-800">
              {decision.action === 'select_alternative' && decision.selectedAlternative !== undefined ? (
                <span className="text-purple-700 dark:text-purple-400">
                  {getSelectedExpression()}
                </span>
              ) : (
                column.proposed || <span className="text-muted-foreground italic">NA</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant={decision.action === 'approve' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleActionChange('approve')}
          >
            Accept
          </Button>

          {column.alternatives && column.alternatives.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={decision.action === 'select_alternative' ? 'secondary' : 'outline'}
                  size="sm"
                >
                  Pick alternative <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-md">
                {column.alternatives.map((alt, i) => (
                  <DropdownMenuItem
                    key={i}
                    disabled={!alt.selectable}
                    onClick={() => handleSelectAlternative(i)}
                    className="flex flex-col items-start gap-1 py-2"
                  >
                    <span className="font-mono text-xs break-all">{alt.expression}</span>
                    <span className="text-xs text-muted-foreground">
                      {stripEmojis(alt.userSummary)}
                    </span>
                    {alt.source === 'literal_original' && (
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Original banner expression
                      </span>
                    )}
                    {!alt.selectable && alt.nonSelectableReason && (
                      <span className="text-xs text-muted-foreground">
                        {stripEmojis(alt.nonSelectableReason)}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant={decision.action === 'provide_hint' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => handleActionChange('provide_hint')}
          >
            Give hint
          </Button>

          <Button
            variant={decision.action === 'skip' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => handleActionChange('skip')}
          >
            Skip
          </Button>
        </div>

        {decision.action === 'provide_hint' && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Your hint (e.g., &ldquo;use variable Q5&rdquo;)</Label>
            <Input
              value={hintValue}
              onChange={(e) => handleHintChange(e.target.value)}
              placeholder="e.g., use variable Q5, not S2"
              className="text-sm"
            />
          </div>
        )}

        {column.uncertainties && column.uncertainties.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowConcerns(!showConcerns)}
              className="flex items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {showConcerns ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span>
                {column.uncertainties.length} {column.uncertainties.length !== 1 ? 'considerations' : 'consideration'}
              </span>
            </button>
            {showConcerns && (
              <ul className="text-sm text-muted-foreground space-y-1 mt-2 ml-6">
                {column.uncertainties.map((u, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="mt-0.5">-</span>
                    <span>{stripEmojis(u)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();
  const { convexOrgId } = useAuthContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Map<string, CrosstabDecision>>(new Map());
  const [decisionsInitialized, setDecisionsInitialized] = useState(false);
  const [groupHints, setGroupHints] = useState<Map<string, string>>(new Map());
  const [expandedGroupHints, setExpandedGroupHints] = useState<Set<string>>(new Set());
  const [submissionRunId, setSubmissionRunId] = useState<string | null>(null);
  const hasRedirectedRef = useRef(false);

  // Convex subscriptions — real-time, no polling (org-scoped to prevent cross-tenant leakage)
  const project = useQuery(api.projects.get, convexOrgId
    ? { projectId: projectId as Id<"projects">, orgId: convexOrgId as Id<"organizations"> }
    : 'skip');
  const runs = useQuery(api.runs.getByProject, convexOrgId
    ? { projectId: projectId as Id<"projects">, orgId: convexOrgId as Id<"organizations"> }
    : 'skip');
  const isLoading = runs === undefined || project === undefined;
  const loadingTimedOut = useLoadingTimeout(isLoading);

  const latestRun = selectPrimaryProjectRun(runs);
  const runId = latestRun ? String(latestRun._id) : null;
  const runResult = parseRunResult(latestRun?.result);

  // Review state from Convex (reactive — updates automatically when PathB completes)
  const reviewState = runResult?.reviewState;
  const reviewMetadata = [
    {
      label: 'Pipeline ID',
      value: reviewState?.pipelineId ?? runResult?.pipelineId,
      monospace: true,
    },
    {
      label: 'Paused At',
      value: formatReviewTimestamp(reviewState?.createdAt),
    },
    {
      label: 'Last V3 Stage',
      value: formatLastCompletedStage(reviewState?.v3LastCompletedStage),
      monospace: true,
    },
    {
      label: 'Tables',
      value:
        reviewState?.totalCanonicalTables !== undefined
          ? String(reviewState.totalCanonicalTables)
          : null,
    },
    {
      label: 'Banner Groups',
      value:
        reviewState?.bannerGroupCount !== undefined
          ? String(reviewState.bannerGroupCount)
          : null,
    },
  ].filter(
    (
      item,
    ): item is {
      label: string;
      value: string;
      monospace?: boolean;
    } => typeof item.value === 'string' && item.value.length > 0,
  );

  // Initialize decisions when reviewState first arrives.
  // Keep this in an effect to avoid state updates during render.
  useEffect(() => {
    if (!reviewState?.flaggedColumns || decisionsInitialized) return;
    const initialDecisions = new Map<string, CrosstabDecision>();
    for (const col of reviewState.flaggedColumns) {
      const key = `${col.groupName}/${col.columnName}`;
      initialDecisions.set(key, { action: 'approve' });
    }
    setDecisions(initialDecisions);
    setDecisionsInitialized(true);
  }, [reviewState?.flaggedColumns, decisionsInitialized]);

  // Auto-return to project page once run leaves pending_review after submit.
  // This makes navigation resilient even if the review POST response is slow.
  useEffect(() => {
    if (!submissionRunId || !latestRun || hasRedirectedRef.current) return;
    if (String(latestRun._id) !== submissionRunId) return;
    if (latestRun.status === 'pending_review') return;

    hasRedirectedRef.current = true;
    toast.success('Review saved', {
      description: 'Pipeline is continuing with your decisions.',
    });

    const destination = `/projects/${encodeURIComponent(projectId)}`;
    router.replace(destination);

    // Fallback for rare client-side navigation failures.
    setTimeout(() => {
      if (window.location.pathname.endsWith('/review')) {
        window.location.assign(destination);
      }
    }, 1200);
  }, [submissionRunId, latestRun, projectId, router]);

  const groupedColumns = useMemo(() => {
    if (!reviewState?.flaggedColumns) return new Map<string, FlaggedCrosstabColumn[]>();
    const groups = new Map<string, FlaggedCrosstabColumn[]>();
    for (const col of reviewState.flaggedColumns) {
      const existing = groups.get(col.groupName) || [];
      existing.push(col);
      groups.set(col.groupName, existing);
    }
    return groups;
  }, [reviewState?.flaggedColumns]);

  const handleDecisionChange = (groupName: string, columnName: string, decision: CrosstabDecision) => {
    const key = `${groupName}/${columnName}`;
    setDecisions(new Map(decisions.set(key, decision)));

    // Track individual review decision
    posthog.capture('review_decision_made', {
      project_id: projectId,
      run_id: runId,
      group_name: groupName,
      column_name: columnName,
      action: decision.action,
      has_hint: decision.action === 'provide_hint' && !!decision.hint,
      alternative_index: decision.selectedAlternative,
    });
  };

  const handleSubmit = async () => {
    if (!reviewState || !runId) return;
    const flaggedColumns = reviewState.flaggedColumns ?? [];

    setIsSubmitting(true);
    setError(null);
    setSubmissionRunId(runId);
    try {
      const decisionsArray = flaggedColumns.map((col) => {
        const key = `${col.groupName}/${col.columnName}`;
        const decision = decisions.get(key) || { action: 'approve' };
        return {
          groupName: col.groupName,
          columnName: col.columnName,
          action: decision.action,
          selectedAlternative: decision.selectedAlternative,
          hint: decision.hint,
        };
      });

      // Build group hints array from state
      const groupHintsArray = Array.from(groupHints.entries())
        .filter(([, hint]) => hint.trim().length > 0)
        .map(([groupName, hint]) => ({ groupName, hint: hint.trim() }));

      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decisions: decisionsArray,
          ...(groupHintsArray.length > 0 ? { groupHints: groupHintsArray } : {}),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to submit review');
      }

      await res.json();

      // Track successful review submission
      posthog.capture('review_submitted', {
        project_id: projectId,
        run_id: runId,
        total_flagged_columns: flaggedColumns.length,
        approved_count: approveCount,
        alternative_count: altCount,
        hint_count: hintCount,
        skip_count: skipCount,
      });

      // Fast-path redirect on successful submission.
      const destination = `/projects/${encodeURIComponent(projectId)}`;
      toast.success('Review saved', {
        description: 'Pipeline is continuing with your decisions.',
      });
      hasRedirectedRef.current = true;
      router.replace(destination);

      // Fallback for rare client-side navigation failures.
      setTimeout(() => {
        if (window.location.pathname.endsWith('/review')) {
          window.location.assign(destination);
        }
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSubmissionRunId(null);
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!runId) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to cancel pipeline');
      }

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="py-12">
        <div className="max-w-4xl mx-auto">
          {loadingTimedOut ? (
            <LoadingTimeoutFallback pageName="Review" />
          ) : (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Project was deleted
  if (project === null) {
    return (
      <div className="py-12">
        <div className="max-w-4xl mx-auto">
          <AppBreadcrumbs
            segments={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Project Not Found' },
            ]}
          />
          <PageHeader
            title="Project Not Found"
            description="This project may have been deleted."
            actions={
              <Button variant="outline" onClick={() => router.push('/dashboard')}>
                Back to Dashboard
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // No run or no review state
  if (!latestRun || !reviewState || !reviewState.flaggedColumns) {
    return (
      <div className="py-12">
        <div className="max-w-4xl mx-auto">
          <AppBreadcrumbs
            segments={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Review Not Available' },
            ]}
          />
          <PageHeader
            title="Review Not Available"
            description={error || 'This project does not require review or has already been reviewed.'}
            actions={
              <div className="flex gap-2">
                {latestRun && ['in_progress', 'pending_review', 'resuming'].includes(latestRun.status) && (
                  <Button variant="destructive" onClick={handleCancel} disabled={isSubmitting}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Run
                  </Button>
                )}
                <Button variant="outline" onClick={() => router.push('/dashboard')}>
                  Back to Dashboard
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  // Already reviewed (run moved past pending_review)
  if (latestRun.status !== 'pending_review' && reviewState.status !== 'awaiting_review') {
    return (
      <div className="py-12">
        <div className="max-w-4xl mx-auto">
          <AppBreadcrumbs
            segments={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Review Completed' },
            ]}
          />
          <PageHeader
            title="Review Already Completed"
            description="This pipeline has already been reviewed."
            actions={
              <Button variant="outline" onClick={() => router.push(`/projects/${encodeURIComponent(projectId)}`)}>
                View Project
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const approveCount = Array.from(decisions.values()).filter(d => d.action === 'approve').length;
  const altCount = Array.from(decisions.values()).filter(d => d.action === 'select_alternative').length;
  const hintCount = Array.from(decisions.values()).filter(d => d.action === 'provide_hint').length;
  const skipCount = Array.from(decisions.values()).filter(d => d.action === 'skip').length;

  return (
    <div>
      <AppBreadcrumbs
        segments={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Project', href: `/projects/${encodeURIComponent(projectId)}` },
          { label: 'Review' },
        ]}
      />

      <div className="max-w-4xl mt-6">
        <PageHeader
          title="Quick Review Needed"
          description={`${reviewState.flaggedColumns.length} banner column${reviewState.flaggedColumns.length !== 1 ? 's' : ''} pending confirmation. Confirm or adjust each one below.`}
        />

        {/* Error Banner */}
        {error && (
          <Card className="mb-6 border-red-500/50 bg-red-500/5">
            <CardContent className="p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Status */}
        <div className="flex items-center gap-4 mb-6">
          <Badge variant="secondary" className="bg-tab-amber/10 text-tab-amber">
            Pending Review
          </Badge>
          <Badge variant="outline">
            {reviewState.pathBStatus === 'completed' ? (
              <>
                <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                Tables Ready
              </>
            ) : reviewState.pathBStatus === 'error' ? (
              <>
                <XCircle className="h-3 w-3 mr-1 text-red-500" />
                Table Processing Failed
              </>
            ) : (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Processing Tables...
              </>
            )}
          </Badge>
        </div>

        {reviewMetadata.length > 0 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reviewMetadata.map((item) => (
                  <div key={item.label} className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                    <p className={item.monospace ? 'text-sm font-mono break-all' : 'text-sm'}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Review Columns */}
        <div className="space-y-6 mb-8">
          {Array.from(groupedColumns.entries()).map(([groupName, columns]) => (
            <div key={groupName}>
              <h3 className="text-lg font-semibold mb-3 px-1">{groupName}</h3>

              {/* Group-level hint */}
              <div className="mb-3 px-1">
                <button
                  onClick={() => {
                    const next = new Set(expandedGroupHints);
                    if (next.has(groupName)) {
                      next.delete(groupName);
                    } else {
                      next.add(groupName);
                    }
                    setExpandedGroupHints(next);
                  }}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {expandedGroupHints.has(groupName) ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <Lightbulb className="h-3.5 w-3.5" />
                  Hint for this group
                  {groupHints.get(groupName) && (
                    <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">Set</Badge>
                  )}
                </button>
                {expandedGroupHints.has(groupName) && (
                  <div className="mt-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Apply a single hint to all columns in this group (column-level hints override)
                    </Label>
                    <Input
                      value={groupHints.get(groupName) || ''}
                      onChange={(e) => {
                        const next = new Map(groupHints);
                        if (e.target.value) {
                          next.set(groupName, e.target.value);
                        } else {
                          next.delete(groupName);
                        }
                        setGroupHints(next);
                      }}
                      placeholder={`e.g., "use hLOCATION1 | hLOCATION2 for all ${groupName} cuts"`}
                      className="text-sm"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {columns.map((col) => {
                  const key = `${col.groupName}/${col.columnName}`;
                  const decision = decisions.get(key) || { action: 'approve' };
                  return (
                    <CrosstabColumnCard
                      key={key}
                      column={col}
                      decision={decision}
                      onDecisionChange={(d) => handleDecisionChange(col.groupName, col.columnName, d)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Summary and Actions */}
        <Card className="sticky bottom-4">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  {approveCount}
                </span>
                {altCount > 0 && (
                  <span className="flex items-center gap-1">
                    <ListOrdered className="h-4 w-4 text-purple-500" />
                    {altCount}
                  </span>
                )}
                {hintCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    {hintCount}
                  </span>
                )}
                {skipCount > 0 && (
                  <span className="flex items-center gap-1">
                    <SkipForward className="h-4 w-4 text-gray-500" />
                    {skipCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving and continuing...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Save & Continue
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
