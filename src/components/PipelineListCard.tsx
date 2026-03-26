'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, Clock, Table, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatDuration';

/**
 * Shape for project list items backed by Convex data.
 * Replaces the old PipelineListItem that came from filesystem scanning.
 */
export interface ProjectListItem {
  projectId: string;
  name: string;
  createdAt: number;       // Unix ms (_creationTime)
  latestRunId?: string;
  status: string;
  tables?: number;
  cuts?: number;
  durationMs?: number;
  hasFeedback?: boolean;
}

interface PipelineListCardProps {
  pipeline: ProjectListItem;
  onClick: (projectId: string) => void;
}

function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }
  if (diffHours > 0) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }
  if (diffMinutes > 0) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }
  return 'Just now';
}


function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-4 w-4 text-tab-teal" />;
    case 'partial':
      return <AlertCircle className="h-4 w-4 text-tab-amber" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-tab-rose" />;
    case 'in_progress':
    case 'resuming':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case 'pending_review':
      return <Clock className="h-4 w-4 text-tab-amber" />;
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'pending_review') {
    return (
      <Badge variant="secondary" className="text-xs bg-tab-amber-dim text-tab-amber">
        Review Required
      </Badge>
    );
  }
  if (status === 'in_progress' || status === 'resuming') {
    return (
      <Badge variant="secondary" className="text-xs bg-tab-indigo-dim text-primary">
        Processing
      </Badge>
    );
  }
  if (status === 'cancelled') {
    return (
      <Badge variant="secondary" className="text-xs">
        Cancelled
      </Badge>
    );
  }
  return null;
}

export function PipelineListCard({ pipeline, onClick }: PipelineListCardProps) {
  const isActive = pipeline.status === 'in_progress' || pipeline.status === 'pending_review' || pipeline.status === 'resuming';
  const isCancelled = pipeline.status === 'cancelled';

  return (
    <Card
      className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
        pipeline.status === 'pending_review' ? 'border-tab-amber/30' : ''
      } ${pipeline.status === 'in_progress' || pipeline.status === 'resuming' ? 'border-primary/30' : ''} ${
        isCancelled ? 'opacity-60' : ''
      }`}
      onClick={() => onClick(pipeline.projectId)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon status={pipeline.status} />
            <span className="font-serif font-medium text-sm truncate">
              {pipeline.name}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground font-mono">
            <span>{formatRelativeTime(pipeline.createdAt)}</span>
            {!isActive && pipeline.durationMs && (
              <>
                <span className="text-muted-foreground/50">|</span>
                <span>{formatDuration(pipeline.durationMs)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusBadge status={pipeline.status} />
            {pipeline.hasFeedback && (
              <Badge variant="outline" className="text-xs">
                Feedback
              </Badge>
            )}
            {!isActive && !isCancelled && pipeline.tables !== undefined && (
              <>
                <Badge variant="secondary" className="text-xs">
                  <Table className="h-3 w-3 mr-1" />
                  {pipeline.tables} tables
                </Badge>
                {pipeline.cuts !== undefined && (
                  <Badge variant="outline" className="text-xs">
                    {pipeline.cuts} cuts
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
      </div>
    </Card>
  );
}
