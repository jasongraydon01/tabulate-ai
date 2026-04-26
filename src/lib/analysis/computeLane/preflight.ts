import { processGroupV2 } from '@/agents/CrosstabAgentV2';
import { draftAnalysisBannerExtensionGroup } from '@/agents/AnalysisBannerExtensionAgent';
import type { AnalysisGroundingContext } from '@/lib/analysis/grounding';
import { getPipelineContext, runWithPipelineContext } from '@/lib/pipeline/PipelineContext';
import { extractAllColumns } from '@/lib/questionContext';
import type { BannerGroupType } from '@/schemas/bannerPlanSchema';
import type { ValidatedGroupType } from '@/schemas/agentOutputSchema';

import { buildAnalysisComputeFingerprint } from './fingerprint';
import { evaluateAnalysisBannerExtensionReviewFlags } from './reviewFlags';
import type { AnalysisBannerExtensionPreflightResult } from './types';
import type { AnalysisParentRunArtifacts } from './artifactLoader';

function ensureNoDuplicateGroup(
  existingGroups: Array<{ groupName: string }>,
  group: BannerGroupType,
): void {
  const next = group.groupName.trim().toLowerCase();
  const duplicate = existingGroups.find((entry) => entry.groupName.trim().toLowerCase() === next);
  if (duplicate) {
    throw new Error(`The parent run already has a banner group named "${group.groupName}".`);
  }
}

function buildClarificationValidatedGroup(group: BannerGroupType, reason: string): ValidatedGroupType {
  return {
    groupName: group.groupName,
    columns: group.columns.map((column) => ({
      name: column.name,
      adjusted: `# Clarification required for "${column.original}"`,
      confidence: 0,
      reasoning: reason,
      userSummary: 'Clarification is required before TabulateAI can compute this cut.',
      alternatives: [],
      uncertainties: [reason],
      expressionType: 'placeholder',
    })),
  };
}

function derivePreflightPipelineId(parentRunId: string, outputDir?: string): string {
  const outputFolder = outputDir?.split(/[\\/]/).filter(Boolean).at(-1);
  return outputFolder || `analysis-preflight-${parentRunId}`;
}

export async function runAnalysisBannerExtensionPreflight(params: {
  parentRunId: string;
  requestText: string;
  groundingContext: AnalysisGroundingContext;
  parentArtifacts: AnalysisParentRunArtifacts;
  outputDir?: string;
  abortSignal?: AbortSignal;
}): Promise<AnalysisBannerExtensionPreflightResult> {
  if (params.groundingContext.questions.length === 0) {
    throw new Error('Parent run question context is unavailable; cannot draft a banner extension.');
  }

  const drafted = await draftAnalysisBannerExtensionGroup({
    requestText: params.requestText,
    questions: params.groundingContext.questions,
    existingGroupNames: params.parentArtifacts.bannerPlan.bannerCuts.map((group) => group.groupName),
    projectContext: {
      projectName: params.groundingContext.projectContext.projectName,
      researchObjectives: params.groundingContext.projectContext.researchObjectives,
      bannerHints: params.groundingContext.projectContext.bannerHints,
    },
    abortSignal: params.abortSignal,
  });

  ensureNoDuplicateGroup(params.parentArtifacts.bannerPlan.bannerCuts, drafted.group);

  const allColumns = extractAllColumns(params.groundingContext.questions);
  const loopCount = params.groundingContext.questions.reduce(
    (max, question) => Math.max(max, question.loop?.iterationCount ?? 0),
    0,
  );
  const validateDraftedGroup = () => processGroupV2(
    params.groundingContext.questions,
    allColumns,
    drafted.group,
    {
      abortSignal: params.abortSignal,
      outputDir: params.outputDir,
      loopCount,
    },
  );

  const frozenValidatedGroup = drafted.needsClarification
    ? buildClarificationValidatedGroup(drafted.group, drafted.clarifyingQuestion || drafted.reasoning)
    : getPipelineContext()
      ? await validateDraftedGroup()
      : await runWithPipelineContext(
        {
          pipelineId: derivePreflightPipelineId(params.parentRunId, params.outputDir),
          runId: params.parentRunId,
          source: 'analysisPreflight',
        },
        validateDraftedGroup,
      );

  const reviewFlags = drafted.needsClarification
    ? {
        requiresClarification: true,
        requiresReview: true,
        reasons: [drafted.clarifyingQuestion || drafted.reasoning || 'Clarification is required.'],
        averageConfidence: 0,
        policyFallbackDetected: false,
        draftConfidence: drafted.confidence,
      }
    : evaluateAnalysisBannerExtensionReviewFlags(frozenValidatedGroup, {
        draftConfidence: drafted.confidence,
      });

  const fingerprint = buildAnalysisComputeFingerprint({
    parentRunId: params.parentRunId,
    parentArtifactKeys: params.parentArtifacts.artifactKeys,
    requestText: params.requestText,
    frozenBannerGroup: drafted.group,
    frozenValidatedGroup,
  });

  return {
    jobType: 'banner_extension_recompute',
    requestText: params.requestText,
    frozenBannerGroup: drafted.group,
    frozenValidatedGroup,
    reviewFlags,
    fingerprint,
    promptSummary: drafted.reasoning,
  };
}
