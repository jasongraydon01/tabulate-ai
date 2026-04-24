import { z } from 'zod';
import { BannerPlanInputSchema } from '@/schemas/bannerPlanSchema';

export const SortedFinalRowSchema = z.object({
  variable: z.string().optional(),
  label: z.string().optional(),
  filterValue: z.string().optional(),
  isNet: z.boolean().optional(),
  netComponents: z.array(z.string()).optional(),
  indent: z.number().optional(),
}).passthrough();

const SortedFinalTableSchema = z.object({
  tableId: z.string(),
  questionId: z.string(),
  questionText: z.string().optional(),
  tableType: z.string(),
  rows: z.array(SortedFinalRowSchema),
  additionalFilter: z.string().optional(),
}).passthrough();

export const SortedFinalArtifactSchema = z.object({
  _metadata: z.object({
    stage: z.string().optional(),
    stageNumber: z.number().optional(),
    tableCount: z.number().optional(),
    timestamp: z.string().optional(),
  }).passthrough().default({}),
  metadata: z.record(z.unknown()).optional(),
  summary: z.record(z.unknown()).optional(),
  tables: z.array(SortedFinalTableSchema),
});

export const ResultsTableColumnSchema = z.object({
  cutKey: z.string(),
  cutName: z.string(),
  groupKey: z.string(),
  groupName: z.string().nullable(),
  statLetter: z.string().nullable(),
  baseN: z.number().nullable(),
  isTotal: z.boolean(),
  order: z.number().int(),
});

export const ResultsTableRowFormatSchema = z.object({
  kind: z.union([z.literal('percent'), z.literal('number')]),
  decimals: z.number().int(),
});

export const ResultsTableRowSchema = z.object({
  rowKey: z.string(),
  label: z.string(),
  rowKind: z.string(),
  statType: z.string().nullable(),
  indent: z.number(),
  isNet: z.boolean(),
  valueType: z.union([
    z.literal('pct'),
    z.literal('count'),
    z.literal('n'),
    z.literal('mean'),
    z.literal('median'),
    z.literal('stddev'),
    z.literal('stderr'),
  ]),
  format: ResultsTableRowFormatSchema,
});

const ResultsTableValueSchema = z.object({
  label: z.string().optional(),
  groupName: z.string().optional(),
  rowKind: z.string().optional(),
  statType: z.string().nullable().optional(),
  n: z.number().nullable().optional(),
  count: z.number().nullable().optional(),
  pct: z.number().nullable().optional(),
  mean: z.number().nullable().optional(),
  median: z.number().nullable().optional(),
  sd: z.number().nullable().optional(),
  std_err: z.number().nullable().optional(),
  sig_higher_than: z.union([z.array(z.string()), z.string(), z.null()]).optional(),
  sig_vs_total: z.string().nullable().optional(),
  isNet: z.boolean().optional(),
  indent: z.number().optional(),
  isStat: z.boolean().optional(),
}).passthrough();

const ResultsTableCutSchema = z.object({
  stat_letter: z.string().optional(),
  table_base_n: z.number().nullable().optional(),
}).catchall(z.union([ResultsTableValueSchema, z.string(), z.number(), z.null()]));

export const ResultsTableEntrySchema = z.object({
  tableId: z.string().optional(),
  questionId: z.string().optional(),
  tableType: z.string().optional(),
  data: z.record(ResultsTableCutSchema).optional(),
  columns: z.array(ResultsTableColumnSchema).optional(),
  rows: z.array(ResultsTableRowSchema).optional(),
}).passthrough();

export const ResultsTablesArtifactSchema = z.object({
  metadata: z.object({
    generatedAt: z.string().optional(),
    tableCount: z.number().optional(),
    cutCount: z.number().optional(),
  }).passthrough(),
  tables: z.record(ResultsTableEntrySchema),
});

export const FinalResultsTableEntrySchema = ResultsTableEntrySchema.extend({
  tableId: z.string(),
  questionId: z.string(),
  tableType: z.string(),
  data: z.record(ResultsTableCutSchema),
  columns: z.array(ResultsTableColumnSchema),
  rows: z.array(ResultsTableRowSchema),
});

export const ResultsTablesFinalContractSchema = ResultsTablesArtifactSchema.extend({
  tables: z.record(FinalResultsTableEntrySchema),
});

const CrosstabColumnSchema = z.object({
  name: z.string(),
  adjusted: z.string().optional(),
  confidence: z.number().optional(),
  expressionType: z.string().optional(),
}).passthrough();

export const CrosstabRawArtifactSchema = z.object({
  bannerCuts: z.array(
    z.object({
      groupName: z.string(),
      columns: z.array(CrosstabColumnSchema),
    }).passthrough()
  ),
});

export const BannerPlanArtifactSchema = BannerPlanInputSchema;

export const BannerRouteMetadataArtifactSchema = z.object({
  routeUsed: z.union([z.literal('banner_agent'), z.literal('banner_generate')]),
  bannerFile: z.string().nullable(),
  generatedAt: z.string(),
  groupCount: z.number(),
  columnCount: z.number(),
  sourceConfidence: z.number(),
  usedFallbackFromBannerAgent: z.boolean(),
  bannerGenerateInputSource: z.union([
    z.literal('questionid_reportable'),
    z.literal('sav_verbose_datamap'),
    z.null(),
  ]),
}).passthrough();

const ParsedSurveyAnswerOptionSchema = z.object({
  code: z.union([z.number(), z.string()]),
  text: z.string(),
  isOther: z.boolean(),
  anchor: z.boolean(),
  routing: z.string().nullable(),
  progNote: z.string().nullable(),
}).passthrough();

const ParsedSurveyQuestionSchema = z.object({
  questionId: z.string(),
  rawText: z.string(),
  questionText: z.string(),
  instructionText: z.string().nullable(),
  answerOptions: z.array(ParsedSurveyAnswerOptionSchema),
  scaleLabels: z.array(
    z.object({
      value: z.number(),
      label: z.string(),
    }).passthrough()
  ).nullable(),
  questionType: z.string(),
  format: z.string(),
  progNotes: z.array(z.string()),
  strikethroughSegments: z.array(z.string()),
  sectionHeader: z.string().nullable(),
}).passthrough();

export const SurveyParsedCleanupArtifactSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
  stats: z.record(z.unknown()).optional(),
  surveyParsed: z.array(ParsedSurveyQuestionSchema),
}).passthrough();

const LoopSummaryVariableSchema = z.object({
  baseName: z.string(),
  label: z.string(),
  iterationColumns: z.record(z.string()),
});

export const LoopSummaryArtifactSchema = z.object({
  totalLoopGroups: z.number(),
  totalIterationVars: z.number(),
  totalBaseVars: z.number(),
  groups: z.array(
    z.object({
      stackedFrameName: z.string(),
      skeleton: z.string(),
      iterations: z.array(z.string()),
      variableCount: z.number(),
      variables: z.array(LoopSummaryVariableSchema),
    })
  ),
}).passthrough();
