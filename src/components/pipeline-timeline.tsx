'use client';

import React from 'react';
import { CheckCircle, Circle, Loader2, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ReviewVerification } from '@/components/ReviewVerification';
import type { ReviewDiffSummary } from '@/lib/api/types';
import type { V3PipelineStage } from '@/schemas/pipelineStageSchema';

type StepStatus = 'completed' | 'active' | 'pending' | 'error';
type TimelineStepId =
  | 'reading'
  | 'enrichment'
  | 'planning'
  | 'review'
  | 'computing'
  | 'output';

interface TimelineStep {
  id: TimelineStepId;
  label: string;
  description: string;
  /** Current V3 orchestrator stages that map to this step */
  stages: readonly V3PipelineStage[];
  /** Legacy stored run stages that should continue to render sensibly */
  legacyStages?: readonly string[];
}

const TIMELINE_STEPS: TimelineStep[] = [
  {
    id: 'reading',
    label: 'Reading & Validating Data',
    description: 'Loading source files, validating the dataset, and preparing the run inputs.',
    stages: ['uploading', 'parsing'],
    legacyStages: ['survey_processing'],
  },
  {
    id: 'enrichment',
    label: 'Enriching Questions',
    description: 'Classifying questions, detecting loops, and preparing the survey metadata for planning.',
    stages: ['v3_enrichment'],
    legacyStages: ['loop_handling'],
  },
  {
    id: 'planning',
    label: 'Planning Tables',
    description: 'Building the table plan and checking whether banner review is required.',
    stages: ['v3_fork_join', 'review_check'],
    legacyStages: ['parallel_processing', 'waiting_for_tables'],
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Applying reviewer decisions and loading the saved artifacts to continue.',
    stages: ['crosstab_review_required', 'applying_review', 'loading_v3_artifacts'],
  },
  {
    id: 'computing',
    label: 'Computing Results',
    description: 'Finalizing loop semantics, computing tables, and executing the analysis scripts.',
    stages: ['loop_semantics', 'v3_compute', 'compute', 'executing_r'],
    legacyStages: ['filtering', 'splitting', 'verification', 'post_processing', 'validating_cuts', 'validating_r'],
  },
  {
    id: 'output',
    label: 'Generating Output',
    description: 'Building result artifacts, uploading outputs, and finalizing the delivered files.',
    stages: ['finalizing_tables', 'contract_build', 'r2_finalize', 'complete'],
    legacyStages: ['generating_r', 'writing_outputs'],
  },
];

const TIMELINE_STEP_INDEX = new Map(
  TIMELINE_STEPS.map((step, index) => [step.id, index] as const),
);
const REVIEW_STEP_ID: TimelineStepId = 'review';

const TIMELINE_STAGE_TO_STEP = new Map<string, TimelineStepId>(
  TIMELINE_STEPS.flatMap((step) => [
    ...step.stages.map((stage) => [stage, step.id] as const),
    ...(step.legacyStages?.map((stage) => [stage, step.id] as const) ?? []),
  ]),
);

export function getTimelineStepId(
  stage: string | undefined,
  runStatus: string,
): TimelineStepId | null {
  if (!stage && runStatus === 'pending_review') {
    return REVIEW_STEP_ID;
  }
  return stage ? TIMELINE_STAGE_TO_STEP.get(stage) ?? null : null;
}

export function getStepStatuses(
  currentStage: string | undefined,
  runStatus: string,
): Map<string, StepStatus> {
  const result = new Map<string, StepStatus>();
  const currentStepId = getTimelineStepId(currentStage, runStatus);
  const currentStepIndex =
    currentStepId !== null
      ? (TIMELINE_STEP_INDEX.get(currentStepId) ?? -1)
      : -1;

  // Terminal statuses
  if (runStatus === 'success' || runStatus === 'partial') {
    for (const step of TIMELINE_STEPS) {
      result.set(step.id, 'completed');
    }
    return result;
  }

  if (runStatus === 'error') {
    if (currentStepIndex >= 0) {
      for (let index = 0; index < TIMELINE_STEPS.length; index++) {
        const step = TIMELINE_STEPS[index];
        if (index < currentStepIndex) {
          result.set(step.id, 'completed');
        } else if (index === currentStepIndex) {
          result.set(step.id, 'error');
        } else {
          result.set(step.id, 'pending');
        }
      }
    } else {
      for (const step of TIMELINE_STEPS) {
        result.set(step.id, 'pending');
      }
      result.set(TIMELINE_STEPS[TIMELINE_STEPS.length - 1].id, 'error');
    }
    return result;
  }

  if (runStatus === 'cancelled') {
    if (currentStepIndex >= 0) {
      for (let index = 0; index < TIMELINE_STEPS.length; index++) {
        const step = TIMELINE_STEPS[index];
        if (index < currentStepIndex) {
          result.set(step.id, 'completed');
        } else {
          result.set(step.id, 'pending');
        }
      }
    } else {
      for (const step of TIMELINE_STEPS) {
        result.set(step.id, 'pending');
      }
    }
    return result;
  }

  // In progress — find which step is current
  if (currentStepIndex >= 0) {
    for (let index = 0; index < TIMELINE_STEPS.length; index++) {
      const step = TIMELINE_STEPS[index];
      if (index < currentStepIndex) {
        result.set(step.id, 'completed');
      } else if (index === currentStepIndex) {
        result.set(step.id, 'active');
      } else {
        result.set(step.id, 'pending');
      }
    }
  } else {
    for (let index = 0; index < TIMELINE_STEPS.length; index++) {
      result.set(TIMELINE_STEPS[index].id, index === 0 ? 'active' : 'pending');
    }
  }

  // When resuming after review, the review step must remain complete unless the
  // run is explicitly in one of the review stages.
  if (
    runStatus === 'resuming' &&
    currentStepId !== REVIEW_STEP_ID &&
    result.get(REVIEW_STEP_ID) === 'pending'
  ) {
    result.set(REVIEW_STEP_ID, 'completed');
  }

  return result;
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-5 w-5 text-tab-teal" />;
    case 'active':
      return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
    case 'error':
      return <XCircle className="h-5 w-5 text-tab-rose" />;
    case 'pending':
    default:
      return <Circle className="h-5 w-5 text-muted-foreground/40" />;
  }
}

/**
 * Extract table progress counts from messages like "Verifying tables (23 of 150)..."
 */
function parseTableProgress(message: string | undefined): { completed: number; total: number } | null {
  if (!message) return null;
  const match = message.match(/\((\d+)\s+of\s+(\d+)\)/);
  if (!match) return null;
  return { completed: parseInt(match[1], 10), total: parseInt(match[2], 10) };
}

interface PipelineTimelineProps {
  stage: string | undefined;
  status: string;
  message?: string;
  progress?: number;
  /** If true, hides the "Review" step (only show it for pipelines that paused there) */
  hideReview?: boolean;
  /** Review diff summary — rendered under the Review step when completed */
  reviewDiff?: ReviewDiffSummary;
}

export function PipelineTimeline({
  stage,
  status,
  message,
  progress,
  hideReview = true,
  reviewDiff,
}: PipelineTimelineProps) {
  const stepStatuses = getStepStatuses(stage, status);
  const currentStepId = getTimelineStepId(stage, status);

  // Only show the review step if the pipeline paused there, is resuming from it,
  // or is currently applying/loading review artifacts.
  const showReview =
    !hideReview ||
    currentStepId === REVIEW_STEP_ID ||
    status === 'pending_review' ||
    status === 'resuming';
  const visibleSteps = TIMELINE_STEPS.filter(
    (s) => s.id !== REVIEW_STEP_ID || showReview,
  );

  return (
    <div className="relative">
      {visibleSteps.map((step, index) => {
        const stepStatus = stepStatuses.get(step.id) ?? 'pending';
        const isLast = index === visibleSteps.length - 1;

        return (
          <div key={step.id} className="relative flex gap-4">
            {/* Vertical line connector */}
            {!isLast && (
              <div
                className={cn(
                  'absolute left-[9px] top-7 w-[1.5px] h-[calc(100%-12px)]',
                  stepStatus === 'completed'
                    ? 'bg-tab-teal/50'
                    : stepStatus === 'active'
                      ? 'bg-primary/30'
                      : 'bg-border/60',
                )}
              />
            )}

            {/* Icon */}
            <div className="relative z-10 flex-shrink-0 mt-0.5">
              <StepIcon status={stepStatus} />
            </div>

            {/* Content */}
            <div className={cn('pb-6', isLast && 'pb-0')}>
              <p
                className={cn(
                  'text-sm font-medium',
                  stepStatus === 'active' && 'text-primary',
                  stepStatus === 'completed' && 'text-foreground',
                  stepStatus === 'error' && 'text-tab-rose',
                  stepStatus === 'pending' && 'text-muted-foreground',
                )}
              >
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stepStatus === 'active' && message
                  ? message
                  : step.description}
              </p>
              {stepStatus === 'active' && (() => {
                const tp = parseTableProgress(message);
                return tp ? (
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {tp.completed} of {tp.total} tables
                  </p>
                ) : null;
              })()}
              {stepStatus === 'active' && (
                <GridCellProgress
                  progress={progress}
                  isIndeterminate={progress === undefined || progress === 0}
                />
              )}
              {step.id === 'review' && stepStatus === 'completed' && reviewDiff && (
                <ReviewVerification reviewDiff={reviewDiff} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================
   Grid Cell Progress Indicator
   Row of small squares that fill to show progress.
   Indeterminate mode: cells pulse in a wave.
   ============================================ */

const CELL_COUNT = 12;

function GridCellProgress({
  progress,
  isIndeterminate = false,
}: {
  progress?: number;
  isIndeterminate?: boolean;
}) {
  const filledCells =
    progress !== undefined && progress > 0
      ? Math.round((Math.min(progress, 100) / 100) * CELL_COUNT)
      : 0;

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex gap-[3px]">
        {Array.from({ length: CELL_COUNT }, (_, i) => {
          const isFilled = !isIndeterminate && i < filledCells;

          return isIndeterminate ? (
            <motion.div
              key={i}
              className="w-2.5 h-2.5 rounded-[1px] bg-primary"
              animate={{ opacity: [0.15, 0.6, 0.15] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                delay: i * 0.1,
                ease: 'easeInOut',
              }}
            />
          ) : (
            <div
              key={i}
              className={cn(
                'w-2.5 h-2.5 rounded-[1px] transition-all duration-500',
                isFilled ? 'bg-primary' : 'bg-muted',
              )}
            />
          );
        })}
      </div>
      {!isIndeterminate && progress !== undefined && progress > 0 && (
        <span className="text-xs text-muted-foreground font-mono">
          {progress}%
        </span>
      )}
    </div>
  );
}
