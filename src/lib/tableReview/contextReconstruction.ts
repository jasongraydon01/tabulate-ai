/**
 * @deprecated Legacy Review Tables backend removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not invoke from active code.
 */
/**
 * Pipeline context reconstruction for table regeneration.
 *
 * Downloads and parses pipeline artifacts from R2 to reconstruct the context
 * needed by VerificationAgent for individual table regeneration.
 */
import { downloadFile } from '@/lib/r2/r2';
import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { BannerGroup } from '@/lib/r/RScriptGeneratorV2';
import type { PipelineSummary, CrosstabReviewState } from '@/lib/api/types';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import { buildCutsSpec, type CutsSpec } from '@/lib/tables/CutsSpec';
import type { LoopGroupMapping, LoopVariableMapping } from '@/lib/validation/LoopCollapser';
import type { LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineContext {
  /** All verified tables from the pipeline run */
  verifiedTables: ExtendedTableDefinition[];
  /** Survey markdown (may be null if no survey was provided) */
  surveyMarkdown: string | null;
  /** Verbose datamap entries */
  verboseDataMap: VerboseDataMapType[];
  /** Pipeline summary with config */
  pipelineSummary: PipelineSummary;
  /** Cuts spec built from crosstab agent output (CutDefinition[] with stat letters) */
  cutsSpec: CutsSpec;
  /** Banner groups from metadata */
  bannerGroups: BannerGroup[];
  /** Loop stacking mappings for R generation */
  loopMappings: LoopGroupMapping[];
  /** Optional loop semantics policy */
  loopSemanticsPolicy?: LoopSemanticsPolicy;
}

// ---------------------------------------------------------------------------
// R2 artifact paths
// ---------------------------------------------------------------------------

/** Well-known relative paths in R2 outputs */
const ARTIFACT_PATHS = {
  verificationRaw: 'verification/verification-output-raw.json',
  pipelineSummary: 'pipeline-summary.json',
  tablesJson: 'results/tables.json',
  loopSummary: 'enrichment/loop-summary.json',
  loopSemanticsPolicy: 'agents/loop-semantics/loop-semantics-policy.json',
} as const;

/**
 * Find the crosstab output file path from R2 outputs.
 * May be in different locations depending on pipeline path.
 */
function findCrosstabOutputPath(r2Outputs: Record<string, string>): string | null {
  // Check for review post-output first, then raw output
  const candidates = [
    'review/crosstab-output-post-review.json',
    'planning/traces/crosstab-output-raw.json',
    'crosstab/crosstab-output-raw.json', // legacy
  ];
  for (const path of candidates) {
    if (path in r2Outputs) return path;
  }
  // Check for any crosstab JSON in traces or legacy crosstab folder
  for (const key of Object.keys(r2Outputs)) {
    if (
      (key.startsWith('planning/traces/') || key.startsWith('crosstab/')) &&
      key.endsWith('.json') &&
      !key.includes('scratchpad') &&
      key.includes('crosstab')
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Find the review state file path from R2 outputs.
 * Contains surveyMarkdown and verboseDataMap.
 */
function findReviewStatePath(r2Outputs: Record<string, string>): string | null {
  const candidates = [
    'review/crosstab-review-state.json',
    'crosstab-review-state.json',
  ];
  for (const path of candidates) {
    if (path in r2Outputs) return path;
  }
  // Check for any review JSON that might contain the state
  for (const key of Object.keys(r2Outputs)) {
    if (key.includes('review-state') && key.endsWith('.json')) {
      return key;
    }
  }
  return null;
}

/**
 * Find the verbose datamap file path from R2 outputs.
 */
function findVerboseDatamapPath(r2Outputs: Record<string, string>): string | null {
  for (const key of Object.keys(r2Outputs)) {
    if (key.includes('-verbose-') && key.endsWith('.json')) {
      return key;
    }
  }
  return null;
}

/**
 * Find a persisted survey markdown artifact path from R2 outputs.
 */
function findSurveyMarkdownPath(r2Outputs: Record<string, string>): string | null {
  const candidates = [
    'survey/survey-markdown.md',
    'survey-markdown.md',
  ];
  for (const path of candidates) {
    if (path in r2Outputs) return path;
  }
  return null;
}

interface LoopSummaryGroupJson {
  stackedFrameName: string;
  skeleton: string;
  iterations: string[];
  variables: LoopVariableMapping[];
}

interface LoopSummaryJson {
  groups?: LoopSummaryGroupJson[];
}

function parseLoopSummary(loopSummaryBuf: Buffer | null): LoopGroupMapping[] {
  if (!loopSummaryBuf) return [];
  try {
    const parsed = JSON.parse(loopSummaryBuf.toString('utf-8')) as LoopSummaryJson;
    const groups = parsed.groups ?? [];
    return groups
      .filter(
        (g): g is LoopSummaryGroupJson =>
          !!g &&
          typeof g.stackedFrameName === 'string' &&
          typeof g.skeleton === 'string' &&
          Array.isArray(g.iterations) &&
          Array.isArray(g.variables),
      )
      .map((g) => ({
        stackedFrameName: g.stackedFrameName,
        skeleton: g.skeleton,
        iterations: g.iterations,
        variables: g.variables,
      }));
  } catch (err) {
    console.warn('[contextReconstruction] Failed to parse loop summary:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Reconstruct pipeline context from R2 artifacts.
 *
 * Downloads and parses the minimum set of artifacts needed for
 * VerificationAgent to regenerate individual tables with feedback.
 *
 * @throws Error if critical artifacts are missing
 */
export async function reconstructPipelineContext(
  r2Outputs: Record<string, string>,
): Promise<PipelineContext> {
  // 1. Download verification output (required — contains all verified tables)
  const verificationPath = ARTIFACT_PATHS.verificationRaw;
  if (!(verificationPath in r2Outputs)) {
    throw new Error('Missing required artifact: verification-output-raw.json');
  }

  // 2. Download pipeline summary (required — contains config)
  const summaryPath = ARTIFACT_PATHS.pipelineSummary;
  if (!(summaryPath in r2Outputs)) {
    throw new Error('Missing required artifact: pipeline-summary.json');
  }

  // 3. Find optional artifacts
  const crosstabPath = findCrosstabOutputPath(r2Outputs);
  const reviewStatePath = findReviewStatePath(r2Outputs);
  const verboseDatamapPath = findVerboseDatamapPath(r2Outputs);
  const surveyMarkdownPath = findSurveyMarkdownPath(r2Outputs);
  const tablesJsonPath = ARTIFACT_PATHS.tablesJson;
  // Try new path first, fall back to legacy stages/ path
  const loopSummaryPath = ARTIFACT_PATHS.loopSummary in r2Outputs
    ? ARTIFACT_PATHS.loopSummary
    : 'stages/loop-summary.json';
  const loopSemanticsPath = ARTIFACT_PATHS.loopSemanticsPolicy;

  // Download in parallel
  const [
    verificationBuf,
    summaryBuf,
    crosstabBuf,
    reviewStateBuf,
    verboseDatamapBuf,
    surveyMarkdownBuf,
    tablesJsonBuf,
    loopSummaryBuf,
    loopSemanticsBuf,
  ] =
    await Promise.all([
      downloadFile(r2Outputs[verificationPath]),
      downloadFile(r2Outputs[summaryPath]),
      crosstabPath ? downloadFile(r2Outputs[crosstabPath]).catch(() => null) : Promise.resolve(null),
      reviewStatePath ? downloadFile(r2Outputs[reviewStatePath]).catch(() => null) : Promise.resolve(null),
      verboseDatamapPath ? downloadFile(r2Outputs[verboseDatamapPath]).catch(() => null) : Promise.resolve(null),
      surveyMarkdownPath ? downloadFile(r2Outputs[surveyMarkdownPath]).catch(() => null) : Promise.resolve(null),
      tablesJsonPath in r2Outputs ? downloadFile(r2Outputs[tablesJsonPath]).catch(() => null) : Promise.resolve(null),
      loopSummaryPath in r2Outputs ? downloadFile(r2Outputs[loopSummaryPath]).catch(() => null) : Promise.resolve(null),
      loopSemanticsPath in r2Outputs ? downloadFile(r2Outputs[loopSemanticsPath]).catch(() => null) : Promise.resolve(null),
    ]);

  // Parse verification output
  const verificationRaw = JSON.parse(verificationBuf.toString('utf-8')) as {
    tables: ExtendedTableDefinition[];
    allChanges?: Array<{ tableId: string; changes: string[] }>;
  };

  // Parse pipeline summary
  const pipelineSummary = JSON.parse(summaryBuf.toString('utf-8')) as PipelineSummary;

  // Parse survey markdown and verbose datamap from review state
  let surveyMarkdown: string | null = null;
  let verboseDataMap: VerboseDataMapType[] = [];
  let loopMappings: LoopGroupMapping[] = [];
  let loopSemanticsPolicy: LoopSemanticsPolicy | undefined;

  if (reviewStateBuf) {
    try {
      const reviewState = JSON.parse(reviewStateBuf.toString('utf-8')) as CrosstabReviewState;
      surveyMarkdown = reviewState.surveyMarkdown ?? null;
      if (reviewState.verboseDataMap) {
        verboseDataMap = reviewState.verboseDataMap;
      }
      if (Array.isArray(reviewState.loopMappings)) {
        loopMappings = reviewState.loopMappings as LoopGroupMapping[];
      }
    } catch (err) {
      console.warn('[contextReconstruction] Failed to parse review state:', err);
    }
  }

  // Fallback: try to get verbose datamap from standalone file
  if (verboseDataMap.length === 0 && verboseDatamapBuf) {
    try {
      verboseDataMap = JSON.parse(verboseDatamapBuf.toString('utf-8')) as VerboseDataMapType[];
    } catch (err) {
      console.warn('[contextReconstruction] Failed to parse verbose datamap:', err);
    }
  }

  // Fallback: try standalone survey markdown artifact if review state is unavailable
  if (!surveyMarkdown && surveyMarkdownBuf) {
    const markdown = surveyMarkdownBuf.toString('utf-8').trim();
    surveyMarkdown = markdown.length > 0 ? markdown : null;
  }

  // Fallback: recover loop mappings from loop summary artifact
  if (loopMappings.length === 0) {
    loopMappings = parseLoopSummary(loopSummaryBuf);
  }

  // Optional: loop semantics policy artifact
  if (loopSemanticsBuf) {
    try {
      loopSemanticsPolicy = JSON.parse(loopSemanticsBuf.toString('utf-8')) as LoopSemanticsPolicy;
    } catch (err) {
      console.warn('[contextReconstruction] Failed to parse loop semantics policy:', err);
    }
  }

  // Parse crosstab output for cuts spec (builds CutDefinition[] with stat letters)
  let cutsSpec: CutsSpec = { cuts: [], groups: [], totalCut: null };
  let bannerGroups: BannerGroup[] = [];

  if (crosstabBuf) {
    try {
      const crosstabRaw = JSON.parse(crosstabBuf.toString('utf-8'));
      if (crosstabRaw.bannerCuts) {
        cutsSpec = buildCutsSpec(crosstabRaw as ValidationResultType);
      }
    } catch (err) {
      console.warn('[contextReconstruction] Failed to parse crosstab output:', err);
    }
  }

  // Get banner groups from tables.json metadata (authoritative source)
  if (tablesJsonBuf) {
    try {
      const tablesJson = JSON.parse(tablesJsonBuf.toString('utf-8'));
      if (tablesJson.metadata?.bannerGroups) {
        bannerGroups = tablesJson.metadata.bannerGroups;
      }
    } catch {
      // ignore
    }
  }

  return {
    verifiedTables: verificationRaw.tables,
    surveyMarkdown,
    verboseDataMap,
    pipelineSummary,
    cutsSpec,
    bannerGroups,
    loopMappings,
    ...(loopSemanticsPolicy ? { loopSemanticsPolicy } : {}),
  };
}
