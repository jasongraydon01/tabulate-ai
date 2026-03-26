/**
 * TableContextAgent
 *
 * Purpose: Review flagged canonical tables and refine their presentation
 * metadata (subtitles, base descriptions, user notes, row labels) to make
 * each table publication-ready.
 *
 * Inputs: TableContextGroup (tables grouped by questionId + entry context)
 * Output: TableContextOutput (per-table results with refined metadata)
 *
 * Runs once per question group, parallelized with p-limit(3) in batch mode.
 * Error fallback: all tables marked noChangesNeeded (never corrupt on failure).
 */

import { generateText, Output, stepCountIs } from 'ai';
import pLimit from 'p-limit';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  TableContextOutputSchema,
  type TableContextOutput,
} from '../schemas/tableContextSchema';
import {
  getTableContextModel,
  getTableContextModelName,
  getTableContextModelTokenLimit,
  getTableContextReasoningEffort,
  getPromptVersions,
  getGenerationConfig,
  getGenerationSamplingParams,
} from '../lib/env';
import {
  createContextScratchpadTool,
  getAllContextScratchpadEntries,
  clearContextScratchpadsForAgent,
  formatScratchpadAsMarkdown,
} from './tools/scratchpad';
import { getTableContextPrompt } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability/AgentMetrics';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import { renderTableContextBlock, type TableContextGroup } from '../lib/v3/runtime/canonical/tableContextRenderer';

// =============================================================================
// Types
// =============================================================================

export interface TableContextBatchResult {
  results: TableContextOutput[];
  summary: {
    totalGroups: number;
    tablesChanged: number;
    tablesUnchanged: number;
    rowLabelsOverridden: number;
    durationMs: number;
  };
  scratchpadMarkdown: string;
}

/** Max tables per AI call to keep context manageable */
const MAX_TABLES_PER_CHUNK = 10;

// =============================================================================
// Single Group Review
// =============================================================================

/**
 * Review a single group of tables (same questionId).
 * If the group has >10 tables, splits into chunks and merges results.
 */
export async function reviewTableContextGroup(
  group: TableContextGroup,
  outputDir: string,
  abortSignal?: AbortSignal,
): Promise<TableContextOutput> {
  // If group has many tables, chunk them
  if (group.tables.length > MAX_TABLES_PER_CHUNK) {
    const chunks = chunkArray(group.tables, MAX_TABLES_PER_CHUNK);
    const chunkResults: TableContextOutput[] = [];

    for (const chunk of chunks) {
      if (abortSignal?.aborted) {
        throw new DOMException('TableContextAgent aborted', 'AbortError');
      }

      const subGroup: TableContextGroup = {
        ...group,
        tables: chunk,
        triageReasons: new Map(
          Array.from(group.triageReasons.entries())
            .filter(([tableId]) => chunk.some(t => t.tableId === tableId)),
        ),
      };

      const result = await callAI(subGroup, outputDir, abortSignal);
      chunkResults.push(result);
    }

    // Merge chunk results
    return {
      tables: chunkResults.flatMap(r => r.tables),
    };
  }

  return callAI(group, outputDir, abortSignal);
}

// =============================================================================
// AI Call
// =============================================================================

async function callAI(
  group: TableContextGroup,
  outputDir: string,
  abortSignal?: AbortSignal,
): Promise<TableContextOutput> {
  const startTime = Date.now();
  const questionId = group.questionId;

  if (abortSignal?.aborted) {
    throw new DOMException('TableContextAgent aborted', 'AbortError');
  }

  // Build prompts
  const promptVersions = getPromptVersions();
  const systemInstructions = getTableContextPrompt(promptVersions.tableContextPromptVersion);
  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${systemInstructions}`;
  const userPrompt = sanitizeForAzureContentFilter(renderTableContextBlock(group));

  // Create context-isolated scratchpad
  const scratchpad = createContextScratchpadTool('TableContextAgent', questionId);
  const genConfig = getGenerationConfig();

  try {
    const retryResult = await retryWithPolicyHandling(
      async () => {
        const { output, usage } = await generateText({
          model: getTableContextModel(),
          system: systemPrompt,
          prompt: userPrompt,
          tools: { scratchpad },
          maxRetries: 0,
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getTableContextModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getTableContextModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getTableContextReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: TableContextOutputSchema,
          }),
          abortSignal,
        });

        if (!output) {
          throw new Error('Invalid output from TableContextAgent');
        }

        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'TableContextAgent',
          getTableContextModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          durationMs,
        );

        return output;
      },
      {
        abortSignal,
        maxAttempts: 10,
        onRetry: (attempt, err) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          console.warn(
            `[TableContextAgent:${questionId}] Retry ${attempt}/10: ${err.message.substring(0, 120)}`,
          );
        },
      },
    );

    if (retryResult.error === 'Operation was cancelled') {
      throw new DOMException('TableContextAgent aborted', 'AbortError');
    }

    if (!retryResult.success || !retryResult.result) {
      throw new Error(`TableContextAgent failed for ${questionId}: ${retryResult.error || 'Unknown error'}`);
    }

    return retryResult.result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // Persist error and return no-op fallback
    try {
      await persistAgentErrorAuto({
        outputDir,
        agentName: 'TableContextAgent',
        severity: 'warning',
        actionTaken: 'continued',
        itemId: questionId,
        error,
        meta: { tableCount: group.tables.length },
      });
    } catch {
      // ignore persistence errors
    }

    console.warn(
      `[TableContextAgent:${questionId}] Failed, keeping prefill defaults: ${error instanceof Error ? error.message.substring(0, 120) : 'Unknown error'}`,
    );

    // Return no-op result — all tables keep prefill values
    return {
      tables: group.tables.map(t => ({
        tableId: t.tableId,
        tableSubtitle: t.tableSubtitle,
        userNote: t.userNote,
        baseText: t.baseText,
        noChangesNeeded: true,
        reasoning: 'TableContextAgent failed; keeping prefill defaults.',
        rowLabelOverrides: [],
      })),
    };
  }
}

// =============================================================================
// Batch Review
// =============================================================================

/**
 * Review all flagged table groups in parallel with p-limit concurrency control.
 */
export async function reviewTableContextBatch(
  groups: TableContextGroup[],
  outputDir: string,
  abortSignal?: AbortSignal,
  concurrency = 3,
): Promise<TableContextBatchResult> {
  const startTime = Date.now();

  console.log(
    `[TableContextAgent] Reviewing ${groups.length} question groups (concurrency=${concurrency})`,
  );

  // Clean slate for scratchpads
  clearContextScratchpadsForAgent('TableContextAgent');

  const limit = pLimit(concurrency);

  const results = await Promise.all(
    groups.map(group =>
      limit(async () => {
        if (abortSignal?.aborted) {
          return {
            tables: group.tables.map(t => ({
              tableId: t.tableId,
              tableSubtitle: t.tableSubtitle,
              userNote: t.userNote,
              baseText: t.baseText,
              noChangesNeeded: true,
              reasoning: 'Aborted before review.',
              rowLabelOverrides: [],
            })),
          } as TableContextOutput;
        }

        return reviewTableContextGroup(group, outputDir, abortSignal);
      }),
    ),
  );

  // Collect scratchpad entries — filter to this agent only to avoid
  // contamination from agents running in parallel (e.g., CrosstabAgentV2)
  const contextEntries = getAllContextScratchpadEntries('TableContextAgent');
  const allScratchpadEntries = contextEntries.flatMap(ctx =>
    ctx.entries.map(e => ({ ...e, contextId: ctx.contextId })),
  );
  const scratchpadMarkdown = formatScratchpadAsMarkdown('TableContextAgent', allScratchpadEntries);
  clearContextScratchpadsForAgent('TableContextAgent');

  // Compute summary
  let tablesChanged = 0;
  let tablesUnchanged = 0;
  let rowLabelsOverridden = 0;

  for (const result of results) {
    for (const tableResult of result.tables) {
      if (tableResult.noChangesNeeded) {
        tablesUnchanged++;
      } else {
        tablesChanged++;
        rowLabelsOverridden += tableResult.rowLabelOverrides.length;
      }
    }
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[TableContextAgent] Done: ${tablesChanged} changed, ${tablesUnchanged} unchanged, ` +
    `${rowLabelsOverridden} row labels overridden (${durationMs}ms)`,
  );

  return {
    results,
    summary: {
      totalGroups: groups.length,
      tablesChanged,
      tablesUnchanged,
      rowLabelsOverridden,
      durationMs,
    },
    scratchpadMarkdown,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
