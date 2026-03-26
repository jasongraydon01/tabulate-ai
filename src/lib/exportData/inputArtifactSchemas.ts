import { z } from 'zod';

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

const ResultsTableEntrySchema = z.object({
  tableId: z.string().optional(),
  questionId: z.string().optional(),
  tableType: z.string().optional(),
}).passthrough();

export const ResultsTablesArtifactSchema = z.object({
  metadata: z.object({
    generatedAt: z.string().optional(),
    tableCount: z.number().optional(),
    cutCount: z.number().optional(),
  }).passthrough(),
  tables: z.record(ResultsTableEntrySchema),
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
