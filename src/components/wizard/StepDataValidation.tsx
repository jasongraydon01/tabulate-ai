'use client';

import type { DataValidationResult } from '@/schemas/wizardSchema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle, XCircle, Database, Scale, Repeat, FileSearch } from 'lucide-react';
import { useState, useEffect } from 'react';

// Validation stages that match the actual backend ValidationRunner
const VALIDATION_STAGES = [
  { icon: FileSearch, message: 'Reading data file structure...' },
  { icon: Database, message: 'Validating variable formats...' },
  { icon: Repeat, message: 'Detecting loop structures...' },
  { icon: Scale, message: 'Analyzing weight candidates...' },
];

interface StepDataValidationProps {
  validationResult: DataValidationResult;
  /** Called when user confirms a weight candidate — sets form.weightVariable */
  onWeightConfirm?: (column: string) => void;
  /** Called when user denies all weight candidates — clears form.weightVariable */
  onWeightDeny?: () => void;
}

export function StepDataValidation({
  validationResult: v,
  onWeightConfirm,
  onWeightDeny,
}: StepDataValidationProps) {
  // Track whether the user has made a decision about weight
  const [weightDecision, setWeightDecision] = useState<'confirmed' | 'denied' | null>(null);

  // Track current validation stage for simulated progress
  const [currentStageIndex, setCurrentStageIndex] = useState(0);

  // Cycle through validation stages while validating
  useEffect(() => {
    if (v.status !== 'validating') {
      setCurrentStageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setCurrentStageIndex((prev) => (prev + 1) % VALIDATION_STAGES.length);
    }, 2500); // Change stage every 2.5 seconds

    return () => clearInterval(interval);
  }, [v.status]);

  if (v.status === 'idle') return null;

  if (v.status === 'validating') {
    const currentStage = VALIDATION_STAGES[currentStageIndex];
    const StageIcon = currentStage.icon;

    return (
      <div aria-live="polite" aria-busy="true">
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <StageIcon className="h-4 w-4 animate-pulse text-primary" />
              {currentStage.message}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (v.status === 'error') {
    return (
      <div aria-live="polite">
        <Card className="border-tab-rose/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-tab-rose">
              <XCircle className="h-4 w-4" />
              Validation Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            {v.errors.map((err, i) => (
              <p key={i} className="text-sm text-tab-rose">{err.message}</p>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  const warnings = v.errors.filter((e) => e.severity === 'warning');
  const errors = v.errors.filter((e) => e.severity === 'error');

  return (
    <div className="space-y-4" aria-live="polite">
      {/* Stacked data warning */}
      {v.isStacked && (
        <Card className="border-tab-rose/40 bg-tab-rose-dim/10">
          <CardContent className="flex items-start gap-3 p-4">
            <XCircle className="h-5 w-5 text-tab-rose mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-tab-rose">Stacked data detected</p>
              <p className="text-sm text-muted-foreground mt-1">
                {v.stackedWarning || 'This data appears to be in stacked (long) format. The pipeline requires wide format with one row per respondent.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success summary */}
      {!v.isStacked && v.canProceed && (
        <Card className="border-tab-teal/40">
          <CardContent className="flex items-start gap-3 p-4">
            <CheckCircle className="h-5 w-5 text-tab-teal mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-tab-teal">Data file validated</p>
              <div className="flex gap-4 mt-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {v.rowCount.toLocaleString()} respondents
                </Badge>
                <Badge variant="outline" className="font-mono text-xs">
                  {v.columnCount.toLocaleString()} variables
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weight candidates with confirm/deny */}
      {v.weightCandidates.length > 0 && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <Scale className="h-5 w-5 text-tab-amber mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Weight variable detected</p>
              <p className="text-sm text-muted-foreground mt-1">
                Found{' '}
                <span className="font-mono text-foreground">
                  {v.weightCandidates[0].column}
                </span>
                {v.weightCandidates[0].label && (
                  <> ({v.weightCandidates[0].label})</>
                )}
                {' '}— mean {v.weightCandidates[0].mean.toFixed(3)}.
              </p>
              {v.weightCandidates.length > 1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {v.weightCandidates.length - 1} other candidate{v.weightCandidates.length > 2 ? 's' : ''} detected.
                </p>
              )}

              {/* Confirm/Deny buttons */}
              {weightDecision === null && (onWeightConfirm || onWeightDeny) && (
                <div className="flex gap-2 mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-tab-teal border-tab-teal/30 hover:bg-tab-teal/10"
                    onClick={() => {
                      setWeightDecision('confirmed');
                      onWeightConfirm?.(v.weightCandidates[0].column);
                    }}
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                    Yes, use this weight
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => {
                      setWeightDecision('denied');
                      onWeightDeny?.();
                    }}
                  >
                    No, run unweighted
                  </Button>
                </div>
              )}

              {/* Decision feedback */}
              {weightDecision === 'confirmed' && (
                <p className="text-xs text-tab-teal mt-2">
                  Weight confirmed. You can adjust this in the next step.
                </p>
              )}
              {weightDecision === 'denied' && (
                <p className="text-xs text-muted-foreground mt-2">
                  Running unweighted. You can change this in the next step.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}


      {/* Errors */}
      {errors.length > 0 && (
        <Card className="border-tab-rose/30">
          <CardContent className="space-y-2 p-4">
            {errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-tab-rose mt-0.5 shrink-0" />
                <p className="text-sm">{err.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <Card className="border-tab-amber/30">
          <CardContent className="space-y-2 p-4">
            {warnings.map((warn, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-tab-amber mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">{warn.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
