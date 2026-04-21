import { ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION } from "./production";
import { ANALYSIS_AGENT_INSTRUCTIONS_ALTERNATIVE } from "./alternative";

export const getAnalysisPrompt = (version?: string): string => {
  const promptVersion = version || process.env.ANALYSIS_PROMPT_VERSION || "production";

  switch (promptVersion) {
    case "alternative":
      return ANALYSIS_AGENT_INSTRUCTIONS_ALTERNATIVE;
    case "production":
    default:
      return ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION;
  }
};

export interface AnalysisQuestionCatalogEntry {
  questionId: string;
  questionText: string | null;
  normalizedType: string | null;
  analyticalSubtype?: string | null;
}

const QUESTION_TEXT_MAX_LENGTH = 140;

function normalizeCatalogWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateQuestionText(value: string): string {
  const cleaned = normalizeCatalogWhitespace(value);
  if (cleaned.length <= QUESTION_TEXT_MAX_LENGTH) return cleaned;
  return `${cleaned.slice(0, QUESTION_TEXT_MAX_LENGTH - 1).trimEnd()}…`;
}

function formatCatalogType(entry: AnalysisQuestionCatalogEntry): string | null {
  const subtype = entry.analyticalSubtype?.trim();
  const normalized = entry.normalizedType?.trim();
  if (subtype && normalized && subtype !== normalized) {
    return `${normalized}/${subtype}`;
  }
  return subtype || normalized || null;
}

export function buildAnalysisQuestionCatalog(
  questions: AnalysisQuestionCatalogEntry[],
): string {
  const lines: string[] = [];
  for (const question of questions) {
    const questionId = question.questionId?.trim();
    if (!questionId) continue;

    const type = formatCatalogType(question);
    const textSource = question.questionText && question.questionText.trim().length > 0
      ? question.questionText
      : null;
    const text = textSource ? truncateQuestionText(textSource) : "";

    const typeSegment = type ? ` (${type})` : "";
    const textSegment = text ? `: ${text}` : "";
    lines.push(`- ${questionId}${typeSegment}${textSegment}`);
  }

  return lines.join("\n");
}

export function buildAnalysisInstructions(context: {
  availability: string;
  missingArtifacts: string[];
  runContext: {
    projectName: string | null;
    runStatus: string | null;
    tableCount: number | null;
    bannerGroupCount: number | null;
    totalCuts: number | null;
    bannerGroupNames: string[];
    bannerSource: "uploaded" | "auto_generated" | null;
    researchObjectives: string | null;
    bannerHints: string | null;
    surveyAvailable: boolean;
    bannerPlanAvailable: boolean;
  };
  questionCatalog?: string;
  promptVersion?: string;
}): string {
  const basePrompt = getAnalysisPrompt(context.promptVersion);

  const runContextSection = [
    "<run_context>",
    `Project name: ${context.runContext.projectName ?? "Unknown"}.`,
    `Run status: ${context.runContext.runStatus ?? "Unknown"}.`,
    `Computed tables available: ${context.runContext.tableCount ?? "Unknown"}.`,
    `Banner groups available: ${context.runContext.bannerGroupCount ?? "Unknown"}.`,
    `Total banner cuts available: ${context.runContext.totalCuts ?? "Unknown"}.`,
    `Banner source: ${context.runContext.bannerSource ?? "Unknown"}.`,
    context.runContext.bannerGroupNames.length > 0
      ? `Banner groups: ${context.runContext.bannerGroupNames.join(", ")}.`
      : "Banner groups: unavailable.",
    context.runContext.researchObjectives
      ? `Research objectives: ${context.runContext.researchObjectives}.`
      : "Research objectives: not provided.",
    context.runContext.bannerHints
      ? `Banner hints: ${context.runContext.bannerHints}.`
      : "Banner hints: not provided.",
    `Survey context available: ${context.runContext.surveyAvailable ? "yes" : "no"}.`,
    `Stage-20 banner plan available: ${context.runContext.bannerPlanAvailable ? "yes" : "no"}.`,
    "</run_context>",
  ].join("\n");

  const groundingStatus = (() => {
    if (context.availability === "unavailable") {
      return [
        "<grounding_status>",
        "Grounded run artifacts are not available in this session.",
        "Do not invent run-specific numbers, percentages, subgroup findings, or banner availability.",
        "You can still help with methodology, interpretation approach, and next analytical steps.",
        "</grounding_status>",
      ].join("\n");
    }

    const artifactNote = context.missingArtifacts.length > 0
      ? `Artifact gaps: ${context.missingArtifacts.join(", ")}.`
      : "All grounding artifacts are available.";

    return [
      "<grounding_status>",
      artifactNote,
      "</grounding_status>",
    ].join("\n");
  })();

  const catalogBlock = context.questionCatalog && context.questionCatalog.trim().length > 0
    ? [
        "<question_catalog>",
        "Every question present in this run, with type and wording. Scan this before",
        "searching — if a concept isn't here, it isn't in the run.",
        "",
        context.questionCatalog.trim(),
        "</question_catalog>",
      ].join("\n")
    : null;

  const sections = [basePrompt, runContextSection, groundingStatus];
  if (catalogBlock) sections.push(catalogBlock);

  return sections.join("\n\n");
}

export {
  ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION,
  ANALYSIS_AGENT_INSTRUCTIONS_ALTERNATIVE,
};
