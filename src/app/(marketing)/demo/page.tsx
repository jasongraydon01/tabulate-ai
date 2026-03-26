'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isPreviewFeatureEnabled } from '@/lib/featureGates';
import { useForm, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import {
  DemoWizardFormSchema,
  DemoStep1Schema,
  type DemoWizardFormValues,
} from '@/schemas/demoWizardSchema';
import { Step3Schema } from '@/schemas/wizardSchema';
import { wizardToProjectConfig } from '@/schemas/projectConfigSchema';
import { useDataValidation } from '@/hooks/useDataValidation';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { WizardShell, type WizardStep } from '@/components/wizard/WizardShell';
import { StepProjectSetup } from '@/components/wizard/StepProjectSetup';
import { StepUploadFiles, type WizardFiles } from '@/components/wizard/StepUploadFiles';
import { StepMaxDiffMessages, validateMessages } from '@/components/wizard/StepMaxDiffMessages';
import { StepConfiguration } from '@/components/wizard/StepConfiguration';
import { StepReviewLaunch } from '@/components/wizard/StepReviewLaunch';
import { DemoPrivacyNotice } from '@/components/wizard/DemoPrivacyNotice';
import { DemoLimitationsCallout } from '@/components/wizard/DemoLimitationsCallout';
import { GridBackground } from '@/components/ui/grid-background';

// Step definitions
const STANDARD_STEPS: WizardStep[] = [
  { number: 1, label: 'Project Setup' },
  { number: 2, label: 'Upload & Validate' },
  { number: 3, label: 'Configure' },
  { number: 4, label: 'Review & Submit' },
];

const MESSAGE_TESTING_STEPS: WizardStep[] = [
  { number: 1, label: 'Project Setup' },
  { number: 2, label: 'Upload & Validate' },
  { number: 3, label: 'Message Stimuli' },
  { number: 4, label: 'Configure' },
  { number: 5, label: 'Review & Submit' },
];

/** @temporary — remove gate when demo is production-ready */
export default function DemoPage() {
  const router = useRouter();

  // @temporary — redirect to home in production
  useEffect(() => {
    if (!isPreviewFeatureEnabled()) router.replace('/');
  }, [router]);

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [files, setFiles] = useState<WizardFiles>({
    dataFile: null,
    surveyDocument: null,
    bannerPlan: null,
    messageList: null,
  });

  const form = useForm<DemoWizardFormValues>({
    resolver: zodResolver(DemoWizardFormSchema),
    mode: 'onChange',
    defaultValues: {
      // Lead capture
      demoName: '',
      demoEmail: '',
      demoCompany: '',
      // Project setup (same defaults as production wizard)
      projectName: '',
      researchObjectives: '',
      studyMethodology: 'standard',
      analysisMethod: 'standard_crosstab',
      isWaveStudy: false,
      segmentationHasAssignments: false,
      maxdiffHasMessageList: false,
      maxdiffHasAnchoredScores: false,
      isDemandSurvey: false,
      hasChoiceModelExercise: false,
      bannerMode: 'upload',
      bannerHints: '',
      maxdiffMessages: [],
      // Configuration
      displayMode: 'frequency',
      separateWorkbooks: false,
      hideExcludedTables: false,
      theme: 'classic',
      statTestingThreshold: 90,
      minBaseSize: 0,
      weightVariable: undefined,
      loopStatTestingMode: undefined,
      exportFormats: ['excel'],
      wincrossProfileId: '',
      // Regroup defaults
      regroupUseCustomConfig: false,
      regroupEnabled: true,
      regroupMinSiblings: 3,
      regroupMaxScaleCardinality: 7,
      regroupAllowedSuffixPatterns: '^r\\d+$',
      regroupBlockedSuffixPatterns: '',
      regroupAllowFamilyPatterns: '',
      regroupBlockFamilyPatterns: '',
      regroupMinAxisMargin: 0.12,
      regroupMaxRowsPerRegroupedTable: 200,
      regroupMinRowsPerRegroupedTable: 2,
      regroupEmitDecisionReport: true,
      regroupSuffixPriorR: 0.6,
      regroupSuffixPriorC: 0.4,
      regroupSuffixPriorDefault: 0.5,
    },
  });

  const validationResult = useDataValidation(files.dataFile, '/api/demo/validate-data');

  const handleFileChange = useCallback(<K extends keyof WizardFiles>(key: K, file: WizardFiles[K]) => {
    setFiles((prev) => ({ ...prev, [key]: file }));
  }, []);

  // Dynamic steps based on study methodology
  const studyMethodology = form.watch('studyMethodology');
  const bannerMode = form.watch('bannerMode');
  const analysisMethod = form.watch('analysisMethod');
  const maxdiffHasMessageList = form.watch('maxdiffHasMessageList');
  const isMessageTesting = studyMethodology === 'message_testing';
  const steps = isMessageTesting ? MESSAGE_TESTING_STEPS : STANDARD_STEPS;
  const totalSteps = steps.length;
  const messagesStep = isMessageTesting ? 3 : -1;
  const configureStep = isMessageTesting ? 4 : 3;
  const reviewStep = totalSteps;

  // Per-step validation
  const validateCurrentStep = (): boolean => {
    const values = form.getValues();

    if (currentStep === 1) {
      const result = DemoStep1Schema.safeParse(values);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string;
          form.setError(field as keyof DemoWizardFormValues, { message: issue.message });
        }
        return false;
      }
      return true;
    }

    if (currentStep === 2) {
      if (!files.dataFile || !files.surveyDocument) {
        toast.error('Please upload all required files');
        return false;
      }
      if (bannerMode === 'upload' && !files.bannerPlan) {
        toast.error('Please upload a banner plan');
        return false;
      }
      return true;
    }

    if (currentStep === messagesStep) {
      const messages = values.maxdiffMessages ?? [];
      const validation = validateMessages(messages);
      if (validation.errors.length > 0) {
        toast.error(validation.errors[0]);
        return false;
      }
      return true;
    }

    if (currentStep === configureStep) {
      const result = Step3Schema.safeParse(values);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path[0] as string;
          form.setError(field as keyof DemoWizardFormValues, { message: issue.message });
        }
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (currentStep === reviewStep) {
      handleLaunch();
      return;
    }
    if (!validateCurrentStep()) return;
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLaunch = async () => {
    setIsSubmitting(true);
    try {
      const values = form.getValues();
      const config = wizardToProjectConfig(values);
      const formData = new FormData();

      // Files
      formData.append('dataFile', files.dataFile!);
      formData.append('surveyDocument', files.surveyDocument!);
      if (files.bannerPlan && values.bannerMode === 'upload') {
        formData.append('bannerPlan', files.bannerPlan);
      }

      // Lead capture
      formData.append('name', values.demoName);
      formData.append('email', values.demoEmail);
      if (values.demoCompany) formData.append('company', values.demoCompany);
      formData.append('projectName', values.projectName);

      // Config as JSON
      formData.append('config', JSON.stringify(config));

      // Honeypot (empty — bots fill it)
      formData.append('website', '');

      const response = await fetch('/api/demo/launch', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Launch failed' }));
        throw new Error(errorData.error || 'Launch failed');
      }

      const result = await response.json();

      toast.success('Demo submitted', {
        description: 'Check your email to confirm delivery.',
      });

      router.push(`/demo/status?token=${encodeURIComponent(result.token)}`);
    } catch (error) {
      console.error('Demo launch error:', error);
      toast.error('Demo launch failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getNextDisabled = (): boolean => {
    if (isSubmitting) return true;
    if (currentStep === 2) {
      return (
        !files.dataFile ||
        !files.surveyDocument ||
        (bannerMode === 'upload' && !files.bannerPlan) ||
        validationResult.status === 'validating' ||
        validationResult.status === 'error' ||
        validationResult.isStacked ||
        !validationResult.canProceed
      );
    }
    return false;
  };

  return (
    <>
      <GridBackground variant="section" fadeBottom vignette className="pt-28 pb-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 bg-secondary/80 border border-border rounded-full text-xs font-mono text-muted-foreground tracking-wider uppercase mb-10">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            Demo mode
          </div>
          <h1 className="editorial-display text-3xl sm:text-4xl lg:text-5xl mb-5">
            Try TabulateAI on <span className="editorial-emphasis">your data</span>
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Upload your .sav file and survey document. We&apos;ll process the first 100 respondents
            and produce 25 tables &mdash; delivered to your inbox.
          </p>
        </div>
      </GridBackground>

      <div className="max-w-4xl mx-auto px-6 pb-28 pt-10">
        <Form {...form}>
          <form onSubmit={(e) => e.preventDefault()}>
            <WizardShell
              currentStep={currentStep}
              onBack={handleBack}
              onNext={handleNext}
              nextDisabled={getNextDisabled()}
              nextLabel={currentStep === reviewStep ? 'Submit Demo' : undefined}
              isSubmitting={isSubmitting}
              steps={steps}
              showBack={currentStep > 1}
            >
              {currentStep === 1 && <DemoStepOne />}
              {currentStep === 2 && (
                <StepUploadFiles
                  files={files}
                  onFileChange={handleFileChange}
                  bannerMode={bannerMode}
                  analysisMethod={analysisMethod}
                  studyMethodology={studyMethodology}
                  maxdiffHasMessageList={maxdiffHasMessageList}
                  validationResult={validationResult}
                  onWeightConfirm={(col) => form.setValue('weightVariable', col)}
                  onWeightDeny={() => form.setValue('weightVariable', undefined)}
                />
              )}
              {currentStep === messagesStep && <StepMaxDiffMessages />}
              {currentStep === configureStep && (
                <StepConfiguration validationResult={validationResult} demoMode />
              )}
              {currentStep === reviewStep && (
                <div className="space-y-6">
                  <DemoLimitationsCallout />
                  <StepReviewLaunch
                    values={form.getValues()}
                    files={files}
                    validationResult={validationResult}
                  />
                </div>
              )}
            </WizardShell>
          </form>
        </Form>
      </div>
    </>
  );
}

// =============================================================================
// Demo Step 1: Lead Capture + Project Setup
// =============================================================================

function DemoStepOne() {
  const form = useFormContext<DemoWizardFormValues>();

  return (
    <div className="space-y-8">
      {/* Lead capture section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground mb-1">Your details</h3>
          <p className="text-xs text-muted-foreground">So we can send you the results.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="demoName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Your name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="demoEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="you@company.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="demoCompany"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Company <span className="text-muted-foreground font-normal">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Your company" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DemoPrivacyNotice />
      </div>

      {/* Divider */}
      <hr className="border-border" />

      {/* Reuse the full project setup component from the production wizard */}
      <StepProjectSetup />
    </div>
  );
}
