/**
 * Context Builder
 *
 * DEPRECATED: Most functions in this file are dead code from the pre-.sav-forward era.
 * The pipeline no longer uses CSV datamaps — ValidationRunner handles everything via .sav.
 *
 * STILL LIVE (type exports only — used by BannerAgent):
 *   - VerboseBannerPlan, AgentBannerGroup, VerboseBannerGroup
 *
 * DEAD (not imported anywhere — safe to delete when web UI is updated):
 *   - generateDualOutputs, generateBasicDualOutputs, convertToDataMapSchema,
 *     convertToBannerPlanSchema, prepareAgentContext, createGroupContext, validateContextSize
 *
 * Can't delete the file yet because BannerAgent imports the type definitions.
 * TODO: Move the 3 live type exports to a shared types file, then delete this file.
 */

import { DataMapType } from '../schemas/dataMapSchema';
import { BannerPlanInputType, BannerGroupType } from '../schemas/bannerPlanSchema';
import { DataMapProcessor } from './processors/DataMapProcessor';
import { VerboseDataMapType, AgentDataMapType } from '../schemas/processingSchemas';

// Use types from processing schemas for consistency
export type VerboseDataMap = VerboseDataMapType;
export type AgentDataMap = AgentDataMapType;

// Verbose banner group structure (from banner-part1-result JSON)
export interface VerboseBannerGroup {
  groupName: string;
  columns: Array<{
    name: string;
    original: string;
    adjusted: string;
    statLetter: string;
    confidence: number;
    requiresInference: boolean;
    reasoning: string;
    uncertainties: unknown[];
  }>;
}

// Simplified agent banner group (only essential fields)
export interface AgentBannerGroup {
  groupName: string;
  columns: Array<{
    name: string;
    original: string;
  }>;
}

// Full verbose banner structure
export interface VerboseBannerPlan {
  success: boolean;
  data: {
    success: boolean;
    extractionType: string;
    timestamp: string;
    extractedStructure: {
      bannerCuts: VerboseBannerGroup[];
      notes: unknown[];
      processingMetadata: unknown;
    };
    errors: unknown;
    warnings: unknown;
  };
  timestamp: string;
}

// Enhanced dual output generation result
export interface DualOutputResult {
  verboseBanner: VerboseBannerPlan;
  verboseDataMap: VerboseDataMap[];
  agentBanner: AgentBannerGroup[];
  agentDataMap: AgentDataMap[];
  processing: {
    success: boolean;
    validationPassed: boolean;
    confidence: number;
    errors: string[];
    warnings: string[];
  };
}

// Enhanced dual output generation using sophisticated processors
export const generateDualOutputs = async (rawBanner: unknown, dataMapFilePath: string, spssFilePath?: string, outputFolder?: string): Promise<DualOutputResult> => {
  console.log(`[ContextBuilder] Starting enhanced dual output generation`);
  
  // Process banner data - handle both mock data and real banner processing results
  let bannerData: VerboseBannerPlan;
  let agentBanner: AgentBannerGroup[];

  if (rawBanner && typeof rawBanner === 'object' && 'verbose' in rawBanner && 'agent' in rawBanner) {
    // Real banner processing result from BannerProcessor
    const processingResult = rawBanner as { verbose: VerboseBannerPlan; agent: AgentBannerGroup[] };
    bannerData = processingResult.verbose;
    agentBanner = processingResult.agent;
    console.log(`[ContextBuilder] Using real banner processing result - ${agentBanner.length} groups`);
  } else {
    // Legacy mock data or raw VerboseBannerPlan
    bannerData = rawBanner as VerboseBannerPlan;
    agentBanner = bannerData.data?.extractedStructure?.bannerCuts?.map((group) => ({
      groupName: group.groupName,
      columns: group.columns?.map((col) => ({
        name: col.name,
        original: col.original
      })) || []
    })) || [];
    console.log(`[ContextBuilder] Using legacy banner data - ${agentBanner.length} groups`);
  }

  // Use validation runner to read .sav and enrich variables
  console.log(`[ContextBuilder] Processing data via .sav: ${spssFilePath || dataMapFilePath}`);

  const { validate } = await import('./validation/ValidationRunner');

  let processingResult;
  if (spssFilePath && outputFolder) {
    const validationResult = await validate({ spssPath: spssFilePath, outputDir: outputFolder });
    processingResult = validationResult.processingResult || {
      success: false, verbose: [], agent: [], validationPassed: false, confidence: 0,
      errors: ['Validation failed'], warnings: [],
    };
  } else {
    // Fallback: use DataMapProcessor directly with empty data
    const dataMapProcessor = new DataMapProcessor();
    const enriched = dataMapProcessor.enrichVariables([]);
    processingResult = {
      success: true, verbose: enriched.verbose, agent: enriched.agent,
      validationPassed: true, confidence: 1.0, errors: [] as string[], warnings: [] as string[],
    };
  }

  console.log(`[ContextBuilder] Data processing completed - Success: ${processingResult.success}`);
  
  return {
    verboseBanner: bannerData,
    verboseDataMap: processingResult.verbose,
    agentBanner,
    agentDataMap: processingResult.agent,
    processing: {
      success: processingResult.success,
      validationPassed: processingResult.validationPassed,
      confidence: processingResult.confidence,
      errors: processingResult.errors,
      warnings: processingResult.warnings
    }
  };
};

// Backward compatibility - simple version for basic field mapping
export const generateBasicDualOutputs = (rawBanner: unknown, rawDataMap: VerboseDataMap[]): Omit<DualOutputResult, 'processing'> => {
  console.log(`[ContextBuilder] Using basic dual output generation (backward compatibility)`);
  
  const bannerData = rawBanner as VerboseBannerPlan;
  const verboseDataMap = rawDataMap;
  
  const agentBanner: AgentBannerGroup[] = bannerData.data?.extractedStructure?.bannerCuts?.map((group) => ({
    groupName: group.groupName,
    columns: group.columns?.map((col) => ({
      name: col.name,
      original: col.original
    })) || []
  })) || [];
  
  const agentDataMap: AgentDataMap[] = rawDataMap.map(item => ({
    Column: item.column,
    Description: item.description,
    Answer_Options: item.answerOptions,
    ParentQuestion: item.parentQuestion !== 'NA' ? item.parentQuestion : undefined,
    Context: item.context || undefined
  }));
  
  return {
    verboseBanner: bannerData,
    verboseDataMap,
    agentBanner,
    agentDataMap
  };
};

// Convert agent data map to schema type
export const convertToDataMapSchema = (agentDataMap: AgentDataMap[]): DataMapType => {
  return agentDataMap.map(item => ({
    Column: item.Column,
    Description: item.Description,
    Answer_Options: item.Answer_Options
  }));
};

// Convert agent banner to schema type
export const convertToBannerPlanSchema = (agentBanner: AgentBannerGroup[]): BannerPlanInputType => {
  return {
    bannerCuts: agentBanner.map(group => ({
      groupName: group.groupName,
      columns: group.columns.map(col => ({
        name: col.name,
        original: col.original
      }))
    }))
  };
};

// Helper functions for context preparation
export const prepareAgentContext = (dualOutput: DualOutputResult) => {
  const dataMapSchema = convertToDataMapSchema(dualOutput.agentDataMap);
  const bannerPlanSchema = convertToBannerPlanSchema(dualOutput.agentBanner);
  
  return {
    dataMap: dataMapSchema,
    bannerPlan: bannerPlanSchema,
    metadata: {
      dataMapVariables: dualOutput.agentDataMap.length,
      bannerGroups: dualOutput.agentBanner.length,
      totalColumns: dualOutput.agentBanner.reduce((total, group) => total + group.columns.length, 0)
    }
  };
};

// Create focused context for single group processing
export const createGroupContext = (dataMap: DataMapType, group: BannerGroupType) => {
  return {
    dataMap,
    bannerPlan: {
      bannerCuts: [group]
    },
    metadata: {
      groupName: group.groupName,
      columnsToProcess: group.columns.length,
      dataMapVariables: dataMap.length
    }
  };
};

// Validate context against token limits
export const validateContextSize = (context: unknown, tokenLimit: number): { valid: boolean; estimatedTokens: number } => {
  // Rough estimation: 1 token per 4 characters
  const contextString = JSON.stringify(context);
  const estimatedTokens = Math.ceil(contextString.length / 4);
  
  return {
    valid: estimatedTokens <= tokenLimit * 0.8, // Use 80% of limit for safety
    estimatedTokens
  };
};