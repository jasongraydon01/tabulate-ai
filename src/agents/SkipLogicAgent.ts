/**
 * SkipLogicAgent
 *
 * Purpose: Read the survey document once and extract ALL skip/show/filter rules.
 * Replaces the per-table BaseFilterAgent approach with a single extraction pass.
 *
 * Supports two modes:
 * - Single-pass: surveys under SKIPLOGIC_CHUNK_THRESHOLD (default 40K chars)
 * - Chunked: large surveys split at question boundaries, processed sequentially
 *   with accumulated context from prior chunks
 *
 * Reads: Survey markdown
 * Writes: {outputDir}/skiplogic/ outputs
 */

/**
 * @deprecated Replaced by DeterministicBaseEngine (src/lib/bases/).
 * Skip logic AI pipeline removed in favor of data-driven base inference.
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

import { generateText, stepCountIs } from 'ai';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  type SkipLogicResult,
  type SkipRule,
} from '../schemas/skipLogicSchema';
import {
  getSkipLogicModel,
  getSkipLogicModelName,
  getSkipLogicModelTokenLimit,
  getSkipLogicReasoningEffort,
  getPromptVersions,
  getGenerationConfig,
  getGenerationSamplingParams,
} from '../lib/env';
import {
  skipLogicScratchpadTool,
  clearScratchpadEntries,
  getAndClearScratchpadEntries,
  getScratchpadEntries,
  formatScratchpadAsMarkdown,
  createContextScratchpadTool,
  getAllContextScratchpadEntries,
} from './tools/scratchpad';
import {
  createRuleEmitterTool,
  getEmittedRules,
  clearEmittedRules,
  createContextRuleEmitterTool,
  getContextEmittedRules,
  clearAllContextEmitters,
} from './tools/ruleEmitter';
import { getSkipLogicPrompt, getSkipLogicCoreInstructions } from '../prompts/skiplogic';
import { retryWithPolicyHandling, type RetryContext } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability';
import {
  segmentSurveyIntoChunks,
  buildSurveyOutline,
  formatAccumulatedRules,
  deduplicateRules,
  getSurveyStats,
} from '../lib/survey/surveyChunker';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import fs from 'fs/promises';
import path from 'path';

// =============================================================================
// Configuration
// =============================================================================

/** Character threshold for chunked mode. Surveys above this use chunked processing. */
function getChunkThreshold(): number {
  return parseInt(process.env.SKIPLOGIC_CHUNK_THRESHOLD || '40000', 10);
}

/** Character budget per chunk (how large each chunk can be). */
function getChunkSize(): number {
  return parseInt(process.env.SKIPLOGIC_CHUNK_SIZE || '40000', 10);
}

/** Maximum number of chunks to avoid excessive sequential API calls. */
function getMaxChunks(): number {
  return parseInt(process.env.SKIPLOGIC_MAX_CHUNKS || '10', 10);
}

// Get modular prompt based on environment variable
const getSkipLogicAgentInstructions = (): string => {
  const promptVersions = getPromptVersions();
  return getSkipLogicPrompt(promptVersions.skipLogicPromptVersion);
};

export interface SkipLogicProcessingOptions {
  outputDir?: string;
  abortSignal?: AbortSignal;
}

// =============================================================================
// Router — decides single-pass vs chunked
// =============================================================================

/**
 * Extract all skip/show rules from the survey document.
 * Routes to single-pass or chunked mode based on survey size.
 */
export async function extractSkipLogic(
  surveyMarkdown: string,
  options?: SkipLogicProcessingOptions
): Promise<SkipLogicResult> {
  console.warn('[DEPRECATED] extractSkipLogic() called — this should not be invoked in the active pipeline. Use DeterministicBaseEngine instead.');
  const stats = getSurveyStats(surveyMarkdown);
  const threshold = getChunkThreshold();

  console.log(`[SkipLogicAgent] Survey: ${stats.charCount} chars (~${stats.estimatedTokens} tokens), threshold: ${threshold} chars`);

  try {
    if (stats.charCount <= threshold) {
      return extractSkipLogicSinglePass(surveyMarkdown, options);
    } else {
      return extractSkipLogicChunked(surveyMarkdown, options);
    }
  } catch (error) {
    const outputDir = options?.outputDir;
    if (outputDir) {
      try {
        await persistAgentErrorAuto({
          outputDir,
          agentName: 'SkipLogicAgent',
          severity: error instanceof DOMException && error.name === 'AbortError' ? 'warning' : 'error',
          actionTaken: error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'continued',
          error,
          meta: {
            charCount: stats.charCount,
            estimatedTokens: stats.estimatedTokens,
            threshold,
          },
        });
      } catch {
        // ignore
      }
    }
    throw error;
  }
}

// =============================================================================
// Single-Pass Mode (existing behavior, unchanged)
// =============================================================================

/**
 * Extract skip/show rules in a single AI call.
 * Used for surveys that fit within the token budget.
 */
async function extractSkipLogicSinglePass(
  surveyMarkdown: string,
  options?: SkipLogicProcessingOptions
): Promise<SkipLogicResult> {
  const { outputDir, abortSignal } = options || {};
  const startTime = Date.now();
  const maxAttempts = 10;

  console.log(`[SkipLogicAgent] Single-pass mode`);
  console.log(`[SkipLogicAgent] Using model: ${getSkipLogicModelName()}`);
  console.log(`[SkipLogicAgent] Reasoning effort: ${getSkipLogicReasoningEffort()}`);
  const genConfig = getGenerationConfig();
  console.log(`[SkipLogicAgent] Survey: ${surveyMarkdown.length} characters`);

  // Check for cancellation
  if (abortSignal?.aborted) {
    throw new DOMException('SkipLogicAgent aborted', 'AbortError');
  }

  // Clear scratchpad and rule emitter from any previous runs (only once at the start)
  clearScratchpadEntries();
  clearEmittedRules();

  // Create emitRule tool
  const emitRule = createRuleEmitterTool('SkipLogicAgent');

  // Build base prompts (will be enhanced with scratchpad + emitted rules context on retries)
  const baseSystemPrompt = `
${RESEARCH_DATA_PREAMBLE}${getSkipLogicAgentInstructions()}

## Survey Document
<survey>
${sanitizeForAzureContentFilter(surveyMarkdown)}
</survey>
`;

  const baseUserPrompt = `Read the entire survey document above and extract skip/show/filter rules that define who should be included in a question's analytic base (i.e., rules that could require additional constraints beyond the default base of "banner cut + non-NA").

Be conservative: if you cannot point to clear evidence in the survey that the default base would be wrong, DO NOT create a rule.

Walk through the survey systematically, section by section. Use the scratchpad to document your analysis for each question. When you confirm a rule, IMMEDIATELY call emitRule with all fields.

When you have finished scanning the entire survey, stop.`;

  const retryResult = await retryWithPolicyHandling(
    async (ctx: RetryContext) => {
      // Policy-safe fallback: if Azure repeatedly content-filters the full survey,
      // return whatever rules were emitted so far rather than failing the pipeline.
      if (ctx.shouldUsePolicySafeVariant) {
        const partialRules = getEmittedRules();
        console.warn(`[SkipLogicAgent] Policy-safe mode triggered — returning ${partialRules.length} emitted rules to continue pipeline`);
        return { rules: partialRules };
      }

      // Get scratchpad state and emitted rules before the call (for error context and prompt enhancement)
      const scratchpadBeforeCall = getScratchpadEntries().filter(e => e.agentName === 'SkipLogicAgent');
      const rulesBeforeCall = getEmittedRules();

      // Enhance prompts with scratchpad + emitted rules context if this is a retry
      let systemPrompt = baseSystemPrompt;
      let userPrompt = baseUserPrompt;

      if (scratchpadBeforeCall.length > 0 || rulesBeforeCall.length > 0) {
        // This is a retry - include existing context so agent can resume
        const scratchpadContext = scratchpadBeforeCall.length > 0
          ? scratchpadBeforeCall
              .map((e, i) => `[${i + 1}] (${e.action}) ${e.content}`)
              .join('\n\n')
          : '';

        const retryParts: string[] = [baseSystemPrompt];

        if (scratchpadContext) {
          retryParts.push(`
## Previous Analysis (from scratchpad)
You have already analyzed part of this survey. Here are your previous scratchpad entries:
${scratchpadContext}`);
        }

        if (rulesBeforeCall.length > 0) {
          retryParts.push(`
## Rules Already Emitted (${rulesBeforeCall.length} rules saved — do NOT re-emit)
<already_emitted>
${formatAccumulatedRules(rulesBeforeCall)}
</already_emitted>
Continue scanning from where you left off. Only emit NEW rules.`);
        }

        retryParts.push(`
IMPORTANT: You are RETRYING after a previous attempt failed. Continue from where you left off — do NOT restart from the beginning.`);

        systemPrompt = retryParts.join('\n');

        userPrompt = `${baseUserPrompt}

NOTE: This is a retry attempt. ${rulesBeforeCall.length > 0 ? `${rulesBeforeCall.length} rules have already been emitted — do NOT re-emit them.` : ''} ${scratchpadBeforeCall.length > 0 ? `You have ${scratchpadBeforeCall.length} scratchpad entries from previous analysis.` : ''} Use the scratchpad "read" action first to review your previous work, then continue analyzing the remaining questions.`;
      }

      try {
        const result = await generateText({
          model: getSkipLogicModel(),
          system: systemPrompt,
          maxRetries: 0, // Centralized outer retries via retryWithPolicyHandling
          prompt: userPrompt,
          tools: {
            scratchpad: skipLogicScratchpadTool,
            emitRule,
          },
          stopWhen: stepCountIs(80),
          maxOutputTokens: Math.min(getSkipLogicModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getSkipLogicModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getSkipLogicReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          abortSignal,
        });

        const { usage } = result;

        // Record metrics
        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'SkipLogicAgent',
          getSkipLogicModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          durationMs
        );

        // Collect rules from emitter (deduplicated by ruleId as safety net)
        const allEmitted = getEmittedRules();
        const dedupedRules = deduplicateEmittedRules(allEmitted);

        return { rules: dedupedRules };
      } catch (error) {
        // Enhanced error logging with scratchpad + emitter context
        const scratchpadAfterError = getScratchpadEntries().filter(e => e.agentName === 'SkipLogicAgent');
        const rulesAfterError = getEmittedRules();
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorType = error instanceof Error ? error.constructor.name : typeof error;

        console.error(`[SkipLogicAgent] Error details:`, {
          error: errorMessage,
          type: errorType,
          scratchpadEntries: scratchpadAfterError.length,
          emittedRules: rulesAfterError.length,
          lastScratchpadEntry: scratchpadAfterError.length > 0
            ? scratchpadAfterError[scratchpadAfterError.length - 1].content.substring(0, 200)
            : 'none',
        });

        throw error;
      }
    },
    {
      abortSignal,
      maxAttempts,
      onRetry: (attempt, err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }

        // Enhanced retry logging with scratchpad + emitter context
        const scratchpadEntriesCount = getScratchpadEntries().filter(e => e.agentName === 'SkipLogicAgent').length;
        const emittedRulesCount = getEmittedRules().length;
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorType = err instanceof Error ? err.constructor.name : typeof err;

        console.warn(
          `[SkipLogicAgent] Retry ${attempt}/${maxAttempts}: ${errorMessage.substring(0, 200)}` +
          ` | Type: ${errorType}` +
          ` | Scratchpad entries: ${scratchpadEntriesCount}` +
          ` | Emitted rules preserved: ${emittedRulesCount}`
        );
      },
    }
  );

  if (retryResult.success && retryResult.result) {
    const extraction = retryResult.result;
    const durationMs = Date.now() - startTime;

    console.log(`[SkipLogicAgent] Extracted ${extraction.rules.length} rules in ${durationMs}ms`);

    // Collect scratchpad entries (agent-specific to avoid contamination)
    const scratchpadEntries = getAndClearScratchpadEntries('SkipLogicAgent');

    const result: SkipLogicResult = {
      extraction,
      metadata: {
        rulesExtracted: extraction.rules.length,
        durationMs,
      },
    };

    // Save outputs
    if (outputDir) {
      await saveSkipLogicOutputs(result, outputDir, scratchpadEntries);
    }

    return result;
  }

  // Handle abort — still return any rules emitted before abort
  if (retryResult.error === 'Operation was cancelled') {
    const partialRules = getEmittedRules();
    if (partialRules.length > 0) {
      console.warn(`[SkipLogicAgent] Aborted but returning ${partialRules.length} emitted rules`);
      return {
        extraction: { rules: deduplicateEmittedRules(partialRules) },
        metadata: {
          rulesExtracted: partialRules.length,
          durationMs: Date.now() - startTime,
        },
      };
    }
    throw new DOMException('SkipLogicAgent aborted', 'AbortError');
  }

  // All retries failed — return whatever rules were emitted (partial success)
  const partialRules = getEmittedRules();
  const errorMessage = retryResult.error || 'Unknown error';

  if (partialRules.length > 0) {
    console.warn(`[SkipLogicAgent] Extraction failed but returning ${partialRules.length} emitted rules: ${errorMessage}`);
    return {
      extraction: { rules: deduplicateEmittedRules(partialRules) },
      metadata: {
        rulesExtracted: partialRules.length,
        durationMs: Date.now() - startTime,
      },
    };
  }

  console.error(`[SkipLogicAgent] Extraction failed: ${errorMessage}`);
  return {
    extraction: { rules: [] },
    metadata: {
      rulesExtracted: 0,
      durationMs: Date.now() - startTime,
    },
  };
}

// =============================================================================
// Chunked Mode — processes large surveys in sequential chunks
// =============================================================================

/**
 * Extract skip/show rules by chunking the survey at question boundaries
 * and processing each chunk sequentially with accumulated context.
 */
async function extractSkipLogicChunked(
  surveyMarkdown: string,
  options?: SkipLogicProcessingOptions
): Promise<SkipLogicResult> {
  const { outputDir, abortSignal } = options || {};
  const startTime = Date.now();
  const chunkSize = getChunkSize();
  const maxChunks = getMaxChunks();
  const maxAttempts = 10;

  console.log(`[SkipLogicAgent] Chunked mode — survey exceeds threshold`);
  console.log(`[SkipLogicAgent] Using model: ${getSkipLogicModelName()}`);
  console.log(`[SkipLogicAgent] Reasoning effort: ${getSkipLogicReasoningEffort()}`);
  const genConfig = getGenerationConfig();

  // Step 1: Build survey outline (compact view of full survey structure)
  const surveyOutline = buildSurveyOutline(surveyMarkdown);
  console.log(`[SkipLogicAgent] Survey outline: ${surveyOutline.length} chars`);

  // Step 2: Segment and chunk the survey — cap chunk count
  const stats = getSurveyStats(surveyMarkdown);
  const effectiveChunkSize = Math.max(chunkSize, Math.ceil(stats.charCount / maxChunks));
  if (effectiveChunkSize > chunkSize) {
    console.log(`[SkipLogicAgent] Chunk size bumped from ${chunkSize} to ${effectiveChunkSize} chars to stay within ${maxChunks} chunk cap`);
  }

  const { chunks, metadata: chunkingMeta } = segmentSurveyIntoChunks(
    surveyMarkdown,
    effectiveChunkSize,
    2 // overlap segments
  );

  if (chunks.length > maxChunks) {
    console.warn(`[SkipLogicAgent] Warning: ${chunks.length} chunks exceeds cap of ${maxChunks} (overlap may have pushed count over)`);
  }

  // Graceful fallback: if chunking produced only 1 chunk (no question boundaries detected)
  if (chunkingMeta.wasSinglePass) {
    console.warn(`[SkipLogicAgent] Chunker returned single chunk — falling back to single-pass with warning`);
    return extractSkipLogicSinglePass(surveyMarkdown, options);
  }

  console.log(`[SkipLogicAgent] Chunked mode: ${chunks.length} chunks (budget ${chunkSize} chars each)`);
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[SkipLogicAgent]   Chunk ${i + 1}: ${chunks[i].length} chars (~${Math.ceil(chunks[i].length / 4)} tokens)`);
  }

  // Clear context-isolated emitters from any previous runs
  clearAllContextEmitters();

  // Step 3: Process chunks sequentially
  const allRules: SkipRule[] = [];
  const rulesPerChunk: number[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    // Check for cancellation before each chunk
    if (abortSignal?.aborted) {
      throw new DOMException('SkipLogicAgent aborted', 'AbortError');
    }

    const chunkNum = i + 1;
    const chunkStartTime = Date.now();
    console.log(`[SkipLogicAgent] Processing chunk ${chunkNum}/${chunks.length}...`);

    // Create context-isolated scratchpad and rule emitter for this chunk
    const chunkContextId = `chunk-${chunkNum}`;
    const chunkScratchpad = createContextScratchpadTool('SkipLogicAgent', chunkContextId);
    const chunkEmitter = createContextRuleEmitterTool('SkipLogicAgent', chunkContextId);

    // Build chunk-specific prompts
    const systemPrompt = buildChunkedSystemPrompt(
      chunks[i],
      surveyOutline,
      allRules,
      chunkNum,
      chunks.length
    );

    const userPrompt = buildChunkedUserPrompt(chunkNum, chunks.length, allRules.length);

    const retryResult = await retryWithPolicyHandling(
      async (ctx: RetryContext) => {
        // Policy-safe fallback: return rules emitted so far for this chunk.
        if (ctx.shouldUsePolicySafeVariant) {
          const partialChunkRules = getContextEmittedRules(chunkContextId);
          console.warn(`[SkipLogicAgent] Chunk ${chunkNum}: policy-safe mode triggered — returning ${partialChunkRules.length} emitted rules for this chunk`);
          return { rules: partialChunkRules };
        }

        const result = await generateText({
          model: getSkipLogicModel(),
          system: systemPrompt,
          maxRetries: 0, // Centralized outer retries via retryWithPolicyHandling
          prompt: userPrompt,
          tools: {
            scratchpad: chunkScratchpad,
            emitRule: chunkEmitter,
          },
          stopWhen: stepCountIs(50),
          maxOutputTokens: Math.min(getSkipLogicModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getSkipLogicModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getSkipLogicReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          abortSignal,
        });

        const { usage } = result;

        // Record metrics per chunk
        const chunkDurationMs = Date.now() - chunkStartTime;
        recordAgentMetrics(
          'SkipLogicAgent',
          getSkipLogicModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          chunkDurationMs
        );

        totalInputTokens += usage?.inputTokens || 0;
        totalOutputTokens += usage?.outputTokens || 0;

        // Collect rules from context-isolated emitter
        const chunkRules = getContextEmittedRules(chunkContextId);
        return { rules: chunkRules };
      },
      {
        abortSignal,
        maxAttempts,
        onRetry: (attempt, err) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          const emittedSoFar = getContextEmittedRules(chunkContextId).length;
          console.warn(
            `[SkipLogicAgent] Chunk ${chunkNum} retry ${attempt}/${maxAttempts}: ${err.message.substring(0, 200)}` +
            ` | Emitted rules preserved: ${emittedSoFar}`
          );
        },
      }
    );

    if (retryResult.success && retryResult.result) {
      const chunkRules = retryResult.result.rules;
      console.log(`[SkipLogicAgent] Chunk ${chunkNum}: emitted ${chunkRules.length} rules`);
      allRules.push(...chunkRules);
      rulesPerChunk.push(chunkRules.length);
    } else {
      // Still collect any rules emitted before the failure
      const partialChunkRules = getContextEmittedRules(chunkContextId);
      if (partialChunkRules.length > 0) {
        console.warn(
          `[SkipLogicAgent] Chunk ${chunkNum} failed but collected ${partialChunkRules.length} emitted rules: ${retryResult.error || 'Unknown error'}`
        );
        allRules.push(...partialChunkRules);
        rulesPerChunk.push(partialChunkRules.length);
      } else {
        console.error(
          `[SkipLogicAgent] Chunk ${chunkNum} failed: ${retryResult.error || 'Unknown error'} — continuing with remaining chunks`
        );
        rulesPerChunk.push(0);
      }
      // Don't abort the whole pipeline — continue with other chunks
    }
  }

  // Step 4: Deduplicate rules from overlapping regions
  const ruleCountBeforeDedup = allRules.length;
  const deduplicatedRules = deduplicateRules(allRules);
  const removedByDedup = ruleCountBeforeDedup - deduplicatedRules.length;

  console.log(
    `[SkipLogicAgent] Deduplication: ${ruleCountBeforeDedup} → ${deduplicatedRules.length} rules (${removedByDedup} duplicates removed)`
  );

  const durationMs = Date.now() - startTime;
  console.log(`[SkipLogicAgent] Chunked mode complete: ${deduplicatedRules.length} rules in ${durationMs}ms`);

  // Step 5: Collect all scratchpad entries from all chunks
  const allScratchpadEntries = getAllContextScratchpadEntries('SkipLogicAgent');
  const flatScratchpadEntries = allScratchpadEntries.flatMap(ctx =>
    ctx.entries.map(entry => ({
      ...entry,
      // Prefix context ID for clarity in the output
      content: `[${ctx.contextId}] ${entry.content}`,
    }))
  );

  const result: SkipLogicResult = {
    extraction: { rules: deduplicatedRules },
    metadata: {
      rulesExtracted: deduplicatedRules.length,
      durationMs,
    },
  };

  // Step 6: Save outputs
  if (outputDir) {
    await saveSkipLogicOutputs(result, outputDir, flatScratchpadEntries, {
      mode: 'chunked',
      totalChunks: chunks.length,
      chunkCharCounts: chunkingMeta.chunkCharCounts,
      rulesBeforeDedup: ruleCountBeforeDedup,
      rulesAfterDedup: deduplicatedRules.length,
      totalInputTokens,
      totalOutputTokens,
      emissionMode: 'incremental',
      rulesPerChunk,
    });
  }

  return result;
}

// =============================================================================
// Chunked Prompt Construction
// =============================================================================

/**
 * Build the system prompt for a chunked call.
 * Includes: core instructions, survey outline, chunk content, accumulated rules.
 */
function buildChunkedSystemPrompt(
  chunkContent: string,
  surveyOutline: string,
  accumulatedRules: SkipRule[],
  chunkNum: number,
  totalChunks: number
): string {
  const parts: string[] = [];

  // Core instructions (shared with single-pass)
  parts.push(`${RESEARCH_DATA_PREAMBLE}${getSkipLogicCoreInstructions()}`);

  // Chunked mode context
  parts.push(`
## Processing Mode: Chunked Survey Analysis

You are processing CHUNK ${chunkNum} of ${totalChunks} of a large survey document.
Focus ONLY on extracting rules for questions that appear in YOUR chunk.
Do NOT invent rules for questions you cannot see in the chunk below.

The survey outline below gives you the full question structure so you can reference
variables from other parts of the survey when describing conditions.`);

  // Survey outline (compact view of entire survey)
  parts.push(`
## Survey Outline (full survey structure)
<survey_outline>
${surveyOutline}
</survey_outline>`);

  // Accumulated rules from previous chunks (for chunks 2+)
  if (accumulatedRules.length > 0) {
    parts.push(`
## Rules Already Extracted (do NOT re-extract these)
The following rules were extracted from earlier chunks. If you encounter the same
rule or a rule that applies to the same questions with the same condition, skip it.
<previous_rules>
${formatAccumulatedRules(accumulatedRules)}
</previous_rules>`);
  }

  // Structured scratchpad + emitRule protocol for chunks
  parts.push(`
<scratchpad_protocol>
USE THE SCRATCHPAD AND emitRule TOGETHER:

**Step 1 — Chunk Survey Map** (do BEFORE extracting any rules):
- List all question IDs present in this chunk
- Note any cross-references to questions OUTSIDE this chunk (e.g., "[ASK IF Q5=1]" where Q5 is not in your chunk — check the survey outline for context)
- Check the survey outline for [SKIP:] and [BASE:] annotations on questions in this chunk
${chunkNum > 1 ? '- Note which of your questions are already covered by prior rules (see "Rules Already Extracted" above)' : ''}

**Step 2 — Systematic Question Walkthrough:**
- Walk through questions top to bottom, one at a time
- For each question: identify any skip/show/filter instructions, classify as table-level, column-level, row-level, or no rule
- Explicitly ask: "Is the default base sufficient, or does the survey text require a restriction?"
- Check for loop-inherent conditions (e.g., "for each product you selected")
- Note coding tables or hidden variable definitions that affect gating
- When you find a rule, IMMEDIATELY call emitRule with all fields — do this NOW while context is fresh

**Step 3 — Cross-Chunk Awareness:**
- Review the survey outline for questions in OTHER chunks that have [SKIP:] annotations referencing variables in your chunk — but do NOT create rules for questions outside your chunk
- Cross-check your emitted rules against "Rules Already Extracted" — do NOT re-emit

**Step 4 — Final Review:**
- Use the scratchpad "read" action to review all your notes
- Cross-check that all identified rules were emitted via emitRule — emit any missing ones
- Verify each emitted rule has clear survey text evidence
- Then stop — do not produce any final JSON or summary
</scratchpad_protocol>`);

  // The chunk content itself
  parts.push(`
## Your Survey Chunk (${chunkNum} of ${totalChunks})
<survey_chunk>
${sanitizeForAzureContentFilter(chunkContent)}
</survey_chunk>`);

  return parts.join('\n');
}

/**
 * Build the user prompt for a chunked call.
 */
function buildChunkedUserPrompt(
  chunkNum: number,
  totalChunks: number,
  previousRuleCount: number
): string {
  const parts: string[] = [];

  parts.push(
    `Analyze the survey chunk above (chunk ${chunkNum} of ${totalChunks}) and extract skip/show/filter rules for questions in THIS chunk.`
  );

  parts.push(
    `Be conservative: if you cannot point to clear evidence that the default base would be wrong, DO NOT create a rule.`
  );

  if (previousRuleCount > 0) {
    parts.push(
      `${previousRuleCount} rules have already been extracted from earlier chunks. Do NOT re-extract rules for the same questions with the same conditions.`
    );
  }

  parts.push(
    `Use the scratchpad to document your analysis. When you confirm a rule, IMMEDIATELY call emitRule. When done scanning this chunk, stop.`
  );

  return parts.join('\n\n');
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Deduplicate emitted rules by ruleId (safety net for retries where
 * the model might re-emit a rule it already emitted in a prior attempt).
 * Keeps the last occurrence of each ruleId (later emission = more context).
 */
function deduplicateEmittedRules(rules: SkipRule[]): SkipRule[] {
  const seen = new Map<string, SkipRule>();
  for (const rule of rules) {
    seen.set(rule.ruleId, rule);
  }
  return Array.from(seen.values());
}

// =============================================================================
// Development Outputs
// =============================================================================

async function saveSkipLogicOutputs(
  result: SkipLogicResult,
  outputDir: string,
  scratchpadEntries: Array<{ timestamp: string; agentName: string; action: string; content: string }>,
  chunkingInfo?: {
    mode: string;
    totalChunks: number;
    chunkCharCounts: number[];
    rulesBeforeDedup: number;
    rulesAfterDedup: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    emissionMode?: string;
    rulesPerChunk?: number[];
  }
): Promise<void> {
  try {
    const skiplogicDir = path.join(outputDir, 'skiplogic');
    await fs.mkdir(skiplogicDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Save extraction output
    const filename = `skiplogic-output-${timestamp}.json`;
    const filePath = path.join(skiplogicDir, filename);
    const enhancedOutput = {
      ...result,
      processingInfo: {
        timestamp: new Date().toISOString(),
        aiProvider: 'azure-openai',
        model: getSkipLogicModelName(),
        reasoningEffort: getSkipLogicReasoningEffort(),
        emissionMode: 'incremental' as const,
        ...(chunkingInfo && { chunking: chunkingInfo }),
      },
    };
    await fs.writeFile(filePath, JSON.stringify(enhancedOutput, null, 2), 'utf-8');
    console.log(`[SkipLogicAgent] Output saved to skiplogic/: ${filename}`);

    // Save raw output
    const rawPath = path.join(skiplogicDir, 'skiplogic-output-raw.json');
    await fs.writeFile(rawPath, JSON.stringify(result.extraction, null, 2), 'utf-8');

    // Save scratchpad
    if (scratchpadEntries.length > 0) {
      const scratchpadFilename = `scratchpad-skiplogic-${timestamp}.md`;
      const scratchpadPath = path.join(skiplogicDir, scratchpadFilename);
      const markdown = formatScratchpadAsMarkdown('SkipLogicAgent', scratchpadEntries);
      await fs.writeFile(scratchpadPath, markdown, 'utf-8');
      console.log(`[SkipLogicAgent] Scratchpad saved to skiplogic/: ${scratchpadFilename}`);
    }
  } catch (error) {
    console.error('[SkipLogicAgent] Failed to save outputs:', error);
  }
}
