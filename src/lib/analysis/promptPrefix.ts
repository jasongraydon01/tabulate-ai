import type { SystemModelMessage } from "ai";

import type { AnalysisGroundingContext } from "@/lib/analysis/grounding";
import { buildAnalysisInstructions, buildAnalysisQuestionCatalog } from "@/prompts/analysis";

const ANTHROPIC_EPHEMERAL_CACHE_CONTROL = {
  anthropic: {
    cacheControl: { type: "ephemeral" as const },
  },
};

export function buildAnalysisPromptPrefix(
  groundingContext: Pick<
    AnalysisGroundingContext,
    | "availability"
    | "missingArtifacts"
    | "questions"
    | "surveyQuestions"
    | "surveyMarkdown"
    | "bannerPlanGroups"
    | "projectContext"
  >,
): string {
  const questionCatalog = buildAnalysisQuestionCatalog(
    groundingContext.questions.map((question) => ({
      questionId: question.questionId,
      questionText: question.questionText,
      normalizedType: question.normalizedType,
      analyticalSubtype: question.analyticalSubtype ?? null,
    })),
  );

  return buildAnalysisInstructions({
    availability: groundingContext.availability,
    missingArtifacts: groundingContext.missingArtifacts,
    runContext: {
      projectName: groundingContext.projectContext.projectName,
      runStatus: groundingContext.projectContext.runStatus,
      studyMethodology: groundingContext.projectContext.studyMethodology,
      analysisMethod: groundingContext.projectContext.analysisMethod,
      tableCount: groundingContext.projectContext.tableCount,
      bannerGroupCount: groundingContext.projectContext.bannerGroupCount,
      totalCuts: groundingContext.projectContext.totalCuts,
      bannerGroupNames: groundingContext.projectContext.bannerGroupNames,
      bannerSource: groundingContext.projectContext.bannerSource,
      bannerMode: groundingContext.projectContext.bannerMode,
      researchObjectives: groundingContext.projectContext.researchObjectives,
      bannerHints: groundingContext.projectContext.bannerHints,
      intakeFiles: groundingContext.projectContext.intakeFiles,
      surveyAvailable: groundingContext.surveyQuestions.length > 0 || Boolean(groundingContext.surveyMarkdown),
      bannerPlanAvailable: groundingContext.bannerPlanGroups.length > 0,
    },
    questionCatalog,
  });
}

export function buildAnalysisSystemMessage(
  groundingContext: Parameters<typeof buildAnalysisPromptPrefix>[0],
  options?: { cacheControl?: "ephemeral" },
): SystemModelMessage {
  return {
    role: "system",
    content: buildAnalysisPromptPrefix(groundingContext),
    ...(options?.cacheControl
      ? { providerOptions: ANTHROPIC_EPHEMERAL_CACHE_CONTROL }
      : {}),
  };
}

export const ANALYSIS_ANTHROPIC_EPHEMERAL_CACHE_CONTROL_PROVIDER_OPTIONS =
  ANTHROPIC_EPHEMERAL_CACHE_CONTROL;
