import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_MESSAGE_CHARS,
  getSanitizedConversationMessagesForModel,
  getAnalysisUIMessageText,
  persistedAnalysisMessagesToUIMessages,
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

  it("reconstructs persisted grounded table cards from analysis artifacts", () => {
    const messages = persistedAnalysisMessagesToUIMessages(
      [
        {
          _id: "msg-1",
          role: "assistant",
          content: "Here is the table.",
          parts: [
            { type: "text", text: "Here is the table." },
            { type: "tool-getTableCard", state: "output-available", artifactId: "artifact-1" },
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
            hiddenCutCount: 0,
            isExpandable: false,
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
        type: "tool-getTableCard",
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

  it("keeps persisted grounded table cards in sanitized model messages", () => {
    const sanitized = getSanitizedConversationMessagesForModel([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "  <b>Summary</b>  " },
          {
            type: "tool-getTableCard",
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
              hiddenCutCount: 0,
              isExpandable: false,
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
        type: "tool-getTableCard",
        state: "output-available",
      }),
    ]);
  });
});
