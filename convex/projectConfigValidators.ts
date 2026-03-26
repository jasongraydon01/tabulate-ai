import { v } from "convex/values";

/**
 * Shared Convex validators for project/run config and intake payloads.
 * Keep this aligned with src/schemas/projectConfigSchema.ts.
 */
export const configValidator = v.object({
  projectSubType: v.optional(v.union(v.literal("standard"), v.literal("segmentation"), v.literal("maxdiff"))),
  studyMethodology: v.optional(v.union(
    v.literal("standard"),
    v.literal("message_testing"),
    v.literal("concept_testing"),
    v.literal("segmentation"),
    v.literal("demand")
  )),
  analysisMethod: v.optional(v.union(v.literal("standard_crosstab"), v.literal("maxdiff"))),
  isWaveStudy: v.optional(v.boolean()),
  isDemandSurvey: v.optional(v.boolean()),
  hasChoiceModelExercise: v.optional(v.boolean()),
  maxdiffHasAnchoredScores: v.optional(v.boolean()),
  exportFormats: v.optional(v.array(v.union(v.literal("excel"), v.literal("q"), v.literal("wincross")))),
  wincrossProfileId: v.optional(v.string()),
  tablePresentation: v.optional(v.object({
    labelVocabulary: v.object({
      rankFormat: v.string(),
      topBoxFormat: v.string(),
      bottomBoxFormat: v.string(),
      meanLabel: v.string(),
      medianLabel: v.string(),
      stddevLabel: v.string(),
      stderrLabel: v.string(),
      totalLabel: v.string(),
      baseLabel: v.string(),
      netPrefix: v.string(),
      middleBoxLabel: v.string(),
      notRankedLabel: v.string(),
      npsScoreLabel: v.string(),
      promotersLabel: v.string(),
      passivesLabel: v.string(),
      detractorsLabel: v.string(),
    }),
  })),
  bannerMode: v.optional(v.union(v.literal("upload"), v.literal("auto_generate"))),
  researchObjectives: v.optional(v.string()),
  bannerHints: v.optional(v.string()),
  maxdiffMessages: v.optional(v.array(v.object({
    code: v.string(),
    text: v.string(),
    variantOf: v.optional(v.string()),
  }))),
  maxdiffPolicy: v.optional(v.object({
    includeChoiceTaskFamilyInMainOutput: v.optional(v.boolean()),
    maxSplitTablesPerInput: v.optional(v.number()),
    allowDerivedTablesForChoiceTasks: v.optional(v.boolean()),
    placeholderResolutionRequired: v.optional(v.boolean()),
  })),
  format: v.optional(v.union(v.literal("standard"), v.literal("stacked"))),
  displayMode: v.optional(v.union(v.literal("frequency"), v.literal("counts"), v.literal("both"))),
  separateWorkbooks: v.optional(v.boolean()),
  hideExcludedTables: v.optional(v.boolean()),
  theme: v.optional(v.string()),
  statTesting: v.optional(v.object({
    thresholds: v.optional(v.array(v.number())),
    minBase: v.optional(v.number()),
  })),
  weightVariable: v.optional(v.string()),
  loopStatTestingMode: v.optional(v.union(v.literal("suppress"), v.literal("complement"))),
  stopAfterVerification: v.optional(v.boolean()),
  demoMode: v.optional(v.boolean()),
  maxRespondents: v.optional(v.number()),
  maxTables: v.optional(v.number()),
  regrouping: v.optional(v.object({
    enabled: v.optional(v.boolean()),
    minSiblings: v.optional(v.number()),
    maxScaleCardinality: v.optional(v.number()),
    allowedSuffixPatterns: v.optional(v.array(v.string())),
    blockedSuffixPatterns: v.optional(v.array(v.string())),
    allowFamilyPatterns: v.optional(v.array(v.string())),
    blockFamilyPatterns: v.optional(v.array(v.string())),
    minAxisMargin: v.optional(v.number()),
    maxRowsPerRegroupedTable: v.optional(v.number()),
    minRowsPerRegroupedTable: v.optional(v.number()),
    emitDecisionReport: v.optional(v.boolean()),
    suffixClassPriorWeights: v.optional(v.object({
      r: v.optional(v.number()),
      c: v.optional(v.number()),
      default: v.optional(v.number()),
    })),
  })),
});

export const intakeValidator = v.object({
  dataMap: v.optional(v.union(v.string(), v.null())),
  dataFile: v.optional(v.union(v.string(), v.null())),
  bannerPlan: v.optional(v.union(v.string(), v.null())),
  survey: v.optional(v.union(v.string(), v.null())),
  messageList: v.optional(v.union(v.string(), v.null())),
  bannerMode: v.optional(v.union(v.literal("upload"), v.literal("auto_generate"))),
});
