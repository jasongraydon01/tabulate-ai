// Schema exports and compilation test
// This file serves as both an export hub and compilation verification

// Data Map Schema exports
export {
  DataMapSchema,
  DataMapItemSchema,
  validateDataMap,
  isValidDataMap,
  findVariable,
  getVariableNames,
  searchByDescription
} from './dataMapSchema';

export type {
  DataMapType,
  DataMapItemType
} from './dataMapSchema';

// Banner Plan Schema exports
export {
  BannerPlanInputSchema,
  BannerGroupSchema,
  BannerColumnSchema,
  validateBannerPlan,
  isValidBannerPlan,
  validateBannerGroup,
  getBannerGroups,
  getGroupByName,
  getTotalColumns,
  getColumnsByGroup,
  createSingleGroupBanner
} from './bannerPlanSchema';

export type {
  BannerPlanInputType,
  BannerGroupType,
  BannerColumnType
} from './bannerPlanSchema';

// Agent Output Schema exports
export {
  ValidationResultSchema,
  ValidatedGroupSchema,
  ValidatedColumnSchema,
  validateResult,
  isValidResult,
  validateGroup,
  getValidatedGroups,
  calculateAverageConfidence,
  getHighConfidenceColumns,
  getLowConfidenceColumns,
  combineValidationResults,
  createValidationResult
} from './agentOutputSchema';

export type {
  ValidationResultType,
  ValidatedGroupType,
  ValidatedColumnType
} from './agentOutputSchema';

// Table Agent Schema exports
export {
  TableTypeSchema,
  StatTypeSchema,
  ScaleLabelSchema,
  TableAgentInputItemSchema,
  TableAgentInputSchema,
  TableRowSchema,
  TableDefinitionSchema,
  TableAgentOutputSchema,
  validateTableAgentInput,
  isValidTableAgentInput,
  validateTableAgentOutput,
  isValidTableAgentOutput,
  getTableVariables,
  getTableIds,
  hasTableType,
  getTablesByType,
  calculateAverageConfidence as calculateTableAverageConfidence,
  combineTableDefinitions,
} from './tableAgentSchema';

export type {
  TableType,
  StatType,
  ScaleLabel,
  TableAgentInputItem,
  TableAgentInput,
  TableRow,
  TableDefinition,
  TableAgentOutput,
} from './tableAgentSchema';

// Pipeline Error Persistence Schema exports
export {
  PipelineErrorRecordSchema,
  PipelineErrorSourceSchema,
  PipelineErrorSeveritySchema,
  PipelineErrorClassificationSchema,
  PipelineErrorActionTakenSchema,
} from './pipelineErrorSchema';

export type {
  PipelineErrorRecord,
  PipelineErrorSource,
  PipelineErrorSeverity,
  PipelineErrorClassification,
  PipelineErrorActionTaken,
} from './pipelineErrorSchema';

// Schema compilation test - this will fail to compile if any schemas are invalid
import { z } from 'zod';
import { DataMapSchema } from './dataMapSchema';
import { BannerPlanInputSchema, BannerGroupSchema } from './bannerPlanSchema';
import { ValidationResultSchema } from './agentOutputSchema';
import { TableAgentInputSchema, TableAgentOutputSchema } from './tableAgentSchema';

// Test that all schemas are valid Zod schemas
const _schemaTest = {
  dataMapIsSchema: DataMapSchema instanceof z.ZodType,
  bannerPlanIsSchema: BannerPlanInputSchema instanceof z.ZodType,
  bannerGroupIsSchema: BannerGroupSchema instanceof z.ZodType,
  validationResultIsSchema: ValidationResultSchema instanceof z.ZodType,
  tableAgentInputIsSchema: TableAgentInputSchema instanceof z.ZodType,
  tableAgentOutputIsSchema: TableAgentOutputSchema instanceof z.ZodType,
};

// Export test result for verification
export const schemaCompilationTest = _schemaTest;