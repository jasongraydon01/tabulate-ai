/**
 * VerificationAgent
 *
 * @deprecated Replaced by the V3 canonical table assembly pipeline (stages 13b–13e)
 * and the V3 compute chain (stages 22–14). The V3 pipeline handles table structure,
 * labels, NETs, T2B/B2B, and exclusions deterministically — no post-hoc AI QC pass needed.
 *
 * Previously used by:
 * - tableRegenerationService.ts (HITL table regen — also deprecated)
 * - ValidationOrchestrator.ts (R validation retry loop — also deprecated)
 *
 * This file is retained for reference only. Do not invoke from active pipeline code.
 *
 * Original purpose: Enhance TableAgent output using the actual survey document.
 * Reads: TableAgent output (table definitions) + Survey markdown + Datamap context
 * Writes (dev): temp-outputs/output-<ts>/verified-table-output-<ts>.json
 */

import { generateText, Output, stepCountIs } from 'ai';
import pLimit from 'p-limit';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  VerificationAgentOutputSchema,
  type VerificationAgentOutput,
  type ExtendedTableDefinition,
  type VerificationResults,
  createPassthroughOutput,
  summarizeVerificationResults,
  toExtendedTable,
} from '../schemas/verificationAgentSchema';
import { type TableDefinition, type TableAgentOutput } from '../schemas/tableAgentSchema';
import { type VerboseDataMapType } from '../schemas/processingSchemas';
import {
  getVerificationModel,
  getVerificationModelName,
  getVerificationModelTokenLimit,
  getVerificationReasoningEffort,
  getPromptVersions,
  getGenerationConfig,
  getGenerationSamplingParams,
  isVerificationMutationMode,
} from '../lib/env';
import {
  verificationScratchpadTool,
  clearScratchpadEntries,
  getAndClearScratchpadEntries,
  formatScratchpadAsMarkdown,
  createContextScratchpadTool,
  getAllContextScratchpadEntries,
  clearContextScratchpadsForAgent,
} from './tools/scratchpad';
import { getVerificationPrompt } from '../prompts';
import { retryWithPolicyHandling, type RetryContext } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability';
import { getPipelineEventBus } from '../lib/events';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import { getPipelineContext } from '../lib/pipeline/PipelineContext';
import { getConsoleCaptureContext } from '../lib/logging/ConsoleCapture';
import { enforceConsolidatedMaxDiffGuard } from './verification/maxdiffConsolidatedGuard';
import { resolveMaxDiffPolicy, type MaxDiffPolicy } from '@/lib/maxdiff/policy';
import type { FamilyContextCard } from './verification/familyContext';
import { buildFamilyContextCards } from './verification/familyContext';
import type { EnhancementReport } from '@/lib/tables/enhancer-rules/types';
import {
  VerificationMutationAgentOutputSchema,
} from '@/schemas/verificationMutationSchema';
import { applyTableMutations, computeTableVersionHash } from './verification/applyTableMutations';
import {
  VerificationEditReportSchema,
  type VerificationEditReport,
} from '@/schemas/verificationEditReportSchema';
import fs from 'fs/promises';
import path from 'path';

// Get modular prompt based on environment variable
const getVerificationAgentInstructions = (): string => {
  const promptVersions = getPromptVersions();
  return getVerificationPrompt(promptVersions.verificationPromptVersion);
};

// =============================================================================
// Types
// =============================================================================

export interface RValidationError {
  /** Error message from R execution */
  errorMessage: string;
  /** Which retry attempt this is (1-based) */
  failedAttempt: number;
  /** Maximum retry attempts allowed */
  maxAttempts: number;
}

export interface VerificationInput {
  /** Table definition from TableAgent */
  table: TableDefinition;
  /** Optional exact ExtendedTableDefinition when available (preserves NET/filter metadata) */
  existingTable?: ExtendedTableDefinition;
  /** Question context */
  questionId: string;
  questionText: string;
  /** Survey markdown (full or section) */
  surveyMarkdown: string;
  /** Verbose datamap entries for variables in this table (as formatted string) */
  datamapContext: string;
  /** R validation error context for retry attempts (optional) */
  rValidationError?: RValidationError;
  /** Pre-applied filter fields to preserve through verification */
  filterContext?: {
    additionalFilter: string;
    baseText: string;
    splitFromTableId: string;
    filterReviewRequired: boolean;
    tableSubtitle: string;
    maxdiffConsolidated?: boolean;
    tableSemanticType?: TableSemanticType;
  };
  /** MaxDiff policy controls for generalized, family-level behavior */
  maxdiffPolicy?: Partial<MaxDiffPolicy>;
  /** Family context card used by mutation mode for bounded sibling awareness */
  familyContext?: FamilyContextCard;
  /** Enhancer flags surfaced for AI attention (mutation mode only) */
  enhancerFlags?: {
    flaggedForAI: boolean;
    flags: string[];
    skippedRules: Array<{ rule: string; reason: string }>;
  };
}

export interface VerificationProcessingOptions {
  /** Output directory for development outputs (full path) */
  outputDir?: string;
  /** Human-readable project/dataset label for logs */
  projectLabel?: string;
  /** Progress callback */
  onProgress?: (completed: number, total: number, tableId: string) => void;
  /** Whether to skip verification and pass through (e.g., when no survey available) */
  passthrough?: boolean;
  /** Abort signal for cancellation support */
  abortSignal?: AbortSignal;
  /** Project sub-type — enables MaxDiff-specific verification guardrails */
  projectSubType?: string;
  /** MaxDiff policy controls for generalized, family-level behavior */
  maxdiffPolicy?: Partial<MaxDiffPolicy>;
  /** Deterministically detected MaxDiff choice-task family question IDs */
  maxdiffChoiceTaskQuestionIds?: string[];
  /** Enhancement report from TableEnhancer (when enhancer output is applied) */
  enhancerReport?: EnhancementReport;
}

export type TableSemanticType =
  | 'maxdiff_score_consolidated'
  | 'maxdiff_choice_task_family'
  | 'maxdiff_message_preference'
  | 'standard_scale'
  | 'standard_categorical';

interface VerificationLogContext {
  projectLabel?: string;
}

function getVerificationLogPrefix(projectLabel?: string): string {
  // ConsoleCapture already prepends [Project | runId] globally in orchestrator path.
  if (getConsoleCaptureContext()) {
    return '';
  }

  const parts: string[] = [];
  if (projectLabel && projectLabel.trim().length > 0) {
    parts.push(projectLabel.trim());
  }

  const ctx = getPipelineContext();
  if (ctx?.meta.runId) {
    parts.push(ctx.meta.runId.slice(-8));
  } else if (ctx?.meta.pipelineId) {
    parts.push(ctx.meta.pipelineId.slice(-8));
  }

  return parts.length > 0 ? `[${parts.join(' | ')}] ` : '';
}

function classifyTableSemanticType(
  table: { tableId: string; rows: Array<{ label: string }>; tableType: string; isDerived?: boolean },
  questionId: string,
  projectSubType?: string,
  isMaxDiffConsolidated?: boolean,
  choiceTaskQuestionIds?: Set<string>,
): TableSemanticType {
  if (projectSubType === 'maxdiff') {
    if (isMaxDiffConsolidated || table.tableId.startsWith('maxdiff_')) {
      return 'maxdiff_score_consolidated';
    }
    if (choiceTaskQuestionIds?.has(questionId)) {
      return 'maxdiff_choice_task_family';
    }

    const labels = table.rows.map((r) => r.label).join(' | ');
    if (/message\s+\d+/i.test(labels) || /preferred message/i.test(labels)) {
      return 'maxdiff_message_preference';
    }
  }

  if (table.tableType === 'mean_rows') return 'standard_scale';
  return 'standard_categorical';
}

function buildBaseExtendedTable(input: VerificationInput): ExtendedTableDefinition {
  const fromExisting = input.existingTable
    ? {
        ...input.existingTable,
        rows: input.existingTable.rows.map((row) => ({ ...row })),
      }
    : null;

  const fromTableDefinition = toExtendedTable(input.table, input.questionId, input.questionText);
  const rowsWithNetHints = input.table.rows.map((row) => {
    const candidate = row as typeof row & { isNet?: boolean; netComponents?: string[]; indent?: number };
    return {
      variable: row.variable,
      label: row.label,
      filterValue: row.filterValue,
      isNet: candidate.isNet ?? false,
      netComponents: Array.isArray(candidate.netComponents) ? candidate.netComponents : [],
      indent: typeof candidate.indent === 'number' && Number.isFinite(candidate.indent) ? candidate.indent : 0,
    };
  });
  fromTableDefinition.rows = rowsWithNetHints;

  const base = fromExisting ?? fromTableDefinition;

  if (input.filterContext) {
    base.additionalFilter = input.filterContext.additionalFilter;
    base.splitFromTableId = input.filterContext.splitFromTableId;
    base.filterReviewRequired = input.filterContext.filterReviewRequired;
    if (input.filterContext.baseText) {
      base.baseText = input.filterContext.baseText;
    }
    if (input.filterContext.tableSubtitle && !base.tableSubtitle) {
      base.tableSubtitle = input.filterContext.tableSubtitle;
    }
  }

  return base;
}

function buildFamilyContextBlock(card?: FamilyContextCard): string {
  if (!card) return '';
  return `
<family_context>
${JSON.stringify({
  familyId: card.familyId,
  mode: card.mode,
  currentTableId: card.currentTableId,
  baseTableId: card.baseTableId,
  familyTableCount: card.familyTableCount,
  familyTotalRows: card.familyTotalRows,
  fullTables: card.fullTables.map((table) => ({
    tableId: table.tableId,
    rowCount: table.rows.length,
    isDerived: table.isDerived,
    sourceTableId: table.sourceTableId,
    additionalFilter: table.additionalFilter,
    exclude: table.exclude,
    rows: table.rows.map((row) => ({
      variable: row.variable,
      label: row.label,
      filterValue: row.filterValue,
      isNet: row.isNet,
      indent: row.indent,
    })),
  })),
  compactSiblings: card.compactSiblings,
}, null, 2)}
</family_context>
`;
}

function buildVerificationEditReport(
  before: ExtendedTableDefinition,
  after: ExtendedTableDefinition,
  confidence: number,
  operationKindCounts?: Record<string, number>,
): VerificationEditReport {
  const beforeLabelByRow = new Map<string, string>();
  for (const row of before.rows) {
    beforeLabelByRow.set(`${row.variable}::${row.filterValue}`, row.label);
  }

  let labelsChanged = 0;
  for (const row of after.rows) {
    const rowKey = `${row.variable}::${row.filterValue}`;
    const previous = beforeLabelByRow.get(rowKey);
    if (previous !== undefined && previous !== row.label) {
      labelsChanged++;
    }
  }

  const beforeNetCount = before.rows.filter((row) => row.isNet).length;
  const afterNetCount = after.rows.filter((row) => row.isNet).length;
  const netsAdded = Math.max(0, afterNetCount - beforeNetCount);
  const netsRemoved = Math.max(0, beforeNetCount - afterNetCount);

  const structuralMutations: string[] = [];
  if (before.tableType !== after.tableType) structuralMutations.push('table_type_changed');
  if (before.tableId !== after.tableId) structuralMutations.push('table_id_changed');
  if (before.rows.length !== after.rows.length) structuralMutations.push('row_count_changed');
  if (before.sourceTableId !== after.sourceTableId) structuralMutations.push('source_table_changed');
  if (before.isDerived !== after.isDerived) structuralMutations.push('derived_flag_changed');
  if (before.exclude !== after.exclude) structuralMutations.push('exclusion_changed');

  const metadataChanges: string[] = [];
  const metadataKeys: Array<keyof ExtendedTableDefinition> = [
    'surveySection',
    'baseText',
    'userNote',
    'tableSubtitle',
    'additionalFilter',
    'splitFromTableId',
    'filterReviewRequired',
    'questionText',
  ];
  for (const key of metadataKeys) {
    if (before[key] !== after[key]) {
      metadataChanges.push(key);
    }
  }

  // Determine verification outcome
  const hasChanges = labelsChanged > 0 || netsAdded > 0 || netsRemoved > 0 ||
    structuralMutations.length > 0 || metadataChanges.length > 0 ||
    before.exclude !== after.exclude;
  let verificationOutcome: 'confirmed' | 'refined' | 'passthrough' | 'error';
  if (confidence === 0) {
    verificationOutcome = 'error';
  } else if (hasChanges) {
    verificationOutcome = 'refined';
  } else {
    verificationOutcome = 'confirmed';
  }

  return VerificationEditReportSchema.parse({
    tableId: after.tableId,
    familyId: after.sourceTableId || after.splitFromTableId || after.tableId,
    labelsChanged,
    labelsTotal: after.rows.length,
    structuralMutations,
    netsAdded,
    netsRemoved,
    exclusionChanged: before.exclude !== after.exclude || before.excludeReason !== after.excludeReason,
    metadataChanges,
    confidence,
    verificationOutcome,
    operationKindCounts: operationKindCounts ?? {},
  });
}

// =============================================================================
// Single Table Processing
// =============================================================================

/**
 * Process a single table through VerificationAgent
 */
export async function verifyTable(
  input: VerificationInput,
  abortSignal?: AbortSignal,
  contextScratchpad?: ReturnType<typeof createContextScratchpadTool>,
  logContext?: VerificationLogContext,
): Promise<VerificationAgentOutput> {
  const prefix = getVerificationLogPrefix(logContext?.projectLabel);
  const log = (message: string) => console.log(`${prefix}${message}`);
  const warn = (message: string) => console.warn(`${prefix}${message}`);
  const error = (message: string, extra?: string) => {
    if (extra !== undefined) {
      console.error(`${prefix}${message}`, extra);
      return;
    }
    console.error(`${prefix}${message}`);
  };

  log(`[VerificationAgent] Processing table: ${input.table.tableId}`);
  const genConfig = getGenerationConfig();
  const resolvedMaxDiffPolicy = resolveMaxDiffPolicy(input.maxdiffPolicy);
  const startTime = Date.now();
  const mutationMode = isVerificationMutationMode();
  const baseExtendedTable = buildBaseExtendedTable(input);
  const tableVersionHash = computeTableVersionHash(baseExtendedTable);

  // Check for cancellation before processing
  if (abortSignal?.aborted) {
    log(`[VerificationAgent] Aborted before processing table ${input.table.tableId}`);
    throw new DOMException('VerificationAgent aborted', 'AbortError');
  }

  // If no survey markdown, pass through unchanged
  if (!input.surveyMarkdown || input.surveyMarkdown.trim() === '') {
    log('[VerificationAgent] No survey markdown - passing through unchanged');
    return {
      tables: [baseExtendedTable],
      changes: [],
      confidence: 1.0,
      userSummary: 'No survey context available; table passed through unchanged.',
    };
  }

  // Build system prompt with survey and datamap context
  const redactDatamapContextForPolicySafe = (datamapContext: string): string => {
    if (!datamapContext) return datamapContext;
    return datamapContext
      .split('\n')
      .map((line) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('Description:')) {
          return line.replace(/Description:.*/i, 'Description: [redacted]');
        }
        if (trimmed.startsWith('Scale Labels:')) {
          return line.replace(/Scale Labels:.*/i, 'Scale Labels: [redacted]');
        }
        // Allowed Values / Type / Values are generally safe and useful.
        return line;
      })
      .join('\n');
  };

  const buildSystemPrompt = (policySafe: boolean): string => {
    const survey = policySafe
      ? '[OMITTED DUE TO POLICY FILTER — rely on question text, table structure, and datamap]'
      : input.surveyMarkdown;
    const datamap = policySafe ? redactDatamapContextForPolicySafe(input.datamapContext) : input.datamapContext;
    const policyNote = policySafe
      ? `\nNOTE: Policy-safe mode is enabled due to repeated Azure content filtering. Some free-text may be redacted.\n`
      : '';

    return `
${RESEARCH_DATA_PREAMBLE}${getVerificationAgentInstructions()}${policyNote}

## Survey Document
<survey>
${sanitizeForAzureContentFilter(survey)}
</survey>

## Variable Context (Datamap)
<datamap>
${sanitizeForAzureContentFilter(datamap)}
</datamap>
`;
  };

  // Build user prompt
  let userPrompt = mutationMode
    ? `Verify this table. Propose mutation operations per the system prompt contract.

<table_identity>
questionId: ${input.questionId}
questionText: ${input.questionText}
targetTableId: ${baseExtendedTable.tableId}
tableVersionHash: ${tableVersionHash}
</table_identity>

<current_table>
${JSON.stringify(baseExtendedTable, null, 2)}
</current_table>
`
    : `Review this table and output the desired end state:

Question: ${input.questionId} - ${input.questionText}

Table Definition:
${JSON.stringify(input.table, null, 2)}

Analyze the table against the survey document. Fix labels, split if needed, add NETs if appropriate, create T2B if it's a scale, or flag for exclusion if low value. Output the tables array representing the desired end state.
`;

  if (input.filterContext?.tableSemanticType) {
    userPrompt += `
<table_semantic_context>
tableSemanticType: ${input.filterContext.tableSemanticType}
</table_semantic_context>
`;
  }

  if (mutationMode) {
    userPrompt += buildFamilyContextBlock(input.familyContext);

    if (input.enhancerFlags && (input.enhancerFlags.flaggedForAI || input.enhancerFlags.flags.length > 0)) {
      userPrompt += `
<enhancer_flags>
flaggedForAI: ${input.enhancerFlags.flaggedForAI}
flags: ${JSON.stringify(input.enhancerFlags.flags)}
skippedRules: ${JSON.stringify(input.enhancerFlags.skippedRules)}
</enhancer_flags>
`;
    }
  }

  userPrompt += `
<maxdiff_policy>
includeChoiceTaskFamilyInMainOutput: ${resolvedMaxDiffPolicy.includeChoiceTaskFamilyInMainOutput}
maxSplitTablesPerInput: ${resolvedMaxDiffPolicy.maxSplitTablesPerInput}
allowDerivedTablesForChoiceTasks: ${resolvedMaxDiffPolicy.allowDerivedTablesForChoiceTasks}
placeholderResolutionRequired: ${resolvedMaxDiffPolicy.placeholderResolutionRequired}

Rules:
- Preserve upstream baseText when provided by filter context; do not replace with unsupported assignment/randomization statements.
- If evidence for baseText is unclear, prefer empty string over speculative claims.
- If placeholder labels are present (e.g., "Message N", "preferred message") and datamap/message evidence allows resolution, resolve them.
- Split only when analytical value is clear; avoid readability-only multiplication.
</maxdiff_policy>
`;

  // Append split context if this table was pre-filtered by upstream FilterApplicator
  if (input.filterContext?.splitFromTableId) {
    userPrompt += `
Note: This table was split from "${input.filterContext.splitFromTableId}" by an upstream filter process that applies per-row base logic. The rows shown are the relevant subset for this split. Treat it as a normal table.
`;
  }

  if (input.filterContext?.maxdiffConsolidated) {
    userPrompt += mutationMode
      ? `
<maxdiff_consolidated_table>
This table is already a consolidated MaxDiff score table from deterministic preprocessing.
Only these mutation operations are allowed:
- update_label: Improve row labels
- set_question_text: Clean question text
- set_metadata: Improve surveySection, baseText, userNote, tableSubtitle
Do NOT use: create_conceptual_net, create_same_variable_net, delete_row, set_exclusion, update_row_fields.
</maxdiff_consolidated_table>
`
      : `
<maxdiff_consolidated_table>
This table is already a consolidated MaxDiff score table from deterministic preprocessing.
Rules:
- Return exactly ONE table.
- Do NOT split, add, remove, or reorder rows.
- Keep tableId unchanged.
- Keep tableType as "mean_rows".
- Keep every row variable and filterValue unchanged.
- Do NOT create NET rows or derived tables.
- Do NOT exclude this table.

Allowed edits:
- Improve row labels.
- Improve questionText, surveySection, baseText, userNote, and tableSubtitle.
</maxdiff_consolidated_table>
`;
  }

  if (input.filterContext?.tableSemanticType === 'maxdiff_choice_task_family') {
    userPrompt += `
<maxdiff_choice_task_policy>
This table belongs to a detected MaxDiff choice-task family.
Rules:
- Treat this as a family-level analytical table, not a question-ID-specific special case.
- Default to one stable table unless policy explicitly allows more.
- Avoid creating derived tables unless they add clear analytical value and policy allows it.
</maxdiff_choice_task_policy>
`;
  }

  // Append retry error context at the bottom if this is a retry attempt
  if (input.rValidationError) {
    const { errorMessage, failedAttempt, maxAttempts } = input.rValidationError;
    userPrompt += `
<r_validation_retry>
RETRY ATTEMPT ${failedAttempt}/${maxAttempts}

Your previous output for this table failed R validation with the following error:
"${errorMessage}"

<common_fixes>
- "object 'X' not found" → Variable name doesn't exist in datamap. Check exact spelling and case.
- "Variable 'X' not found" → Variable name is hallucinated. Use ONLY variables from the datamap.
- "Variable '_NET_*' not found" → You created a NET but forgot isNet: true and/or netComponents.
  For synthetic NET variables, you MUST set isNet: true AND populate netComponents with exact variable names from the datamap.
- "NET component variable 'X' not found" → A variable in netComponents doesn't exist. Check exact spelling/case against datamap.
- "non-numeric argument" → filterValue or variable type mismatch. Check datamap for correct types.
</common_fixes>

Please carefully review the error message and the datamap context above, then retry your output for this table. Follow all system prompt instructions as normal.
</r_validation_retry>
`;
  }

  // Check if this is an abort error
  const checkAbortError = (error: unknown): boolean => {
    return error instanceof DOMException && error.name === 'AbortError';
  };

  const maxAttempts = 10;

  // Use context scratchpad if provided (for parallel execution), else use global
  const scratchpad = contextScratchpad || verificationScratchpadTool;

  // Wrap the AI call with retry logic for policy errors
  const retryResult = await retryWithPolicyHandling(
    async (ctx: RetryContext) => {
      // On policy errors, resubmit the identical prompt — the filter is stochastic,
      // and telling the model about a content filter failure would cause needless second-guessing.
      const retryContextBlock = ctx.attempt > 1 && ctx.lastClassification !== 'policy'
        ? `\n<retry_context>\nYour previous attempt failed.\nReason: ${ctx.lastErrorSummary}\nFix the issue and retry. Do NOT invent variables or schema fields.\n</retry_context>\n`
        : '';

      // Escalate maxOutputTokens if consecutive output_validation errors suggest truncation
      const defaultMaxTokens = Math.min(getVerificationModelTokenLimit(), 100000);
      const maxOutputTokens = ctx.possibleTruncation ? getVerificationModelTokenLimit() : defaultMaxTokens;
      if (ctx.possibleTruncation) {
        warn(`[VerificationAgent] Possible truncation detected — increasing maxOutputTokens to ${maxOutputTokens}`);
      }

      const baseRequest = {
        model: getVerificationModel(),
        system: buildSystemPrompt(ctx.shouldUsePolicySafeVariant),
        maxRetries: 0,  // Centralized outer retries via retryWithPolicyHandling
        prompt: userPrompt + retryContextBlock,
        tools: {
          scratchpad,
        },
        stopWhen: stepCountIs(15),
        maxOutputTokens,
        ...getGenerationSamplingParams(getVerificationModelName()),
        providerOptions: {
          openai: {
            reasoningEffort: getVerificationReasoningEffort(),
            parallelToolCalls: genConfig.parallelToolCalls,
          },
        },
        abortSignal,
      } as const;

      let normalizedOutput: VerificationAgentOutput;
      let usage: { inputTokens?: number; outputTokens?: number } | undefined;
      if (mutationMode) {
        const { output, usage: mutationUsage } = await generateText({
          ...baseRequest,
          output: Output.object({
            schema: VerificationMutationAgentOutputSchema,
          }),
        });
        usage = mutationUsage;

        const proposal = VerificationMutationAgentOutputSchema.parse(output);
        const mutationResult = applyTableMutations(
          baseExtendedTable,
          proposal.mutation,
          { allowReservedOperations: true },
        );
        const mutationChanges = Array.from(
          new Set([
            ...proposal.changes,
            ...mutationResult.audit.applied,
            ...mutationResult.audit.skipped.map((entry) => `skipped:${entry}`),
            ...mutationResult.audit.warnings.map((entry) => `warning:${entry}`),
            ...mutationResult.audit.requestedOverrides.map((entry) => `override:${entry}`),
            ...mutationResult.audit.reviewFlags.map((entry) => `review:${entry}`),
          ]),
        );

        // Compute operation kind counts from applied audit entries
        const kindCounts: Record<string, number> = {};
        for (const entry of mutationResult.audit.applied) {
          const kind = entry.split(':')[0];
          kindCounts[kind] = (kindCounts[kind] || 0) + 1;
        }

        normalizedOutput = {
          tables: [mutationResult.table],
          changes: mutationChanges,
          confidence: proposal.confidence,
          userSummary: proposal.userSummary,
          _operationKindCounts: kindCounts,
        } as VerificationAgentOutput & { _operationKindCounts?: Record<string, number> };
      } else {
        const { output, usage: verificationUsage } = await generateText({
          ...baseRequest,
          output: Output.object({
            schema: VerificationAgentOutputSchema,
          }),
        });
        usage = verificationUsage;
        normalizedOutput = VerificationAgentOutputSchema.parse(output as VerificationAgentOutput);
      }

      if (!normalizedOutput.tables || normalizedOutput.tables.length === 0) {
        throw new Error(`Invalid output for table ${input.table.tableId}`);
      }

      // Record metrics
      const durationMs = Date.now() - startTime;
      recordAgentMetrics(
        'VerificationAgent',
        getVerificationModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        durationMs
      );

      return normalizedOutput;
    },
    {
      abortSignal,
      maxAttempts,
      onRetry: (attempt, err) => {
        // Check for abort errors and propagate them
        if (checkAbortError(err)) {
          throw err;
        }
        warn(`[VerificationAgent] Retry ${attempt}/${maxAttempts} for table "${input.table.tableId}": ${err.message.substring(0, 120)}`);
      },
    }
  );

  if (retryResult.success && retryResult.result) {
    let normalizedResult = retryResult.result;

    if (input.filterContext?.maxdiffConsolidated) {
      const guard = enforceConsolidatedMaxDiffGuard(input.table, normalizedResult);
      if (guard.adjusted && guard.reason) {
        warn(`[VerificationAgent] MaxDiff consolidated guardrail applied to ${input.table.tableId}: ${guard.reason}`);
      }
      normalizedResult = guard.output;
    }

    // Preserve filter fields from upstream FilterApplicator / GridAutoSplitter
    if (input.filterContext) {
      for (const t of normalizedResult.tables) {
        t.additionalFilter = input.filterContext.additionalFilter;
        t.splitFromTableId = input.filterContext.splitFromTableId;
        t.filterReviewRequired = input.filterContext.filterReviewRequired;
        // Preserve upstream baseText if set; otherwise keep agent's
        if (input.filterContext.baseText) {
          t.baseText = input.filterContext.baseText;
        }
        // Preserve upstream tableSubtitle if agent didn't set its own
        if (input.filterContext.tableSubtitle && !t.tableSubtitle) {
          t.tableSubtitle = input.filterContext.tableSubtitle;
        }
      }
    }

    // Deterministic policy enforcement for detected choice-task families
    if (input.filterContext?.tableSemanticType === 'maxdiff_choice_task_family') {
      if (!resolvedMaxDiffPolicy.includeChoiceTaskFamilyInMainOutput) {
        for (const t of normalizedResult.tables) {
          t.exclude = true;
          t.excludeReason = 'Suppressed by MaxDiff policy: choice-task family moved to reference output';
        }
      }

      if (!resolvedMaxDiffPolicy.allowDerivedTablesForChoiceTasks) {
        for (const t of normalizedResult.tables) {
          if (t.isDerived) {
            t.exclude = true;
            t.excludeReason = 'Suppressed by MaxDiff policy: derived choice-task tables disabled';
          }
        }
      }
    }

    log(
      `[VerificationAgent] Table ${input.table.tableId} processed - ${normalizedResult.tables.length} tables, ${normalizedResult.changes.length} changes, confidence: ${normalizedResult.confidence.toFixed(2)}`
    );
    return normalizedResult;
  }

  // Handle abort errors
  if (retryResult.error === 'Operation was cancelled') {
    log(`[VerificationAgent] Aborted by signal during table ${input.table.tableId}`);
    throw new DOMException('VerificationAgent aborted', 'AbortError');
  }

  // All retries failed - return passthrough on error
  const errorMessage = retryResult.error || 'Unknown error';
  const retryContext = retryResult.wasPolicyError
    ? ` (failed after ${retryResult.attempts} retries due to content policy)`
    : '';
  error(`[VerificationAgent] Error processing table ${input.table.tableId}:`, errorMessage + retryContext);

  return {
    tables: [baseExtendedTable],
    changes: [],
    confidence: 0,
    userSummary: 'Verification failed; table passed through unchanged.',
  };
}

// =============================================================================
// Batch Processing
// =============================================================================

/**
 * Process all tables from TableAgent output through VerificationAgent
 */
export async function verifyAllTables(
  tableAgentOutput: TableAgentOutput[],
  surveyMarkdown: string,
  verboseDataMap: VerboseDataMapType[],
  options: VerificationProcessingOptions = {}
): Promise<VerificationResults> {
  const {
    outputDir,
    projectLabel,
    onProgress,
    passthrough,
    abortSignal,
    projectSubType,
    maxdiffPolicy,
    maxdiffChoiceTaskQuestionIds,
    enhancerReport,
  } = options;
  const processingLog: string[] = [];
  const prefix = getVerificationLogPrefix(projectLabel);
  const choiceTaskQuestionIdSet = new Set(maxdiffChoiceTaskQuestionIds ?? []);

  const logEntry = (message: string) => {
    const tagged = `${prefix}${message}`;
    console.log(tagged);
    processingLog.push(`${new Date().toISOString()}: ${tagged}`);
  };

  // Check for cancellation before starting
  if (abortSignal?.aborted) {
    logEntry('[VerificationAgent] Aborted before processing started');
    throw new DOMException('VerificationAgent aborted', 'AbortError');
  }

  // Clear scratchpad from any previous runs
  clearScratchpadEntries();

  // Collect all tables with their question context
  const allTables: Array<{
    table: TableDefinition;
    existingTable: ExtendedTableDefinition;
    questionId: string;
    questionText: string;
  }> = [];

  for (const questionGroup of tableAgentOutput) {
    for (const table of questionGroup.tables) {
      const existingTable = toExtendedTable(table, questionGroup.questionId, questionGroup.questionText);
      allTables.push({
        table,
        existingTable,
        questionId: questionGroup.questionId,
        questionText: questionGroup.questionText,
      });
    }
  }

  const familyContextByTableId = buildFamilyContextCards(allTables.map((entry) => entry.existingTable));

  // Build per-table enhancer flags lookup from the enhancement report
  const enhancerFlagsByTableId = new Map<string, VerificationInput['enhancerFlags']>();
  if (enhancerReport) {
    const flaggedSet = new Set(enhancerReport.flaggedForAI);
    for (const trace of enhancerReport.ruleApplications) {
      const isFlagged = flaggedSet.has(trace.tableId);
      if (isFlagged || trace.skipped.length > 0) {
        enhancerFlagsByTableId.set(trace.tableId, {
          flaggedForAI: isFlagged,
          flags: trace.applied,
          skippedRules: trace.skipped,
        });
      }
    }
  }

  logEntry(`[VerificationAgent] Starting processing: ${allTables.length} tables`);
  logEntry(`[VerificationAgent] Using model: ${getVerificationModelName()}`);
  logEntry(`[VerificationAgent] Reasoning effort: ${getVerificationReasoningEffort()}`);
  logEntry(`[VerificationAgent] Survey markdown: ${surveyMarkdown.length} characters`);

  // If passthrough mode or no survey, return all tables unchanged
  if (passthrough || !surveyMarkdown || surveyMarkdown.trim() === '') {
    logEntry(`[VerificationAgent] Passthrough mode - returning tables unchanged`);
    const passthroughResults = allTables.map(({ table, questionId }) => {
      const output = createPassthroughOutput(table);
      // Attach questionId to passthrough tables
      return {
        ...output,
        tables: output.tables.map((t) => ({ ...t, questionId })),
      };
    });
    const allVerifiedTables = passthroughResults.flatMap((r) => r.tables);

    return {
      tables: allVerifiedTables,
      metadata: summarizeVerificationResults(passthroughResults),
      allChanges: [],
    };
  }

  // Build datamap lookup for quick access
  const datamapByColumn = new Map<string, VerboseDataMapType>();
  for (const entry of verboseDataMap) {
    datamapByColumn.set(entry.column, entry);
  }

  const results: VerificationAgentOutput[] = [];
  const questionIdByIndex: string[] = []; // Track questionId for each result

  // Process each table
  for (let i = 0; i < allTables.length; i++) {
    // Check for cancellation between tables
    if (abortSignal?.aborted) {
      logEntry(`[VerificationAgent] Aborted after ${i} tables`);
      throw new DOMException('VerificationAgent aborted', 'AbortError');
    }

    const { table, existingTable, questionId, questionText } = allTables[i];
    const startTime = Date.now();

    logEntry(
      `[VerificationAgent] Processing table ${i + 1}/${allTables.length}: "${table.tableId}"`
    );

    // Get datamap context for variables in this table
    const datamapContext = getDatamapContextForTable(table, datamapByColumn);

    const input: VerificationInput = {
      table,
      existingTable,
      questionId,
      questionText,
      surveyMarkdown,
      datamapContext,
      maxdiffPolicy,
      familyContext: familyContextByTableId.get(existingTable.tableId),
      enhancerFlags: enhancerFlagsByTableId.get(existingTable.tableId),
      filterContext: {
        additionalFilter: '',
        baseText: '',
        splitFromTableId: '',
        filterReviewRequired: false,
        tableSubtitle: '',
        tableSemanticType: classifyTableSemanticType(
          table,
          questionId,
          projectSubType,
          false,
          choiceTaskQuestionIdSet,
        ),
      },
    };

    const result = await verifyTable(input, abortSignal, undefined, { projectLabel });
    results.push(result);
    questionIdByIndex.push(questionId); // Track questionId for this result

    const duration = Date.now() - startTime;
    logEntry(
      `[VerificationAgent] Table "${table.tableId}" completed in ${duration}ms - ${result.tables.length} output tables, ${result.changes.length} changes`
    );

    try {
      onProgress?.(i + 1, allTables.length, table.tableId);
    } catch {
      // Ignore progress callback errors
    }
  }

  // Collect scratchpad entries (agent-specific to avoid contamination)
  // Note: In parallel mode, this will be empty since context-isolated scratchpads are used
  const scratchpadEntries = getAndClearScratchpadEntries('VerificationAgent');
  logEntry(`[VerificationAgent] Collected ${scratchpadEntries.length} scratchpad entries`);

  // Combine all verified tables, attaching questionId from the tracked array
  const allVerifiedTables: ExtendedTableDefinition[] = results.flatMap((r, i) =>
    r.tables.map((t) => ({ ...t, questionId: questionIdByIndex[i] }))
  );

  const editReports: VerificationEditReport[] = results.flatMap((result, index) => {
    const before = allTables[index].existingTable;
    const kindCounts = (result as VerificationAgentOutput & { _operationKindCounts?: Record<string, number> })._operationKindCounts;
    return result.tables.map((after) => buildVerificationEditReport(before, after, result.confidence, kindCounts));
  });

  // Collect all changes
  const allChanges = results
    .map((r, i) => ({
      tableId: allTables[i].table.tableId,
      changes: r.changes,
    }))
    .filter((c) => c.changes.length > 0);

  // Calculate metadata
  const metadata = summarizeVerificationResults(results);

  logEntry(
    `[VerificationAgent] Processing complete - ${allTables.length} input → ${allVerifiedTables.length} output tables`
  );
  logEntry(
    `[VerificationAgent] Modified: ${metadata.tablesModified}, Split: ${metadata.tablesSplit}, Excluded: ${metadata.tablesExcluded}`
  );

  const verificationResults: VerificationResults = {
    tables: allVerifiedTables,
    metadata,
    allChanges,
  };

  // Save outputs
  if (outputDir) {
    await saveDevelopmentOutputs(
      verificationResults,
      outputDir,
      processingLog,
      scratchpadEntries,
      editReports,
    );
  }

  return verificationResults;
}

// =============================================================================
// Parallel Processing
// =============================================================================

/**
 * Detect whether input is ExtendedTableDefinition[] (from FilterApplicator)
 * vs TableAgentOutput[] (original format from TableGenerator).
 */
function isExtendedTableArray(input: unknown[]): input is ExtendedTableDefinition[] {
  return input.length > 0 && typeof input[0] === 'object' && input[0] !== null && 'additionalFilter' in input[0];
}

/**
 * Process all tables in parallel with configurable concurrency.
 * Accepts either TableAgentOutput[] (legacy) or ExtendedTableDefinition[] (filtered).
 */
export async function verifyAllTablesParallel(
  tableInput: TableAgentOutput[] | ExtendedTableDefinition[],
  surveyMarkdown: string,
  verboseDataMap: VerboseDataMapType[],
  options: VerificationProcessingOptions & { concurrency?: number } = {}
): Promise<VerificationResults> {
  const {
    outputDir,
    projectLabel,
    onProgress,
    passthrough,
    abortSignal,
    concurrency = 3,
    projectSubType,
    maxdiffPolicy,
    maxdiffChoiceTaskQuestionIds,
    enhancerReport,
  } = options;
  const processingLog: string[] = [];
  const prefix = getVerificationLogPrefix(projectLabel);
  const choiceTaskQuestionIdSet = new Set(maxdiffChoiceTaskQuestionIds ?? []);

  const logEntry = (message: string) => {
    const tagged = `${prefix}${message}`;
    console.log(tagged);
    processingLog.push(`${new Date().toISOString()}: ${tagged}`);
  };

  // Check for cancellation before starting
  if (abortSignal?.aborted) {
    logEntry('[VerificationAgent] Aborted before processing started');
    throw new DOMException('VerificationAgent aborted', 'AbortError');
  }

  // Clear both global and context scratchpads from any previous runs
  clearScratchpadEntries();
  clearContextScratchpadsForAgent('VerificationAgent');

  // Build lookup table once (shared, immutable)
  const datamapByColumn = new Map<string, VerboseDataMapType>();
  for (const entry of verboseDataMap) {
    datamapByColumn.set(entry.column, entry);
  }

  // Flatten all tables with their context
  const allTables: Array<{
    table: TableDefinition;
    existingTable: ExtendedTableDefinition;
    questionId: string;
    questionText: string;
    index: number;
    filterContext?: VerificationInput['filterContext'];
  }> = [];

  if (isExtendedTableArray(tableInput)) {
    // ExtendedTableDefinition[] from FilterApplicator — flat array with filter fields
    for (const extTable of tableInput) {
      const isMaxDiffConsolidated = projectSubType === 'maxdiff' && extTable.lastModifiedBy === 'MaxDiffConsolidator';
      const filterContext: VerificationInput['filterContext'] = {
        additionalFilter: extTable.additionalFilter,
        baseText: extTable.baseText,
        splitFromTableId: extTable.splitFromTableId,
        filterReviewRequired: extTable.filterReviewRequired,
        tableSubtitle: extTable.tableSubtitle,
        maxdiffConsolidated: isMaxDiffConsolidated,
        tableSemanticType: classifyTableSemanticType(
          extTable,
          extTable.questionId,
          projectSubType,
          isMaxDiffConsolidated,
          choiceTaskQuestionIdSet,
        ),
      };

      // Convert ExtendedTableDefinition back to TableDefinition for the agent
      const table: TableDefinition = {
        tableId: extTable.tableId,
        questionText: extTable.questionText,
        tableType: extTable.tableType,
        rows: extTable.rows.map(r => ({
          variable: r.variable,
          label: r.label,
          filterValue: r.filterValue,
        })),
        hints: [],
      };

      allTables.push({
        table,
        existingTable: {
          ...extTable,
          rows: extTable.rows.map((row) => ({ ...row })),
        },
        questionId: extTable.questionId,
        questionText: extTable.questionText,
        index: allTables.length,
        filterContext,
      });
    }
  } else {
    // TableAgentOutput[] — legacy format (grouped by question)
    for (const questionGroup of tableInput) {
      for (const table of questionGroup.tables) {
        allTables.push({
          table,
          existingTable: toExtendedTable(table, questionGroup.questionId, questionGroup.questionText),
          questionId: questionGroup.questionId,
          questionText: questionGroup.questionText,
          index: allTables.length,
          filterContext: {
            additionalFilter: '',
            baseText: '',
            splitFromTableId: '',
            filterReviewRequired: false,
            tableSubtitle: '',
            maxdiffConsolidated: false,
            tableSemanticType: classifyTableSemanticType(
              table,
              questionGroup.questionId,
              projectSubType,
              false,
              choiceTaskQuestionIdSet,
            ),
          },
        });
      }
    }
  }

  const familyContextByTableId = buildFamilyContextCards(allTables.map((entry) => entry.existingTable));

  // Build per-table enhancer flags lookup from the enhancement report
  const enhancerFlagsByTableId = new Map<string, VerificationInput['enhancerFlags']>();
  if (enhancerReport) {
    const flaggedSet = new Set(enhancerReport.flaggedForAI);
    for (const trace of enhancerReport.ruleApplications) {
      const isFlagged = flaggedSet.has(trace.tableId);
      if (isFlagged || trace.skipped.length > 0) {
        enhancerFlagsByTableId.set(trace.tableId, {
          flaggedForAI: isFlagged,
          flags: trace.applied,
          skippedRules: trace.skipped,
        });
      }
    }
  }

  logEntry(`[VerificationAgent] Starting parallel processing: ${allTables.length} tables (concurrency: ${concurrency})`);
  logEntry(`[VerificationAgent] Using model: ${getVerificationModelName()}`);
  logEntry(`[VerificationAgent] Reasoning effort: ${getVerificationReasoningEffort()}`);
  logEntry(`[VerificationAgent] Survey markdown: ${surveyMarkdown.length} characters`);

  // If passthrough mode or no survey, return all tables unchanged
  if (passthrough || !surveyMarkdown || surveyMarkdown.trim() === '') {
    logEntry(`[VerificationAgent] Passthrough mode - returning tables unchanged`);
    const passthroughTables = allTables.map(({ existingTable }) => ({
      ...existingTable,
      rows: existingTable.rows.map((row) => ({ ...row })),
    }));

    return {
      tables: passthroughTables,
      metadata: {
        totalInputTables: allTables.length,
        totalOutputTables: passthroughTables.length,
        tablesModified: 0,
        tablesSplit: 0,
        tablesExcluded: 0,
        averageConfidence: 1.0,
      },
      allChanges: [],
    };
  }

  // Create limiter for concurrency control
  const limit = pLimit(concurrency);
  let completed = 0;

  // Track active slots for event emission
  const activeSlots = new Map<string, number>(); // tableId -> slotIndex
  let nextSlotIndex = 0;

  // Process in parallel with limit
  const resultPromises = allTables.map(({ table, existingTable, questionId, questionText, index, filterContext }) =>
    limit(async () => {
      if (abortSignal?.aborted) {
        throw new DOMException('VerificationAgent aborted', 'AbortError');
      }

      // Assign slot index (round-robin)
      const slotIndex = nextSlotIndex % concurrency;
      nextSlotIndex++;
      activeSlots.set(table.tableId, slotIndex);

      const startTime = Date.now();

      // Emit slot:start event
      getPipelineEventBus().emitSlotStart('VerificationAgent', slotIndex, table.tableId);

      const datamapContext = getDatamapContextForTable(table, datamapByColumn);
      const input: VerificationInput = {
        table,
        existingTable,
        questionId,
        questionText,
        surveyMarkdown,
        datamapContext,
        filterContext,
        maxdiffPolicy,
        familyContext: familyContextByTableId.get(existingTable.tableId),
        enhancerFlags: enhancerFlagsByTableId.get(existingTable.tableId),
      };

      // Use context-specific scratchpad
      const contextScratchpad = createContextScratchpadTool('VerificationAgent', table.tableId);
      try {
        const result = await verifyTable(input, abortSignal, contextScratchpad, { projectLabel });

        // Emit slot:complete event
        const durationMs = Date.now() - startTime;
        getPipelineEventBus().emitSlotComplete('VerificationAgent', slotIndex, table.tableId, durationMs);
        activeSlots.delete(table.tableId);

        completed++;

        // Emit agent:progress event
        getPipelineEventBus().emitAgentProgress('VerificationAgent', completed, allTables.length);

        try {
          onProgress?.(completed, allTables.length, table.tableId);
        } catch { /* ignore progress errors */ }

        return { result, questionId, index, beforeTable: existingTable };
      } catch (error) {
        // Always close the slot so the CLI/UI doesn't hang.
        const durationMs = Date.now() - startTime;
        getPipelineEventBus().emitSlotComplete('VerificationAgent', slotIndex, table.tableId, durationMs);
        activeSlots.delete(table.tableId);

        // Propagate aborts — cancellation should stop the pipeline.
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }

        // Persist error for post-run diagnostics (best-effort)
        if (outputDir) {
          try {
            await persistAgentErrorAuto({
              outputDir,
              agentName: 'VerificationAgent',
              severity: 'error',
              actionTaken: 'skipped_item',
              itemId: table.tableId,
              error,
              meta: {
                tableId: table.tableId,
                questionId,
                durationMs,
              },
            });
          } catch {
            // ignore
          }
        }

        // Return a safe fallback: passthrough table marked excluded.
        const fallbackTable: ExtendedTableDefinition = {
          ...existingTable,
          rows: existingTable.rows.map((row) => ({ ...row })),
          exclude: true,
          excludeReason: `VerificationAgent failed for this table: ${error instanceof Error ? error.message : String(error)}`.substring(0, 500),
        };
        const fallback: VerificationAgentOutput = {
          tables: [fallbackTable],
          changes: [],
          confidence: 0,
          userSummary: 'Verification failed; table marked excluded.',
        };

        completed++;
        getPipelineEventBus().emitAgentProgress('VerificationAgent', completed, allTables.length);
        try {
          onProgress?.(completed, allTables.length, table.tableId);
        } catch { /* ignore progress errors */ }

        return { result: fallback, questionId, index, beforeTable: existingTable };
      }
    })
  );

  const resolvedResults = await Promise.all(resultPromises);

  // Sort by original index to maintain order
  resolvedResults.sort((a, b) => a.index - b.index);

  // Aggregate results
  const results = resolvedResults.map((r) => r.result);
  const questionIdByIndex = resolvedResults.map((r) => r.questionId);
  const beforeTablesByIndex = resolvedResults.map((r) => r.beforeTable);

  // Aggregate scratchpad entries from all contexts
  const contextEntries = getAllContextScratchpadEntries('VerificationAgent');
  const allScratchpadEntries = contextEntries.flatMap((ctx) =>
    ctx.entries.map((e) => ({ ...e, contextId: ctx.contextId }))
  );
  logEntry(`[VerificationAgent] Collected ${allScratchpadEntries.length} scratchpad entries from ${contextEntries.length} contexts`);

  // Combine all verified tables, attaching questionId from the tracked array
  const allVerifiedTables: ExtendedTableDefinition[] = results.flatMap((r, i) =>
    r.tables.map((t) => ({ ...t, questionId: questionIdByIndex[i] }))
  );

  const editReports: VerificationEditReport[] = results.flatMap((result, index) => {
    const before = beforeTablesByIndex[index];
    const kindCounts = (result as VerificationAgentOutput & { _operationKindCounts?: Record<string, number> })._operationKindCounts;
    return result.tables.map((after) => buildVerificationEditReport(before, after, result.confidence, kindCounts));
  });

  // Collect all changes
  const allChanges = results
    .map((r, i) => ({
      tableId: allTables[i].table.tableId,
      changes: r.changes,
    }))
    .filter((c) => c.changes.length > 0);

  // Calculate metadata
  const metadata = summarizeVerificationResults(results);

  logEntry(
    `[VerificationAgent] Parallel processing complete - ${allTables.length} input → ${allVerifiedTables.length} output tables`
  );
  logEntry(
    `[VerificationAgent] Modified: ${metadata.tablesModified}, Split: ${metadata.tablesSplit}, Excluded: ${metadata.tablesExcluded}`
  );

  const verificationResults: VerificationResults = {
    tables: allVerifiedTables,
    metadata,
    allChanges,
  };

  // Save outputs
  if (outputDir) {
    // Map context entries to the expected format for saveDevelopmentOutputs
    const scratchpadEntries = allScratchpadEntries.map((e) => ({
      timestamp: e.timestamp,
      agentName: e.agentName,
      action: e.action,
      content: `[${e.contextId}] ${e.content}`,
    }));
    await saveDevelopmentOutputs(
      verificationResults,
      outputDir,
      processingLog,
      scratchpadEntries,
      editReports,
    );
  }

  return verificationResults;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get formatted datamap context for variables in a table
 */
function getDatamapContextForTable(
  table: TableDefinition,
  datamapByColumn: Map<string, VerboseDataMapType>
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
  ${entry.allowedValues ? `Allowed Values: ${entry.allowedValues.join(', ')}` : ''}`
      );
    }
  }

  return entries.length > 0 ? entries.join('\n\n') : 'No datamap context available';
}

/**
 * Get non-excluded tables from results
 */
export function getIncludedTables(results: VerificationResults): ExtendedTableDefinition[] {
  return results.tables.filter((t) => !t.exclude);
}

/**
 * Get excluded tables from results
 */
export function getExcludedTables(results: VerificationResults): ExtendedTableDefinition[] {
  return results.tables.filter((t) => t.exclude);
}

// =============================================================================
// Development Outputs
// =============================================================================

async function saveDevelopmentOutputs(
  results: VerificationResults,
  outputDir: string,
  processingLog: string[],
  scratchpadEntries: Array<{ timestamp: string; agentName: string; action: string; content: string }>,
  editReports: VerificationEditReport[],
): Promise<void> {
  try {
    // Create verification subfolder for all VerificationAgent outputs
    const verificationDir = path.join(outputDir, 'verification');
    await fs.mkdir(verificationDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Save verified table output
    const filename = `verified-table-output-${timestamp}.json`;
    const filePath = path.join(verificationDir, filename);

    const enhancedOutput = {
      ...results,
      processingInfo: {
        timestamp: new Date().toISOString(),
        aiProvider: 'azure-openai',
        model: getVerificationModelName(),
        reasoningEffort: getVerificationReasoningEffort(),
        processingLog,
      },
    };

    await fs.writeFile(filePath, JSON.stringify(enhancedOutput, null, 2), 'utf-8');
    console.log(`[VerificationAgent] Development output saved to verification/: ${filename}`);

    // Save raw output (complete model output - for golden dataset comparison)
    // This includes tables and allChanges (model decisions), but NOT metadata (system-calculated)
    const rawOutput = {
      tables: results.tables,
      allChanges: results.allChanges,
    };
    const rawPath = path.join(verificationDir, 'verification-output-raw.json');
    await fs.writeFile(rawPath, JSON.stringify(rawOutput, null, 2), 'utf-8');

    const editReportPath = path.join(verificationDir, 'verification-edit-reports.json');
    await fs.writeFile(editReportPath, JSON.stringify(editReports, null, 2), 'utf-8');

    // Save scratchpad trace as separate markdown file
    if (scratchpadEntries.length > 0) {
      const scratchpadFilename = `scratchpad-verification-${timestamp}.md`;
      const scratchpadPath = path.join(verificationDir, scratchpadFilename);
      const markdown = formatScratchpadAsMarkdown('VerificationAgent', scratchpadEntries);
      await fs.writeFile(scratchpadPath, markdown, 'utf-8');
      console.log(`[VerificationAgent] Scratchpad saved to verification/: ${scratchpadFilename}`);
    }
  } catch (error) {
    console.error('[VerificationAgent] Failed to save development outputs:', error);
  }
}
