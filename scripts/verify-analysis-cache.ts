import "../src/lib/loadEnv";

import { streamAnalysisResponse } from "../src/lib/analysis/AnalysisAgent";
import { persistedAnalysisMessagesToUIMessages } from "../src/lib/analysis/messages";
import { buildPersistedAnalysisParts } from "../src/lib/analysis/persistence";
import type { AnalysisGroundingContext } from "../src/lib/analysis/grounding";
import { FETCH_TABLE_TOOL_TYPE } from "../src/lib/analysis/toolLabels";
import type { AnalysisUIMessage } from "../src/lib/analysis/ui";

type SupportedProvider = "anthropic" | "openai";

function buildVerificationContext(): AnalysisGroundingContext {
  const questions = Array.from({ length: 80 }, (_, index) => ({
    questionId: `Q${index + 1}`,
    questionText: index === 0
      ? "Overall satisfaction with TabulateAI"
      : `Verification prompt filler question ${index + 1}`,
    normalizedType: "single_punch",
    analyticalSubtype: "standard_overview",
    disposition: "reportable" as const,
    isHidden: false,
    hiddenLink: null,
    loop: null,
    loopQuestionId: null,
    surveyMatch: null,
    baseSummary: {
      situation: "all_respondents",
      signals: ["reported"],
      questionBase: 240,
      totalN: 240,
      itemBaseRange: [240, 240] as [number, number],
    },
    items: [{
      column: `Q${index + 1}`,
      label: `Question ${index + 1}`,
      normalizedType: "single_punch",
      valueLabels: [
        { value: 1, label: "Yes" },
        { value: 2, label: "No" },
      ],
    }],
  }));

  return {
    availability: "available",
    missingArtifacts: [],
    tablesMetadata: {
      significanceTest: "unpooled z-test for column proportions",
      significanceLevel: 0.1,
      comparisonGroups: ["A/B"],
    },
    tables: {
      q1_overall: {
        tableId: "q1_overall",
        questionId: "Q1",
        questionText: "Overall satisfaction with TabulateAI",
        tableType: "frequency",
        baseText: "All respondents",
        tableSubtitle: "Overall",
        data: {
          Total: {
            stat_letter: "T",
            row_0_1: { label: "Very satisfied", n: 240, count: 116, pct: 48.3, isNet: false, indent: 0 },
            row_1_2: { label: "Somewhat satisfied", n: 240, count: 72, pct: 30, isNet: false, indent: 0 },
          },
          Female: {
            stat_letter: "A",
            row_0_1: { label: "Very satisfied", groupName: "Gender", n: 120, count: 66, pct: 55, isNet: false, indent: 0, sig_higher_than: ["B"] },
            row_1_2: { label: "Somewhat satisfied", groupName: "Gender", n: 120, count: 30, pct: 25, isNet: false, indent: 0 },
          },
          Male: {
            stat_letter: "B",
            row_0_1: { label: "Very satisfied", groupName: "Gender", n: 120, count: 50, pct: 41.7, isNet: false, indent: 0, sig_vs_total: "lower" },
            row_1_2: { label: "Somewhat satisfied", groupName: "Gender", n: 120, count: 42, pct: 35, isNet: false, indent: 0 },
          },
        },
      },
    },
    questions,
    bannerGroups: [{
      groupName: "Gender",
      columns: [
        { name: "Female", statLetter: "A", expression: "gender == 1" },
        { name: "Male", statLetter: "B", expression: "gender == 2" },
      ],
    }],
    bannerPlanGroups: [{
      groupName: "Gender",
      columns: [
        { name: "Female", original: "Female" },
        { name: "Male", original: "Male" },
      ],
    }],
    bannerRouteMetadata: null,
    surveyMarkdown: null,
    surveyQuestions: [],
    projectContext: {
      projectName: "TabulateAI Cache Verification",
      runStatus: "success",
      studyMethodology: "Online survey",
      analysisMethod: "Crosstab analysis",
      bannerSource: "uploaded",
      bannerMode: "upload",
      tableCount: 1,
      bannerGroupCount: 1,
      totalCuts: 2,
      bannerGroupNames: ["Gender"],
      researchObjectives: "Verify analysis prompt caching and transport stability.",
      bannerHints: "Prioritize topline and gender cuts.",
      intakeFiles: {
        dataFile: "verification.sav",
        survey: "verification.docx",
        bannerPlan: "verification-banner.xlsx",
        messageList: null,
      },
    },
  };
}

async function runTurn(
  messages: AnalysisUIMessage[],
  groundingContext: AnalysisGroundingContext,
): Promise<{
  responseMessage: AnalysisUIMessage;
  traceCapture: ReturnType<Awaited<ReturnType<typeof streamAnalysisResponse>>["getTraceCapture"]>;
}> {
  const { streamResult, getTraceCapture } = await streamAnalysisResponse({
    messages,
    groundingContext,
  });

  let responseMessage: AnalysisUIMessage | null = null;
  const uiStream = streamResult.toUIMessageStream<AnalysisUIMessage>({
    originalMessages: messages,
    sendReasoning: true,
    sendFinish: false,
    onError: (error) => {
      console.error("analysis stream error:", error);
      return "analysis stream failed";
    },
    onFinish: ({ responseMessage: finalMessage }) => {
      responseMessage = finalMessage;
    },
  });

  for await (const _chunk of uiStream) {
    // Drain the stream to trigger onFinish and usage capture.
  }

  if (!responseMessage) {
    throw new Error("Analysis response finished without a final UI message");
  }

  return {
    responseMessage,
    traceCapture: getTraceCapture(),
  };
}

function roundTripMessages(firstTurnUserText: string, assistantMessage: AnalysisUIMessage): AnalysisUIMessage[] {
  const pending = buildPersistedAnalysisParts(assistantMessage.parts);
  const artifacts: Array<{ _id: string; artifactType: "table_card"; payload: unknown }> = [];
  const persistedParts = pending.map((entry, index) => {
    if (entry.kind === "ready") {
      return entry.part;
    }

    const artifactId = `artifact-${index + 1}`;
    artifacts.push({
      _id: artifactId,
      artifactType: "table_card",
      payload: entry.artifact.payload,
    });

    return {
      type: FETCH_TABLE_TOOL_TYPE,
      state: entry.template.state,
      label: entry.template.label,
      artifactId,
      ...(entry.template.toolCallId ? { toolCallId: entry.template.toolCallId } : {}),
    };
  });

  return persistedAnalysisMessagesToUIMessages(
    [
      {
        _id: "user-1",
        role: "user",
        content: firstTurnUserText,
        parts: [{ type: "text", text: firstTurnUserText }],
      },
      {
        _id: "assistant-1",
        role: "assistant",
        content: assistantMessage.parts
          .filter((part) => part.type === "text")
          .map((part) => ("text" in part ? part.text : ""))
          .join("")
          .trim(),
        parts: persistedParts,
      },
    ],
    artifacts,
  );
}

function ensureProviderConfigured(provider: SupportedProvider): void {
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is required to verify Anthropic analysis caching");
  }

  if (provider === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required to verify OpenAI analysis caching");
  }
}

async function verifyProvider(provider: SupportedProvider) {
  ensureProviderConfigured(provider);
  process.env.ANALYSIS_AI_PROVIDER = provider;

  const groundingContext = buildVerificationContext();
  const firstTurnUserText = [
    "Use grounded tools before answering.",
    "Search the run catalog for Q1 satisfaction, fetch the table, and summarize the total result.",
    "Then mention whether Female is higher than Male if the table shows that.",
  ].join(" ");

  const firstTurnMessages: AnalysisUIMessage[] = [
    {
      id: "turn-1-user",
      role: "user",
      parts: [{ type: "text", text: firstTurnUserText }],
    },
  ];

  console.log(`\n=== ${provider} verification ===`);
  console.log("provider model:", process.env.ANALYSIS_MODEL?.trim() || "(provider default)");

  const firstTurn = await runTurn(firstTurnMessages, groundingContext);
  const allowlistedToolCount = firstTurn.responseMessage.parts.filter((part) => part.type.startsWith("tool-")).length;
  if (allowlistedToolCount === 0) {
    throw new Error(`${provider}: first turn produced no grounded tool parts; cannot verify reload transport`);
  }

  const reloadedMessages = roundTripMessages(firstTurnUserText, firstTurn.responseMessage);
  const secondTurnMessages: AnalysisUIMessage[] = [
    ...reloadedMessages,
    {
      id: "turn-2-user",
      role: "user",
      parts: [{
        type: "text",
        text: "Follow up on the same grounded findings and compare Female versus Male again without re-explaining the setup.",
      }],
    },
  ];

  const secondTurn = await runTurn(secondTurnMessages, groundingContext);

  console.log("turn 1 usage:", firstTurn.traceCapture.usage);
  console.log("turn 2 usage:", secondTurn.traceCapture.usage);

  if ((secondTurn.traceCapture.usage.cachedInputTokens ?? 0) <= 0) {
    throw new Error(`${provider}: turn 2 had zero cached input tokens`);
  }

  if (provider === "anthropic") {
    const cacheWrites = (firstTurn.traceCapture.usage.cacheWriteInputTokens ?? 0)
      + (secondTurn.traceCapture.usage.cacheWriteInputTokens ?? 0);
    if (cacheWrites <= 0) {
      throw new Error("anthropic: no cache write tokens were reported across the first two turns");
    }
  }

  console.log(`${provider}: cache verification passed`);
}

async function main() {
  const requestedProviders = (process.argv[2]?.split(",").map((value) => value.trim()).filter(Boolean) as SupportedProvider[] | undefined)
    ?? ["anthropic", "openai"];

  for (const provider of requestedProviders) {
    if (provider !== "anthropic" && provider !== "openai") {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    await verifyProvider(provider);
  }
}

main().catch((error) => {
  console.error("analysis cache verification failed:", error);
  process.exit(1);
});
