'use client';

import { useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import type { WizardFormValues } from '@/schemas/wizardSchema';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { BarChart3, Info, Layers, Lightbulb, MessageSquare, TrendingUp, XCircle } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';

const METHODOLOGY_OPTIONS = [
  {
    value: 'standard' as const,
    label: 'Standard',
    description: 'General-purpose crosstabs with banner cuts',
    icon: BarChart3,
  },
  {
    value: 'message_testing' as const,
    label: 'Message Testing',
    description: 'Evaluate message performance across audience cuts',
    icon: MessageSquare,
  },
  {
    value: 'concept_testing' as const,
    label: 'Concept Testing',
    description: 'Concept-focused study with standard crosstabs',
    icon: Lightbulb,
  },
  {
    value: 'segmentation' as const,
    label: 'Segmentation',
    description: 'Segment-based analysis with assignments',
    icon: Layers,
  },
  {
    value: 'demand' as const,
    label: 'Demand Study',
    description: 'Demand modeling and preference share analysis',
    icon: TrendingUp,
  },
] as const;

export function StepProjectSetup() {
  const form = useFormContext<WizardFormValues>();
  const studyMethodology = form.watch('studyMethodology');
  const analysisMethod = form.watch('analysisMethod');
  const isWaveStudy = form.watch('isWaveStudy');
  const segmentationHasAssignments = form.watch('segmentationHasAssignments');
  const maxdiffHasMessageList = form.watch('maxdiffHasMessageList');
  const maxdiffHasAnchoredScores = form.watch('maxdiffHasAnchoredScores');
  const hasChoiceModelExercise = form.watch('hasChoiceModelExercise');
  const bannerMode = form.watch('bannerMode');

  // Derive analysisMethod from methodology toggles
  // MaxDiff is only available under message testing; otherwise standard_crosstab
  useEffect(() => {
    if (studyMethodology !== 'message_testing' && analysisMethod === 'maxdiff') {
      form.setValue('analysisMethod', 'standard_crosstab');
    }
  }, [analysisMethod, form, studyMethodology]);

  // Clear segmentation fields when switching away
  useEffect(() => {
    if (studyMethodology !== 'segmentation' && segmentationHasAssignments) {
      form.setValue('segmentationHasAssignments', false);
    }
  }, [form, segmentationHasAssignments, studyMethodology]);

  // Clear message testing fields when switching away
  useEffect(() => {
    if (studyMethodology !== 'message_testing') {
      if (maxdiffHasMessageList) {
        form.setValue('maxdiffHasMessageList', false);
      }
      if ((form.getValues('maxdiffMessages') ?? []).length > 0) {
        form.setValue('maxdiffMessages', []);
      }
    }
  }, [studyMethodology, form, maxdiffHasMessageList]);

  // Clear MaxDiff-specific fields when switching away from maxdiff
  useEffect(() => {
    if (analysisMethod !== 'maxdiff') {
      if (maxdiffHasAnchoredScores) {
        form.setValue('maxdiffHasAnchoredScores', false);
      }
    }
  }, [analysisMethod, form, maxdiffHasAnchoredScores]);

  // Clear demand fields when switching away
  useEffect(() => {
    if (studyMethodology !== 'demand') {
      if (hasChoiceModelExercise) {
        form.setValue('hasChoiceModelExercise', false);
      }
      if (form.getValues('isDemandSurvey')) {
        form.setValue('isDemandSurvey', false);
      }
    }
  }, [studyMethodology, form, hasChoiceModelExercise]);

  // Auto-set isDemandSurvey when demand methodology is selected
  useEffect(() => {
    if (studyMethodology === 'demand') {
      form.setValue('isDemandSurvey', true);
    }
  }, [studyMethodology, form]);

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      {/* Project name */}
      <FormField
        control={form.control}
        name="projectName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Project Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Q4 Brand Tracker" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Research objectives */}
      <FormField
        control={form.control}
        name="researchObjectives"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="inline-flex items-center gap-1.5">
              Research Objectives{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
              <InfoTooltip text="Used when auto-generating banner cuts. The more specific you are, the better." />
            </FormLabel>
            <FormControl>
              <Textarea
                placeholder="Brief description of what this study aims to understand"
                rows={2}
                {...field}
              />
            </FormControl>
          </FormItem>
        )}
      />

      {/* Study methodology cards */}
      <FormField
        control={form.control}
        name="studyMethodology"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Study Type</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                {METHODOLOGY_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isSelected = field.value === option.value;
                  return (
                    <label
                      key={option.value}
                      className="cursor-pointer"
                    >
                      <RadioGroupItem
                        value={option.value}
                        className="sr-only"
                      />
                      <Card
                        className={cn(
                          'transition-all relative',
                          'hover:border-foreground/20',
                          isSelected && 'ring-2 ring-primary border-primary'
                        )}
                      >
                        <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                          <Icon className={cn(
                            'h-6 w-6',
                            isSelected ? 'text-primary' : 'text-muted-foreground'
                          )} />
                          <span className="text-sm font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        </CardContent>
                      </Card>
                    </label>
                  );
                })}
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />

      {/* Wave study toggle */}
      <FormField
        control={form.control}
        name="isWaveStudy"
        render={({ field }) => (
          <FormItem className="flex items-center gap-3 rounded-lg border p-4">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-0.5">
                  <FormLabel className="text-sm inline-flex items-center gap-1.5">
                    Wave-over-wave study
                    <InfoTooltip text="Tag this project as one wave in a recurring tracking study. Helps keep table structures and labeling consistent." />
                  </FormLabel>
                </div>
              </FormItem>
            )}
          />
      {isWaveStudy && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            TabulateAI will tag this project as a tracking study. This helps keep table structures and labeling consistent for your data processor. We do not currently support trending across waves, but we will in a future phase.
          </p>
        </div>
      )}

      {/* Conditional: segmentation */}
      {studyMethodology === 'segmentation' && (
        <FormField
          control={form.control}
          name="segmentationHasAssignments"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 rounded-lg border p-4">
              <FormControl>
                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="text-sm inline-flex items-center gap-1.5">
                My data includes segment assignments
                <InfoTooltip text="The .sav file has a column assigning each respondent to a segment. Without it, segments won't be available as banner cuts." />
              </FormLabel>
            </FormItem>
          )}
        />
      )}

      {/* Conditional: demand study — choice model toggle */}
      {studyMethodology === 'demand' && (
        <FormField
          control={form.control}
          name="hasChoiceModelExercise"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 rounded-lg border p-4">
              <FormControl>
                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="text-sm inline-flex items-center gap-1.5">
                Includes choice model exercise
                <InfoTooltip text="The data contains a discrete choice or conjoint task. Choice model families will be handled separately from standard crosstabs." />
              </FormLabel>
            </FormItem>
          )}
        />
      )}

      {/* Conditional: message testing — message stimuli toggle + MaxDiff */}
      {studyMethodology === 'message_testing' && (
        <>
          <FormField
            control={form.control}
            name="maxdiffHasMessageList"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 rounded-lg border p-4">
                <FormControl>
                  <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="text-sm inline-flex items-center gap-1.5">
                  I have a message stimuli list
                  <InfoTooltip text="The next step will let you map item codes to full message text. Without it, labels may be truncated or use codes." />
                </FormLabel>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="analysisMethod"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 rounded-lg border p-4">
                <FormControl>
                  <Switch
                    checked={field.value === 'maxdiff'}
                    onCheckedChange={(checked) =>
                      field.onChange(checked ? 'maxdiff' : 'standard_crosstab')
                    }
                  />
                </FormControl>
                <FormLabel className="text-sm inline-flex items-center gap-1.5">
                  MaxDiff analysis
                  <InfoTooltip text="Best-worst scaling analysis for this message testing study." />
                </FormLabel>
              </FormItem>
            )}
          />
        </>
      )}

      {/* Conditional: MaxDiff-specific options (anchored scores) */}
      {analysisMethod === 'maxdiff' && (
        <>
          <FormField
            control={form.control}
            name="maxdiffHasAnchoredScores"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 rounded-lg border p-4">
                <FormControl>
                  <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="text-sm inline-flex items-center gap-1.5">
                  Anchored probability scores appended
                  <InfoTooltip text="Data includes anchored MaxDiff scores (not just raw choices)." />
                </FormLabel>
              </FormItem>
            )}
          />
          {maxdiffHasAnchoredScores === false && (
            <div className="flex items-start gap-3 rounded-lg border border-tab-rose/40 bg-tab-rose/5 p-4">
              <XCircle className="h-4 w-4 text-tab-rose mt-0.5 shrink-0" />
              <p className="text-sm text-tab-rose">
                Anchored probability scores must be appended to the .sav file before running MaxDiff crosstabs.
              </p>
            </div>
          )}
        </>
      )}

      {/* Banner plan mode */}
      <FormField
        control={form.control}
        name="bannerMode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Banner Plan</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <label className="cursor-pointer">
                  <RadioGroupItem value="upload" className="sr-only" />
                  <Card
                    className={cn(
                      'transition-all hover:border-foreground/20',
                      field.value === 'upload' && 'ring-2 ring-primary border-primary'
                    )}
                  >
                    <CardContent className="p-4 text-center">
                      <span className="text-sm font-medium">I have a banner plan</span>
                      <p className="text-xs text-muted-foreground mt-1">Upload a PDF or DOCX</p>
                    </CardContent>
                  </Card>
                </label>
                <label className="cursor-pointer">
                  <RadioGroupItem value="auto_generate" className="sr-only" />
                  <Card
                    className={cn(
                      'transition-all hover:border-foreground/20',
                      field.value === 'auto_generate' && 'ring-2 ring-primary border-primary'
                    )}
                  >
                    <CardContent className="p-4 text-center">
                      <span className="text-sm font-medium">Auto-generate for me</span>
                      <p className="text-xs text-muted-foreground mt-1">AI creates banner cuts from your data</p>
                    </CardContent>
                  </Card>
                </label>
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />

      {/* Banner hints — always shown */}
      <FormField
        control={form.control}
        name="bannerHints"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="inline-flex items-center gap-1.5">
              {bannerMode === 'upload' ? 'Banner Notes' : 'Banner Hints'}{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
              <InfoTooltip
                text={
                  bannerMode === 'upload'
                    ? 'Notes or clarifications for the AI when reading your banner plan.'
                    : 'Tell the AI what cuts you want. Be as specific or general as you like.'
                }
              />
            </FormLabel>
            <FormControl>
              <Textarea
                placeholder={
                  bannerMode === 'upload'
                    ? 'Any special instructions about the banner plan'
                    : 'e.g. "Include Total, Gender, Age groups, Region"'
                }
                rows={2}
                {...field}
              />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}
