import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_ASSISTANT_MESSAGE_CHARS,
  MAX_ANALYSIS_MESSAGE_CHARS,
  getAnalysisMessageFollowUpSuggestions,
  getSanitizedConversationMessagesForModel,
  getAnalysisUIMessageText,
  normalizePersistedAnalysisMessageRecord,
  normalizeAssistantMarkdown,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisAssistantMessageContent,
  sanitizeAnalysisMessageContent,
} from "@/lib/analysis/messages";
import type { AnalysisUIMessage as UIMessage } from "@/lib/analysis/ui";

describe("analysis message helpers", () => {
  it("sanitizes angle brackets and trims to the configured maximum", () => {
    const value = sanitizeAnalysisMessageContent(`  <b>${"x".repeat(MAX_ANALYSIS_MESSAGE_CHARS + 20)}</b>  `);

    expect(value.startsWith("b")).toBe(true);
    expect(value.includes("<")).toBe(false);
    expect(value.includes(">")).toBe(false);
    expect(value.length).toBe(MAX_ANALYSIS_MESSAGE_CHARS);
  });

  it("allows longer assistant responses and normalizes split bullet markers", () => {
    const assistantText = sanitizeAnalysisAssistantMessageContent(
      `•\n\nFirst point\n\n${"x".repeat(MAX_ANALYSIS_ASSISTANT_MESSAGE_CHARS + 50)}`,
    );

    expect(assistantText.startsWith("- First point")).toBe(true);
    expect(assistantText.length).toBe(MAX_ANALYSIS_ASSISTANT_MESSAGE_CHARS);
  });

  it("repairs standalone ordered and unordered bullet marker lines", () => {
    const normalized = normalizeAssistantMarkdown([
      "Client-ready, I'd frame it like this:",
      "",
      "•",
      "",
      "Younger cohorts lean more active.",
      "",
      "2.",
      "",
      "Older cohorts skew more supplemental.",
    ].join("\n"));

    expect(normalized).toContain("- Younger cohorts lean more active.");
    expect(normalized).toContain("2. Older cohorts skew more supplemental.");
  });

  it("extracts text from UI message parts", () => {
    const text = getAnalysisUIMessageText({
      parts: [
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ],
    });

    expect(text).toBe("Hello world");
  });

  it("maps persisted records into UI messages", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Ready to help.",
      },
    ]);

    expect(messages).toEqual([
      {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "Ready to help." }],
      },
    ]);
  });

  it("rehydrates persisted follow-up suggestions into message metadata", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Ready to help.",
        followUpSuggestions: [
          "Show this in counts",
          "How was Q1 asked?",
        ],
      },
    ]);

    expect(getAnalysisMessageFollowUpSuggestions(messages[0])).toEqual([
      "Show this in counts",
      "How was Q1 asked?",
    ]);
  });

  it("reconstructs persisted grounded table cards from analysis artifacts", () => {
    const messages = persistedAnalysisMessagesToUIMessages(
      [
        {
          _id: "msg-1",
          role: "assistant",
          content: "Here is the table.",
          parts: [
            { type: "text", text: "Here is the table." },
            { type: "tool-fetchTable", state: "output-available", artifactId: "artifact-1" },
          ],
        },
      ],
      [
        {
          _id: "artifact-1",
          artifactType: "table_card",
          payload: {
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
            columnGroups: [
              {
                groupKey: "__total__",
                groupName: "Total",
                columns: [],
              },
            ],
            rows: [],
            totalRows: 0,
            totalColumns: 0,
            truncatedRows: 0,
            truncatedColumns: 0,
            defaultScope: "total_only",
            initialVisibleRowCount: 0,
            initialVisibleGroupCount: 0,
            hiddenRowCount: 0,
            hiddenGroupCount: 0,
            focusedCutIds: null,
            requestedCutGroups: null,
            focusedRowKeys: null,
            focusedGroupKeys: null,
            significanceTest: null,
            significanceLevel: null,
            comparisonGroups: [],
            sourceRefs: [],
          },
        },
      ],
    );

    expect(messages[0].parts).toEqual([
      { type: "text", text: "Here is the table." },
      {
        type: "tool-fetchTable",
        toolCallId: "artifact-1",
        state: "output-available",
        input: {
          tableId: "q1",
          cutGroups: null,
        },
        output: expect.objectContaining({
          tableId: "q1",
          title: "Q1 overall",
        }),
      },
    ]);
  });

  it("rehydrates persisted reasoning parts as reasoning UI parts", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "",
        parts: [
          { type: "reasoning", text: "Thinking through base sizes first." },
          { type: "text", text: "Base looks solid." },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
      { type: "reasoning", text: "Thinking through base sizes first.", state: "done" },
      { type: "text", text: "Base looks solid." },
    ]);
  });

  it("rehydrates persisted structured assistant parts into explicit structured UI parts", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Intro. Close.",
        parts: [
          { type: "text", text: "Intro." },
          { type: "render", tableId: "q1", focus: { rowLabels: ["CSB"] } },
          { type: "text", text: "Value." },
          { type: "cite", cellIds: ["q1|row|cut"] },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
      { type: "text", text: "Intro." },
      {
        type: "data-analysis-render",
        data: {
          tableId: "q1",
          focus: { rowLabels: ["CSB"] },
        },
      },
      { type: "text", text: "Value." },
      { type: "data-analysis-cite", data: { cellIds: ["q1|row|cut"] } },
    ]);
  });

  it("rehydrates content-only legacy assistant messages with markers into structured UI parts", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-legacy",
        role: "assistant",
        content: "Intro.\n\n[[render tableId=q1]]\n\nValue.[[cite cellIds=q1|row|cut]]",
      },
    ]);

    expect(messages[0].parts).toEqual([
      { type: "text", text: "Intro." },
      {
        type: "data-analysis-render",
        data: {
          tableId: "q1",
        },
      },
      { type: "text", text: "Value." },
      { type: "data-analysis-cite", data: { cellIds: ["q1|row|cut"] } },
    ]);
  });

  it("preserves structured assistant part payloads through the shared persisted-message normalizer", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      normalizePersistedAnalysisMessageRecord({
        _id: "msg-1",
        role: "assistant",
        content: "Intro. Value.",
        parts: [
          { type: "text", text: "Intro." },
          { type: "render", tableId: "q1", focus: { rowLabels: ["CSB"], groupRefs: ["group:age"] } },
          { type: "text", text: "Value." },
          { type: "cite", cellIds: ["q1|row|cut"] },
          {
            type: "tool-searchRunCatalog",
            toolCallId: "call-1",
            state: "output-available",
            input: { query: "awareness" },
            output: { matches: ["Q1"] },
          },
        ],
        groundingRefs: [
          {
            claimId: "q1|row|cut",
            claimType: "cell",
            evidenceKind: "cell",
            refType: "table",
            refId: "q1",
            label: "Q1 overall — CSB / Total",
            anchorId: "tool-1",
            artifactId: "artifact-1",
            sourceTableId: "q1",
            sourceQuestionId: "Q1",
            rowKey: "row",
            cutKey: "cut",
            renderedInCurrentMessage: true,
          },
        ],
        followUpSuggestions: ["Show me the base sizes"],
      }),
    ]);

    expect(messages[0]).toEqual({
      id: "msg-1",
      role: "assistant",
      metadata: {
        hasGroundedClaims: true,
        evidence: [
          expect.objectContaining({
            anchorId: "tool-1",
            artifactId: "artifact-1",
          }),
        ],
        followUpSuggestions: ["Show me the base sizes"],
      },
      parts: [
        {
          type: "text",
          text: "Intro.",
        },
        {
          type: "data-analysis-render",
          data: {
            tableId: "q1",
            focus: { rowLabels: ["CSB"], groupRefs: ["group:age"] },
          },
        },
        {
          type: "text",
          text: "Value.",
        },
        {
          type: "data-analysis-cite",
          data: { cellIds: ["q1|row|cut"] },
        },
        {
          type: "tool-searchRunCatalog",
          toolCallId: "call-1",
          state: "output-available",
          input: { query: "awareness" },
          output: { matches: ["Q1"] },
        },
      ],
    });
  });

  it("rehydrates persisted non-fetchTable tool parts when allowlisted and toolCallId is present", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-searchRunCatalog",
            toolCallId: "call-abc",
            state: "output-available",
            input: { query: "awareness" },
            output: { matches: ["Q1"] },
          },
          { type: "text", text: "Found the table." },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
      {
        type: "tool-searchRunCatalog",
        toolCallId: "call-abc",
        state: "output-available",
        input: { query: "awareness" },
        output: { matches: ["Q1"] },
      },
      { type: "text", text: "Found the table." },
    ]);
  });

  it("skips persisted reasoning with empty text", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Final answer.",
        parts: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Final answer." },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
      { type: "text", text: "Final answer." },
    ]);
  });

  it("rehydrates persisted tool parts with arbitrary tool types when toolCallId is present", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Answer.",
        parts: [
          {
            type: "tool-newExperimentalThing",
            toolCallId: "call-x",
            state: "output-available",
            input: { topic: "brands" },
            output: { ok: true },
          },
          { type: "text", text: "Answer." },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
      {
        type: "tool-newExperimentalThing",
        toolCallId: "call-x",
        state: "output-available",
        input: { topic: "brands" },
        output: { ok: true },
      },
      { type: "text", text: "Answer." },
    ]);
  });

  it("skips persisted tool parts that are missing a toolCallId", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Answer.",
        parts: [
          { type: "tool-searchRunCatalog", state: "output-available" },
          { type: "text", text: "Answer." },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
      { type: "text", text: "Answer." },
    ]);
  });

  it("keeps tool history in sanitized model messages", () => {
    const sanitized = getSanitizedConversationMessagesForModel([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "  <b>Summary</b>  " },
          {
            type: "tool-fetchTable",
            toolCallId: "artifact-1",
            state: "output-available",
            input: {
              tableId: "q1",
              cutGroups: null,
            },
            output: {
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
              columnGroups: [{ groupKey: "__total__", groupName: "Total", columns: [] }],
              rows: [],
              totalRows: 0,
              totalColumns: 0,
              truncatedRows: 0,
              truncatedColumns: 0,
              defaultScope: "total_only",
              initialVisibleRowCount: 0,
              initialVisibleGroupCount: 0,
              hiddenRowCount: 0,
              hiddenGroupCount: 0,
              focusedCutIds: null,
              requestedCutGroups: null,
              focusedRowKeys: null,
              focusedGroupKeys: null,
              significanceTest: null,
              significanceLevel: null,
              comparisonGroups: [],
              sourceRefs: [],
            },
          },
          {
            type: "tool-newExperimentalThing",
            toolCallId: "call-2",
            state: "input-available",
            input: { topic: "follow-up" },
          } as UIMessage["parts"][number],
        ],
      },
    ]);

    expect(sanitized[0].parts).toEqual([
      { type: "text", text: "bSummary/b" },
      expect.objectContaining({
        type: "tool-fetchTable",
        toolCallId: "artifact-1",
        state: "output-available",
      }),
      {
        type: "tool-newExperimentalThing",
        toolCallId: "call-2",
        state: "input-available",
        input: { topic: "follow-up" },
      },
    ]);
  });

  it("keeps reasoning and confirmCitation parts in sanitized model history", () => {
    const sanitized = getSanitizedConversationMessagesForModel([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Thinking through base sizes." },
          {
            type: "tool-confirmCitation",
            toolCallId: "cite-1",
            state: "output-available",
            input: { tableId: "q1", rowLabel: "Aware", columnLabel: "Total" },
            output: {
              status: "confirmed",
              cellId: "q1|row_1|__total__%3A%3Atotal",
              tableId: "q1",
              tableTitle: "Q1 overall",
              questionId: "Q1",
              rowKey: "row_1",
              rowLabel: "Aware",
              cutKey: "__total__::total",
              cutName: "Total",
              groupName: null,
              valueMode: "pct",
              displayValue: "58%",
              pct: 58,
              count: 236,
              n: null,
              mean: null,
              baseN: 405,
              sigHigherThan: [],
              sigVsTotal: null,
              sourceRefs: [],
            },
          },
        ],
      },
    ]);

    expect(sanitized[0].parts).toEqual([
      { type: "reasoning", text: "Thinking through base sizes.", state: "done" },
      expect.objectContaining({
        type: "tool-confirmCitation",
        toolCallId: "cite-1",
        state: "output-available",
      }),
    ]);
  });

  it("drops structured render and cite parts from prior-turn assistant history while preserving prose", () => {
    const sanitized = getSanitizedConversationMessagesForModel([
      {
        id: "assistant-hist",
        role: "assistant",
        parts: [
          { type: "text", text: "Awareness is 58%." },
          { type: "data-analysis-cite", id: "cite-1", data: { cellIds: ["q1|row_1_csb|__total__%3A%3Atotal|pct"] } },
          { type: "text", text: "\n\n" },
          { type: "data-analysis-render", id: "render-1", data: { tableId: "A3" } },
          { type: "text", text: "\n\nEnd." },
        ],
      },
    ]);

    expect(sanitized[0].parts).toEqual([
      { type: "text", text: "Awareness is 58%." },
      { type: "text", text: "End." },
    ]);
  });
});
