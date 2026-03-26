/**
 * V3 Runtime — Banner Plan (Stage 20)
 *
 * Produces a canonical banner plan artifact for downstream step 21 (crosstab plan).
 *
 * Routing logic:
 *   1. If a banner document exists in the dataset → BannerAgent extracts structure.
 *   2. If BannerAgent fails or returns 0 groups/columns → fallback to BannerGenerateAgent.
 *   3. If no banner document exists at all → BannerGenerateAgent directly.
 *
 * BannerGenerateAgent input resolution:
 *   - Prefers V2 question-centric path (buildBannerContext → generateBannerCutsWithValidationV2)
 *   - Falls back to V1 flat datamap path (.sav → DataMapProcessor → generateBannerCutsWithValidation)
 *     only when no questionid-enriched entries are available
 *
 * This module contains ONLY the core planning/transformation logic.
 * CLI wrapper, reporting, and run-directory discovery are NOT included.
 *
 * See: scripts/v3-enrichment/20-banner-plan.ts (reference script)
 */

import { BannerAgent } from '@/agents/BannerAgent';
import {
  generateBannerCutsWithValidation,
  generateBannerCutsWithValidationV2,
} from '@/agents/BannerGenerateAgent';
import { findDatasetFiles } from '@/lib/pipeline/FileDiscovery';
import type { VerboseDataMap } from '@/lib/processors/DataMapProcessor';
import { DataMapProcessor } from '@/lib/processors/DataMapProcessor';
import { getDataFileStats, convertToRawVariables } from '@/lib/validation/RDataReader';
import { buildBannerContext } from '@/lib/questionContext/adapters';
import type { BannerQuestionSummary } from '@/schemas/questionContextSchema';
import type { BannerPlanInputType } from '@/schemas/bannerPlanSchema';

import type {
  QuestionIdEntry,
  SurveyMetadata,
  BannerRouteUsed,
  BannerGenerateInputSource,
  BannerRouteMetadata,
  BannerPlanResult,
} from './types';

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Shape of BannerAgent's extractedStructure — matches the raw banner output
 * with full column metadata (stat letters, confidence, etc.).
 */
interface BannerRawLike {
  bannerCuts: Array<{
    groupName: string;
    columns: Array<{
      name: string;
      original: string;
      adjusted: string;
      statLetter: string;
      confidence: number;
      requiresInference: boolean;
      reasoning: string;
      uncertainties: string[];
    }>;
  }>;
}

interface BannerGenerateResolution {
  source: BannerGenerateInputSource;
  generate: (args: {
    researchObjectives?: string;
    cutSuggestions?: string;
    projectType?: string;
    outputDir: string;
    abortSignal?: AbortSignal;
  }) => Promise<{ agent: Array<{ groupName: string; columns: Array<{ name: string; original: string }> }>; confidence: number }>;
}

// =============================================================================
// Input Types
// =============================================================================

export interface BannerPlanInput {
  /** Enriched question-id entries from stage 12. */
  entries: QuestionIdEntry[];
  /** Survey-level metadata. */
  metadata: SurveyMetadata;
  /** Path to .sav file (fallback for BannerGenerateAgent). */
  savPath: string;
  /** Path to dataset directory (for FileDiscovery). */
  datasetPath: string;
  /** Output directory for agent artifacts. */
  outputDir: string;
  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;
  /** Optional row cap for demo mode. */
  maxRespondents?: number;
  /** Optional research objectives hint. */
  researchObjectives?: string;
  /** Optional cut suggestions. */
  cutSuggestions?: string;
  /** Optional project type hint. */
  projectType?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/** Extract the canonical plan shape from a BannerAgent raw structure. */
function toCanonicalPlan(raw: BannerRawLike): BannerPlanInputType {
  return {
    bannerCuts: raw.bannerCuts.map(group => ({
      groupName: group.groupName,
      columns: group.columns.map(column => ({
        name: column.name,
        original: column.original,
      })),
    })),
  };
}

/** Build VerboseDataMap[] from .sav file via R + DataMapProcessor. */
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

/**
 * Resolve how BannerGenerateAgent should be called.
 *
 * Prefers V2 question-centric path when enriched entries are available.
 * Falls back to V1 flat datamap path from .sav when no questionid data exists.
 */
function resolveBannerGenerateInput(
  entries: QuestionIdEntry[],
  savPath: string,
  outputDir: string,
  maxRespondents?: number,
): BannerGenerateResolution {
  // Build question-level context from enriched entries
  const questionFile = { questionIds: entries };
  const bannerContext: BannerQuestionSummary[] = buildBannerContext(questionFile);

  if (bannerContext.length > 0) {
    return {
      source: 'questionid_reportable',
      generate: (args) => generateBannerCutsWithValidationV2({
        questionContext: bannerContext,
        researchObjectives: args.researchObjectives,
        cutSuggestions: args.cutSuggestions,
        projectType: args.projectType,
        outputDir: args.outputDir,
        abortSignal: args.abortSignal,
      }),
    };
  }

  // No enriched question data — fall back to V1 path from .sav
  return {
    source: 'sav_verbose_datamap',
    generate: async (args) => {
      const verboseDataMap = await buildVerboseDataMapFromSav(savPath, outputDir, maxRespondents);
      return generateBannerCutsWithValidation({
        verboseDataMap,
        researchObjectives: args.researchObjectives,
        cutSuggestions: args.cutSuggestions,
        projectType: args.projectType,
        outputDir: args.outputDir,
        abortSignal: args.abortSignal,
      });
    },
  };
}

// =============================================================================
// Main Runner
// =============================================================================

/**
 * Run banner plan (stage 20).
 *
 * Routes between BannerAgent (document extraction) and BannerGenerateAgent
 * (AI generation from datamap), producing a canonical BannerPlanInputType.
 *
 * @returns BannerPlanResult with canonical plan and route metadata.
 * @throws If both routes fail to produce a non-empty banner plan.
 */
export async function runBannerPlan(input: BannerPlanInput): Promise<BannerPlanResult> {
  const files = await findDatasetFiles(input.datasetPath);

  let routeUsed: BannerRouteUsed | null = null;
  let usedFallbackFromBannerAgent = false;
  let canonicalPlan: BannerPlanInputType | null = null;
  let sourceConfidence = 0;
  let bannerGenerateInputSource: BannerGenerateInputSource | null = null;
  let fallbackGroupNames: string[] = [];

  // ── Route 1: BannerAgent (document extraction) ──────────────────────
  if (files.banner) {
    const bannerAgent = new BannerAgent();
    const bannerResult = await bannerAgent.processDocument(
      files.banner,
      input.outputDir,
      input.abortSignal,
    );
    const extracted = bannerResult.verbose?.data?.extractedStructure as BannerRawLike | undefined;
    const groupCount = extracted?.bannerCuts?.length || 0;
    const columnCount = extracted?.bannerCuts?.reduce(
      (sum, g) => sum + g.columns.length, 0,
    ) || 0;

    if (groupCount > 0 && extracted) {
      fallbackGroupNames = extracted.bannerCuts
        .map(g => g.groupName)
        .filter(Boolean);
    }

    if (bannerResult.success && extracted && groupCount > 0 && columnCount > 0) {
      routeUsed = 'banner_agent';
      canonicalPlan = toCanonicalPlan(extracted);
      sourceConfidence = bannerResult.confidence;
    } else {
      usedFallbackFromBannerAgent = true;
      // BannerAgent failed or returned incomplete output — fall through to generate
    }
  }

  // ── Route 2: BannerGenerateAgent (AI generation) ────────────────────
  if (!canonicalPlan) {
    const groupHint =
      fallbackGroupNames.length > 0
        ? `Create banner cuts for these groups: ${fallbackGroupNames.join(', ')}`
        : '';
    const combinedCutSuggestions =
      groupHint && input.cutSuggestions
        ? `${input.cutSuggestions}\n\n${groupHint}`
        : groupHint || input.cutSuggestions;

    const resolution = resolveBannerGenerateInput(
      input.entries,
      input.savPath,
      input.outputDir,
      input.maxRespondents,
    );
    bannerGenerateInputSource = resolution.source;

    const generated = await resolution.generate({
      researchObjectives: input.researchObjectives,
      cutSuggestions: combinedCutSuggestions,
      projectType: input.projectType,
      outputDir: input.outputDir,
      abortSignal: input.abortSignal,
    });

    routeUsed = 'banner_generate';
    canonicalPlan = {
      bannerCuts: generated.agent.map(group => ({
        groupName: group.groupName,
        columns: group.columns.map(col => ({
          name: col.name,
          original: col.original,
        })),
      })),
    };
    sourceConfidence = generated.confidence;
  }

  if (!routeUsed || !canonicalPlan) {
    throw new Error('Banner plan: both routes failed to produce output.');
  }

  const groupCount = canonicalPlan.bannerCuts.length;
  const columnCount = canonicalPlan.bannerCuts.reduce(
    (sum, g) => sum + g.columns.length, 0,
  );

  if (groupCount === 0 || columnCount === 0) {
    throw new Error(
      `Banner plan produced empty output: ${groupCount} groups, ${columnCount} columns.`,
    );
  }

  const routeMetadata: BannerRouteMetadata = {
    routeUsed,
    bannerFile: files.banner,
    generatedAt: new Date().toISOString(),
    groupCount,
    columnCount,
    sourceConfidence,
    usedFallbackFromBannerAgent,
    bannerGenerateInputSource,
  };

  return { bannerPlan: canonicalPlan, routeMetadata };
}
