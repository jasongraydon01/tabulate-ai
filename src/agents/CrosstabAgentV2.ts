/**
 * CrosstabAgentV2
 *
 * Question-centric variant of CrosstabAgent.
 * Accepts QuestionContext[] instead of DataMapType, renders question-grouped XML
 * into the system prompt. Shares all validation/normalization utilities with V1.
 *
 * Activated via USE_QUESTION_CENTRIC=true feature flag.
 */

import { generateText, Output, stepCountIs } from 'ai';
import fs from 'fs/promises';
import path from 'path';

import {
  ValidatedGroupSchema,
  combineValidationResults,
  type ValidationResultType,
  type ValidatedGroupType,
} from '../schemas/agentOutputSchema';
import type { BannerGroupType, BannerPlanInputType } from '../schemas/bannerPlanSchema';
import type { QuestionContext } from '../schemas/questionContextSchema';
import {
  getCrosstabModel,
  getCrosstabModelName,
  getCrosstabModelTokenLimit,
  getCrosstabReasoningEffort,
  getGenerationConfig,
  getGenerationSamplingParams,
  getPromptVersions,
} from '../lib/env';
import {
  createContextScratchpadTool,
  getAllContextScratchpadEntries,
  clearContextScratchpadsForAgent,
  formatScratchpadAsMarkdown,
} from './tools/scratchpad';
import { getCrosstabPrompt } from '../prompts';
import { buildLoopAwarePrompt } from '../prompts/crosstab/production';
import { retryWithPolicyHandling, type RetryContext } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter, sanitizeHintForPrompt } from '../lib/promptSanitization';
import { extractAllColumns } from '../lib/questionContext';
import { renderQuestionContextForCrosstab } from '../lib/questionContext/renderers';

// Import shared utilities from V1 CrosstabAgent
import {
  normalizeGroupOutput,
  buildPolicyFallbackColumn,
  buildPolicyFallbackGroup,
  type CutValidationErrorContext,
  type CrosstabScratchpadByGroup,
} from './CrosstabAgent';

// ---------------------------------------------------------------------------
// R expression variable extraction (same logic as V1)
// ---------------------------------------------------------------------------

const R_KEYWORDS = new Set([
  'TRUE', 'FALSE', 'NA', 'NULL', 'Inf', 'NaN',
  'if', 'else', 'for', 'in', 'while', 'repeat', 'next', 'break',
  'function', 'return', 'c', 'rep', 'nrow', 'ncol',
  'with', 'data', 'eval', 'parse', 'text',
  'is', 'na', 'as', 'numeric', 'character', 'logical',
  'sum', 'mean', 'max', 'min', 'length',
  'median', 'quantile', 'probs',
  'na.rm',
  'grepl', 'nchar', 'paste', 'paste0',
]);

function extractVariableNames(rExpression: string): string[] {
  const matches = rExpression.match(/\b([A-Za-z][A-Za-z0-9_.]*)\b/g) || [];
  const vars = new Set<string>();
  for (const m of matches) {
    if (R_KEYWORDS.has(m)) continue;
    if (/^\d+$/.test(m)) continue;
    if (/^(is|as|na)\.[a-z]+$/i.test(m)) continue;
    vars.add(m);
  }
  return [...vars];
}

// ---------------------------------------------------------------------------
// V2 Options
// ---------------------------------------------------------------------------

export interface ReviewContextEntry {
  columnName: string;
  action: 'approved' | 'alternative_selected' | 'user_edited';
  finalExpression: string;
}

export interface ProcessGroupV2Options {
  abortSignal?: AbortSignal;
  hint?: string;
  outputDir?: string;
  rValidationErrors?: CutValidationErrorContext;
  loopCount?: number;
  previousResult?: ValidatedGroupType;
  reviewContext?: ReviewContextEntry[];
  previousAttemptContext?: {
    priorColumns: Array<{
      name: string;
      original?: string;
      adjusted?: string;
      reasoning?: string;
      alternatives?: Array<{ expression: string; rank: number; userSummary: string }>;
      uncertainties?: string[];
    }>;
    priorScratchpadEntries: Array<{ timestamp: string; action: string; content: string }>;
    mode: 'hint_retry' | 'cut_retry';
  };
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function sanitizePriorColumnsForPrompt(
  priorColumns: Array<{
    name: string;
    original?: string;
    adjusted?: string;
    reasoning?: string;
    alternatives?: Array<{ expression: string; rank: number; userSummary: string }>;
    uncertainties?: string[];
  }> | undefined,
): string {
  if (!priorColumns || priorColumns.length === 0) return 'None';
  const compact = priorColumns.map((col) => ({
    name: col.name,
    original: col.original || '',
    adjusted: col.adjusted || '',
    reasoning: col.reasoning || '',
    alternatives: (col.alternatives || []).slice(0, 3),
    uncertainties: (col.uncertainties || []).slice(0, 5),
  }));
  return sanitizeForAzureContentFilter(JSON.stringify(compact, null, 2));
}

function buildSystemPromptV2(
  questions: QuestionContext[],
  group: BannerGroupType,
  loopCount: number,
  hint?: string,
  previousAttemptContext?: ProcessGroupV2Options['previousAttemptContext'],
  reviewContext?: ReviewContextEntry[],
): string {
  // Get prompt instructions (uses production_v3 by default for V2)
  const promptVersions = getPromptVersions();
  const baseInstructions = getCrosstabPrompt(promptVersions.crosstabPromptVersion);
  const loopAwareInstructions = buildLoopAwarePrompt(baseInstructions, loopCount);

  if (loopCount > 0) {
    console.log(`[CrosstabAgentV2] Loop guidance appended (${loopCount} iterations)`);
  }

  const sanitizedHint = hint
    ? sanitizeHintForPrompt(hint)
    : '';

  const hintDefense = sanitizedHint
    ? `
A human reviewer has examined your prior output and provided corrective guidance in <reviewer-hint> below. This person is a domain expert who understands the survey data and the intended analysis. Take their guidance seriously — they are pointing you in a direction, providing clarity on something you may have gotten wrong or been uncertain about.

Rules for applying reviewer guidance:
- If the hint names specific variables (e.g., "use hCLASS1 | hCLASS2"), use exactly those variables in your revised expression — but verify they exist in the survey questions first.
- If the hint describes a pattern (e.g., "capture both loops"), apply that pattern consistently across all columns in this group.
- If the hint contradicts your prior reasoning, lean toward the hint — the reviewer likely has context you do not. But if the hint asks for something logically impossible (e.g., a variable that doesn't exist), explain what you found and propose the closest valid alternative.
- Your revised expression must clearly reflect the hint's intent.
- In your reasoning field, begin with a brief summary of what you changed and why.
`
    : '';

  const hintSection = sanitizedHint
    ? `\n<reviewer-hint>\n${sanitizedHint}\n</reviewer-hint>\n`
    : '';

  const previousAttemptSection = previousAttemptContext?.priorColumns
    ? `\n<previous_attempt_output>\n${sanitizePriorColumnsForPrompt(previousAttemptContext.priorColumns)}\n</previous_attempt_output>`
    : '';

  // Build review context section — shows already-resolved cuts in the same group
  const reviewContextSection = reviewContext && reviewContext.length > 0
    ? `\n<review_context>
The human reviewer has already resolved other cuts in this same group during the current review session.
These decisions establish a pattern you should follow for consistency:

${reviewContext.map(entry => `- "${entry.columnName}" (${entry.action}): ${entry.finalExpression}`).join('\n')}

Use this context to ensure your output is consistent with the reviewer's established pattern.
If the reviewer consistently chose a specific variable mapping pattern (e.g., OR-joined iteration
variables), apply that same pattern to the cuts you are processing now.
</review_context>\n`
    : '';

  const totalVars = questions.reduce((sum, q) => sum + q.items.length, 0);
  const questionXml = renderQuestionContextForCrosstab(questions);

  return `${RESEARCH_DATA_PREAMBLE}${loopAwareInstructions}${hintDefense}
${hintSection}${reviewContextSection}
NOTE: The survey data is presented in question-centric format below. Each <question>
contains all its executable variables as <item> elements. The "col" attribute on each
<item> is the SPSS column name you must use in R expressions. The <values> element
(when present) shows the valid value codes and labels for that question's items.

CURRENT CONTEXT DATA:

SURVEY QUESTIONS (${questions.length} questions, ${totalVars} executable variables):
${sanitizeForAzureContentFilter(questionXml)}

BANNER GROUP TO VALIDATE:
Group: "${group.groupName}"
${sanitizeForAzureContentFilter(JSON.stringify(group, null, 2))}
${previousAttemptSection}
PROCESSING REQUIREMENTS:
- Validate all ${group.columns.length} columns in this group
- Generate R syntax for each column's "original" expression
- Variable names for R expressions MUST come from the <item col="..."> attributes above
- Provide confidence scores and detailed reasoning
- Use scratchpad to show your validation process

Begin validation now.
`;
}

// ---------------------------------------------------------------------------
// processGroupV2 — single group processing
// ---------------------------------------------------------------------------

export async function processGroupV2(
  questions: QuestionContext[],
  allColumns: Set<string>,
  group: BannerGroupType,
  options?: ProcessGroupV2Options,
): Promise<ValidatedGroupType> {
  const {
    abortSignal,
    hint,
    outputDir,
    rValidationErrors,
    loopCount = 0,
    previousResult,
    previousAttemptContext,
  } = options || {};

  const genConfig = getGenerationConfig();
  const maxAttempts = 10;
  const startTime = Date.now();

  const scratchpad = createContextScratchpadTool('CrosstabAgentV2', group.groupName);

  const checkAbortError = (error: unknown): boolean => {
    return error instanceof DOMException && error.name === 'AbortError';
  };

  const retryResult = await retryWithPolicyHandling(
    async (ctx: RetryContext) => {
      const retryHint =
        ctx.attempt > 1 && ctx.lastClassification !== 'policy'
          ? ` Previous attempt failed validation: ${ctx.lastErrorSummary}. Do NOT invent variable names — use ONLY column names from <item col="..."> attributes.`
          : '';

      // R validation retry prompt
      let rValidationRetryPrompt = '';
      if (rValidationErrors && rValidationErrors.failedExpressions.length > 0) {
        const failedExprs = rValidationErrors.failedExpressions
          .map((f) => `  "${f.cutName}": ${f.rExpression} → ERROR: ${f.error}`)
          .join('\n');

        rValidationRetryPrompt = `

<r_validation_retry>
R VALIDATION FAILED (attempt ${rValidationErrors.failedAttempt}/${rValidationErrors.maxAttempts}):
The following R expressions were syntactically valid but failed at runtime against the actual .sav data:

${failedExprs}

<common_cut_fixes>
- Variable name case mismatch → Use EXACT case from <item col="..."> (R is case-sensitive)
- Value code wrong → Check <values> element for correct codes
- String vs numeric → Check if value is quoted string or bare number
- Result is all-FALSE (0 matches) → Value codes may be wrong. Check <values> element.
</common_cut_fixes>

Fix ONLY the failed expressions. Keep all other columns unchanged.
</r_validation_retry>`;
      }

      const priorAttemptPrompt = previousAttemptContext
        ? `\nYour previous output is included in <previous_attempt_output> above. The reviewer's guidance is in <reviewer-hint>.`
        : '';

      const defaultMaxTokens = Math.min(getCrosstabModelTokenLimit(), 100000);
      const maxOutputTokens = ctx.possibleTruncation ? getCrosstabModelTokenLimit() : defaultMaxTokens;
      if (ctx.possibleTruncation) {
        console.warn(`[CrosstabAgentV2] Possible truncation detected — increasing maxOutputTokens to ${maxOutputTokens}`);
      }

      const systemPrompt = buildSystemPromptV2(
        questions,
        group,
        loopCount,
        hint,
        previousAttemptContext,
        options?.reviewContext,
      );

      const { output, usage } = await generateText({
        model: getCrosstabModel(),
        system: systemPrompt,
        maxRetries: 0,
        prompt: `Validate banner group "${group.groupName}" with ${group.columns.length} columns against the survey questions.${retryHint}${rValidationRetryPrompt}${priorAttemptPrompt}`,
        tools: { scratchpad },
        stopWhen: stepCountIs(25),
        maxOutputTokens,
        ...getGenerationSamplingParams(getCrosstabModelName()),
        providerOptions: {
          openai: {
            reasoningEffort: getCrosstabReasoningEffort(),
            parallelToolCalls: genConfig.parallelToolCalls,
          },
        },
        output: Output.object({ schema: ValidatedGroupSchema }),
        abortSignal,
      });

      if (!output || !output.columns) {
        throw new Error(`Invalid agent response for group ${group.groupName}`);
      }

      recordAgentMetrics(
        'CrosstabAgentV2',
        getCrosstabModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        Date.now() - startTime,
      );

      // Deterministic validation: ensure adjusted expressions reference real variables
      const invalidVars: string[] = [];
      for (const col of output.columns) {
        const expr = col.adjusted || '';
        if (expr.trim().startsWith('#')) continue;
        for (const v of extractVariableNames(expr)) {
          if (!allColumns.has(v)) invalidVars.push(v);
        }
      }
      if (invalidVars.length > 0) {
        const unique = [...new Set(invalidVars)].slice(0, 25);
        const attemptedExprs = output.columns
          .map((c: { name: string; adjusted?: string }) => `  ${c.name}: ${c.adjusted || '(empty)'}`)
          .join('\n');
        console.warn(
          `[CrosstabAgentV2] Validation failed for group "${group.groupName}" — agent attempted:\n${attemptedExprs}`,
        );
        throw new Error(
          `INVALID VARIABLES: ${unique.join(', ')}. Use ONLY variables from the survey questions; do not synthesize names.`,
        );
      }

      return normalizeGroupOutput(group, output, allColumns, extractVariableNames);
    },
    {
      abortSignal,
      maxAttempts,
      policyRetryMode: 'ai',
      onRetry: (attempt, err) => {
        if (checkAbortError(err)) throw err;
        console.warn(`[CrosstabAgentV2] Retry ${attempt}/${maxAttempts} for group "${group.groupName}": ${err.message}`);
      },
    },
  );

  if (retryResult.success && retryResult.result) {
    console.log(
      `[CrosstabAgentV2] Group "${group.groupName}" processed — ${retryResult.result.columns.length} columns validated`,
    );
    return retryResult.result;
  }

  // Handle abort
  if (retryResult.error === 'Operation was cancelled') {
    throw new DOMException('CrosstabAgentV2 aborted', 'AbortError');
  }

  const errorMessage = retryResult.error || 'Unknown error';
  const retryContext = retryResult.wasPolicyError
    ? ` (failed after ${retryResult.attempts} retries due to content policy)`
    : '';
  console.error(`[CrosstabAgentV2] Error processing group ${group.groupName}:`, errorMessage + retryContext);

  // Reuse previous result on policy failure
  if (retryResult.finalClassification === 'policy' && previousResult) {
    console.warn(
      `[CrosstabAgentV2] Reusing previous validated output for group "${group.groupName}" after policy failure`,
    );
    return previousResult;
  }

  if (retryResult.finalClassification === 'policy') {
    console.warn(
      `[CrosstabAgentV2] Applying deterministic policy fallback for group "${group.groupName}" after policy retries were exhausted`,
    );
    return buildPolicyFallbackGroup(group, allColumns, extractVariableNames);
  }

  // Per-column salvage
  console.warn(`[CrosstabAgentV2] Falling back to per-column processing for group "${group.groupName}" (${group.columns.length} columns)`);

  if (outputDir) {
    try {
      await persistAgentErrorAuto({
        outputDir,
        agentName: 'CrosstabAgentV2',
        severity: 'error',
        actionTaken: 'fallback_used',
        itemId: group.groupName,
        error: new Error(`Group failed: ${errorMessage}${retryContext}`),
        meta: {
          groupName: group.groupName,
          columnCount: group.columns.length,
          attempts: retryResult.attempts,
          wasPolicyError: retryResult.wasPolicyError,
          hint: hint || '',
        },
      });
    } catch {
      /* ignore */
    }
  }

  const columns = [];
  for (const col of group.columns) {
    columns.push(await processSingleColumnV2(questions, allColumns, group, col, {
      abortSignal,
      outputDir,
      loopCount,
    }));
  }

  return { groupName: group.groupName, columns };
}

// ---------------------------------------------------------------------------
// Per-column salvage
// ---------------------------------------------------------------------------

async function processSingleColumnV2(
  questions: QuestionContext[],
  allColumns: Set<string>,
  group: BannerGroupType,
  col: BannerGroupType['columns'][number],
  options: { abortSignal?: AbortSignal; outputDir?: string; loopCount: number },
): Promise<ValidatedGroupType['columns'][number]> {
  const { abortSignal, outputDir, loopCount } = options;
  const genConfig = getGenerationConfig();
  const singleGroup: BannerGroupType = { groupName: group.groupName, columns: [col] };
  const colStart = Date.now();
  const colMaxAttempts = 10;

  const scratchpad = createContextScratchpadTool('CrosstabAgentV2', `${group.groupName}::${col.name}`);

  const columnRetryResult = await retryWithPolicyHandling(
    async (ctx: RetryContext) => {
      const retryHint = ctx.attempt > 1 && ctx.lastClassification !== 'policy'
        ? ` Previous attempt failed: ${ctx.lastErrorSummary}. Do NOT invent variable names.`
        : '';

      const systemPrompt = buildSystemPromptV2(questions, singleGroup, loopCount);

      const { output, usage } = await generateText({
        model: getCrosstabModel(),
        system: systemPrompt,
        maxRetries: 0,
        prompt: `Validate banner column "${col.name}" in group "${group.groupName}".${retryHint}`,
        tools: { scratchpad },
        stopWhen: stepCountIs(15),
        maxOutputTokens: Math.min(getCrosstabModelTokenLimit(), 100000),
        ...getGenerationSamplingParams(getCrosstabModelName()),
        providerOptions: {
          openai: {
            reasoningEffort: getCrosstabReasoningEffort(),
            parallelToolCalls: genConfig.parallelToolCalls,
          },
        },
        output: Output.object({ schema: ValidatedGroupSchema }),
        abortSignal,
      });

      if (!output || !output.columns || output.columns.length !== 1) {
        throw new Error(`Invalid agent response for column ${col.name} in group ${group.groupName}`);
      }

      recordAgentMetrics(
        'CrosstabAgentV2',
        getCrosstabModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        Date.now() - colStart,
      );

      const invalidVars: string[] = [];
      for (const v of extractVariableNames(output.columns[0].adjusted || '')) {
        if (!allColumns.has(v)) invalidVars.push(v);
      }
      if (invalidVars.length > 0) {
        const unique = [...new Set(invalidVars)].slice(0, 25);
        console.warn(`[CrosstabAgentV2] Validation failed for column "${col.name}" — agent attempted: ${output.columns[0].adjusted || '(empty)'}`);
        throw new Error(`INVALID VARIABLES: ${unique.join(', ')}. Use ONLY variables from the survey questions.`);
      }

      return output;
    },
    {
      abortSignal,
      maxAttempts: colMaxAttempts,
      policyRetryMode: 'ai',
      onRetry: (attempt, err) => {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        console.warn(`[CrosstabAgentV2] Retry ${attempt}/${colMaxAttempts} for column "${col.name}" (group "${group.groupName}"): ${err.message.substring(0, 160)}`);
      },
    },
  );

  if (columnRetryResult.success && columnRetryResult.result) {
    return normalizeGroupOutput(
      singleGroup,
      columnRetryResult.result,
      allColumns,
      extractVariableNames,
    ).columns[0];
  }

  const colErr = columnRetryResult.error || 'Unknown error';
  const colRetryContext = columnRetryResult.wasPolicyError
    ? ` (failed after ${columnRetryResult.attempts} retries due to content policy)`
    : '';

  if (columnRetryResult.finalClassification === 'policy') {
    console.warn(
      `[CrosstabAgentV2] Applying deterministic policy fallback for column "${col.name}" in group "${group.groupName}"`,
    );
    return buildPolicyFallbackColumn(col, allColumns, extractVariableNames);
  }

  if (outputDir) {
    try {
      await persistAgentErrorAuto({
        outputDir,
        agentName: 'CrosstabAgentV2',
        severity: 'error',
        actionTaken: 'fallback_used',
        itemId: `${group.groupName}::${col.name}`,
        error: new Error(`Column failed: ${colErr}${colRetryContext}`),
        meta: {
          groupName: group.groupName,
          columnName: col.name,
          original: col.original,
          attempts: columnRetryResult.attempts,
          wasPolicyError: columnRetryResult.wasPolicyError,
        },
      });
    } catch {
      /* ignore */
    }
  }

  return {
    name: col.name,
    adjusted: `# Error: Processing failed for "${col.original}"`,
    confidence: 0.0,
    reasoning: `Processing error: ${colErr}${colRetryContext}. Manual review required.`,
    userSummary: 'Processing failed for this column. Manual review required.',
    alternatives: [],
    uncertainties: [`Processing error: ${colErr}${colRetryContext}`],
    expressionType: 'direct_variable' as const,
  };
}

// ---------------------------------------------------------------------------
// processAllGroupsV2 — main entry point
// ---------------------------------------------------------------------------

export async function processAllGroupsV2(
  questions: QuestionContext[],
  bannerPlan: BannerPlanInputType,
  outputDir?: string,
  onProgress?: (completedGroups: number, totalGroups: number) => void,
  abortSignal?: AbortSignal,
  loopCount?: number,
): Promise<{
  result: ValidationResultType;
  processingLog: string[];
  scratchpadByGroup?: CrosstabScratchpadByGroup;
}> {
  const processingLog: string[] = [];
  const log = (message: string) => {
    console.log(message);
    processingLog.push(`${new Date().toISOString()}: ${message}`);
  };

  if (abortSignal?.aborted) {
    throw new DOMException('CrosstabAgentV2 aborted', 'AbortError');
  }

  clearContextScratchpadsForAgent('CrosstabAgentV2');

  const allColumns = extractAllColumns(questions);
  const totalVars = questions.reduce((sum, q) => sum + q.items.length, 0);

  log(`[CrosstabAgentV2] Starting group-by-group processing: ${bannerPlan.bannerCuts.length} groups`);
  log(`[CrosstabAgentV2] Question context: ${questions.length} questions, ${totalVars} variables`);
  log(`[CrosstabAgentV2] Model: ${getCrosstabModelName()}, reasoning: ${getCrosstabReasoningEffort()}`);
  log(`[CrosstabAgentV2] Loop iterations: ${loopCount ?? 0} ${loopCount && loopCount > 0 ? '(loop-aware mode)' : '(no loops)'}`);

  const results: ValidatedGroupType[] = [];
  const scratchpadByGroup: CrosstabScratchpadByGroup = {};

  for (let i = 0; i < bannerPlan.bannerCuts.length; i++) {
    if (abortSignal?.aborted) {
      throw new DOMException('CrosstabAgentV2 aborted', 'AbortError');
    }

    const group = bannerPlan.bannerCuts[i];
    const groupStartTime = Date.now();

    log(`[CrosstabAgentV2] Processing group ${i + 1}/${bannerPlan.bannerCuts.length}: "${group.groupName}" (${group.columns.length} columns)`);

    const groupResult = await processGroupV2(questions, allColumns, group, {
      abortSignal,
      outputDir,
      loopCount: loopCount ?? 0,
    });
    results.push(groupResult);

    // Collect scratchpad entries for this group
    const allEntries = getAllContextScratchpadEntries('CrosstabAgentV2');
    const groupEntries = allEntries.find((e) => e.contextId === group.groupName);
    if (groupEntries && groupEntries.entries.length > 0) {
      scratchpadByGroup[group.groupName] = groupEntries.entries
        .slice(0, 25)
        .map((e) => ({ timestamp: e.timestamp, action: e.action, content: e.content }));
    }

    const groupDuration = Date.now() - groupStartTime;
    const avgConfidence =
      groupResult.columns.length > 0
        ? groupResult.columns.reduce((sum, col) => sum + col.confidence, 0) / groupResult.columns.length
        : 0;

    log(`[CrosstabAgentV2] Group "${group.groupName}" completed in ${groupDuration}ms — avg confidence: ${avgConfidence.toFixed(2)}`);

    try {
      onProgress?.(i + 1, bannerPlan.bannerCuts.length);
    } catch {
      /* ignore */
    }
  }

  const combinedResult = combineValidationResults(results);

  if (outputDir) {
    await saveDevelopmentOutputsV2(combinedResult, outputDir, processingLog);
  }

  log(
    `[CrosstabAgentV2] All ${results.length} groups processed — total columns: ${combinedResult.bannerCuts.reduce((t, g) => t + g.columns.length, 0)}`,
  );

  return { result: combinedResult, processingLog, scratchpadByGroup };
}

// ---------------------------------------------------------------------------
// Output persistence
// ---------------------------------------------------------------------------

async function saveDevelopmentOutputsV2(
  result: ValidationResultType,
  outputDir: string,
  processingLog: string[],
): Promise<void> {
  try {
    const crosstabDir = path.join(outputDir, 'agents', 'crosstab');
    await fs.mkdir(crosstabDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    await fs.writeFile(
      path.join(crosstabDir, 'crosstab-output-raw.json'),
      JSON.stringify(result, null, 2),
    );

    await fs.writeFile(
      path.join(crosstabDir, `crosstab-output-${timestamp}.json`),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          agent: 'CrosstabAgentV2',
          model: getCrosstabModelName(),
          reasoningEffort: getCrosstabReasoningEffort(),
          promptVersion: getPromptVersions().crosstabPromptVersion,
          inputFormat: 'question-centric',
          result,
          processingLog,
        },
        null,
        2,
      ),
    );

    const allEntries = getAllContextScratchpadEntries('CrosstabAgentV2');
    if (allEntries.length > 0) {
      const scratchpadLines: string[] = [];
      for (const ctx of allEntries) {
        scratchpadLines.push(`\n## Group: ${ctx.contextId}\n`);
        scratchpadLines.push(formatScratchpadAsMarkdown('CrosstabAgentV2', ctx.entries));
      }
      await fs.writeFile(
        path.join(crosstabDir, `scratchpad-crosstab-v2-${timestamp}.md`),
        scratchpadLines.join('\n'),
      );
    }

    console.log(`[CrosstabAgentV2] Development output saved to agents/crosstab/`);
  } catch (error) {
    console.error('[CrosstabAgentV2] Failed to save development outputs:', error);
  }
}
