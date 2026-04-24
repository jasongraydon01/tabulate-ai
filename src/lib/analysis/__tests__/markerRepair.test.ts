import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  buildAnalysisSystemMessage: vi.fn(() => ({ role: "system", content: "system prompt" })),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    convertToModelMessages: vi.fn(async (messages) => messages),
    generateText: mocks.generateText,
  };
});

vi.mock("@/lib/analysis/model", () => ({
  getAnalysisModel: vi.fn(() => "model-instance"),
  getAnalysisProviderOptions: vi.fn(() => undefined),
}));

vi.mock("@/lib/analysis/promptPrefix", () => ({
  buildAnalysisSystemMessage: mocks.buildAnalysisSystemMessage,
}));

describe("attemptAnalysisMarkerRepair", () => {
  let attemptAnalysisMarkerRepair: typeof import("@/lib/analysis/markerRepair").attemptAnalysisMarkerRepair;

  beforeEach(async () => {
    if (!attemptAnalysisMarkerRepair) {
      ({ attemptAnalysisMarkerRepair } = await import("@/lib/analysis/markerRepair"));
    }
    vi.clearAllMocks();
  });

  it("uses a structured system message with anthropic cache control", async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: "Corrected answer.",
    });

    const groundingContext = {
      availability: "available" as const,
      missingArtifacts: [],
      questions: [],
      surveyQuestions: [],
      surveyMarkdown: null,
      bannerPlanGroups: [],
      projectContext: {
        projectName: "TabulateAI Study",
        runStatus: "success",
        studyMethodology: null,
        analysisMethod: null,
        bannerSource: null,
        bannerMode: null,
        tableCount: null,
        bannerGroupCount: null,
        totalCuts: null,
        bannerGroupNames: [],
        researchObjectives: null,
        bannerHints: null,
        intakeFiles: {
          dataFile: null,
          survey: null,
          bannerPlan: null,
          messageList: null,
        },
      },
    };

    const result = await attemptAnalysisMarkerRepair({
      groundingContext,
      conversationMessages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Show me awareness" }] }],
      failedAssistantText: "Old answer",
      renderIssues: [],
      citeIssues: [{
        raw: "[[cite cellIds=abc]]",
        reason: "not_confirmed_this_turn",
        cellIds: ["abc"],
        unconfirmedCellIds: ["abc"],
      }],
      fetchedTableIds: [],
      confirmedCellIds: [],
      catalogSampleTableIds: [],
    });

    expect(result).toBe("Corrected answer.");
    expect(mocks.buildAnalysisSystemMessage).toHaveBeenCalledWith(groundingContext, {
      cacheControl: "ephemeral",
    });
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      system: { role: "system", content: "system prompt" },
    }));
  });
});
