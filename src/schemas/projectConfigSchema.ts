/**
 * Project Config Schema
 *
 * Shape stored in Convex project.config and run.config.
 * This is the canonical server-side representation of all pipeline options.
 * The wizard form values are mapped to this shape before persisting.
 */

import { z } from 'zod';
import { TablePresentationConfigSchema } from '@/lib/tablePresentation/labelVocabulary';

export const LegacyProjectSubTypes = ['standard', 'segmentation', 'maxdiff'] as const;
export type LegacyProjectSubType = (typeof LegacyProjectSubTypes)[number];

export const StudyMethodologies = ['standard', 'message_testing', 'concept_testing', 'segmentation', 'demand'] as const;
export type StudyMethodology = (typeof StudyMethodologies)[number];

export const AnalysisMethods = ['standard_crosstab', 'maxdiff'] as const;
export type AnalysisMethod = (typeof AnalysisMethods)[number];

export const ExportFormats = ['excel', 'q', 'wincross'] as const;
export type ExportFormat = (typeof ExportFormats)[number];

export const ProjectConfigSchema = z.object({
  // Project identity
  projectSubType: z.enum(LegacyProjectSubTypes).default('standard'),
  studyMethodology: z.enum(StudyMethodologies).optional(),
  analysisMethod: z.enum(AnalysisMethods).optional(),
  isWaveStudy: z.boolean().optional(),
  isDemandSurvey: z.boolean().optional(),
  hasChoiceModelExercise: z.boolean().optional(),
  maxdiffHasAnchoredScores: z.boolean().optional(),
  exportFormats: z.array(z.enum(ExportFormats)).optional(),
  wincrossProfileId: z.string().optional(),
  tablePresentation: TablePresentationConfigSchema.optional(),
  bannerMode: z.enum(['upload', 'auto_generate']).default('upload'),
  researchObjectives: z.string().max(2000).optional(),
  bannerHints: z.string().max(2000).optional(),

  // MaxDiff messages (structured data from wizard grid, optional)
  maxdiffMessages: z.array(z.object({
    code: z.string(),
    text: z.string(),
    variantOf: z.string().optional(),
  })).optional(),
  maxdiffPolicy: z.object({
    includeChoiceTaskFamilyInMainOutput: z.boolean().default(false),
    maxSplitTablesPerInput: z.number().int().min(1).default(20),
    allowDerivedTablesForChoiceTasks: z.boolean().default(false),
    placeholderResolutionRequired: z.boolean().default(true),
  }).optional(),

  // Display / Excel
  format: z.enum(['standard', 'stacked']).default('standard'),
  displayMode: z.enum(['frequency', 'counts', 'both']).default('frequency'),
  separateWorkbooks: z.boolean().default(false),
  hideExcludedTables: z.boolean().default(false),
  theme: z.string().default('classic'),

  // Statistical testing
  statTesting: z.object({
    thresholds: z.array(z.number()).default([90]),
    minBase: z.number().default(0),
  }).default({ thresholds: [90], minBase: 0 }),

  // Weights
  weightVariable: z.string().optional(),

  // Loop handling
  loopStatTestingMode: z.enum(['suppress', 'complement']).optional(),

  // Pipeline control
  /** @deprecated Not respected by the V3 pipeline. Retained for backward compatibility. */
  stopAfterVerification: z.boolean().default(false),

  // Demo mode — public trial with limited output
  demoMode: z.boolean().optional().default(false),
  maxRespondents: z.number().int().min(1).optional(),
  maxTables: z.number().int().min(1).optional(),

  // Regrouping (optional override; omitted uses env/default behavior)
  regrouping: z.object({
    enabled: z.boolean().optional(),
    minSiblings: z.number().int().min(1).optional(),
    maxScaleCardinality: z.number().int().min(1).optional(),
    allowedSuffixPatterns: z.array(z.string()).optional(),
    blockedSuffixPatterns: z.array(z.string()).optional(),
    allowFamilyPatterns: z.array(z.string()).optional(),
    blockFamilyPatterns: z.array(z.string()).optional(),
    minAxisMargin: z.number().min(0).max(1).optional(),
    maxRowsPerRegroupedTable: z.number().int().min(1).optional(),
    minRowsPerRegroupedTable: z.number().int().min(1).optional(),
    emitDecisionReport: z.boolean().optional(),
    suffixClassPriorWeights: z.object({
      r: z.number().min(0).max(1).optional(),
      c: z.number().min(0).max(1).optional(),
      default: z.number().min(0).max(1).optional(),
    }).optional(),
  }).optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export interface StudyFlags {
  isDemandSurvey: boolean;
  hasChoiceModelExercise: boolean | null;
  hasMaxDiff: boolean;
}

export function deriveLegacyProjectSubType(config: ProjectConfig): LegacyProjectSubType {
  if (config.analysisMethod === 'maxdiff') return 'maxdiff';
  if (config.studyMethodology === 'segmentation') return 'segmentation';
  // Demand maps to 'standard' in the legacy sub-type system
  if (config.studyMethodology === 'demand') return 'standard';
  return config.projectSubType ?? 'standard';
}

export function deriveMethodologyFromLegacy(config: ProjectConfig): {
  studyMethodology: StudyMethodology;
  analysisMethod: AnalysisMethod;
} {
  if (config.studyMethodology) {
    return {
      studyMethodology: config.studyMethodology,
      analysisMethod: config.analysisMethod ?? 'standard_crosstab',
    };
  }
  if (config.projectSubType === 'maxdiff') {
    return { studyMethodology: 'message_testing', analysisMethod: 'maxdiff' };
  }
  if (config.projectSubType === 'segmentation') {
    return { studyMethodology: 'segmentation', analysisMethod: 'standard_crosstab' };
  }
  return { studyMethodology: 'standard', analysisMethod: 'standard_crosstab' };
}

export function deriveStudyFlagsFromConfig(config: ProjectConfig): StudyFlags {
  const { studyMethodology, analysisMethod } = deriveMethodologyFromLegacy(config);

  return {
    isDemandSurvey: config.isDemandSurvey ?? studyMethodology === 'demand',
    hasChoiceModelExercise: config.hasChoiceModelExercise ?? null,
    hasMaxDiff: analysisMethod === 'maxdiff',
  };
}

/**
 * Convert wizard form values + any overrides into a ProjectConfig.
 * This is the boundary between the UI form and the server-side config.
 */
export function wizardToProjectConfig(wizard: {
  projectSubType?: string;
  studyMethodology?: string;
  analysisMethod?: string;
  isWaveStudy?: boolean;
  isDemandSurvey?: boolean;
  hasChoiceModelExercise?: boolean;
  maxdiffHasAnchoredScores?: boolean;
  exportFormats?: string[];
  wincrossProfileId?: string;
  tablePresentation?: z.infer<typeof TablePresentationConfigSchema>;
  bannerMode?: string;
  researchObjectives?: string;
  bannerHints?: string;
  maxdiffMessages?: Array<{ code: string; text: string; variantOf?: string }>;
  maxdiffPolicy?: {
    includeChoiceTaskFamilyInMainOutput?: boolean;
    maxSplitTablesPerInput?: number;
    allowDerivedTablesForChoiceTasks?: boolean;
    placeholderResolutionRequired?: boolean;
  };
  format?: string;
  displayMode?: string;
  separateWorkbooks?: boolean;
  hideExcludedTables?: boolean;
  theme?: string;
  statTestingThreshold?: number;
  minBaseSize?: number;
  weightVariable?: string;
  stopAfterVerification?: boolean;
  loopStatTestingMode?: 'suppress' | 'complement';
  regroupUseCustomConfig?: boolean;
  regroupEnabled?: boolean;
  regroupMinSiblings?: number;
  regroupMaxScaleCardinality?: number;
  regroupAllowedSuffixPatterns?: string;
  regroupBlockedSuffixPatterns?: string;
  regroupAllowFamilyPatterns?: string;
  regroupBlockFamilyPatterns?: string;
  regroupMinAxisMargin?: number;
  regroupMaxRowsPerRegroupedTable?: number;
  regroupMinRowsPerRegroupedTable?: number;
  regroupEmitDecisionReport?: boolean;
  regroupSuffixPriorR?: number;
  regroupSuffixPriorC?: number;
  regroupSuffixPriorDefault?: number;
}): ProjectConfig {
  const customRegroupingEnabled = wizard.regroupUseCustomConfig === true;
  const parsePatternList = (input?: string): string[] | undefined => {
    if (input === undefined) return undefined;
    if (!input.trim()) return [];
    return input.split(',').map(s => s.trim()).filter(Boolean);
  };

  const parsedConfig = ProjectConfigSchema.parse({
    projectSubType: wizard.projectSubType ?? 'standard',
    studyMethodology: wizard.studyMethodology ?? 'standard',
    analysisMethod: wizard.analysisMethod ?? 'standard_crosstab',
    isWaveStudy: wizard.isWaveStudy ?? false,
    isDemandSurvey: wizard.isDemandSurvey ?? (wizard.studyMethodology === 'demand'),
    hasChoiceModelExercise: wizard.hasChoiceModelExercise ?? false,
    maxdiffHasAnchoredScores: wizard.maxdiffHasAnchoredScores ?? false,
    exportFormats: wizard.exportFormats?.length ? wizard.exportFormats : ['excel'],
    wincrossProfileId: wizard.wincrossProfileId?.trim() ? wizard.wincrossProfileId.trim() : undefined,
    tablePresentation: wizard.tablePresentation,
    bannerMode: wizard.bannerMode ?? 'upload',
    researchObjectives: wizard.researchObjectives,
    bannerHints: wizard.bannerHints,
    maxdiffMessages: wizard.maxdiffMessages?.length ? wizard.maxdiffMessages : undefined,
    maxdiffPolicy: wizard.maxdiffPolicy,
    format: wizard.format ?? 'standard',
    displayMode: wizard.displayMode ?? 'frequency',
    separateWorkbooks: wizard.separateWorkbooks ?? false,
    hideExcludedTables: wizard.hideExcludedTables ?? false,
    theme: wizard.theme ?? 'classic',
    statTesting: {
      thresholds: [wizard.statTestingThreshold ?? 90],
      minBase: wizard.minBaseSize ?? 0,
    },
    weightVariable: wizard.weightVariable,
    loopStatTestingMode: wizard.loopStatTestingMode,
    stopAfterVerification: wizard.stopAfterVerification ?? false,
    regrouping: customRegroupingEnabled ? {
      enabled: wizard.regroupEnabled,
      minSiblings: wizard.regroupMinSiblings,
      maxScaleCardinality: wizard.regroupMaxScaleCardinality,
      allowedSuffixPatterns: parsePatternList(wizard.regroupAllowedSuffixPatterns),
      blockedSuffixPatterns: parsePatternList(wizard.regroupBlockedSuffixPatterns),
      allowFamilyPatterns: parsePatternList(wizard.regroupAllowFamilyPatterns),
      blockFamilyPatterns: parsePatternList(wizard.regroupBlockFamilyPatterns),
      minAxisMargin: wizard.regroupMinAxisMargin,
      maxRowsPerRegroupedTable: wizard.regroupMaxRowsPerRegroupedTable,
      minRowsPerRegroupedTable: wizard.regroupMinRowsPerRegroupedTable,
      emitDecisionReport: wizard.regroupEmitDecisionReport,
      suffixClassPriorWeights: {
        r: wizard.regroupSuffixPriorR,
        c: wizard.regroupSuffixPriorC,
        default: wizard.regroupSuffixPriorDefault,
      },
    } : undefined,
  });

  return {
    ...parsedConfig,
    projectSubType: deriveLegacyProjectSubType(parsedConfig),
  };
}
