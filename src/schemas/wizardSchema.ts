/**
 * Wizard Form Schema
 *
 * Zod schema for the 4-step New Project wizard.
 * Used for client-side form validation (React Hook Form) and
 * server-side request validation.
 */

import { z } from 'zod';
import {
  AnalysisMethods,
  ExportFormats,
  LegacyProjectSubTypes,
  StudyMethodologies,
} from './projectConfigSchema';

// =============================================================================
// Enums / Literals
// =============================================================================

export const ProjectSubTypes = LegacyProjectSubTypes;
export type ProjectSubType = (typeof ProjectSubTypes)[number];

export const StudyMethodologyOptions = StudyMethodologies;
export type StudyMethodology = (typeof StudyMethodologyOptions)[number];

export const AnalysisMethodOptions = AnalysisMethods;
export type AnalysisMethod = (typeof AnalysisMethodOptions)[number];

export const BannerModes = ['upload', 'auto_generate'] as const;
export type BannerMode = (typeof BannerModes)[number];

export const MaxDiffMessageEntrySchema = z.object({
  code: z.string().min(1, 'Code is required'),
  text: z.string().min(1, 'Message text is required'),
  variantOf: z.string().optional(),
});

export type MaxDiffMessageEntry = z.infer<typeof MaxDiffMessageEntrySchema>;

export const DisplayModes = ['frequency', 'counts', 'both'] as const;
export type DisplayMode = (typeof DisplayModes)[number];

export const ExportFormatOptions = ExportFormats;
export type ExportFormat = (typeof ExportFormatOptions)[number];

// =============================================================================
// Wizard Form Schema (client-side, all 4 steps)
// =============================================================================

/**
 * Form schema for the wizard.
 * NOTE: Defaults are NOT set here (they cause input/output type mismatch with zodResolver).
 * Instead, provide defaults via useForm({ defaultValues }) in the page component.
 */
export const WizardFormSchema = z.object({
  // --- Step 1: Project Setup ---
  projectName: z.string().min(1, 'Project name is required'),
  researchObjectives: z.string().max(2000).optional(),
  projectSubType: z.enum(ProjectSubTypes).optional(),
  studyMethodology: z.enum(StudyMethodologyOptions),
  analysisMethod: z.enum(AnalysisMethodOptions),
  isWaveStudy: z.boolean(),
  segmentationHasAssignments: z.boolean().optional(),
  maxdiffHasMessageList: z.boolean().optional(),
  maxdiffHasAnchoredScores: z.boolean().optional(),
  isDemandSurvey: z.boolean().optional(),
  hasChoiceModelExercise: z.boolean().optional(),
  bannerMode: z.enum(BannerModes),
  bannerHints: z.string().max(2000).optional(),

  // --- Step 2.5: Message Stimuli (optional, for message testing studies) ---
  maxdiffMessages: z.array(MaxDiffMessageEntrySchema).optional(),

  // --- Step 3: Configuration ---
  displayMode: z.enum(DisplayModes),
  separateWorkbooks: z.boolean(),
  hideExcludedTables: z.boolean(),
  theme: z.string(),
  statTestingThreshold: z.number().min(50).max(99),
  minBaseSize: z.number().min(0),
  weightVariable: z.string().optional(),
  loopStatTestingMode: z.enum(['suppress', 'complement']).optional(),
  exportFormats: z.array(z.enum(ExportFormatOptions)).min(1, 'Select at least one export format'),
  wincrossProfileId: z.string().optional(),

  // --- Optional regroup override ---
  regroupUseCustomConfig: z.boolean(),
  regroupEnabled: z.boolean(),
  regroupMinSiblings: z.number().int().min(1),
  regroupMaxScaleCardinality: z.number().int().min(1),
  regroupAllowedSuffixPatterns: z.string().optional(),
  regroupBlockedSuffixPatterns: z.string().optional(),
  regroupAllowFamilyPatterns: z.string().optional(),
  regroupBlockFamilyPatterns: z.string().optional(),
  regroupMinAxisMargin: z.number().min(0).max(1),
  regroupMaxRowsPerRegroupedTable: z.number().int().min(1),
  regroupMinRowsPerRegroupedTable: z.number().int().min(1),
  regroupEmitDecisionReport: z.boolean(),
  regroupSuffixPriorR: z.number().min(0).max(1),
  regroupSuffixPriorC: z.number().min(0).max(1),
  regroupSuffixPriorDefault: z.number().min(0).max(1),
});

export type WizardFormValues = z.infer<typeof WizardFormSchema>;

// =============================================================================
// Per-step validation schemas (subset of fields validated at each step)
// =============================================================================

export const Step1Schema = WizardFormSchema.pick({
  projectName: true,
  researchObjectives: true,
  studyMethodology: true,
  analysisMethod: true,
  isWaveStudy: true,
  segmentationHasAssignments: true,
  maxdiffHasMessageList: true,
  maxdiffHasAnchoredScores: true,
  bannerMode: true,
  bannerHints: true,
});

export const Step3Schema = WizardFormSchema.pick({
  displayMode: true,
  separateWorkbooks: true,
  hideExcludedTables: true,
  theme: true,
  statTestingThreshold: true,
  minBaseSize: true,
  weightVariable: true,
  loopStatTestingMode: true,
  exportFormats: true,
  wincrossProfileId: true,
  regroupUseCustomConfig: true,
  regroupEnabled: true,
  regroupMinSiblings: true,
  regroupMaxScaleCardinality: true,
  regroupAllowedSuffixPatterns: true,
  regroupBlockedSuffixPatterns: true,
  regroupAllowFamilyPatterns: true,
  regroupBlockFamilyPatterns: true,
  regroupMinAxisMargin: true,
  regroupMaxRowsPerRegroupedTable: true,
  regroupMinRowsPerRegroupedTable: true,
  regroupEmitDecisionReport: true,
  regroupSuffixPriorR: true,
  regroupSuffixPriorC: true,
  regroupSuffixPriorDefault: true,
});

// =============================================================================
// Data Validation Result (returned by /api/validate-data, consumed by Step 2B)
// =============================================================================

export interface DataValidationResult {
  status: 'idle' | 'validating' | 'success' | 'error';
  rowCount: number;
  columnCount: number;
  weightCandidates: {
    column: string;
    label: string;
    score: number;
    mean: number;
  }[];
  isStacked: boolean;
  stackedWarning: string | null;
  /** Summary of loop detection — shown as informational, not a warning */
  loopSummary: { hasLoops: boolean; loopCount: number };
  errors: { message: string; severity: 'error' | 'warning' }[];
  canProceed: boolean;
}

export const INITIAL_VALIDATION: DataValidationResult = {
  status: 'idle',
  rowCount: 0,
  columnCount: 0,
  weightCandidates: [],
  isStacked: false,
  stackedWarning: null,
  loopSummary: { hasLoops: false, loopCount: 0 },
  errors: [],
  canProceed: false,
};
