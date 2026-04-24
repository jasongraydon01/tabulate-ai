import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_ASSISTANT_MESSAGE_CHARS,
  MAX_ANALYSIS_MESSAGE_CHARS,
  getAnalysisMessageFollowUpSuggestions,
  getSanitizedConversationMessagesForModel,
  getAnalysisUIMessageText,
  normalizeAssistantMarkdown,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisAssistantMessageContent,
  sanitizeAnalysisMessageContent,
} from "@/lib/analysis/messages";

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
            requestedRowFilter: null,
            requestedCutFilter: null,
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
          rowFilter: null,
          cutFilter: null,
          valueMode: "pct",
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

  it("rehydrates persisted non-getTableCard tool parts when allowlisted and toolCallId is present", () => {
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

  it("skips persisted tool parts with unknown tool types", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Answer.",
        parts: [
          { type: "tool-newExperimentalThing", toolCallId: "call-x", state: "output-available" },
          { type: "text", text: "Answer." },
        ],
      },
    ]);

    expect(messages[0].parts).toEqual([
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

  it("keeps allowlisted tool parts in sanitized model messages", () => {
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
              rowFilter: null,
              cutFilter: null,
              valueMode: "pct",
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
              requestedRowFilter: null,
              requestedCutFilter: null,
              significanceTest: null,
              significanceLevel: null,
              comparisonGroups: [],
              sourceRefs: [],
            },
          },
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
            input: { tableId: "q1", rowKey: "row_1", cutKey: "__total__::total" },
            output: {
              status: "confirmed",
              cellId: "q1|row_1|__total__%3A%3Atotal|pct",
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

  it("strips render and cite markers from prior-turn assistant text", () => {
    const sanitized = getSanitizedConversationMessagesForModel([
      {
        id: "assistant-hist",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: [
              "Awareness is 58%.[[cite cellIds=q1%7Crow_1_csb%7C__total__%3A%3Atotal%7Cpct]]",
              "",
              "[[render tableId=A3]]",
              "",
              "End.",
            ].join("\n"),
          },
        ],
      },
    ]);

    const text = (sanitized[0].parts[0] as { type: "text"; text: string }).text;
    expect(text).not.toContain("[[render");
    expect(text).not.toContain("[[cite");
    expect(text).toContain("Awareness is 58%.");
    expect(text).toContain("End.");
  });
});
