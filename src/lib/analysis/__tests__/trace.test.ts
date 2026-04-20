import { promises as fs } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOutputsBaseDir } from "@/lib/paths/outputs";
import {
  sanitizeForTrace,
  serializeAnalysisToolTimeline,
  updateAnalysisTraceIndex,
  writeAnalysisTurnErrorTrace,
  writeAnalysisTurnTrace,
  type AnalysisTraceCapture,
} from "@/lib/analysis/trace";

const mocks = vi.hoisted(() => ({
  uploadRunOutputArtifact: vi.fn(async (_params: unknown) => "r2-key"),
}));

vi.mock("@/lib/r2/R2FileManager", () => ({
  uploadRunOutputArtifact: mocks.uploadRunOutputArtifact,
}));

function makeTraceCapture(): AnalysisTraceCapture {
  return {
    usage: {
      model: "gpt-test",
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      durationMs: 890,
      estimatedCostUsd: 0.0123,
    },
    scratchpadEntries: [
      {
        timestamp: "2026-04-20T12:00:00.000Z",
        action: "add",
        content: "Search the awareness tables first.",
      },
      {
        timestamp: "2026-04-20T12:00:01.000Z",
        action: "review",
        content: "The grouped banner cuts still look relevant.",
      },
    ],
    retryEvents: [
      {
        attempt: 1,
        maxAttempts: 3,
        nextDelayMs: 250,
        lastClassification: "policy",
        lastErrorSummary: "content policy block",
        shouldUsePolicySafeVariant: false,
        possibleTruncation: false,
      },
    ],
    retryAttempts: 2,
    finalClassification: "policy",
    terminalError: null,
  };
}

function makeTableCardPart() {
  return {
    type: "tool-getTableCard" as const,
    toolCallId: "table-1",
    state: "output-available" as const,
    input: {
      tableId: "q1",
      rowFilter: null,
      cutFilter: null,
      valueMode: "pct" as const,
    },
    output: {
      status: "available" as const,
      tableId: "q1",
      title: "Q1 overall",
      questionId: "Q1",
      questionText: "How satisfied are you?",
      tableType: "frequency",
      surveySection: null,
      baseText: "All respondents",
      tableSubtitle: null,
      userNote: null,
      valueMode: "pct" as const,
      columns: [],
      rows: [],
      totalRows: 12,
      totalColumns: 4,
      truncatedRows: 0,
      truncatedColumns: 0,
      requestedRowFilter: null,
      requestedCutFilter: null,
      significanceTest: null,
      significanceLevel: null,
      comparisonGroups: [],
      sourceRefs: [],
    },
  };
}

describe("analysis trace helpers", () => {
  let tempRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(getOutputsBaseDir(), "analysis-trace-test-"));
    outputDir = path.join(tempRoot, "dataset-a", "pipeline-a");
    await fs.mkdir(outputDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("sanitizes nested values and marks truncation", () => {
    const longString = `${"<unsafe>".repeat(250)}tail`;
    const objectWithManyKeys = Object.fromEntries(
      Array.from({ length: 35 }, (_, index) => [`key-${index}`, index]),
    );

    const sanitized = sanitizeForTrace({
      text: longString,
      list: Array.from({ length: 25 }, (_, index) => ({ index })),
      object: objectWithManyKeys,
      deep: { one: { two: { three: { four: { five: "hidden" } } } } },
    }) as Record<string, unknown>;

    expect((sanitized.text as string)).not.toContain("<");
    expect((sanitized.text as string)).toContain("[TRUNCATED]");
    expect((sanitized.list as unknown[])).toHaveLength(21);
    expect((sanitized.object as Record<string, unknown>).__truncated__).toBe("[TRUNCATED]");
    expect(sanitized.deep).toEqual({
      one: {
        two: {
          three: "[TRUNCATED]",
        },
      },
    });
  });

  it("serializes tool timeline in order and compacts table card outputs", () => {
    const timeline = serializeAnalysisToolTimeline([
      {
        type: "tool-searchRunCatalog",
        toolCallId: "search-1",
        state: "output-available",
        input: { query: "satisfaction <raw>" },
        output: { matches: Array.from({ length: 25 }, (_, index) => `Q${index}`) },
      } as const,
      makeTableCardPart(),
    ]);

    expect(timeline).toEqual([
      {
        toolName: "tool-searchRunCatalog",
        toolCallId: "search-1",
        state: "output-available",
        inputPreview: { query: "satisfaction raw" },
        outputPreview: {
          matches: [
            "Q0", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9",
            "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", "Q16", "Q17", "Q18", "Q19",
            "[TRUNCATED]",
          ],
        },
      },
      {
        toolName: "tool-getTableCard",
        toolCallId: "table-1",
        state: "output-available",
        inputPreview: {
          tableId: "q1",
          rowFilter: null,
          cutFilter: null,
          valueMode: "pct",
        },
        outputPreview: {
          status: "available",
          tableId: "q1",
          questionId: "Q1",
          title: "Q1 overall",
          totalRows: 12,
          totalColumns: 4,
          truncatedRows: 0,
          truncatedColumns: 0,
          valueMode: "pct",
        },
      },
    ]);
  });

  it("writes a successful analysis turn trace and updates the index deterministically", async () => {
    const relativePath = await writeAnalysisTurnTrace({
      runResultValue: { outputDir },
      orgId: "org-1",
      projectId: "project-1",
      runId: "run-1",
      sessionId: "session-1",
      sessionTitle: "Audit Session",
      messageId: "assistant-1",
      createdAt: "2026-04-20T12:00:02.000Z",
      assistantText: "Here is the answer.",
      responseParts: [
        { type: "reasoning", text: "First check the grounded survey wording." },
        {
          type: "tool-searchRunCatalog",
          toolCallId: "search-1",
          state: "output-available",
          input: { query: "awareness" },
          output: { matches: ["Q1", "Q2"] },
        },
        { type: "text", text: "Here is the answer." },
      ],
      traceCapture: makeTraceCapture(),
    });

    expect(relativePath).toBe("agents/analysis/sessions/session-1/turn-1776686402000-assistant-1.json");

    const trace = JSON.parse(
      await fs.readFile(path.join(outputDir, relativePath!), "utf-8"),
    ) as Record<string, unknown>;
    expect(trace.kind).toBe("success");
    expect(trace.sessionTitle).toBe("Audit Session");
    expect(trace.reasoningParts).toEqual(["First check the grounded survey wording."]);
    expect(trace.scratchpadEntries).toHaveLength(2);
    expect(trace.toolTimeline).toHaveLength(1);
    expect(trace.retrySummary).toEqual({
      totalAttempts: 2,
      finalClassification: "policy",
      terminalError: null,
      events: makeTraceCapture().retryEvents,
    });
    expect(trace.usage).toEqual(makeTraceCapture().usage);

    const index = JSON.parse(
      await fs.readFile(path.join(outputDir, "agents", "analysis", "index.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(index).toEqual({
      version: 1,
      updatedAt: "2026-04-20T12:00:02.000Z",
      runId: "run-1",
      sessions: [
        {
          sessionId: "session-1",
          sessionTitle: "Audit Session",
          updatedAt: "2026-04-20T12:00:02.000Z",
          turns: [
            {
              path: "agents/analysis/sessions/session-1/turn-1776686402000-assistant-1.json",
              kind: "success",
              createdAt: "2026-04-20T12:00:02.000Z",
              messageId: "assistant-1",
            },
          ],
        },
      ],
    });

    expect(mocks.uploadRunOutputArtifact).toHaveBeenCalledTimes(2);
  });

  it("writes an error trace without failing when the output dir is valid", async () => {
    const relativePath = await writeAnalysisTurnErrorTrace({
      runResultValue: { outputDir },
      orgId: "org-1",
      projectId: "project-1",
      runId: "run-1",
      sessionId: "session-2",
      sessionTitle: "Error Session",
      createdAt: "2026-04-20T12:00:05.000Z",
      latestUserPrompt: "What happened next?",
      errorMessage: "Stream failed after retrying",
      traceCapture: {
        ...makeTraceCapture(),
        terminalError: "Stream failed after retrying",
      },
    });

    expect(relativePath).toBe("agents/analysis/sessions/session-2/turn-error-1776686405000.json");

    const errorTrace = JSON.parse(
      await fs.readFile(path.join(outputDir, relativePath!), "utf-8"),
    ) as Record<string, unknown>;
    expect(errorTrace.kind).toBe("error");
    expect(errorTrace.latestUserPrompt).toBe("What happened next?");
    expect(errorTrace.errorMessage).toBe("Stream failed after retrying");
  });

  it("skips writing when the run result has no valid output dir", async () => {
    const result = await writeAnalysisTurnTrace({
      runResultValue: {},
      orgId: "org-1",
      projectId: "project-1",
      runId: "run-1",
      sessionId: "session-1",
      sessionTitle: "No Output",
      messageId: "assistant-1",
      createdAt: "2026-04-20T12:00:02.000Z",
      assistantText: "No trace should be written.",
      responseParts: [{ type: "text", text: "No trace should be written." }],
      traceCapture: makeTraceCapture(),
    });

    expect(result).toBeNull();
    expect(mocks.uploadRunOutputArtifact).not.toHaveBeenCalled();
  });

  it("maintains separate session entries in the trace index", async () => {
    await updateAnalysisTraceIndex({
      outputDir,
      runId: "run-1",
      sessionId: "session-b",
      sessionTitle: "Session B",
      createdAt: "2026-04-20T12:01:00.000Z",
      relativePath: "agents/analysis/sessions/session-b/turn-1.json",
      kind: "success",
      messageId: "assistant-2",
    });
    const index = await updateAnalysisTraceIndex({
      outputDir,
      runId: "run-1",
      sessionId: "session-a",
      sessionTitle: "Session A",
      createdAt: "2026-04-20T12:00:00.000Z",
      relativePath: "agents/analysis/sessions/session-a/turn-1.json",
      kind: "error",
      messageId: null,
    });

    expect(index.sessions.map((session) => session.sessionId)).toEqual(["session-a", "session-b"]);
    expect(index.sessions[0]?.turns[0]).toEqual({
      path: "agents/analysis/sessions/session-a/turn-1.json",
      kind: "error",
      createdAt: "2026-04-20T12:00:00.000Z",
      messageId: null,
    });
  });
});
