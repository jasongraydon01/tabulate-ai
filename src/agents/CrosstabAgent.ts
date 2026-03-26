/**
 * CrosstabAgent (v1)
 *
 * @deprecated Replaced by CrosstabAgentV2 (src/agents/CrosstabAgentV2.ts) which uses
 * question-centric planning with QuestionContext input (V3 stage 21).
 *
 * Previously used as a fallback in reviewCompletion.ts when isQuestionCentricEnabled()
 * returned false. CrosstabAgentV2 is now the sole active path.
 *
 * This file is retained for reference only. Do not invoke from active pipeline code.
 *
 * Original purpose: Validate banner groups against data map; emit adjusted R expressions + confidence.
 * Reads: agent banner groups + processed data map
 * Writes (dev): temp-outputs/output-<ts>/crosstab-output-<ts>.json (with processing info)
 * Invariants: group-by-group validation; uses scratchpad
 */

import { generateText, Output, stepCountIs } from 'ai';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter, sanitizeHintForPrompt } from '../lib/promptSanitization';
import { ValidationResultSchema, ValidatedGroupSchema, combineValidationResults, type ValidationResultType, type ValidatedGroupType } from '../schemas/agentOutputSchema';
import { DataMapType } from '../schemas/dataMapSchema';
import { BannerGroupType, BannerPlanInputType } from '../schemas/bannerPlanSchema';
import {
  getCrosstabModel,
  getCrosstabModelName,
  getCrosstabModelTokenLimit,
  getCrosstabReasoningEffort,
  getPromptVersions,
  getGenerationConfig,
  getGenerationSamplingParams,
} from '../lib/env';
import {
  crosstabScratchpadTool,
  clearScratchpadEntries,
  getAndClearScratchpadEntries,
  getScratchpadEntries,
  formatScratchpadAsMarkdown,
} from './tools/scratchpad';
import { getCrosstabPrompt } from '../prompts';
import { buildLoopAwarePrompt } from '../prompts/crosstab/production';
import { retryWithPolicyHandling, type RetryContext } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import fs from 'fs/promises';
import path from 'path';

// Get modular validation instructions based on environment variable
const getCrosstabValidationInstructions = (): string => {
  const promptVersions = getPromptVersions();
  return getCrosstabPrompt(promptVersions.crosstabPromptVersion);
};

// R validation errors passed in for retry context
export interface CutValidationErrorContext {
  failedAttempt: number;
  maxAttempts: number;
  failedExpressions: Array<{
    cutName: string;
    rExpression: string;
    error: string;
    variableType?: string;  // normalizedType from verbose datamap
  }>;
}

// Options for processGroup
export interface ReviewContextEntry {
  columnName: string;
  action: 'approved' | 'alternative_selected' | 'user_edited';
  finalExpression: string;
}

export interface ProcessGroupOptions {
  abortSignal?: AbortSignal;
  hint?: string;  // User-provided hint for re-run (e.g., "use variable Q5")
  outputDir?: string;  // For saving scratchpad
  rValidationErrors?: CutValidationErrorContext;  // Failed R expressions for retry
  loopCount?: number;  // Number of loop iterations (for loop-aware prompt)
  previousResult?: ValidatedGroupType; // Prior validated output to reuse on policy failures
  reviewContext?: ReviewContextEntry[];  // Already-resolved cuts from the same group in this review session
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

export interface CrosstabScratchpadEntry {
  timestamp: string;
  action: string;
  content: string;
}

export type CrosstabScratchpadByGroup = Record<string, CrosstabScratchpadEntry[]>;
type PriorAttemptContext = NonNullable<ProcessGroupOptions['previousAttemptContext']>;

const MAX_SCRATCHPAD_ENTRIES_PER_GROUP = 50;
const MAX_SCRATCHPAD_CONTENT_LENGTH = 500;

function normalizeScratchpadEntry(entry: { timestamp: string; action: string; content: string }): CrosstabScratchpadEntry {
  return {
    timestamp: entry.timestamp,
    action: entry.action,
    content: (entry.content || '').slice(0, MAX_SCRATCHPAD_CONTENT_LENGTH),
  };
}

function sanitizePriorColumnsForPrompt(
  priorColumns: PriorAttemptContext['priorColumns'],
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

function sanitizePriorScratchpadForPrompt(entries: Array<{ timestamp: string; action: string; content: string }>): string {
  if (!entries || entries.length === 0) return 'None';
  const trimmed = entries
    .slice(-15)
    .map((e) => ({
      timestamp: e.timestamp,
      action: e.action,
      content: (e.content || '').slice(0, 300),
    }));
  return sanitizeForAzureContentFilter(JSON.stringify(trimmed, null, 2));
}

function formatPriorAttemptAsNarrative(
  priorColumns: PriorAttemptContext['priorColumns'],
  hint: string,
): string {
  if (!priorColumns || priorColumns.length === 0) return 'No prior output available.';
  // For 4+ columns, fall back to JSON (too verbose as narrative)
  if (priorColumns.length > 3) {
    return `Prior output from the last attempt:\n${sanitizePriorColumnsForPrompt(priorColumns)}\n\nThe reviewer's guidance: "${hint}"`;
  }
  // Readable narrative for 1-3 columns
  const parts = priorColumns.map((col) => {
    const lines: string[] = [];
    lines.push(`Your prior expression for "${col.name}" was: ${col.adjusted || '(none)'}`);
    if (col.reasoning) {
      lines.push(`Your prior reasoning: "${col.reasoning}"`);
    }
    return lines.join('\n');
  });
  parts.push(`\nThe reviewer's guidance: "${hint}"`);
  parts.push('\nRevise the expression(s) to incorporate this guidance.');
  return parts.join('\n\n');
}

/** @internal Exported for CrosstabAgentV2 */
export function expressionKey(expression: string): string {
  return expression.replace(/\s+/g, '').toLowerCase();
}

/** @internal Exported for CrosstabAgentV2 */
export function normalizeOriginalExpression(original: string): string {
  let expression = original.trim();
  if (!expression) return '';

  // Normalize common banner syntax to executable R for simple list equality cases.
  expression = expression.replace(
    /\b([A-Za-z][A-Za-z0-9_.]*)\s*=\s*([-+]?\d+(?:\s*,\s*[-+]?\d+)+)\b/g,
    (_match, variable: string, values: string) => {
      const normalizedValues = values
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .join(',');
      return `${variable} %in% c(${normalizedValues})`;
    },
  );

  expression = expression.replace(/\bAND\b/gi, '&').replace(/\bOR\b/gi, '|');
  expression = expression.replace(/(^|[^<>=!])=([^=])/g, '$1==$2');
  expression = expression.replace(/\s+/g, ' ').trim();
  return expression;
}

/** @internal Exported for CrosstabAgentV2 */
export function hasKnownVariables(
  expression: string,
  datamapColumns: Set<string>,
  extractVariableNames: (rExpression: string) => string[],
): boolean {
  const variables = extractVariableNames(expression);
  if (variables.length === 0) return false;
  return variables.every((variable) => datamapColumns.has(variable));
}

/** @internal Exported for CrosstabAgentV2 */
export function nextAlternativeRank(alternatives: Array<{ rank: number }>): number {
  const maxExisting = alternatives.reduce((max, alternative) => Math.max(max, alternative.rank), 1);
  return Math.max(2, maxExisting + 1);
}

/** @internal Exported for CrosstabAgentV2 */
export function attachOriginalExpressionAlternative(
  sourceColumn: BannerGroupType['columns'][number],
  validatedColumn: ValidatedGroupType['columns'][number],
  datamapColumns: Set<string>,
  extractVariableNames: (rExpression: string) => string[],
): ValidatedGroupType['columns'][number] {
  const normalizedOriginal = normalizeOriginalExpression(sourceColumn.original);
  if (!normalizedOriginal) return validatedColumn;

  if (!hasKnownVariables(normalizedOriginal, datamapColumns, extractVariableNames)) {
    return validatedColumn;
  }

  if (expressionKey(normalizedOriginal) === expressionKey(validatedColumn.adjusted || '')) {
    return validatedColumn;
  }

  const alreadyPresent = (validatedColumn.alternatives || []).some(
    (alternative) => expressionKey(alternative.expression) === expressionKey(normalizedOriginal),
  );
  if (alreadyPresent) return validatedColumn;

  return {
    ...validatedColumn,
    alternatives: [
      ...(validatedColumn.alternatives || []),
      {
        expression: normalizedOriginal,
        rank: nextAlternativeRank(validatedColumn.alternatives || []),
        userSummary: 'Original banner expression retained as a low-priority fallback.',
      },
    ],
  };
}

/** @internal Exported for CrosstabAgentV2 */
export function buildMissingColumnFallback(
  sourceColumn: BannerGroupType['columns'][number],
  datamapColumns: Set<string>,
  extractVariableNames: (rExpression: string) => string[],
): ValidatedGroupType['columns'][number] {
  const normalizedOriginal = normalizeOriginalExpression(sourceColumn.original);
  const originalIsPlausible =
    normalizedOriginal.length > 0 &&
    hasKnownVariables(normalizedOriginal, datamapColumns, extractVariableNames);

  return {
    name: sourceColumn.name,
    adjusted: originalIsPlausible ? normalizedOriginal : 'NA',
    confidence: originalIsPlausible ? 0.35 : 0.1,
    reasoning: originalIsPlausible
      ? 'Agent omitted this column in grouped output. Restored from original banner expression because it maps to known data-map variables.'
      : 'Agent omitted this column and original banner expression could not be mapped confidently to known data-map variables.',
    userSummary: originalIsPlausible
      ? 'Recovered this cut from the original banner expression for reviewer confirmation.'
      : 'This cut could not be recovered from valid mapped variables and needs manual review.',
    alternatives: [],
    uncertainties: [
      originalIsPlausible
        ? 'Recovered automatically because grouped output omitted this column.'
        : 'Grouped output omitted this column and original expression did not map cleanly to known variables.',
    ],
    expressionType: originalIsPlausible ? 'direct_variable' : 'placeholder',
  };
}

/** @internal Exported for CrosstabAgentV2 */
export function buildPolicyFallbackColumn(
  sourceColumn: BannerGroupType['columns'][number],
  datamapColumns: Set<string>,
  extractVariableNames: (rExpression: string) => string[],
): ValidatedGroupType['columns'][number] {
  const normalizedOriginal = normalizeOriginalExpression(sourceColumn.original);
  const originalIsPlausible =
    normalizedOriginal.length > 0 &&
    hasKnownVariables(normalizedOriginal, datamapColumns, extractVariableNames);

  return {
    name: sourceColumn.name,
    adjusted: originalIsPlausible ? normalizedOriginal : 'NA',
    confidence: originalIsPlausible ? 0.3 : 0.05,
    reasoning: originalIsPlausible
      ? 'Azure content policy blocked generation. Used normalized original banner expression as deterministic fallback.'
      : 'Azure content policy blocked generation and original expression did not map to known variables. Marked as NA for manual review.',
    userSummary: originalIsPlausible
      ? 'Temporarily used the original banner expression because the model response was policy-blocked.'
      : 'This cut needs manual review because the model response was policy-blocked and the original expression could not be validated.',
    alternatives: [],
    uncertainties: [
      'Policy block prevented model output; deterministic fallback was applied.',
    ],
    expressionType: originalIsPlausible ? 'direct_variable' : 'placeholder',
  };
}

/** @internal Exported for CrosstabAgentV2 */
export function buildPolicyFallbackGroup(
  sourceGroup: BannerGroupType,
  datamapColumns: Set<string>,
  extractVariableNames: (rExpression: string) => string[],
): ValidatedGroupType {
  return {
    groupName: sourceGroup.groupName,
    columns: sourceGroup.columns.map((column) =>
      buildPolicyFallbackColumn(column, datamapColumns, extractVariableNames),
    ),
  };
}

/**
 * Normalize Unicode quotes/apostrophes to ASCII equivalents for name matching.
 * Models often return straight quotes even when the source uses curly/smart quotes.
 */
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes → straight
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');   // curly double quotes → straight
}

/** @internal Exported for CrosstabAgentV2 */
export function normalizeGroupOutput(
  sourceGroup: BannerGroupType,
  outputGroup: ValidatedGroupType,
  datamapColumns: Set<string>,
  extractVariableNames: (rExpression: string) => string[],
): ValidatedGroupType {
  // Build lookup from normalized source name → original source name
  const sourceNameMap = new Map<string, string>();
  for (const column of sourceGroup.columns) {
    sourceNameMap.set(normalizeQuotes(column.name), column.name);
  }

  const outputBySourceName = new Map<string, ValidatedGroupType['columns'][number]>();
  let droppedUnexpectedColumns = 0;

  for (const column of outputGroup.columns) {
    const normalizedOutputName = normalizeQuotes(column.name);
    const matchedSourceName = sourceNameMap.get(normalizedOutputName);
    if (!matchedSourceName) {
      droppedUnexpectedColumns += 1;
      continue;
    }
    if (!outputBySourceName.has(matchedSourceName)) {
      // Store under the source name, and patch the column name to match source
      outputBySourceName.set(matchedSourceName, { ...column, name: matchedSourceName });
    }
  }

  const normalizedColumns = sourceGroup.columns.map((sourceColumn) => {
    const validatedColumn = outputBySourceName.get(sourceColumn.name);
    if (!validatedColumn) {
      return buildMissingColumnFallback(sourceColumn, datamapColumns, extractVariableNames);
    }
    return attachOriginalExpressionAlternative(
      sourceColumn,
      validatedColumn,
      datamapColumns,
      extractVariableNames,
    );
  });

  if (droppedUnexpectedColumns > 0) {
    console.warn(
      `[CrosstabAgent] Dropped ${droppedUnexpectedColumns} unexpected column(s) returned by model for group "${sourceGroup.groupName}"`,
    );
  }

  return {
    groupName: sourceGroup.groupName,
    columns: normalizedColumns,
  };
}

// Process single banner group using Vercel AI SDK
export async function processGroup(
  dataMap: DataMapType,
  group: BannerGroupType,
  optionsOrAbortSignal?: ProcessGroupOptions | AbortSignal,
  legacyHint?: string  // Legacy support for direct hint parameter
): Promise<ValidatedGroupType> {
  // Handle both old and new calling conventions
  let options: ProcessGroupOptions;
  if (optionsOrAbortSignal instanceof AbortSignal || optionsOrAbortSignal === undefined) {
    options = { abortSignal: optionsOrAbortSignal, hint: legacyHint };
  } else {
    options = optionsOrAbortSignal;
  }

  const { abortSignal, hint, outputDir, rValidationErrors, loopCount = 0 } = options;
  const genConfig = getGenerationConfig();
  const startTime = Date.now();

  console.log(`[CrosstabAgent] Processing group: ${group.groupName} (${group.columns.length} columns)${hint ? ` [with hint: ${hint}]` : ''}${rValidationErrors ? ` [R validation retry ${rValidationErrors.failedAttempt}/${rValidationErrors.maxAttempts}]` : ''}${loopCount > 0 ? ` [loop-aware mode: ${loopCount} iterations]` : ''}`);

  // Check for cancellation before AI call
  if (abortSignal?.aborted) {
    console.log(`[CrosstabAgent] Aborted before processing group ${group.groupName}`);
    throw new DOMException('CrosstabAgent aborted', 'AbortError');
  }

  // Build system prompt with context injection.
  // Hints are untrusted input; sanitize aggressively and keep short.
  const sanitizedHint = hint
    ? sanitizeHintForPrompt(hint, 500)
    : '';
  const hintSection = sanitizedHint ? `
<reviewer-hint>
"${sanitizedHint}"
</reviewer-hint>

` : '';

  const previousAttemptSection = options.previousAttemptContext
    ? `
<previous_attempt_context mode="${options.previousAttemptContext.mode}">
${options.previousAttemptContext.mode === 'hint_retry' && sanitizedHint
  ? formatPriorAttemptAsNarrative(options.previousAttemptContext.priorColumns, sanitizedHint)
  : `Prior output from the last attempt:\n${sanitizePriorColumnsForPrompt(options.previousAttemptContext.priorColumns)}`}

${options.previousAttemptContext.mode === 'hint_retry'
  ? `Your prior output is shown above for reference. The reviewer has provided guidance to correct or improve your expression. Revise the adjusted expression to incorporate their guidance. Do not default to your prior expression — the reviewer provided a hint because they want something to change. If the hint is clear, follow it. If it's ambiguous, make your best interpretation and explain your reasoning.`
  : `Instruction: Start from the prior adjusted expression(s). Make minimal revisions only when the validation context requires it.`}
</previous_attempt_context>
`
    : '';

  const previousScratchpadSection = options.previousAttemptContext && options.previousAttemptContext.priorScratchpadEntries.length > 0
    ? `
<previous_scratchpad_context>
Prior scratchpad entries:
${sanitizePriorScratchpadForPrompt(options.previousAttemptContext.priorScratchpadEntries)}

Use these notes for continuity; do not restart reasoning from scratch unless evidence is incorrect.
</previous_scratchpad_context>
`
    : '';

  const toPolicySafeAnswerOptions = (answerOptions?: string): string | undefined => {
    if (!answerOptions) return answerOptions;
    // Keep codes but redact labels: "1=Label,2=Label" → "1=?,2=?"
    const parts = answerOptions.split(',').slice(0, 80);
    const redacted = parts
      .map(p => p.split('=')[0]?.trim())
      .filter(Boolean)
      .map(code => `${code}=?`)
      .join(',');
    return redacted;
  };

  const policySafeDataMap: DataMapType = dataMap.map((item) => ({
    ...item,
    // Remove most free-text fields that commonly trip Azure content filters.
    Description: '',
    Answer_Options: toPolicySafeAnswerOptions(item.Answer_Options) || '',
    Context: '',
  }));

  const buildSystemPromptForGroup = (targetGroup: BannerGroupType, policySafe: boolean): string => {
    const dm = policySafe ? policySafeDataMap : dataMap;
    const policyNote = policySafe
      ? `\nNOTE: Policy-safe mode is enabled due to repeated Azure content filtering. Free-text descriptions/labels may be redacted. Rely primarily on variable names, types, and value structures.\n`
      : '';

    const hintDefense = sanitizedHint
      ? `
A human reviewer has examined your prior output and provided corrective guidance in <reviewer-hint> below. This person is a domain expert who understands the survey data and the intended analysis. Take their guidance seriously — they are pointing you in a direction, providing clarity on something you may have gotten wrong or been uncertain about.

Rules for applying reviewer guidance:
- If the hint names specific variables (e.g., "use hCLASS1 | hCLASS2"), use exactly those variables in your revised expression — but verify they exist in the data map first.
- If the hint describes a pattern (e.g., "capture both loops"), apply that pattern consistently across all columns in this group.
- If the hint contradicts your prior reasoning, lean toward the hint — the reviewer likely has context you do not. But if the hint asks for something logically impossible (e.g., a variable that doesn't exist, a value outside the variable's range), explain what you found and propose the closest valid alternative.
- Your revised expression must clearly reflect the hint's intent. Do not make minimal changes and leave the expression essentially unchanged — that defeats the purpose of the reviewer providing guidance.
- In your reasoning field, begin with a brief summary of what you changed and why, so the change is traceable.
`
      : '';

    // Build base instructions, then conditionally append loop guidance
    const baseInstructions = getCrosstabValidationInstructions();
    const loopAwareInstructions = buildLoopAwarePrompt(baseInstructions, loopCount);

    if (loopCount > 0) {
      console.log(`[CrosstabAgent] Loop guidance appended (${loopCount} iterations)`);
    }

    // Review context: show already-resolved cuts from the same group
    const reviewContextSection = options.reviewContext && options.reviewContext.length > 0
      ? `\n<review_context>
The human reviewer has already resolved other cuts in this same group during the current review session.
These decisions establish a pattern you should follow for consistency:

${options.reviewContext.map(entry => `- "${entry.columnName}" (${entry.action}): ${entry.finalExpression}`).join('\n')}

Use this context to ensure your output is consistent with the reviewer's established pattern.
If the reviewer consistently chose a specific variable mapping pattern (e.g., OR-joined iteration
variables), apply that same pattern to the cuts you are processing now.
</review_context>\n`
      : '';

    return `
${RESEARCH_DATA_PREAMBLE}${loopAwareInstructions}${hintDefense}
${hintSection}${reviewContextSection}${policyNote}
CURRENT CONTEXT DATA:

DATA MAP (${dm.length} variables):
${sanitizeForAzureContentFilter(JSON.stringify(dm, null, 2))}

BANNER GROUP TO VALIDATE:
Group: "${targetGroup.groupName}"
${sanitizeForAzureContentFilter(JSON.stringify(targetGroup, null, 2))}

PROCESSING REQUIREMENTS:
- Validate all ${targetGroup.columns.length} columns in this group
- Generate R syntax for each column's "original" expression
- Provide confidence scores and detailed reasoning
- Use scratchpad to show your validation process

Begin validation now.
`;
  };

  // Check if this is an abort error before the AI call
  const checkAbortError = (error: unknown): boolean => {
    return error instanceof DOMException && error.name === 'AbortError';
  };

  const datamapColumns = new Set<string>(dataMap.map(d => d.Column));
  const extractVariableNames = (rExpression: string): string[] => {
    const rKeywords = new Set([
      'TRUE', 'FALSE', 'NA', 'NULL', 'Inf', 'NaN',
      'if', 'else', 'for', 'in', 'while', 'repeat', 'next', 'break',
      'function', 'return', 'c', 'rep', 'nrow', 'ncol',
      'with', 'data', 'eval', 'parse', 'text',
      'is', 'na', 'as', 'numeric', 'character', 'logical',
      'sum', 'mean', 'max', 'min', 'length',
      'median', 'quantile', 'probs',        // statistical functions for splits
      'na.rm',                                // common R argument
      'grepl', 'nchar', 'paste', 'paste0',
    ]);

    const matches = rExpression.match(/\b([A-Za-z][A-Za-z0-9_.]*)\b/g) || [];
    const vars = new Set<string>();
    for (const m of matches) {
      if (rKeywords.has(m)) continue;
      if (/^\d+$/.test(m)) continue;
      // Skip R dot-notation functions: is.na, is.null, as.numeric, as.factor, etc.
      if (/^(is|as|na)\.[a-z]+$/i.test(m)) continue;
      vars.add(m);
    }
    return [...vars];
  };

  const maxAttempts = 10;

  // Wrap the AI call with retry logic for policy errors
  const retryResult = await retryWithPolicyHandling(
    async (ctx: RetryContext) => {
      // On policy errors, resubmit the identical prompt — the filter is stochastic,
      // and telling the model about a content filter failure would cause needless second-guessing.
      const retryHint = ctx.attempt > 1 && ctx.lastClassification !== 'policy'
        ? ` Previous attempt failed validation: ${ctx.lastErrorSummary}. Do NOT invent variable names.`
        : '';

      // Build R validation retry context (injected when re-running after cut validation failures)
      let rValidationRetryPrompt = '';
      if (rValidationErrors) {
        const failedList = rValidationErrors.failedExpressions
          .map(f => `  - "${f.cutName}": ${f.rExpression}\n    R error: ${f.error}${f.variableType ? `\n    Variable type: ${f.variableType}` : ''}`)
          .join('\n');
        rValidationRetryPrompt = `

<r_validation_retry>
RETRY ATTEMPT ${rValidationErrors.failedAttempt}/${rValidationErrors.maxAttempts}

Your previous R expressions for this group failed when tested against the actual .sav data:

FAILED EXPRESSIONS:
${failedList}

<common_cut_fixes>
- "object 'X' not found" → Variable name doesn't exist in the data. Check exact spelling/case.
- "non-numeric argument to binary operator" → Variable is character/factor. Use string comparison.
- "comparison of these types is not implemented" → Type mismatch. Check if variable is numeric or labelled.
- haven_labelled error → Use as.numeric() wrapper or safe_quantile() instead of quantile().
- Result is all-FALSE (0 matches) → Value codes may be wrong. Check Answer_Options.
</common_cut_fixes>

Fix ONLY the failed expressions. Keep all other columns unchanged.
</r_validation_retry>`;
      }

      const priorAttemptPrompt = options.previousAttemptContext
        ? `
${previousAttemptSection}
${previousScratchpadSection}
`
        : '';

      // Escalate maxOutputTokens if consecutive output_validation errors suggest truncation
      const defaultMaxTokens = Math.min(getCrosstabModelTokenLimit(), 100000);
      const maxOutputTokens = ctx.possibleTruncation ? getCrosstabModelTokenLimit() : defaultMaxTokens;
      if (ctx.possibleTruncation) {
        console.warn(`[CrosstabAgent] Possible truncation detected — increasing maxOutputTokens to ${maxOutputTokens}`);
      }

      const { output, usage } = await generateText({
        model: getCrosstabModel(),  // Task-based: crosstab model for complex validation
        system: buildSystemPromptForGroup(group, ctx.shouldUsePolicySafeVariant),
        maxRetries: 0,  // Centralized outer retries via retryWithPolicyHandling
        prompt: `Validate banner group "${group.groupName}" with ${group.columns.length} columns against the data map.${retryHint}${rValidationRetryPrompt}${priorAttemptPrompt}`,
        tools: {
          scratchpad: crosstabScratchpadTool,
        },
        stopWhen: stepCountIs(25),  // AI SDK 5+: replaces maxTurns/maxSteps
        maxOutputTokens,
        ...getGenerationSamplingParams(getCrosstabModelName()),
        // Configure reasoning effort and tool call ordering for Azure OpenAI GPT-5/o-series models
        providerOptions: {
          openai: {
            reasoningEffort: getCrosstabReasoningEffort(),
            parallelToolCalls: genConfig.parallelToolCalls,
          },
        },
        output: Output.object({
          schema: ValidatedGroupSchema,
        }),
        abortSignal,  // Pass abort signal to AI SDK
      });

      if (!output || !output.columns) {
        throw new Error(`Invalid agent response for group ${group.groupName}`);
      }

      // Record metrics
      const durationMs = Date.now() - startTime;
      recordAgentMetrics(
        'CrosstabAgent',
        getCrosstabModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        durationMs
      );

      // Deterministic validation: ensure adjusted expressions reference real variables.
      const invalidVars: string[] = [];
      for (const col of output.columns) {
        const expr = col.adjusted || '';
        if (expr.trim().startsWith('#')) continue; // error/comment fallback
        for (const v of extractVariableNames(expr)) {
          if (!datamapColumns.has(v)) invalidVars.push(v);
        }
      }
      if (invalidVars.length > 0) {
        const unique = [...new Set(invalidVars)].slice(0, 25);
        // Log what the agent actually produced so we can debug validation failures
        const attemptedExprs = output.columns.map((c: { name: string; adjusted?: string }) => `  ${c.name}: ${c.adjusted || '(empty)'}`).join('\n');
        console.warn(`[CrosstabAgent] Validation failed for group "${group.groupName}" — agent attempted:\n${attemptedExprs}`);
        throw new Error(
          `INVALID VARIABLES: ${unique.join(', ')}. Use ONLY variables from the data map; do not synthesize names.`
        );
      }

      return normalizeGroupOutput(group, output, datamapColumns, extractVariableNames);
    },
    {
      abortSignal,
      maxAttempts,
      policyRetryMode: 'ai',
      onRetry: (attempt, err) => {
        // Check for abort errors and propagate them
        if (checkAbortError(err)) {
          throw err;
        }
        console.warn(`[CrosstabAgent] Retry ${attempt}/${maxAttempts} for group "${group.groupName}": ${err.message}`);
      },
    }
  );

  if (retryResult.success && retryResult.result) {
    console.log(`[CrosstabAgent] Group ${group.groupName} processed successfully - ${retryResult.result.columns.length} columns validated`);
    return retryResult.result;
  }

  // Handle abort errors
  if (retryResult.error === 'Operation was cancelled') {
    console.log(`[CrosstabAgent] Aborted by signal during group ${group.groupName}`);
    throw new DOMException('CrosstabAgent aborted', 'AbortError');
  }

  // All retries failed - return fallback result with zero confidence
  const errorMessage = retryResult.error || 'Unknown error';
  const retryContext = retryResult.wasPolicyError
    ? ` (failed after ${retryResult.attempts} retries due to content policy)`
    : '';
  console.error(`[CrosstabAgent] Error processing group ${group.groupName}:`, errorMessage + retryContext);

  if (retryResult.finalClassification === 'policy' && options.previousResult) {
    console.warn(
      `[CrosstabAgent] Reusing previous validated output for group "${group.groupName}" after policy failure`,
    );
    return options.previousResult;
  }

  if (retryResult.finalClassification === 'policy') {
    console.warn(
      `[CrosstabAgent] Applying deterministic policy fallback for group "${group.groupName}" after policy retries were exhausted`,
    );
    return buildPolicyFallbackGroup(group, datamapColumns, extractVariableNames);
  }

  // Per-column salvage: if a single column blocks (policy/transient), we still want to process the rest.
  console.warn(`[CrosstabAgent] Falling back to per-column processing for group "${group.groupName}" (${group.columns.length} columns)`);

  if (outputDir) {
    try {
      await persistAgentErrorAuto({
        outputDir,
        agentName: 'CrosstabAgent',
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
      // ignore
    }
  }

  const processSingleColumn = async (col: BannerGroupType['columns'][number]) => {
    const singleGroup: BannerGroupType = {
      groupName: group.groupName,
      columns: [col],
    };
    const colStart = Date.now();
    const colMaxAttempts = 10;

    const columnRetryResult = await retryWithPolicyHandling(
      async (ctx: RetryContext) => {
        const retryHint = ctx.attempt > 1 && ctx.lastClassification !== 'policy'
          ? ` Previous attempt failed: ${ctx.lastErrorSummary}. Do NOT invent variable names.`
          : '';

        const { output, usage } = await generateText({
          model: getCrosstabModel(),
          system: buildSystemPromptForGroup(singleGroup, ctx.shouldUsePolicySafeVariant),
          maxRetries: 0,
          prompt: `Validate banner column "${col.name}" in group "${group.groupName}".${retryHint}`,
          tools: { scratchpad: crosstabScratchpadTool },
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getCrosstabModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getCrosstabModelName()),
          providerOptions: { openai: { reasoningEffort: getCrosstabReasoningEffort(), parallelToolCalls: genConfig.parallelToolCalls } },
          output: Output.object({ schema: ValidatedGroupSchema }),
          abortSignal,
        });

        if (!output || !output.columns || output.columns.length !== 1) {
          throw new Error(`Invalid agent response for column ${col.name} in group ${group.groupName}`);
        }

        recordAgentMetrics(
          'CrosstabAgent',
          getCrosstabModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          Date.now() - colStart
        );

        const invalidVars: string[] = [];
        for (const v of extractVariableNames(output.columns[0].adjusted || '')) {
          if (!datamapColumns.has(v)) invalidVars.push(v);
        }
        if (invalidVars.length > 0) {
          const unique = [...new Set(invalidVars)].slice(0, 25);
          const attemptedExpr = output.columns[0].adjusted || '(empty)';
          console.warn(`[CrosstabAgent] Validation failed for column "${col.name}" (group "${group.groupName}") — agent attempted: ${attemptedExpr}`);
          throw new Error(`INVALID VARIABLES: ${unique.join(', ')}. Use ONLY variables from the data map; do not synthesize names.`);
        }

        return output;
      },
      {
        abortSignal,
        maxAttempts: colMaxAttempts,
        policyRetryMode: 'ai',
        onRetry: (attempt, err) => {
          if (checkAbortError(err)) throw err;
          console.warn(`[CrosstabAgent] Retry ${attempt}/${colMaxAttempts} for column "${col.name}" (group "${group.groupName}"): ${err.message.substring(0, 160)}`);
        },
      }
    );

    if (columnRetryResult.success && columnRetryResult.result) {
      return columnRetryResult.result.columns[0];
    }

    const colErr = columnRetryResult.error || 'Unknown error';
    const colRetryContext = columnRetryResult.wasPolicyError
      ? ` (failed after ${columnRetryResult.attempts} retries due to content policy)`
      : '';

    if (columnRetryResult.finalClassification === 'policy') {
      console.warn(
        `[CrosstabAgent] Applying deterministic policy fallback for column "${col.name}" in group "${group.groupName}"`,
      );
      return buildPolicyFallbackColumn(col, datamapColumns, extractVariableNames);
    }

    if (outputDir) {
      try {
        await persistAgentErrorAuto({
          outputDir,
          agentName: 'CrosstabAgent',
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
        // ignore
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
  };

  const columns = [];
  for (const col of group.columns) {
    columns.push(await processSingleColumn(col));
  }

  return { groupName: group.groupName, columns };
}

// Process all banner groups using group-by-group strategy
export async function processAllGroups(
  dataMap: DataMapType,
  bannerPlan: BannerPlanInputType,
  outputDir?: string,
  onProgress?: (completedGroups: number, totalGroups: number) => void,
  abortSignal?: AbortSignal,
  loopCount?: number
): Promise<{ result: ValidationResultType; processingLog: string[]; scratchpadByGroup?: CrosstabScratchpadByGroup }> {
  const processingLog: string[] = [];
  const logEntry = (message: string) => {
    console.log(message);
    processingLog.push(`${new Date().toISOString()}: ${message}`);
  };

  // Check for cancellation before starting
  if (abortSignal?.aborted) {
    console.log('[CrosstabAgent] Aborted before processing started');
    throw new DOMException('CrosstabAgent aborted', 'AbortError');
  }

  // Clear scratchpad from any previous runs
  clearScratchpadEntries();

  logEntry(`[CrosstabAgent] Starting group-by-group processing: ${bannerPlan.bannerCuts.length} groups`);
  logEntry(`[CrosstabAgent] Using model: ${getCrosstabModelName()}`);
  logEntry(`[CrosstabAgent] Reasoning effort: ${getCrosstabReasoningEffort()}`);
  logEntry(`[CrosstabAgent] Loop iteration count: ${loopCount ?? 0} ${loopCount && loopCount > 0 ? '(loop-aware mode enabled)' : '(no loops)'}`);

  const results: ValidatedGroupType[] = [];
  const scratchpadByGroup: CrosstabScratchpadByGroup = {};

  // Process each group individually (group-by-group approach)
  for (let i = 0; i < bannerPlan.bannerCuts.length; i++) {
    // Check for cancellation between groups
    if (abortSignal?.aborted) {
      console.log(`[CrosstabAgent] Aborted after ${i} groups`);
      throw new DOMException('CrosstabAgent aborted', 'AbortError');
    }

    const group = bannerPlan.bannerCuts[i];
    const groupStartTime = Date.now();
    const beforeEntries = getScratchpadEntries().filter(e => e.agentName === 'CrosstabAgent');
    const beforeCount = beforeEntries.length;

    logEntry(`[CrosstabAgent] Processing group ${i + 1}/${bannerPlan.bannerCuts.length}: "${group.groupName}" (${group.columns.length} columns)`);

    const groupResult = await processGroup(dataMap, group, { abortSignal, outputDir, loopCount });
    results.push(groupResult);

    const afterEntries = getScratchpadEntries().filter(e => e.agentName === 'CrosstabAgent');
    const groupDelta = afterEntries.slice(beforeCount).map((entry) => normalizeScratchpadEntry({
      timestamp: entry.timestamp,
      action: entry.action,
      content: entry.content,
    }));
    if (groupDelta.length > 0) {
      scratchpadByGroup[group.groupName] = groupDelta.slice(0, MAX_SCRATCHPAD_ENTRIES_PER_GROUP);
    }

    const groupDuration = Date.now() - groupStartTime;
    const avgConfidence = groupResult.columns.length > 0
      ? groupResult.columns.reduce((sum, col) => sum + col.confidence, 0) / groupResult.columns.length
      : 0;

    logEntry(`[CrosstabAgent] Group "${group.groupName}" completed in ${groupDuration}ms - Avg confidence: ${avgConfidence.toFixed(2)}`);
    try { onProgress?.(i + 1, bannerPlan.bannerCuts.length); } catch {}
  }

  const combinedResult = combineValidationResults(results);

  // Collect scratchpad entries for the processing log (agent-specific to avoid contamination)
  const scratchpadEntries = getAndClearScratchpadEntries('CrosstabAgent');
  logEntry(`[CrosstabAgent] Collected ${scratchpadEntries.length} scratchpad entries`);

  // Save outputs with processing log and scratchpad
  if (outputDir) {
    await saveDevelopmentOutputs(combinedResult, outputDir, processingLog, scratchpadEntries);
  }

  logEntry(`[CrosstabAgent] All ${results.length} groups processed successfully - Total columns: ${combinedResult.bannerCuts.reduce((total, group) => total + group.columns.length, 0)}`);

  return { result: combinedResult, processingLog, scratchpadByGroup };
}

// Parallel processing option (for future optimization)
export async function processAllGroupsParallel(
  dataMap: DataMapType,
  bannerPlan: BannerPlanInputType,
  loopCount?: number
): Promise<{ result: ValidationResultType; processingLog: string[] }> {
  const processingLog: string[] = [];
  const logEntry = (message: string) => {
    console.log(message);
    processingLog.push(`${new Date().toISOString()}: ${message}`);
  };

  logEntry(`[CrosstabAgent] Starting parallel processing: ${bannerPlan.bannerCuts.length} groups`);
  logEntry(`[CrosstabAgent] Using model: ${getCrosstabModelName()}`);
  logEntry(`[CrosstabAgent] Reasoning effort: ${getCrosstabReasoningEffort()}`);

  try {
    logEntry(`[CrosstabAgent] Starting parallel group processing`);
    const groupPromises = bannerPlan.bannerCuts.map((group, index) => {
      logEntry(`[CrosstabAgent] Queuing group ${index + 1}: "${group.groupName}"`);
      return processGroup(dataMap, group, { loopCount });
    });

    const results = await Promise.all(groupPromises);
    const combinedResult = combineValidationResults(results);

    logEntry(`[CrosstabAgent] Parallel processing completed - ${results.length} groups, ${combinedResult.bannerCuts.reduce((total, group) => total + group.columns.length, 0)} total columns`);

    return { result: combinedResult, processingLog };

  } catch (error) {
    logEntry(`[CrosstabAgent] Parallel processing failed, falling back to sequential: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Fall back to sequential processing
    const results: ValidatedGroupType[] = [];

    for (const group of bannerPlan.bannerCuts) {
      logEntry(`[CrosstabAgent] Sequential fallback processing: "${group.groupName}"`);
      const groupResult = await processGroup(dataMap, group, { loopCount });
      results.push(groupResult);
    }

    logEntry(`[CrosstabAgent] Sequential fallback completed`);
    return { result: combineValidationResults(results), processingLog };
  }
}

// Validation helpers
export const validateAgentResult = (result: unknown): ValidationResultType => {
  return ValidationResultSchema.parse(result);
};

export const isValidAgentResult = (result: unknown): result is ValidationResultType => {
  return ValidationResultSchema.safeParse(result).success;
};

// Save development outputs
// NOTE: This replaces both saveDevelopmentOutputsWithTrace() and _saveDevelopmentOutputs()
// Key changes from old version:
//   - Removed: tracingEnabled, tracesDashboard (OpenAI-specific)
//   - Added: aiProvider, model (Azure-specific)
//   - Removed: _traceId parameter (was unused)
//   - Added: scratchpadEntries for reasoning transparency
async function saveDevelopmentOutputs(
  result: ValidationResultType,
  outputDir: string,
  processingLog?: string[],
  scratchpadEntries?: Array<{ timestamp: string; action: string; content: string }>
): Promise<void> {
  try {
    // Create crosstab subfolder for all CrosstabAgent outputs
    const crosstabDir = path.join(outputDir, 'crosstab');
    await fs.mkdir(crosstabDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `crosstab-output-${timestamp}.json`;
    const filePath = path.join(crosstabDir, filename);

    // Enhanced output with processing information
    const enhancedOutput = {
      ...result,
      processingInfo: {
        timestamp: new Date().toISOString(),
        processingMode: 'group-by-group',
        aiProvider: 'azure-openai',
        model: getCrosstabModelName(),
        reasoningEffort: getCrosstabReasoningEffort(),
        totalGroups: result.bannerCuts.length,
        totalColumns: result.bannerCuts.reduce((total, group) => total + group.columns.length, 0),
        averageConfidence: result.bannerCuts.length > 0
          ? result.bannerCuts
              .flatMap(group => group.columns)
              .reduce((sum, col) => sum + col.confidence, 0)
            / result.bannerCuts.flatMap(group => group.columns).length
          : 0,
        processingLog: processingLog || [],
        scratchpadTrace: scratchpadEntries || []
      }
    };

    await fs.writeFile(filePath, JSON.stringify(enhancedOutput, null, 2), 'utf-8');

    // Save raw output (complete model output - for golden dataset comparison)
    // This is the full combined result: bannerCuts with groupName, columns (name, adjusted, confidence, reason)
    const rawPath = path.join(crosstabDir, 'crosstab-output-raw.json');
    await fs.writeFile(rawPath, JSON.stringify(result, null, 2), 'utf-8');

    // Save scratchpad trace as separate markdown file for easy reading
    if (scratchpadEntries && scratchpadEntries.length > 0) {
      const scratchpadFilename = `scratchpad-crosstab-${timestamp}.md`;
      const scratchpadPath = path.join(crosstabDir, scratchpadFilename);
      const markdown = formatScratchpadAsMarkdown('CrosstabAgent', scratchpadEntries);
      await fs.writeFile(scratchpadPath, markdown, 'utf-8');
      console.log(`[CrosstabAgent] Development output saved to crosstab/: ${filename}, ${scratchpadFilename}`);
    } else {
      console.log(`[CrosstabAgent] Development output saved to crosstab/: ${filename}`);
    }
  } catch (error) {
    console.error('[CrosstabAgent] Failed to save development outputs:', error);
  }
}
