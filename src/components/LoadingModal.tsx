'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

export interface JobProgress {
  percent: number;
  message: string;
}

export interface ProcessingStep {
  step: 'initial' | 'banner' | 'crosstab' | 'complete';
  message: string;
}

interface LoadingModalProps {
  isOpen: boolean;
  currentStep?: ProcessingStep; // backward compat
  jobProgress?: JobProgress;    // preferred
}

const STEP_PROGRESS = {
  initial: 5,
  banner: 40,
  crosstab: 80,
  complete: 100
};

const STEP_MESSAGES = {
  initial: 'Processing your files...',
  banner: 'Creating banner plan...',
  crosstab: 'Generating crosstabs...',
  complete: 'Almost done...'
};

export default function LoadingModal({ isOpen, currentStep, jobProgress }: LoadingModalProps) {
  const step = currentStep?.step || 'initial';
  const fallbackMessage = currentStep?.message || STEP_MESSAGES[step];
  const fallbackProgress = STEP_PROGRESS[step];
  const message = jobProgress?.message ?? fallbackMessage;
  const progress = jobProgress?.percent ?? fallbackProgress;

  return (
    <Dialog open={isOpen}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="text-lg font-medium text-center mb-4">
          Processing Files
        </DialogTitle>
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-6">
            {message}
          </p>

          <Progress value={progress} className="mb-4" />
          
          <p className="text-xs text-muted-foreground">
            {progress}% complete
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}