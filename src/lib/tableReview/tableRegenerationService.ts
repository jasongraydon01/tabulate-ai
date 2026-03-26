/**
 * Table regeneration service.
 *
 * @deprecated Depends on VerificationAgent which is deprecated. The V3 pipeline handles
 * post-review table changes through the compute chain (stages 22–14) without per-table
 * AI regeneration. If per-table regeneration is needed in V3, a new purpose-built agent
 * should be created rather than resurrecting this legacy path.
 *
 * This file is retained for reference only. Do not invoke from active pipeline code.
 *
 * Original purpose: Regenerates individual tables using VerificationAgent with reviewer
 * feedback, then rebuilds the R script and Excel outputs.
 */
import pLimit from 'p-limit';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { verifyTable, type VerificationInput } from '@/agents/VerificationAgent';
import {
  type ExtendedTableDefinition,
  type VerificationAgentOutput,
  type TableWithLoopFrame,
} from '@/schemas/verificationAgentSchema';
import type { TableDefinition } from '@/schemas/tableAgentSchema';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import {
  createContextScratchpadTool,
  clearContextScratchpadsForAgent,
} from '@/agents/tools/scratchpad';
import { buildFeedbackPromptSection } from './feedbackPromptBuilder';
import { rebuildAllWorkbooks, detectTableVariants } from './tableReviewService';
import type { PipelineContext } from './contextReconstruction';
import { generateRScriptV2WithValidation } from '@/lib/r/RScriptGeneratorV2';
import type { TablesJson, ExcelFormatOptions } from '@/lib/excel/ExcelFormatter';
import type { PipelineSummary } from '@/lib/api/types';
import { downloadFile } from '@/lib/r2/r2';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegenerateTableRequest {
  tableId: string;
  feedback: string;
  includeRelated?: boolean;
}

export interface ExpandedRegenerationTarget {
  tableId: string;
  feedback: string;
}

export interface RegenerationResult {
  tableId: string;
  status: 'success' | 'failed';
  changeSummary?: string;
  error?: string;
  beforeSnapshot: ExtendedTableDefinition;
  afterSnapshot?: ExtendedTableDefinition;
}

export interface RegenerationOutput {
  results: RegenerationResult[];
  updatedTablesJsonVariants: Map<string, TablesJson>;
  excelBuffers: Map<string, Buffer>;
  updatedVerifiedTables: ExtendedTableDefinition[];
}

export interface RegenerateParams {
  tables: RegenerateTableRequest[];
  pipelineContext: PipelineContext;
  r2Outputs: Record<string, string>;
  runConfig: ExcelFormatOptions;
  generationConfig: {
    weightVariable?: string;
    statTesting?: {
      thresholds?: number[];
      minBase?: number;
    };
    loopStatTestingMode?: 'suppress' | 'complement';
  };
  abortSignal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expand `includeRelated` flag: find tables sharing the same sourceTableId.
 */
function expandRelatedTables(
  tableId: string,
  allTables: ExtendedTableDefinition[],
): string[] {
  const target = allTables.find((t) => t.tableId === tableId);
  if (!target) return [];

  const sourceId = target.sourceTableId || target.tableId;
  return allTables
    .filter(
      (t) =>
        t.tableId !== tableId &&
        (t.sourceTableId === sourceId || t.tableId === sourceId),
    )
    .map((t) => t.tableId);
}

/**
 * Expand and deduplicate regeneration targets.
 * Includes explicitly requested tableIds (even if missing), plus related tables
 * for requests with includeRelated=true when the source table exists.
 */
export function expandRegenerationTargets(
  requests: RegenerateTableRequest[],
  verifiedTables: ExtendedTableDefinition[],
): ExpandedRegenerationTarget[] {
  const targets = new Map<string, ExpandedRegenerationTarget>();

  for (const req of requests) {
    if (!targets.has(req.tableId)) {
      targets.set(req.tableId, {
        tableId: req.tableId,
        feedback: req.feedback,
      });
    }

    if (!req.includeRelated) continue;
    const related = expandRelatedTables(req.tableId, verifiedTables);
    for (const relId of related) {
      if (!targets.has(relId)) {
        targets.set(relId, {
          tableId: relId,
          feedback: req.feedback,
        });
      }
    }
  }

  return Array.from(targets.values());
}

/**
 * Convert an ExtendedTableDefinition to the TableDefinition format
 * that VerificationAgent expects as input.
 */
function toTableDefinition(ext: ExtendedTableDefinition): TableDefinition {
  return {
    tableId: ext.tableId,
    questionText: ext.questionText,
    tableType: ext.tableType,
    rows: ext.rows.map((r) => ({
      variable: r.variable,
      label: r.label,
      filterValue: r.filterValue,
      isNet: r.isNet,
      netComponents: r.netComponents,
      indent: r.indent,
    })),
    hints: [],
  };
}

/**
 * Build datamap context string for a table's variables.
 */
function getDatamapContextForTable(
  table: ExtendedTableDefinition,
  datamapByColumn: Map<string, VerboseDataMapType>,
): string {
  const variables = new Set<string>();
  for (const row of table.rows) {
    variables.add(row.variable);
  }

  const entries: string[] = [];
  for (const variable of variables) {
    const entry = datamapByColumn.get(variable);
    if (entry) {
      entries.push(
        `${variable}:
  Description: ${entry.description}
  Type: ${entry.normalizedType || 'unknown'}
  Values: ${entry.valueType}
  ${entry.scaleLabels ? `Scale Labels: ${JSON.stringify(entry.scaleLabels)}` : ''}
  ${entry.allowedValues ? `Allowed Values: ${entry.allowedValues.join(', ')}` : ''}`,
      );
    }
  }

  return entries.length > 0 ? entries.join('\n\n') : 'No datamap context available';
}

/**
 * Find the Rscript executable.
 */
async function findRCommand(): Promise<string> {
  const candidates = [
    '/opt/homebrew/bin/Rscript',
    '/usr/local/bin/Rscript',
    '/usr/bin/Rscript',
    'Rscript',
  ];
  for (const rPath of candidates) {
    try {
      await execFileAsync(rPath, ['--version'], { timeout: 2000 });
      return rPath;
    } catch {
      // Try next
    }
  }
  throw new Error('Rscript not found. R must be installed to regenerate tables.');
}

function inferLoopDataFrameForTable(
  table: ExtendedTableDefinition,
  baseNameToFrame: Map<string, string>,
): string {
  for (const row of table.rows) {
    const frame = baseNameToFrame.get(row.variable);
    if (frame) return frame;
  }
  return '';
}

function buildLoopFrameLookup(loopMappings: LoopGroupMapping[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const mapping of loopMappings) {
    for (const variable of mapping.variables) {
      lookup.set(variable.baseName, mapping.stackedFrameName);
    }
  }
  return lookup;
}

function normalizeStatThresholds(rawThresholds: number[] | undefined): number[] {
  if (!rawThresholds || rawThresholds.length === 0) return [0.10];
  return rawThresholds
    .map((t) => {
      if (!Number.isFinite(t)) return null;
      // Wizard config stores percentages (e.g. 95/90). Accept p-values as-is.
      if (t > 1) return (100 - t) / 100;
      return t;
    })
    .filter((t): t is number => t !== null && t > 0 && t < 1);
}

async function readGeneratedVariantFiles(resultsDir: string): Promise<Map<string, TablesJson>> {
  const mapping = new Map<string, string>([
    ['results/tables.json', 'tables.json'],
    ['results/tables-weighted.json', 'tables-weighted.json'],
    ['results/tables-unweighted.json', 'tables-unweighted.json'],
  ]);

  const generated = new Map<string, TablesJson>();
  for (const [variantPath, filename] of mapping) {
    const filePath = path.join(resultsDir, filename);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      generated.set(variantPath, JSON.parse(raw) as TablesJson);
    } catch {
      // File may not exist for this run configuration
    }
  }

  return generated;
}

function selectGeneratedVariant(
  targetVariantPath: string,
  generatedVariants: Map<string, TablesJson>,
): TablesJson | null {
  const direct = generatedVariants.get(targetVariantPath);
  if (direct) return direct;

  if (targetVariantPath === 'results/tables.json') {
    return (
      generatedVariants.get('results/tables-weighted.json') ??
      generatedVariants.get('results/tables-unweighted.json') ??
      null
    );
  }

  return generatedVariants.get('results/tables.json') ?? null;
}

// ---------------------------------------------------------------------------
// Core regeneration function
// ---------------------------------------------------------------------------

/**
 * Regenerate tables with reviewer feedback.
 *
 * Flow:
 * 1. Expand includeRelated → find tables sharing sourceTableId
 * 2. Snapshot each table for rollback
 * 3. Run VerificationAgent per table (parallel, pLimit(3)) with feedback
 * 4. Replace regenerated tables in full ExtendedTableDefinition[]
 * 5. Generate R script
 * 6. Execute R in temp dir
 * 7. Parse resulting tables.json
 * 8. Rebuild Excel workbooks
 *
 * Error handling:
 * - VerificationAgent fails for one table → keep original, mark failed
 * - R execution fails → rollback ALL tables, return error
 */
export async function regenerateTables(
  params: RegenerateParams,
): Promise<RegenerationOutput> {
  const {
    tables: requests,
    pipelineContext,
    r2Outputs,
    runConfig,
    generationConfig,
    abortSignal,
  } = params;

  const { verifiedTables, surveyMarkdown, verboseDataMap, pipelineSummary } =
    pipelineContext;

  // Build datamap lookup
  const datamapByColumn = new Map<string, VerboseDataMapType>();
  for (const entry of verboseDataMap) {
    datamapByColumn.set(entry.column, entry);
  }

  // 1. Expand includeRelated and deduplicate
  const expandedTargets = expandRegenerationTargets(requests, verifiedTables);
  const allTableIds = new Set(expandedTargets.map((t) => t.tableId));
  const feedbackByTableId = new Map(
    expandedTargets.map((t) => [t.tableId, t.feedback]),
  );

  // 2. Snapshot originals
  const snapshots = new Map<string, ExtendedTableDefinition>();
  for (const tableId of allTableIds) {
    const table = verifiedTables.find((t) => t.tableId === tableId);
    if (table) {
      snapshots.set(tableId, structuredClone(table));
    }
  }

  // 3. Run VerificationAgent per table with feedback
  clearContextScratchpadsForAgent('VerificationAgent');
  const limit = pLimit(3);
  const results: RegenerationResult[] = [];

  const regenerationPromises = Array.from(allTableIds).map((tableId) =>
    limit(async (): Promise<RegenerationResult> => {
      const original = snapshots.get(tableId);
      if (!original) {
        return {
          tableId,
          status: 'failed',
          error: `Table ${tableId} not found in verified tables`,
          beforeSnapshot: { tableId } as ExtendedTableDefinition,
        };
      }

      if (abortSignal?.aborted) {
        return {
          tableId,
          status: 'failed',
          error: 'Regeneration cancelled',
          beforeSnapshot: original,
        };
      }

      try {
        const feedback = feedbackByTableId.get(tableId) || '';
        const feedbackSection = buildFeedbackPromptSection(feedback);

        const datamapContext = getDatamapContextForTable(original, datamapByColumn);
        const contextScratchpad = createContextScratchpadTool(
          'VerificationAgent',
          `regen-${tableId}`,
        );

        const input: VerificationInput = {
          table: toTableDefinition(original),
          existingTable: original,
          questionId: original.questionId,
          questionText: original.questionText,
          surveyMarkdown: (surveyMarkdown || '') + feedbackSection,
          datamapContext,
          filterContext: {
            additionalFilter: original.additionalFilter || '',
            baseText: original.baseText || '',
            splitFromTableId: original.splitFromTableId || '',
            filterReviewRequired: original.filterReviewRequired || false,
            tableSubtitle: original.tableSubtitle || '',
          },
        };

        const result: VerificationAgentOutput = await verifyTable(
          input,
          abortSignal,
          contextScratchpad,
        );

        // Take the first table output (regeneration targets a single table)
        const regeneratedTableRaw = result.tables[0];
        const regeneratedTable: ExtendedTableDefinition | undefined = regeneratedTableRaw
          ? {
              ...regeneratedTableRaw,
              additionalFilter: original.additionalFilter,
              splitFromTableId: original.splitFromTableId,
              filterReviewRequired: original.filterReviewRequired,
              sourceTableId: original.sourceTableId,
              isDerived: original.isDerived,
              ...(original.baseText ? { baseText: original.baseText } : {}),
              ...(original.tableSubtitle && !regeneratedTableRaw.tableSubtitle
                ? { tableSubtitle: original.tableSubtitle }
                : {}),
            }
          : undefined;
        if (!regeneratedTable) {
          return {
            tableId,
            status: 'failed',
            error: 'VerificationAgent returned no tables',
            beforeSnapshot: original,
          };
        }

        return {
          tableId,
          status: 'success',
          changeSummary: result.changes.join('; ') || 'No changes',
          beforeSnapshot: original,
          afterSnapshot: regeneratedTable,
        };
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : String(err);
        console.error(
          `[RegenerationService] Failed to regenerate table ${tableId}:`,
          errorMsg,
        );
        return {
          tableId,
          status: 'failed',
          error: errorMsg.substring(0, 500),
          beforeSnapshot: original,
        };
      }
    }),
  );

  const rawResults = await Promise.all(regenerationPromises);
  results.push(...rawResults);

  // 4. Replace regenerated tables in full array
  const updatedVerifiedTables = verifiedTables.map((t) => {
    const result = results.find(
      (r) => r.tableId === t.tableId && r.status === 'success' && r.afterSnapshot,
    );
    if (result?.afterSnapshot) {
      return result.afterSnapshot;
    }
    return t;
  });

  // Check if any regeneration succeeded
  const anySuccess = results.some((r) => r.status === 'success');
  if (!anySuccess) {
    // All failed — return early, no R/Excel work needed
    return {
      results,
      updatedTablesJsonVariants: new Map(),
      excelBuffers: new Map(),
      updatedVerifiedTables: verifiedTables, // unchanged
    };
  }

  // 5–8. Generate R, execute, parse, rebuild Excel
  let tmpDir: string | null = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crosstab-regen-'));
    const rDir = path.join(tmpDir, 'r');
    const resultsDir = path.join(tmpDir, 'results');
    await fs.mkdir(rDir, { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });

    // Copy the SPSS data file from the pipeline outputs
    // We need the data file path — extract from pipeline summary
    const dataFilePath = await copyDataFileToTemp(
      tmpDir,
      pipelineSummary,
      r2Outputs,
    );

    const baseNameToLoopFrame = buildLoopFrameLookup(pipelineContext.loopMappings);

    // Attach loopDataFrame from reconstructed loop mappings
    const tablesWithLoopFrame: TableWithLoopFrame[] = updatedVerifiedTables
      .filter((t) => !t.exclude)
      .map((t) => ({
        ...t,
        loopDataFrame: inferLoopDataFrameForTable(t, baseNameToLoopFrame),
      }));

    const normalizedThresholds = normalizeStatThresholds(
      generationConfig.statTesting?.thresholds,
    );
    const statTestingConfig = {
      thresholds: normalizedThresholds,
      proportionTest: 'unpooled_z' as const,
      meanTest: 'welch_t' as const,
      minBase: generationConfig.statTesting?.minBase ?? 0,
    };

    // Generate R script
    const { script: masterScript } = generateRScriptV2WithValidation(
      {
        tables: tablesWithLoopFrame,
        cuts: pipelineContext.cutsSpec.cuts,
        cutGroups: pipelineContext.cutsSpec.groups,
        loopMappings: pipelineContext.loopMappings,
        loopSemanticsPolicy: pipelineContext.loopSemanticsPolicy,
        loopStatTestingMode:
          generationConfig.loopStatTestingMode ??
          pipelineSummary.options?.loopStatTestingMode,
        statTestingConfig,
        significanceThresholds: statTestingConfig.thresholds,
        bannerGroups: pipelineContext.bannerGroups,
        dataFilePath: dataFilePath.replace(/\\/g, '/'),
        weightVariable: generationConfig.weightVariable,
      },
      { outputDir: 'results' },
    );

    const masterPath = path.join(rDir, 'master.R');
    await fs.writeFile(masterPath, masterScript, 'utf-8');

    // Execute R
    const rCommand = await findRCommand();
    const { stderr } = await execFileAsync(rCommand, [masterPath], {
      cwd: tmpDir,
      timeout: 300_000, // 5 minutes
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    });

    if (stderr && stderr.includes('Error')) {
      // R execution failed — rollback all tables
      console.error('[RegenerationService] R execution error:', stderr.substring(0, 500));
      // Mark all success results as failed
      for (const r of results) {
        if (r.status === 'success') {
          r.status = 'failed';
          r.error = 'R execution failed after regeneration';
          r.afterSnapshot = undefined;
        }
      }
      return {
        results,
        updatedTablesJsonVariants: new Map(),
        excelBuffers: new Map(),
        updatedVerifiedTables: verifiedTables, // rollback
      };
    }

    const generatedVariants = await readGeneratedVariantFiles(resultsDir);
    if (generatedVariants.size === 0) {
      throw new Error('R execution completed but no tables JSON outputs were generated');
    }

    // Download all existing tables.json variants from R2 and update
    const variantPaths = detectTableVariants(r2Outputs);
    const updatedVariants = new Map<string, TablesJson>();

    for (const vPath of variantPaths) {
      const r2Key = r2Outputs[vPath];
      const existingBuf = await downloadFile(r2Key);
      const existingJson = JSON.parse(
        existingBuf.toString('utf-8'),
      ) as TablesJson;
      const sourceVariant = selectGeneratedVariant(vPath, generatedVariants);

      // Replace tables in existing JSON with regenerated versions
      if (!sourceVariant) {
        console.warn(
          `[RegenerationService] No generated source variant for ${vPath}; preserving existing tables`,
        );
        updatedVariants.set(vPath, existingJson);
        continue;
      }

      for (const [tableId, tableData] of Object.entries(sourceVariant.tables)) {
        if (allTableIds.has(tableId)) {
          existingJson.tables[tableId] = tableData;
        }
      }

      updatedVariants.set(vPath, existingJson);
    }

    // Rebuild Excel workbooks
    const excelBuffers = await rebuildAllWorkbooks(updatedVariants, runConfig);

    return {
      results,
      updatedTablesJsonVariants: updatedVariants,
      excelBuffers,
      updatedVerifiedTables,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[RegenerationService] Fatal error:', errorMsg);

    // Mark all success results as failed (rollback)
    for (const r of results) {
      if (r.status === 'success') {
        r.status = 'failed';
        r.error = `Post-regeneration failure: ${errorMsg.substring(0, 300)}`;
        r.afterSnapshot = undefined;
      }
    }

    return {
      results,
      updatedTablesJsonVariants: new Map(),
      excelBuffers: new Map(),
      updatedVerifiedTables: verifiedTables, // rollback
    };
  } finally {
    // Cleanup temp dir
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        console.warn('[RegenerationService] Failed to clean up temp dir:', tmpDir);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Data file handling
// ---------------------------------------------------------------------------

/**
 * Copy the SPSS data file to the temp directory for R execution.
 * Returns the path to the copied file.
 */
async function copyDataFileToTemp(
  tmpDir: string,
  pipelineSummary: PipelineSummary,
  r2Outputs: Record<string, string>,
): Promise<string> {
  // For regeneration, R needs the original SPSS file.
  // We now persist `dataFile.sav` in run outputs and retrieve from there.
  const dataFileName = pipelineSummary.inputs?.spss || 'dataFile.sav';
  const localDataPath = path.join(tmpDir, path.basename(dataFileName));

  // Try to find the SPSS file in R2 outputs
  for (const [key, r2Key] of Object.entries(r2Outputs)) {
    if (key.endsWith('.sav')) {
      const buf = await downloadFile(r2Key);
      await fs.writeFile(localDataPath, buf);
      return localDataPath;
    }
  }

  throw new Error(
    'SPSS data file not available in R2 outputs. ' +
    'Table regeneration requires the original .sav file to be accessible.',
  );
}
