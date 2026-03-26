'use client';

import React from 'react';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Clock3,
  Layers,
  Scale,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

import type { PipelineDecisions } from '@/lib/v3/runtime/pipelineDecisions';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

const PANEL_STORAGE_KEY = 'tabulate-ai:pipeline-decisions-panel-seen';

interface PipelineDecisionsProps {
  decisions: PipelineDecisions;
  summary?: string;
}

export function PipelineDecisions({ decisions, summary }: PipelineDecisionsProps) {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    try {
      const hasSeenPanel = window.localStorage.getItem(PANEL_STORAGE_KEY) === '1';
      setIsOpen(!hasSeenPanel);
      window.localStorage.setItem(PANEL_STORAGE_KEY, '1');
    } catch {
      // Non-fatal — fall back to expanded.
    }
  }, []);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="mb-8">
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="text-lg">Pipeline Decisions</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge
                    tone="info"
                    label={`${decisions.enrichment.totalQuestions} questions enriched`}
                  />
                  <StatusBadge
                    tone="success"
                    label={`${decisions.tables.finalTableCount} final tables`}
                  />
                  {(decisions.errors.total > 0 || decisions.errors.warnings > 0) && (
                    <StatusBadge
                      tone="warning"
                      label={`${decisions.errors.total} errors, ${decisions.errors.warnings} warnings`}
                    />
                  )}
                </div>
              </div>
              <ChevronDown
                className={cn('mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {summary && (
              <div className="rounded-lg border border-tab-blue/20 bg-tab-blue/5 p-4">
                <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{summary}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <DecisionCard
                title="Question Enrichment"
                icon={Sparkles}
                tone="info"
                lines={[
                  `${formatNumber(decisions.enrichment.totalQuestions)} questions processed`,
                  `${formatNumber(decisions.enrichment.loopsDetected)} loop structures detected`,
                  `${formatNumber(decisions.enrichment.aiTriageRequired)} required additional review`,
                  `${formatNumber(decisions.enrichment.aiValidationPassed)} resolved automatically`,
                  `${formatNumber(decisions.enrichment.messageCodesMatched)} message codes matched`,
                ]}
              />

              <DecisionCard
                title="Table Generation"
                icon={BarChart3}
                tone="success"
                lines={[
                  `${formatNumber(decisions.tables.canonicalTablesPlanned)} tables planned`,
                  `${formatNumber(decisions.tables.netsAdded)} NET roll-ups added`,
                  `${formatNumber(decisions.tables.tablesExcluded)} excluded before output`,
                  `${formatNumber(decisions.tables.finalTableCount)} final tables generated`,
                ]}
              />

              <DecisionCard
                title="Bannering"
                icon={Layers}
                tone={decisions.banners.flaggedForReview > 0 ? 'warning' : 'info'}
                lines={[
                  `${decisions.banners.source === 'uploaded' ? 'Uploaded' : 'Auto-generated'} banner source`,
                  `${formatNumber(decisions.banners.bannerGroupCount)} banner groups`,
                  `${formatNumber(decisions.banners.totalCuts)} total cuts`,
                  decisions.banners.flaggedForReview > 0
                    ? `${formatNumber(decisions.banners.flaggedForReview)} flagged for review`
                    : 'No cuts required review',
                ]}
              />

              <DecisionCard
                title="Weights & Study Shape"
                icon={Scale}
                tone={decisions.weights.variableUsed ? 'success' : 'info'}
                lines={[
                  decisions.weights.variableUsed
                    ? `Weight variable used: ${decisions.weights.variableUsed}`
                    : decisions.weights.detected
                      ? 'Weight candidate detected, but no variable was applied'
                      : 'No weight variable detected or applied',
                  `${formatNumber(decisions.weights.candidateCount)} weight candidates found`,
                  decisions.studyFlags.hasMaxDiff ? 'MaxDiff structure detected' : 'No MaxDiff structure detected',
                  decisions.studyFlags.hasChoiceModelExercise ? 'Choice exercise detected' : 'No choice exercise detected',
                  decisions.studyFlags.isDemandSurvey ? 'Demand-oriented study metadata present' : 'No demand-study metadata present',
                ]}
                monoMatcher={(line) => line.includes('Weight variable used:')}
              />

              <DecisionCard
                title="Recoveries & Warnings"
                icon={ShieldAlert}
                tone={decisions.errors.total > 0 || decisions.errors.warnings > 0 ? 'warning' : 'success'}
                lines={[
                  `${formatNumber(decisions.errors.total)} errors encountered`,
                  `${formatNumber(decisions.errors.recovered)} recovered automatically`,
                  `${formatNumber(decisions.errors.warnings)} warnings`,
                ]}
              />

              <DecisionCard
                title="Runtime"
                icon={Clock3}
                tone="info"
                lines={[
                  `Enrichment: ${formatDuration(decisions.timing.enrichmentMs)}`,
                  `Table generation: ${formatDuration(decisions.timing.tableGenerationMs)}`,
                  `Compute: ${formatDuration(decisions.timing.computeMs)}`,
                  `Excel: ${formatDuration(decisions.timing.excelMs)}`,
                  `Total: ${formatDuration(decisions.timing.totalMs)}`,
                ]}
              />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function DecisionCard({
  title,
  icon: Icon,
  lines,
  tone,
  monoMatcher,
}: {
  title: string;
  icon: typeof Sparkles;
  lines: string[];
  tone: 'success' | 'warning' | 'info';
  monoMatcher?: (line: string) => boolean;
}) {
  return (
    <div className={cn('rounded-lg border p-4', toneClasses[tone].card)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn('h-4 w-4', toneClasses[tone].icon)} />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="space-y-2">
        {lines.map((line) => (
          <p
            key={line}
            className={cn(
              'text-sm text-muted-foreground',
              monoMatcher?.(line) && 'font-mono text-xs',
            )}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ tone, label }: { tone: 'success' | 'warning' | 'info'; label: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'text-xs',
        tone === 'success' && 'bg-tab-teal/10 text-tab-teal',
        tone === 'warning' && 'bg-tab-amber/10 text-tab-amber',
        tone === 'info' && 'bg-tab-blue/10 text-tab-blue',
      )}
    >
      {label}
    </Badge>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDuration(durationMs: number): string {
  if (durationMs <= 0) return '0s';
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

const toneClasses = {
  success: {
    card: 'border-tab-teal/25 bg-tab-teal/5',
    icon: 'text-tab-teal',
  },
  warning: {
    card: 'border-tab-amber/25 bg-tab-amber/5',
    icon: 'text-tab-amber',
  },
  info: {
    card: 'border-tab-blue/25 bg-tab-blue/5',
    icon: 'text-tab-blue',
  },
} as const;
