/**
 * V3 Runtime — Crosstab Plan (Stage 21)
 *
 * Builds a crosstab-validated banner plan from:
 *   - Step 20 banner-plan.json (canonical banner groups/columns)
 *   - Step 12 questionid-final entries (adapted into QuestionContext)
 *
 * Key behavior:
 *   - Uses question-centric adapters (buildQuestionContext) for rich AI context
 *   - Falls back to BannerGenerateAgent when banner groups have 0 columns
 *   - Runs CrosstabAgentV2 (processAllGroupsV2) with production_v3 prompt
 *   - Propagates abort signal to the underlying agent
 *
 * This module contains ONLY the core planning/transformation logic.
 * CLI wrapper, reporting, and run-directory discovery are NOT included.
 *
 * See: scripts/v3-enrichment/21-crosstab-plan.ts (reference script)
 */

import { processAllGroupsV2 } from '@/agents/CrosstabAgentV2';
import {
  generateBannerCutsWithValidation,
  generateBannerCutsWithValidationV2,
} from '@/agents/BannerGenerateAgent';
import { findDatasetFiles } from '@/lib/pipeline/FileDiscovery';
import type { VerboseDataMap } from '@/lib/processors/DataMapProcessor';
import { DataMapProcessor } from '@/lib/processors/DataMapProcessor';
import { getDataFileStats, convertToRawVariables } from '@/lib/validation/RDataReader';
import {
  buildQuestionContext,
  buildBannerContext,
  deriveLoopIterationCount,
} from '@/lib/questionContext/adapters';
import type { BannerPlanInputType } from '@/schemas/bannerPlanSchema';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';

import type {
  QuestionIdEntry,
  SurveyMetadata,
  CrosstabPlanResult,
  ResolvedBannerPlanInfo,
  CrosstabFallbackReason,
  BannerPlanSource,
} from './types';

// =============================================================================
// Input Types
// =============================================================================

export interface CrosstabPlanInput {
  /** Enriched question-id entries from stage 12. */
  entries: QuestionIdEntry[];
  /** Survey-level metadata. */
  metadata: SurveyMetadata;
  /** Banner plan from step 20. */
  bannerPlan: BannerPlanInputType;
  /** Path to .sav file (fallback for banner regeneration). */
  savPath: string;
  /** Path to dataset directory (for FileDiscovery). */
  datasetPath: string;
  /** Output directory for agent artifacts. */
  outputDir: string;
  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;
  /** Optional row cap for demo mode. */
  maxRespondents?: number;
  /** Optional research objectives hint for banner fallback. */
  researchObjectives?: string;
  /** Optional cut suggestions for banner fallback. */
  cutSuggestions?: string;
  /** Optional project type hint for banner fallback. */
  projectType?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function countBannerColumns(plan: BannerPlanInputType): number {
  return plan.bannerCuts.reduce((sum, group) => sum + group.columns.length, 0);
}

/** Build VerboseDataMap[] from .sav via R + DataMapProcessor. */
async function buildVerboseDataMapFromSav(
  spssPath: string,
  outputDir: string,
  maxRespondents?: number,
): Promise<VerboseDataMap[]> {
  const dataStats = await getDataFileStats(spssPath, outputDir, {
    maxRows: maxRespondents,
  });
  const raw = convertToRawVariables(dataStats);
  const processor = new DataMapProcessor();
  const enriched = processor.enrichVariables(raw);
  return enriched.verbose;
}

function calculateAverageConfidence(result: ValidationResultType): number {
  const columns = result.bannerCuts.flatMap(group => group.columns);
  if (columns.length === 0) return 0;
  const total = columns.reduce((sum, col) => sum + col.confidence, 0);
  return total / columns.length;
}

/**
 * Resolve the banner plan for crosstab processing.
 * If step-20's plan has groups but 0 columns, fall back to BannerGenerateAgent.
 */
async function resolveBannerPlan(args: {
  entries: QuestionIdEntry[];
  bannerPlan: BannerPlanInputType;
  savPath: string;
  datasetPath: string;
  outputDir: string;
  abortSignal?: AbortSignal;
  maxRespondents?: number;
  researchObjectives?: string;
  cutSuggestions?: string;
  projectType?: string;
}): Promise<{
  plan: BannerPlanInputType;
  info: ResolvedBannerPlanInfo;
}> {
  const originalGroupCount = args.bannerPlan.bannerCuts.length;
  const originalColumnCount = countBannerColumns(args.bannerPlan);

  // Happy path: step-20 plan has groups with columns
  if (originalGroupCount > 0 && originalColumnCount > 0) {
    return {
      plan: args.bannerPlan,
      info: {
        source: 'step20',
        fallbackUsed: false,
        fallbackReason: null,
        originalGroupCount,
        originalColumnCount,
        finalGroupCount: originalGroupCount,
        finalColumnCount: originalColumnCount,
      },
    };
  }

  // Fallback: regenerate banner using BannerGenerateAgent
  // Build group-name hints from step-20 plan (preserve group structure even if columns were empty)
  const groupNames = args.bannerPlan.bannerCuts
    .map(group => group.groupName)
    .filter(Boolean);
  const groupHint = groupNames.length > 0
    ? `Create banner cuts for these groups: ${groupNames.join(', ')}`
    : '';
  const combinedCutSuggestions = groupHint && args.cutSuggestions
    ? `${args.cutSuggestions}\n\n${groupHint}`
    : groupHint || args.cutSuggestions;

  // Prefer V2 (question-centric) when enriched entries are available;
  // fall back to V1 (flat datamap from .sav) otherwise
  const questionFile = { questionIds: args.entries };
  const bannerContext = buildBannerContext(questionFile);

  let generated: { agent: Array<{ groupName: string; columns: Array<{ name: string; original: string }> }>; confidence: number };
  if (bannerContext.length > 0) {
    generated = await generateBannerCutsWithValidationV2({
      questionContext: bannerContext,
      researchObjectives: args.researchObjectives,
      cutSuggestions: combinedCutSuggestions,
      projectType: args.projectType,
      outputDir: args.outputDir,
      abortSignal: args.abortSignal,
    });
  } else {
    const files = await findDatasetFiles(args.datasetPath);
    const verboseDataMap = await buildVerboseDataMapFromSav(files.spss, args.outputDir, args.maxRespondents);
    generated = await generateBannerCutsWithValidation({
      verboseDataMap,
      researchObjectives: args.researchObjectives,
      cutSuggestions: combinedCutSuggestions,
      projectType: args.projectType,
      outputDir: args.outputDir,
      abortSignal: args.abortSignal,
    });
  }

  const generatedPlan: BannerPlanInputType = {
    bannerCuts: generated.agent.map(group => ({
      groupName: group.groupName,
      columns: group.columns.map(col => ({
        name: col.name,
        original: col.original,
      })),
    })),
  };

  const finalGroupCount = generatedPlan.bannerCuts.length;
  const finalColumnCount = countBannerColumns(generatedPlan);

  if (finalGroupCount === 0 || finalColumnCount === 0) {
    throw new Error(
      `Banner fallback failed: generated ${finalGroupCount} groups and ${finalColumnCount} columns.`,
    );
  }

  const fallbackReason: CrosstabFallbackReason =
    originalGroupCount > 0 && originalColumnCount === 0
      ? 'groups_without_columns'
      : 'empty_banner_plan';

  return {
    plan: generatedPlan,
    info: {
      source: 'fallback_generate' as BannerPlanSource,
      fallbackUsed: true,
      fallbackReason,
      originalGroupCount,
      originalColumnCount,
      finalGroupCount,
      finalColumnCount,
    },
  };
}

// =============================================================================
// Main Runner
// =============================================================================

/**
 * Run crosstab plan (stage 21).
 *
 * Builds question context from enriched entries, resolves the banner plan
 * (with fallback), then runs CrosstabAgentV2 to validate/generate R expressions
 * for every banner column.
 *
 * @returns CrosstabPlanResult with validated crosstab plan and metadata.
 * @throws If no reportable questions found or crosstab processing fails.
 */
export async function runCrosstabPlan(input: CrosstabPlanInput): Promise<CrosstabPlanResult> {
  const questionFile = { questionIds: input.entries };

  // Build question-centric context
  const questions = buildQuestionContext(questionFile);
  if (questions.length === 0) {
    throw new Error('No reportable questions found for crosstab planning.');
  }

  const loopIterationCount = deriveLoopIterationCount(questionFile);

  // Resolve banner plan (with fallback if step-20 was incomplete)
  const resolved = await resolveBannerPlan({
    entries: input.entries,
    bannerPlan: input.bannerPlan,
    savPath: input.savPath,
    datasetPath: input.datasetPath,
    outputDir: input.outputDir,
    abortSignal: input.abortSignal,
    maxRespondents: input.maxRespondents,
    researchObjectives: input.researchObjectives,
    cutSuggestions: input.cutSuggestions,
    projectType: input.projectType,
  });

  // Run CrosstabAgentV2
  const { result: crosstabPlan, scratchpadByGroup } = await processAllGroupsV2(
    questions,
    resolved.plan,
    input.outputDir,
    undefined, // onProgress — not wired in runtime (no CLI)
    input.abortSignal,
    loopIterationCount,
  );

  const variableCount = questions.reduce((sum, q) => sum + q.items.length, 0);
  const averageConfidence = calculateAverageConfidence(crosstabPlan);

  return {
    crosstabPlan,
    resolvedBannerPlan: resolved.plan,
    resolvedBannerPlanInfo: resolved.info,
    questions,
    loopIterationCount,
    questionCount: questions.length,
    variableCount,
    averageConfidence,
    scratchpadByGroup,
  };
}
