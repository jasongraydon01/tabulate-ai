/**
 * NETEnrichmentAgent
 *
 * Purpose: Review flagged canonical standard_overview tables and propose
 * meaningful NET (roll-up) groupings. Each table is reviewed independently.
 * The agent outputs netting instructions; a deterministic apply step builds
 * the companion table.
 *
 * Inputs: NetEnrichmentContext (one table + entry context)
 * Output: NetEnrichmentResult (netting instructions per table)
 *
 * Runs one AI call per flagged table, parallelized with p-limit(3) in batch mode.
 * Error fallback: noNetsNeeded=true (never corrupt on failure).
 */

import { generateText, Output, stepCountIs } from 'ai';
import pLimit from 'p-limit';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  NetEnrichmentOutputSchema,
  type NetEnrichmentResult,
} from '../schemas/netEnrichmentSchema';
import {
  getNetEnrichmentModel,
  getNetEnrichmentModelName,
  getNetEnrichmentModelTokenLimit,
  getNetEnrichmentReasoningEffort,
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
import { getNetEnrichmentPrompt } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability/AgentMetrics';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import {
  renderNetEnrichmentBlock,
  type NetEnrichmentContext,
} from '../lib/v3/runtime/canonical/netEnrichmentRenderer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NetEnrichmentBatchResult {
  results: NetEnrichmentResult[];
  summary: {
    totalTables: number;
    netsProposed: number;
    tablesWithNets: number;
    tablesSkipped: number;
    durationMs: number;
  };
  scratchpadMarkdown: string;
}

// Re-export context type for pipeline wiring
export type { NetEnrichmentContext };

// ─── Single Table AI Call ────────────────────────────────────────────────────

async function callAI(
  context: NetEnrichmentContext,
  outputDir: string,
  abortSignal?: AbortSignal,
): Promise<NetEnrichmentResult> {
  const startTime = Date.now();
  const tableId = context.table.tableId;

  if (abortSignal?.aborted) {
    throw new DOMException('NETEnrichmentAgent aborted', 'AbortError');
  }

  // Build prompts
  const promptVersions = getPromptVersions();
  const systemInstructions = getNetEnrichmentPrompt(promptVersions.netEnrichmentPromptVersion);
  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${systemInstructions}`;
  const userPrompt = sanitizeForAzureContentFilter(renderNetEnrichmentBlock(context));

  // Create context-isolated scratchpad
  const scratchpad = createContextScratchpadTool('NETEnrichmentAgent', tableId);
  const genConfig = getGenerationConfig();

  try {
    const retryResult = await retryWithPolicyHandling(
      async () => {
        const { output, usage } = await generateText({
          model: getNetEnrichmentModel(),
          system: systemPrompt,
          prompt: userPrompt,
          tools: { scratchpad },
          maxRetries: 0,
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getNetEnrichmentModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getNetEnrichmentModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getNetEnrichmentReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: NetEnrichmentOutputSchema,
          }),
          abortSignal,
        });

        if (!output) {
          throw new Error('Invalid output from NETEnrichmentAgent');
        }

        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'NETEnrichmentAgent',
          getNetEnrichmentModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          durationMs,
        );

        return output.result;
      },
      {
        abortSignal,
        maxAttempts: 10,
        onRetry: (attempt, err) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          console.warn(
            `[NETEnrichmentAgent:${tableId}] Retry ${attempt}/10: ${err.message.substring(0, 120)}`,
          );
        },
      },
    );

    if (retryResult.error === 'Operation was cancelled') {
      throw new DOMException('NETEnrichmentAgent aborted', 'AbortError');
    }

    if (!retryResult.success || !retryResult.result) {
      throw new Error(`NETEnrichmentAgent failed for ${tableId}: ${retryResult.error || 'Unknown error'}`);
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
        agentName: 'NETEnrichmentAgent',
        severity: 'warning',
        actionTaken: 'continued',
        itemId: tableId,
        error,
      });
    } catch {
      // ignore persistence errors
    }

    console.warn(
      `[NETEnrichmentAgent:${tableId}] Failed, keeping table as-is: ${error instanceof Error ? error.message.substring(0, 120) : 'Unknown error'}`,
    );

    return makeNoOpResult(tableId);
  }
}

// ─── Batch Review ────────────────────────────────────────────────────────────

/**
 * Review all flagged tables in parallel with p-limit concurrency control.
 */
export async function reviewNetEnrichmentBatch(
  contexts: NetEnrichmentContext[],
  outputDir: string,
  abortSignal?: AbortSignal,
  concurrency = 3,
): Promise<NetEnrichmentBatchResult> {
  const startTime = Date.now();

  console.log(
    `[NETEnrichmentAgent] Reviewing ${contexts.length} tables for NET opportunities (concurrency=${concurrency})`,
  );

  // Clean slate for scratchpads
  clearContextScratchpadsForAgent('NETEnrichmentAgent');

  const limit = pLimit(concurrency);

  const results = await Promise.all(
    contexts.map(context =>
      limit(async () => {
        if (abortSignal?.aborted) {
          return makeNoOpResult(context.table.tableId);
        }

        return callAI(context, outputDir, abortSignal);
      }),
    ),
  );

  // Collect scratchpad entries — filter to this agent only
  const contextEntries = getAllContextScratchpadEntries('NETEnrichmentAgent');
  const allScratchpadEntries = contextEntries.flatMap(ctx =>
    ctx.entries.map(e => ({ ...e, contextId: ctx.contextId })),
  );
  const scratchpadMarkdown = formatScratchpadAsMarkdown('NETEnrichmentAgent', allScratchpadEntries);
  clearContextScratchpadsForAgent('NETEnrichmentAgent');

  // Compute summary
  let netsProposed = 0;
  let tablesWithNets = 0;
  let tablesSkipped = 0;

  for (const result of results) {
    if (result.noNetsNeeded) {
      tablesSkipped++;
    } else {
      tablesWithNets++;
      netsProposed += result.nets.length;
    }
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[NETEnrichmentAgent] Done: ${tablesWithNets} tables got NETs, ${netsProposed} NETs proposed, ` +
    `${tablesSkipped} tables skipped (${durationMs}ms)`,
  );

  return {
    results,
    summary: {
      totalTables: contexts.length,
      netsProposed,
      tablesWithNets,
      tablesSkipped,
      durationMs,
    },
    scratchpadMarkdown,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNoOpResult(tableId: string): NetEnrichmentResult {
  return {
    tableId,
    noNetsNeeded: true,
    reasoning: 'NETEnrichmentAgent skipped or failed; keeping table as-is.',
    suggestedSubtitle: '',
    nets: [],
  };
}
