import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { TableMeta } from '@/schemas/tableAgentSchema';
import { deterministicHash } from './enhancerDeterminism';
import {
  type EnhancementReport,
  type TableEnhancerOptions,
  type EnhancerRuntimeContext,
  type RuleTrace,
} from './enhancer-rules/types';
import { prefillMetadata } from './enhancer-rules/metadataPrefill';
import { applyExclusionHeuristics } from './enhancer-rules/exclusionHeuristics';
import { applyScaleEnrichment } from './enhancer-rules/scaleEnrichment';
import { applyRankingEnrichment } from './enhancer-rules/rankingEnrichment';
import { applyMultiSelectNet } from './enhancer-rules/netEnrichment';
import { applyGridEnrichment } from './enhancer-rules/gridEnrichment';
import { applyMeanRowsBinning } from './enhancer-rules/meanRowsBinning';

export interface EnhanceTablesInput {
  tables: ExtendedTableDefinition[];
  verboseDataMap: VerboseDataMapType[];
  surveyStructure?: string;
  tableMetaContext?: Record<string, TableMeta | undefined>;
  options?: TableEnhancerOptions;
}

export interface EnhanceTablesOutput {
  tables: ExtendedTableDefinition[];
  report: EnhancementReport;
}

const ENHANCER_VERSION = '1.0.0';

const DEFAULT_OPTIONS: Required<TableEnhancerOptions> = {
  maxRankRollups: 3,
  maxGridDerivedPerFamily: 8,
  minMeanRowsBinSample: 30,
};

export function enhanceTables(input: EnhanceTablesInput): EnhanceTablesOutput {
  const normalizedInputForHash = {
    enhancerVersion: ENHANCER_VERSION,
    options: {
      ...DEFAULT_OPTIONS,
      ...(input.options || {}),
    },
    tables: input.tables,
  };

  const report: EnhancementReport = {
    enhancerVersion: ENHANCER_VERSION,
    deterministicHash: deterministicHash(normalizedInputForHash),
    tablesCreated: 0,
    derivedTablesCreated: 0,
    scaleEnrichments: 0,
    rankingEnrichments: 0,
    netsCreated: 0,
    gridSplits: 0,
    autoExclusions: 0,
    idCollisions: [],
    ruleApplications: [],
    flaggedForAI: [],
  };

  const verboseByColumn = new Map<string, VerboseDataMapType>();
  for (const entry of input.verboseDataMap) {
    verboseByColumn.set(entry.column, entry);
  }

  const tableMetaById = new Map<string, TableMeta | undefined>();
  if (input.tableMetaContext) {
    for (const [tableId, meta] of Object.entries(input.tableMetaContext)) {
      tableMetaById.set(tableId, meta);
    }
  }

  const usedIds = new Set<string>(input.tables.map((table) => table.tableId));

  const ctx: EnhancerRuntimeContext = {
    verboseByColumn,
    tableMetaById,
    options: {
      ...DEFAULT_OPTIONS,
      ...(input.options || {}),
    },
    usedIds,
    report,
  };

  const outputTables: ExtendedTableDefinition[] = [];

  for (const sourceTable of input.tables) {
    const trace: RuleTrace = {
      tableId: sourceTable.tableId,
      applied: [],
      skipped: [],
    };

    const alreadyEnhanced =
      sourceTable.lastModifiedBy === 'TableEnhancer' ||
      sourceTable.isDerived ||
      !!sourceTable.sourceTableId;
    if (alreadyEnhanced) {
      outputTables.push({
        ...sourceTable,
        rows: sourceTable.rows.map((row) => ({ ...row })),
      });
      trace.skipped.push({
        rule: 'enhancer_pass',
        reason: 'table_already_enhanced_or_derived',
      });
      report.ruleApplications.push({
        tableId: trace.tableId,
        applied: trace.applied,
        skipped: trace.skipped,
      });
      continue;
    }

    let table = { ...sourceTable };
    const derivedTables: ExtendedTableDefinition[] = [];

    const prefilled = prefillMetadata(table);
    table = prefilled.table;
    trace.applied.push('metadata_prefill');
    appendFlags(report, prefilled.flaggedForAI);

    const exclusion = applyExclusionHeuristics(table, ctx);
    table = exclusion.table;
    trace.applied.push(...exclusion.applied);
    trace.skipped.push(...exclusion.skipped);

    const ranking = applyRankingEnrichment(table, ctx);
    const rankingApplied = ranking.applied.length > 0;
    if (rankingApplied) {
      derivedTables.push(...ranking.derived);
      trace.applied.push(...ranking.applied);
      trace.skipped.push(...ranking.skipped);
      appendFlags(report, ranking.flaggedForAI);
    } else {
      trace.skipped.push(...ranking.skipped);

      const scale = applyScaleEnrichment(table, ctx);
      table = scale.table;
      derivedTables.push(...scale.derived);
      trace.applied.push(...scale.applied);
      trace.skipped.push(...scale.skipped);
      appendFlags(report, scale.flaggedForAI);
    }

    const net = applyMultiSelectNet(table, ctx);
    table = net.table;
    trace.applied.push(...net.applied);
    trace.skipped.push(...net.skipped);
    appendFlags(report, net.flaggedForAI);

    const grid = applyGridEnrichment(table, ctx);
    derivedTables.push(...grid.derived);
    trace.applied.push(...grid.applied);
    trace.skipped.push(...grid.skipped);

    const binning = applyMeanRowsBinning(table, ctx);
    derivedTables.push(...binning.derived);
    trace.applied.push(...binning.applied);
    trace.skipped.push(...binning.skipped);
    appendFlags(report, binning.flaggedForAI);

    outputTables.push(table);
    outputTables.push(...derivedTables);

    if (derivedTables.length > 0) {
      report.derivedTablesCreated += derivedTables.length;
    }

    report.ruleApplications.push({
      tableId: trace.tableId,
      applied: trace.applied,
      skipped: trace.skipped,
    });
  }

  report.tablesCreated = outputTables.length;

  return {
    tables: outputTables,
    report,
  };
}

function appendFlags(report: EnhancementReport, flagged: string[]): void {
  for (const flag of flagged) {
    if (!report.flaggedForAI.includes(flag)) {
      report.flaggedForAI.push(flag);
    }
  }
}
