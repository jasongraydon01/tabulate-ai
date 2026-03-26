import { downloadFile, uploadFile } from '@/lib/r2/r2';
import { buildRunArtifactKey } from '@/lib/r2/R2FileManager';
import {
  ExcelFormatter,
  type ExcelFormatOptions,
  type TablesJson,
} from '@/lib/excel/ExcelFormatter';
import type { ProjectConfig } from '@/schemas/projectConfigSchema';
import {
  detectUsedLabelSlotsFromCanonicalTables,
  rewriteGeneratedRowLabel,
  rewriteGeneratedSubtitle,
  resolveTablePresentationConfig,
  type TableLabelSlot,
} from './labelVocabulary';

const SORTED_FINAL_CANDIDATES = [
  'tables/13e-table-enriched.json',
  'tables/13d-table-canonical.json',
  'tables/07-sorted-final.json',
] as const;

const RESULTS_TABLE_VARIANTS = [
  'results/tables.json',
  'results/tables-weighted.json',
  'results/tables-unweighted.json',
] as const;

const VARIANT_TO_WORKBOOK: Record<string, { primary: string; counts?: string }> = {
  'results/tables.json': {
    primary: 'results/crosstabs.xlsx',
    counts: 'results/crosstabs-counts.xlsx',
  },
  'results/tables-weighted.json': {
    primary: 'results/crosstabs-weighted.xlsx',
    counts: 'results/crosstabs-weighted-counts.xlsx',
  },
  'results/tables-unweighted.json': {
    primary: 'results/crosstabs-unweighted.xlsx',
  },
};

interface CanonicalLikeRow {
  label?: string;
}

interface CanonicalLikeTable {
  tableSubtitle?: string;
  rows?: CanonicalLikeRow[];
}

interface ResultsTableRowLike {
  label?: string;
}

interface ResultsTableLike {
  tableSubtitle?: string;
  data?: Record<string, Record<string, ResultsTableRowLike | string> | unknown>;
}

export interface RebuildTablePresentationParams {
  orgId: string;
  projectId: string;
  runId: string;
  runConfig: ProjectConfig;
  r2Outputs: Record<string, string>;
}

export interface RebuildTablePresentationResult {
  usedSlots: TableLabelSlot[];
  updatedArtifactPaths: string[];
  rebuiltWorkbookPaths: string[];
  exportPackagesShouldRefresh: boolean;
}

function parseJsonBuffer<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString('utf8')) as T;
}

function toJsonBuffer(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function resolveSortedFinalPath(outputs: Record<string, string>): string | null {
  for (const candidate of SORTED_FINAL_CANDIDATES) {
    if (outputs[candidate]) return candidate;
  }
  return null;
}

function collectResultVariantPaths(outputs: Record<string, string>): string[] {
  return RESULTS_TABLE_VARIANTS.filter((candidate) => !!outputs[candidate]);
}

export async function getRunTablePresentationUsedSlots(
  r2Outputs: Record<string, string>,
): Promise<TableLabelSlot[]> {
  const sortedFinalPath = resolveSortedFinalPath(r2Outputs);
  if (!sortedFinalPath) return [];

  const sortedFinalKey = r2Outputs[sortedFinalPath];
  if (!sortedFinalKey) return [];

  const sortedFinal = parseJsonBuffer<{ tables?: CanonicalLikeTable[] }>(
    await downloadFile(sortedFinalKey),
  );
  return detectUsedLabelSlotsFromCanonicalTables(
    (Array.isArray(sortedFinal.tables) ? sortedFinal.tables : []) as Array<Record<string, unknown>>,
  );
}

function rewriteCanonicalTablesWithVocabulary(
  tables: CanonicalLikeTable[],
  config: ProjectConfig,
): void {
  const vocabulary = resolveTablePresentationConfig(config.tablePresentation).labelVocabulary;
  for (const table of tables) {
    if (typeof table.tableSubtitle === 'string') {
      table.tableSubtitle = rewriteGeneratedSubtitle(table.tableSubtitle, vocabulary);
    }
    if (!Array.isArray(table.rows)) continue;
    for (const row of table.rows) {
      if (typeof row.label === 'string') {
        row.label = rewriteGeneratedRowLabel(row.label, vocabulary);
      }
    }
  }
}

function rewriteResultsTablesArtifact(
  artifact: TablesJson,
  config: ProjectConfig,
): TablesJson {
  const vocabulary = resolveTablePresentationConfig(config.tablePresentation).labelVocabulary;
  const nextTables: Record<string, ResultsTableLike> = {};

  for (const [tableId, table] of Object.entries(artifact.tables)) {
    const nextTable: ResultsTableLike = { ...table };

    if (typeof nextTable.tableSubtitle === 'string') {
      nextTable.tableSubtitle = rewriteGeneratedSubtitle(nextTable.tableSubtitle, vocabulary);
    }

    const data = nextTable.data && typeof nextTable.data === 'object'
      ? nextTable.data
      : undefined;
    if (data) {
      const nextData: Record<string, Record<string, ResultsTableRowLike | string> | unknown> = {};
      for (const [cutName, cutData] of Object.entries(data)) {
        if (!cutData || typeof cutData !== 'object' || Array.isArray(cutData)) {
          nextData[cutName] = cutData;
          continue;
        }
        const nextCutData: Record<string, ResultsTableRowLike | string> = {};
        for (const [rowKey, rowValue] of Object.entries(cutData)) {
          if (!rowValue || typeof rowValue !== 'object' || Array.isArray(rowValue)) {
            nextCutData[rowKey] = rowValue as string;
            continue;
          }
          const nextRow = { ...(rowValue as ResultsTableRowLike) };
          if (typeof nextRow.label === 'string') {
            nextRow.label = rewriteGeneratedRowLabel(nextRow.label, vocabulary);
          }
          nextCutData[rowKey] = nextRow;
        }
        nextData[cutName] = nextCutData;
      }
      nextTable.data = nextData;
    }

    nextTables[tableId] = nextTable;
  }

  return {
    ...artifact,
    tables: nextTables as TablesJson['tables'],
  };
}

async function rebuildWorkbookBuffers(
  variants: Map<string, TablesJson>,
  runConfig: ProjectConfig,
): Promise<Map<string, Buffer>> {
  const buffers = new Map<string, Buffer>();
  const options: ExcelFormatOptions = {
    format: runConfig.format,
    displayMode: runConfig.displayMode,
    separateWorkbooks: runConfig.separateWorkbooks,
    hideExcludedTables: runConfig.hideExcludedTables,
    theme: runConfig.theme,
    tablePresentation: resolveTablePresentationConfig(runConfig.tablePresentation),
  };

  for (const [variantPath, tablesJson] of variants) {
    const target = VARIANT_TO_WORKBOOK[variantPath];
    if (!target) continue;

    const formatter = new ExcelFormatter(options);
    await formatter.formatFromJson(tablesJson);
    buffers.set(target.primary, await formatter.getBuffer());

    if (target.counts && formatter.hasSecondWorkbook()) {
      buffers.set(target.counts, await formatter.getSecondWorkbookBuffer());
    }
  }

  return buffers;
}

async function uploadBufferToExistingOrDerivedKey(params: {
  keyPath: string;
  body: Buffer;
  contentType: string;
  r2Outputs: Record<string, string>;
  orgId: string;
  projectId: string;
  runId: string;
}): Promise<void> {
  const key = params.r2Outputs[params.keyPath]
    ?? buildRunArtifactKey(params.orgId, params.projectId, params.runId, params.keyPath);
  await uploadFile(key, params.body, params.contentType);
}

export async function rebuildRunTablePresentation(
  params: RebuildTablePresentationParams,
): Promise<RebuildTablePresentationResult> {
  const { orgId, projectId, runId, runConfig, r2Outputs } = params;
  const updatedArtifactPaths: string[] = [];
  const rebuiltWorkbookPaths: string[] = [];

  const sortedFinalPath = resolveSortedFinalPath(r2Outputs);
  if (!sortedFinalPath) {
    throw new Error('Missing canonical table artifact required for label rebuild.');
  }

  const sortedFinalKey = r2Outputs[sortedFinalPath];
  if (!sortedFinalKey) {
    throw new Error(`Missing R2 key for ${sortedFinalPath}.`);
  }

  const sortedFinal = parseJsonBuffer<{ tables?: CanonicalLikeTable[] }>(
    await downloadFile(sortedFinalKey),
  );
  const canonicalTables = Array.isArray(sortedFinal.tables) ? sortedFinal.tables : [];
  const usedSlots = detectUsedLabelSlotsFromCanonicalTables(
    canonicalTables as Array<Record<string, unknown>>,
  );
  rewriteCanonicalTablesWithVocabulary(canonicalTables, runConfig);

  await uploadBufferToExistingOrDerivedKey({
    keyPath: sortedFinalPath,
    body: toJsonBuffer(sortedFinal),
    contentType: 'application/json',
    r2Outputs,
    orgId,
    projectId,
    runId,
  });
  updatedArtifactPaths.push(sortedFinalPath);

  const variantPaths = collectResultVariantPaths(r2Outputs);
  if (variantPaths.length === 0) {
    throw new Error('Missing results/tables artifact required for workbook rebuild.');
  }

  const rewrittenVariants = new Map<string, TablesJson>();
  for (const variantPath of variantPaths) {
    const variantKey = r2Outputs[variantPath];
    if (!variantKey) continue;
    const variant = parseJsonBuffer<TablesJson>(await downloadFile(variantKey));
    const rewritten = rewriteResultsTablesArtifact(variant, runConfig);
    rewrittenVariants.set(variantPath, rewritten);

    await uploadBufferToExistingOrDerivedKey({
      keyPath: variantPath,
      body: toJsonBuffer(rewritten),
      contentType: 'application/json',
      r2Outputs,
      orgId,
      projectId,
      runId,
    });
    updatedArtifactPaths.push(variantPath);
  }

  const workbookBuffers = await rebuildWorkbookBuffers(rewrittenVariants, runConfig);
  for (const [workbookPath, buffer] of workbookBuffers) {
    await uploadBufferToExistingOrDerivedKey({
      keyPath: workbookPath,
      body: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      r2Outputs,
      orgId,
      projectId,
      runId,
    });
    rebuiltWorkbookPaths.push(workbookPath);
  }

  return {
    usedSlots,
    updatedArtifactPaths,
    rebuiltWorkbookPaths,
    exportPackagesShouldRefresh: true,
  };
}
