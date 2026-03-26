'use client';

import { Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const DEFAULT_STEPS: WizardStep[] = [
  { number: 1, label: 'Project Setup' },
  { number: 2, label: 'Upload & Validate' },
  { number: 3, label: 'Configure' },
  { number: 4, label: 'Review & Launch' },
];

export interface WizardStep {
  number: number;
  label: string;
}

interface WizardShellProps {
  currentStep: number;
  children: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  showBack?: boolean;
  isSubmitting?: boolean;
  steps?: WizardStep[];
}

export function WizardShell({
  currentStep,
  children,
  onBack,
  onNext,
  nextDisabled = false,
  nextLabel,
  showBack = true,
  isSubmitting = false,
  steps = DEFAULT_STEPS,
}: WizardShellProps) {
  const totalSteps = steps.length;
  const isLastStep = currentStep === totalSteps;

  return (
    <div className="flex flex-col gap-8">
      {/* Step indicator */}
      <nav aria-label="Wizard steps" className="flex items-center justify-center gap-2">
        {steps.map((step, i) => {
          const isActive = step.number === currentStep;
          const isComplete = step.number < currentStep;
          const isUpcoming = step.number > currentStep;

          return (
            <div key={step.number} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={cn(
                    'h-px w-8 sm:w-12',
                    isComplete ? 'bg-tab-teal' : 'bg-border'
                  )}
                />
              )}
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
                    isComplete && 'bg-tab-teal/20 text-tab-teal',
                    isActive && 'bg-primary/15 text-primary ring-2 ring-primary/50',
                    isUpcoming && 'bg-muted text-muted-foreground'
                  )}
                >
                  {isComplete ? <Check className="h-4 w-4" /> : step.number}
                </div>
                <span
                  className={cn(
                    'hidden text-sm sm:inline',
                    isActive && 'font-medium text-foreground',
                    isComplete && 'text-tab-teal',
                    isUpcoming && 'font-mono text-[11px] uppercase tracking-wider text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Step content with transition */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          className="min-h-[400px]"
        >
          {children}
        </motion.div>
      </AnimatePresence>

      {/* Navigation footer */}
      <div className="flex items-center justify-between border-t pt-6">
        <div>
          {showBack && currentStep > 1 && (
            <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
              Back
            </Button>
          )}
        </div>
        <Button
          onClick={onNext}
          disabled={nextDisabled || isSubmitting}
        >
          {isSubmitting ? 'Launching...' : nextLabel ?? (isLastStep ? 'Launch Pipeline' : 'Next')}
        </Button>
      </div>
    </div>
  );
}
