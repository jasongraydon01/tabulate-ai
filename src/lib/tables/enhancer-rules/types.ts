import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { TableMeta } from '@/schemas/tableAgentSchema';

export interface TableEnhancerOptions {
  maxRankRollups?: number;
  maxGridDerivedPerFamily?: number;
  minMeanRowsBinSample?: number;
}

export interface RuleSkip {
  rule: string;
  reason: string;
}

export interface RuleTrace {
  tableId: string;
  applied: string[];
  skipped: RuleSkip[];
}

export interface EnhancementReport {
  enhancerVersion: string;
  deterministicHash: string;
  tablesCreated: number;
  derivedTablesCreated: number;
  scaleEnrichments: number;
  rankingEnrichments: number;
  netsCreated: number;
  gridSplits: number;
  autoExclusions: number;
  idCollisions: string[];
  ruleApplications: RuleTrace[];
  flaggedForAI: string[];
}

export interface EnhancerRuntimeContext {
  verboseByColumn: Map<string, VerboseDataMapType>;
  tableMetaById: Map<string, TableMeta | undefined>;
  options: Required<TableEnhancerOptions>;
  usedIds: Set<string>;
  report: EnhancementReport;
}

export interface RuleResult {
  table: ExtendedTableDefinition;
  derived: ExtendedTableDefinition[];
  applied: string[];
  skipped: RuleSkip[];
  flaggedForAI: string[];
}
