'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import posthog from 'posthog-js';
import Link from 'next/link';

import { WizardFormSchema, Step1Schema, Step3Schema, type WizardFormValues } from '@/schemas/wizardSchema';
import { wizardToProjectConfig } from '@/schemas/projectConfigSchema';
import { useDataValidation } from '@/hooks/useDataValidation';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { PageHeader } from '@/components/PageHeader';
import { Form } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { WizardShell, type WizardStep } from '@/components/wizard/WizardShell';
import { StepProjectSetup } from '@/components/wizard/StepProjectSetup';
import { StepUploadFiles, type WizardFiles } from '@/components/wizard/StepUploadFiles';
import { StepMaxDiffMessages, validateMessages } from '@/components/wizard/StepMaxDiffMessages';
import { StepConfiguration } from '@/components/wizard/StepConfiguration';
import { StepReviewLaunch } from '@/components/wizard/StepReviewLaunch';
import { useAuthContext } from '@/providers/auth-provider';

// Step definitions — message testing studies get an extra Messages step
const STANDARD_STEPS: WizardStep[] = [
  { number: 1, label: 'Project Setup' },
  { number: 2, label: 'Upload & Validate' },
  { number: 3, label: 'Configure' },
  { number: 4, label: 'Review & Launch' },
];

const MESSAGE_TESTING_STEPS: WizardStep[] = [
  { number: 1, label: 'Project Setup' },
  { number: 2, label: 'Upload & Validate' },
  { number: 3, label: 'Message Stimuli' },
  { number: 4, label: 'Configure' },
  { number: 5, label: 'Review & Launch' },
];

// Step name map for analytics (keyed by step number per project type)
const STANDARD_STEP_NAMES = ['project_setup', 'upload_files', 'configuration', 'review'];
const MESSAGE_TESTING_STEP_NAMES = ['project_setup', 'upload_files', 'messages', 'configuration', 'review'];

export default function NewProjectPage() {
  const router = useRouter();
  const { hasActiveSubscription } = useAuthContext();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // File state (separate from form — File objects aren't serializable via Zod)
  const [files, setFiles] = useState<WizardFiles>({
    dataFile: null,
    surveyDocument: null,
    bannerPlan: null,
    messageList: null,
  });

  const form = useForm<WizardFormValues>({
    resolver: zodResolver(WizardFormSchema),
    mode: 'onChange',
    defaultValues: {
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

  // Data validation — auto-triggers when dataFile changes
  const validationResult = useDataValidation(files.dataFile);

  // Pre-select best weight candidate when validation succeeds
  const handleFileChange = useCallback(<K extends keyof WizardFiles>(key: K, file: WizardFiles[K]) => {
    setFiles((prev) => ({ ...prev, [key]: file }));

    // Track file upload event
    if (file) {
      const fileObj = file as File;
      posthog.capture('file_uploaded', {
        file_type: key,
        file_name: fileObj.name,
        file_size_bytes: fileObj.size,
        file_extension: fileObj.name.split('.').pop()?.toLowerCase(),
      });
    }
  }, []);

  // Auto-select best weight candidate when validation succeeds
  useEffect(() => {
    if (
      validationResult.status === 'success' &&
      validationResult.weightCandidates.length > 0 &&
      form.getValues('weightVariable') === undefined
    ) {
      form.setValue('weightVariable', validationResult.weightCandidates[0].column);
    }
  }, [validationResult.status, validationResult.weightCandidates, form]);

  const bannerMode = form.watch('bannerMode');
  const studyMethodology = form.watch('studyMethodology');
  const analysisMethod = form.watch('analysisMethod');
  const maxdiffHasMessageList = form.watch('maxdiffHasMessageList');

  // Dynamic step configuration based on study methodology
  const isMessageTesting = studyMethodology === 'message_testing';
  const steps = isMessageTesting ? MESSAGE_TESTING_STEPS : STANDARD_STEPS;
  const totalSteps = steps.length;
  const stepNames = isMessageTesting ? MESSAGE_TESTING_STEP_NAMES : STANDARD_STEP_NAMES;

  // Step number mapping: which logical step maps to which component
  const configureStep = isMessageTesting ? 4 : 3;
  const reviewStep = isMessageTesting ? 5 : 4;
  const messagesStep = isMessageTesting ? 3 : null; // null for non-message-testing projects

  // When switching away from message testing, clamp step if user was on messages/later step
  useEffect(() => {
    if (!isMessageTesting && currentStep > 4) {
      setCurrentStep(4);
    }
  }, [isMessageTesting, currentStep]);

  // Clear stale files when options change
  useEffect(() => {
    if (bannerMode !== 'upload' && files.bannerPlan) {
      setFiles((prev) => ({ ...prev, bannerPlan: null }));
    }
  }, [bannerMode, files.bannerPlan]);

  // Message list file upload handled by Step 3 (Message Stimuli) for message testing studies

  // Per-step validation
  const validateCurrentStep = async (): Promise<boolean> => {
    if (currentStep === 1) {
      const values = form.getValues();
      const result = Step1Schema.safeParse(values);
      if (!result.success) {
        await form.trigger(['projectName', 'studyMethodology', 'analysisMethod', 'isWaveStudy', 'bannerMode']);
        return false;
      }
      if (values.analysisMethod === 'maxdiff' && !values.maxdiffHasAnchoredScores) {
        toast.info('No anchored probability scores detected', {
          description: 'The pipeline will report which score families are present in the data file.',
        });
      }
      return true;
    }

    if (currentStep === 2) {
      if (!files.dataFile) {
        toast.error('Data file is required');
        return false;
      }
      if (!files.surveyDocument) {
        toast.error('Survey document is required');
        return false;
      }
      if (bannerMode === 'upload' && !files.bannerPlan) {
        toast.error('Banner plan is required (or switch to auto-generate)');
        return false;
      }
      if (validationResult.status === 'validating') {
        toast.error('Please wait for data validation to complete');
        return false;
      }
      if (validationResult.status === 'error') {
        toast.error('Data validation failed — please check your data file');
        return false;
      }
      if (validationResult.isStacked) {
        toast.error('Stacked data detected — pipeline requires wide format');
        return false;
      }
      if (!validationResult.canProceed) {
        toast.error('Data validation has blocking errors');
        return false;
      }
      return true;
    }

    if (currentStep === messagesStep) {
      // Messages step validation: allow skipping (empty is ok — falls back to .sav labels)
      const messages = form.getValues('maxdiffMessages') ?? [];
      if (messages.length > 0) {
        const validation = validateMessages(messages);
        if (!validation.isValid) {
          toast.error('Message list has errors', {
            description: validation.errors[0],
          });
          return false;
        }
      }
      return true;
    }

    if (currentStep === configureStep) {
      const values = form.getValues();
      const result = Step3Schema.safeParse(values);
      if (!result.success) {
        await form.trigger([
          'displayMode', 'separateWorkbooks', 'theme',
          'statTestingThreshold', 'minBaseSize', 'weightVariable', 'loopStatTestingMode',
          'exportFormats', 'wincrossProfileId',
          'regroupUseCustomConfig',
          'regroupEnabled',
          'regroupMinSiblings',
          'regroupMaxScaleCardinality',
          'regroupAllowedSuffixPatterns',
          'regroupBlockedSuffixPatterns',
          'regroupAllowFamilyPatterns',
          'regroupBlockFamilyPatterns',
          'regroupMinAxisMargin',
          'regroupMaxRowsPerRegroupedTable',
          'regroupMinRowsPerRegroupedTable',
          'regroupEmitDecisionReport',
          'regroupSuffixPriorR',
          'regroupSuffixPriorC',
          'regroupSuffixPriorDefault',
        ]);
        return false;
      }
      return true;
    }

    if (currentStep === reviewStep) {
      return true; // Review step — always valid
    }

    return true;
  };

  const handleNext = async () => {
    const valid = await validateCurrentStep();
    if (!valid) return;

    if (currentStep === reviewStep) {
      // Launch
      await handleLaunch();
    } else {
      // Track wizard step completion
      posthog.capture('wizard_step_completed', {
        step_number: currentStep,
        step_name: stepNames[currentStep - 1],
      });

      setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLaunch = async () => {
    setIsSubmitting(true);

    try {
      const values = form.getValues();
      const formData = new FormData();
      const config = wizardToProjectConfig(values);

      // Files
      formData.append('dataFile', files.dataFile!);
      formData.append('surveyDocument', files.surveyDocument!);
      if (files.bannerPlan && values.bannerMode === 'upload') {
        formData.append('bannerPlan', files.bannerPlan);
      }
      // Message list handled via config.maxdiffMessages from the Message Stimuli step

      // Config as JSON — use shared mapping function
      formData.append('config', JSON.stringify(config));
      formData.append('projectName', values.projectName);

      const response = await fetch('/api/projects/launch', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Launch failed' }));
        if (response.status === 402 && errorData?.action === 'redirect_to_pricing') {
          toast.info('Choose a billing plan before launching a project.');
          router.push('/pricing');
          return;
        }
        throw new Error(errorData.error || 'Launch failed');
      }

      const result = await response.json();

      // Track successful project creation
      posthog.capture('project_created', {
        project_id: result.projectId,
        project_name: values.projectName,
        project_type: config.projectSubType,
        study_methodology: config.studyMethodology,
        analysis_method: config.analysisMethod,
        is_wave_study: config.isWaveStudy,
        export_formats: config.exportFormats,
        banner_mode: values.bannerMode,
        has_weight_variable: !!values.weightVariable,
        has_maxdiff_messages: (values.maxdiffMessages?.length ?? 0) > 0,
        display_mode: values.displayMode,
        theme: values.theme,
      });

      toast.success('Pipeline started', {
        description: 'Tracking progress on the project page.',
      });

      router.push(`/projects/${encodeURIComponent(result.projectId)}`);
    } catch (error) {
      console.error('Launch error:', error);
      toast.error('Launch failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Compute next-disabled based on step
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

  if (!hasActiveSubscription) {
    return (
      <div>
        <AppBreadcrumbs segments={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'New Project' }]} />

        <div className="max-w-2xl mt-6">
          <PageHeader
            title="New Project"
            description="Choose a billing plan before launching a new project."
          />

          <div className="rounded-lg border border-border/60 bg-card p-6">
            <p className="text-sm text-muted-foreground mb-4">
              Your organization does not have an active billing plan yet. Choose a plan to enable project creation.
            </p>
            <Button asChild>
              <Link href="/pricing">Choose Plan</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppBreadcrumbs segments={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'New Project' }]} />

      <div className="max-w-4xl mt-6">
        <PageHeader
          title="New Project"
          description="Set up your crosstab project in a few steps. Upload data, configure options, and launch."
        />

        <Form {...form}>
          <form onSubmit={(e) => e.preventDefault()}>
            <WizardShell
              currentStep={currentStep}
              onBack={handleBack}
              onNext={handleNext}
              nextDisabled={getNextDisabled()}
              isSubmitting={isSubmitting}
              steps={steps}
            >
              {currentStep === 1 && <StepProjectSetup />}
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
                <StepConfiguration validationResult={validationResult} />
              )}
              {currentStep === reviewStep && (
                <StepReviewLaunch
                  values={form.getValues()}
                  files={files}
                  validationResult={validationResult}
                />
              )}
            </WizardShell>
          </form>
        </Form>
      </div>
    </div>
  );
}
