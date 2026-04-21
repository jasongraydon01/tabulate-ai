import { describe, expect, it } from "vitest";

import { resolveAssistantMessageTrust } from "@/lib/analysis/claimCheck";
import type { AnalysisTableCard } from "@/lib/analysis/types";

function makeTableCard(overrides: Partial<AnalysisTableCard> = {}): AnalysisTableCard {
  return {
    status: "available",
    tableId: "q1",
    title: "Q1 overall",
    questionId: "Q1",
    questionText: "How satisfied are you?",
    tableType: "frequency",
    surveySection: null,
    baseText: "All respondents",
    tableSubtitle: null,
    userNote: null,
    valueMode: "pct",
    columns: [],
    rows: [],
    totalRows: 0,
    totalColumns: 0,
    truncatedRows: 0,
    truncatedColumns: 0,
    focusedCutIds: null,
    requestedRowFilter: null,
    requestedCutFilter: null,
    significanceTest: null,
    significanceLevel: null,
    comparisonGroups: [],
    sourceRefs: [
      { refType: "table", refId: "q1", label: "Q1 overall" },
      { refType: "question", refId: "Q1", label: "Q1" },
    ],
    ...overrides,
  };
}

describe("resolveAssistantMessageTrust", () => {
  it("ignores non-numeric conversational responses", () => {
    const result = resolveAssistantMessageTrust({
      assistantText: "I would start with overall satisfaction, then check subgroup spread.",
      responseParts: [{ type: "text", text: "I would start with overall satisfaction, then check subgroup spread." }],
      groundingEvents: [],
      priorTableArtifacts: [],
    });

    expect(result).toEqual({
      assistantText: "I would start with overall satisfaction, then check subgroup spread.",
      hasGroundedClaims: false,
      groundingRefs: [],
      injectedTableCards: [],
    });
  });

  it("uses a current rendered table card as numeric evidence", () => {
    const card = makeTableCard();

    const result = resolveAssistantMessageTrust({
      assistantText: "Overall satisfaction is 45%.",
      responseParts: [
        {
          type: "tool-getTableCard",
          toolCallId: "tool-1",
          state: "output-available",
          input: { tableId: "q1" },
          output: card,
        },
        { type: "text", text: "Overall satisfaction is 45%." },
      ],
      groundingEvents: [],
      priorTableArtifacts: [],
    });

    expect(result.hasGroundedClaims).toBe(true);
    expect(result.injectedTableCards).toEqual([]);
    expect(result.groundingRefs).toEqual([
      expect.objectContaining({
        claimId: "numeric-1",
        claimType: "numeric",
        evidenceKind: "table_card",
        refType: "table",
        refId: "q1",
        anchorId: "tool-1",
      }),
    ]);
  });

  it("reuses a prior table artifact when the current turn only inspects the table", () => {
    const card = makeTableCard();

    const result = resolveAssistantMessageTrust({
      assistantText: "Overall satisfaction is 45%.",
      responseParts: [{ type: "text", text: "Overall satisfaction is 45%." }],
      groundingEvents: [
        {
          toolName: "viewTable",
          toolCallId: "view-1",
          sourceRefs: [{ refType: "table", refId: "q1", label: "Q1 overall" }],
          tableCard: card,
        },
      ],
      priorTableArtifacts: [{
        artifactId: "artifact-1",
        title: "Q1 overall",
        sourceTableIds: ["q1"],
        sourceQuestionIds: ["Q1"],
        payload: card,
      }],
    });

    expect(result.injectedTableCards).toEqual([]);
    expect(result.groundingRefs).toEqual([
      expect.objectContaining({
        artifactId: "artifact-1",
        anchorId: "artifact-1",
        renderedInCurrentMessage: false,
      }),
    ]);
  });

  it("injects a table card when the turn has numeric claims and only a silent viewTable result", () => {
    const card = makeTableCard();

    const result = resolveAssistantMessageTrust({
      assistantText: "Overall satisfaction is 45%.",
      responseParts: [{ type: "text", text: "Overall satisfaction is 45%." }],
      groundingEvents: [
        {
          toolName: "viewTable",
          toolCallId: "view-1",
          sourceRefs: [{ refType: "table", refId: "q1", label: "Q1 overall" }],
          tableCard: card,
        },
      ],
      priorTableArtifacts: [],
    });

    expect(result.hasGroundedClaims).toBe(true);
    expect(result.injectedTableCards).toEqual([
      {
        toolCallId: "evidence-q1",
        card,
      },
    ]);
    expect(result.groundingRefs).toEqual([
      expect.objectContaining({
        anchorId: "evidence-q1",
        renderedInCurrentMessage: true,
      }),
    ]);
  });

  it("repairs unsupported numeric claims when there is no table evidence path", () => {
    const result = resolveAssistantMessageTrust({
      assistantText: "Overall satisfaction is 45%.",
      responseParts: [{ type: "text", text: "Overall satisfaction is 45%." }],
      groundingEvents: [],
      priorTableArtifacts: [],
    });

    expect(result.hasGroundedClaims).toBe(false);
    expect(result.injectedTableCards).toEqual([]);
    expect(result.groundingRefs).toEqual([]);
    expect(result.assistantText).toContain("supporting table card");
  });

  it("strips leaked placeholder citation tokens from assistant text", () => {
    const card = makeTableCard();

    const result = resolveAssistantMessageTrust({
      assistantText: [
        "These three tables help flesh it out:",
        "",
        "{{table:f10__standard_overview}}",
        "",
        "{{table:f11__standard_overview}}",
        "",
        "---",
        "",
        "The age story gets sharper now.",
      ].join("\n"),
      responseParts: [
        {
          type: "tool-getTableCard",
          toolCallId: "tool-1",
          state: "output-available",
          input: { tableId: "q1" },
          output: card,
        },
        { type: "text", text: "placeholder" },
      ],
      groundingEvents: [],
      priorTableArtifacts: [],
    });

    expect(result.assistantText).toBe([
      "These three tables help flesh it out:",
      "",
      "The age story gets sharper now.",
    ].join("\n"));
  });
});
