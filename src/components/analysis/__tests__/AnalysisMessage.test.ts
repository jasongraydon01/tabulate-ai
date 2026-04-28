import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnalysisMessage,
  buildAnalysisDisplayBlocks,
  buildAnalysisRevealEntries,
  getAnalysisAnswerRevealPhase,
  getNextAnalysisRevealDelayMs,
  getAnalysisValidationStatusLabel,
  getAnalysisMessageEvidenceItems,
  getAnalysisMessageFollowUpItems,
  getAnalysisTraceEntries,
  getAnalysisTraceHeaderLabel,
  getAnalysisWorkStatusLabel,
  sanitizeAnalysisReasoningSummaryForUI,
  splitAnalysisStableTextWindow,
  splitAnalysisTextForReveal,
  getVisibleEvidenceItems,
  resolveAnalysisFooterMessageId,
} from "@/components/analysis/AnalysisMessage";
import { AnalysisWorkDisclosure } from "@/components/analysis/AnalysisWorkDisclosure";
import { buildAnalysisRenderableBlocks } from "@/lib/analysis/renderAnchors";
import type { AnalysisTableCard } from "@/lib/analysis/types";
import type { AnalysisUIMessage as UIMessage } from "@/lib/analysis/ui";

function makeTablePart(toolCallId: string, tableId: string = "q1"): UIMessage["parts"][number] {
  const output: AnalysisTableCard = {
    status: "available",
    tableId,
    title: `${tableId} overall`,
    questionId: tableId.toUpperCase(),
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
    requestedCutGroups: null,
    focusedRowKeys: null,
    focusedGroupKeys: null,
    significanceTest: null,
    significanceLevel: null,
    comparisonGroups: [],
    sourceRefs: [],
  };

  return {
    type: "tool-fetchTable",
    toolCallId,
    state: "output-available",
    input: {
      tableId,
      cutGroups: null,
      valueMode: "pct",
    },
    output,
  } as UIMessage["parts"][number];
}

function makeRenderPart(
  tableId: string,
  focus?: {
    rowLabels?: string[];
    groupNames?: string[];
  },
): UIMessage["parts"][number] {
  return {
    type: "data-analysis-render",
    id: `render-${tableId}`,
    data: {
      tableId,
      ...(focus ? { focus } : {}),
    },
  } as UIMessage["parts"][number];
}

function makeCitePart(cellIds: string[]): UIMessage["parts"][number] {
  return {
    type: "data-analysis-cite",
    id: `cite-${cellIds.join("-")}`,
    data: { cellIds },
  } as UIMessage["parts"][number];
}

describe("AnalysisMessage trace presentation", () => {
  it("surfaces fetchTable and other tool activity as analysis steps with friendly labels", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-searchRunCatalog",
          toolCallId: "search-1",
          state: "output-available",
          input: { query: "awareness" },
          output: undefined,
        } as UIMessage["parts"][number],
        {
          type: "tool-fetchTable",
          toolCallId: "fetch-1",
          state: "output-available",
          input: { tableId: "f9__standard_overview" },
          output: undefined,
        } as UIMessage["parts"][number],
      ],
    };

    const traceEntries = getAnalysisTraceEntries(message);

    expect(traceEntries).toEqual([
      {
        kind: "tool",
        id: "search-1",
        label: "Searching run catalog",
        state: "output-available",
      },
      {
        kind: "tool",
        id: "fetch-1",
        label: "Fetching table",
        state: "output-available",
      },
    ]);
    expect(getAnalysisTraceHeaderLabel(traceEntries, "Fetching table", false)).toBe("Fetching table");
    expect(getAnalysisTraceHeaderLabel(traceEntries, "Fetching table", true)).toBe("Analysis steps");
  });

  it("hides submitAnswer, hidden proposal tools, unknown tool names, and raw payloads from work activity", () => {
    const message: UIMessage = {
      id: "assistant-hidden-tools",
      role: "assistant",
      parts: [
        {
          type: "tool-submitAnswer",
          toolCallId: "submit-1",
          state: "output-available",
          input: { parts: [{ type: "text", text: "Hidden" }] },
          output: { parts: [{ type: "text", text: "Hidden" }] },
        } as UIMessage["parts"][number],
        {
          type: "tool-proposeRowRollup",
          toolCallId: "proposal-1",
          state: "output-available",
          input: { rawExpression: "private_expression" },
          output: { status: "created" },
        } as UIMessage["parts"][number],
        {
          type: "tool-privateDebug",
          toolCallId: "debug-1",
          state: "input-available",
          input: { secret: "raw json should not render" },
        } as UIMessage["parts"][number],
        {
          type: "tool-fetchTable",
          toolCallId: "fetch-1",
          state: "input-available",
          input: { tableId: "q1" },
        } as UIMessage["parts"][number],
      ],
    };

    const entries = getAnalysisTraceEntries(message);
    expect(entries).toEqual([{
      kind: "tool",
      id: "fetch-1",
      label: "Fetching table",
      state: "input-available",
    }]);

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message, isStreaming: true }),
    );

    expect(markup).toContain("Fetching table...");
    expect(markup).not.toContain("submitAnswer");
    expect(markup).not.toContain("proposeRowRollup");
    expect(markup).not.toContain("privateDebug");
    expect(markup).not.toContain("private_expression");
    expect(markup).not.toContain("raw json should not render");
  });

  it("strips markdown markers from reasoning summaries so they render cleanly as plain text", () => {
    const message: UIMessage = {
      id: "assistant-md",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "**Filtering bank data**\n\nI need to check _aided_ awareness for `CSB` and ~~others~~.\n\n- step one\n- step two",
        },
      ],
    };

    const entries = getAnalysisTraceEntries(message);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "reasoning",
      text: "Filtering bank data\n\nI need to check aided awareness for CSB and others.\n\nstep one\nstep two",
    });
  });

  it("redacts internal tool names and JSON-shaped payloads from reasoning summaries", () => {
    const summary = sanitizeAnalysisReasoningSummaryForUI(
      "Calling tool-submitAnswer with {\"parts\":[{\"type\":\"text\",\"text\":\"Hidden\"}]} before fetchTable.",
    );

    expect(summary).toContain("analysis step");
    expect(summary).toContain("[details hidden]");
    expect(summary).not.toContain("tool-submitAnswer");
    expect(summary).not.toContain("submitAnswer");
    expect(summary).not.toContain("fetchTable");
    expect(summary).not.toContain("\"parts\"");
    expect(summary).not.toContain("Hidden");
  });

  it("shows reasoning when the model emits real reasoning summary text", () => {
    const message: UIMessage = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "The age gradient is strongest among 25-34s." },
      ],
    };

    const traceEntries = getAnalysisTraceEntries(message);

    expect(traceEntries).toEqual([
      {
        kind: "reasoning",
        id: "assistant-2-reasoning-0",
        text: "The age gradient is strongest among 25-34s.",
      },
    ]);
    expect(getAnalysisTraceHeaderLabel(traceEntries, "The age gradient is strongest among 25-34s.", false)).toBe(
      "The age gradient is strongest among 25-34s.",
    );
    expect(getAnalysisTraceHeaderLabel(traceEntries, "The age gradient is strongest among 25-34s.", true)).toBe(
      "Reasoning",
    );
  });

  it("keeps active reasoning/tool details collapsed by default", () => {
    const message: UIMessage = {
      id: "assistant-collapsed-work",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Detailed reasoning should stay behind the disclosure." },
        {
          type: "tool-searchRunCatalog",
          toolCallId: "search-1",
          state: "input-available",
          input: { query: "awareness" },
        } as UIMessage["parts"][number],
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message, isStreaming: true }),
    );

    expect(markup).toContain("Searching run catalog...");
    expect(markup).not.toContain("Detailed reasoning should stay behind the disclosure.");
  });

  it("renders expanded work details with tool steps before reasoning summaries", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisWorkDisclosure, {
        entries: [
          { kind: "reasoning", id: "reason-1", text: "Reasoning summary." },
          { kind: "tool", id: "tool-1", label: "Fetching table", state: "output-available" },
        ],
        statusLabel: "Analysis steps",
        isOpen: true,
        onOpenChange: () => {},
      }),
    );

    expect(markup.indexOf("Fetching table")).toBeGreaterThan(-1);
    expect(markup.indexOf("Reasoning summary.")).toBeGreaterThan(-1);
    expect(markup.indexOf("Fetching table")).toBeLessThan(markup.indexOf("Reasoning summary."));
  });

  it("drops empty reasoning events so they do not masquerade as summaries", () => {
    const message: UIMessage = {
      id: "assistant-3",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "   " },
        {
          type: "tool-listBannerCuts",
          toolCallId: "list-2",
          state: "output-available",
          input: { filter: null },
          output: undefined,
        } as UIMessage["parts"][number],
      ],
    };

    const traceEntries = getAnalysisTraceEntries(message);

    expect(traceEntries).toEqual([
      {
        kind: "tool",
        id: "list-2",
        label: "Listing available cuts",
        state: "output-available",
      },
    ]);
    expect(getAnalysisTraceHeaderLabel(traceEntries, null, true)).toBe("Analysis steps");
  });

  it("reads evidence metadata for grounded claim messages", () => {
    const message: UIMessage = {
      id: "assistant-4",
      role: "assistant",
      metadata: {
        hasGroundedClaims: true,
        evidence: [
          {
            key: "table_card::numeric::artifact-1",
            claimType: "numeric",
            evidenceKind: "table_card",
            refType: "table",
            refId: "q1",
            label: "Q1 overall",
            anchorId: "artifact-1",
            artifactId: "artifact-1",
            sourceTableId: "q1",
            sourceQuestionId: "Q1",
            renderedInCurrentMessage: false,
          },
        ],
      },
      parts: [{ type: "text", text: "Overall satisfaction is 45%." }],
    };

    expect(getAnalysisMessageEvidenceItems(message)).toEqual([
      expect.objectContaining({
        label: "Q1 overall",
        refId: "q1",
        anchorId: "artifact-1",
      }),
    ]);
  });

  it("hides the additional sources block when inline citations already surface rendered cell refs", () => {
    const cellId = "q1|row_0_1|__total__%3A%3Atotal";
    const message: UIMessage = {
      id: "assistant-inline-only",
      role: "assistant",
      metadata: {
        hasGroundedClaims: true,
        evidence: [
          {
            key: "cell::q1",
            claimType: "cell",
            evidenceKind: "cell",
            refType: "table",
            refId: "q1",
            label: "Q1 overall — Very satisfied / Total",
            anchorId: "tool-fetch-1",
            sourceTableId: "q1",
            sourceQuestionId: "Q1",
            rowKey: "row_0_1",
            cutKey: "__total__::total",
            renderedInCurrentMessage: true,
          },
        ],
      },
      parts: [
        {
          type: "tool-confirmCitation",
          toolCallId: "cite-1",
          state: "output-available",
          input: { tableId: "q1", rowLabel: "Very satisfied", columnLabel: "Total" },
          output: {
            status: "confirmed",
            cellId,
            tableId: "q1",
            tableTitle: "Q1 overall",
            questionId: "Q1",
            rowKey: "row_0_1",
            rowLabel: "Very satisfied",
            cutKey: "__total__::total",
            cutName: "Total",
            groupName: null,
            valueMode: "pct",
            displayValue: "45%",
            pct: 45,
            count: 54,
            n: null,
            mean: null,
            baseN: 120,
            sigHigherThan: [],
            sigVsTotal: null,
            sourceRefs: [],
          },
        } as UIMessage["parts"][number],
        {
          type: "text",
          text: "Overall satisfaction is **45%**.",
        },
        makeCitePart([cellId]),
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message, isStreaming: false }),
    );

    expect(markup).not.toContain("Additional sources (");
  });

  it("shows context support in the merged additional sources block", () => {
    const message: UIMessage = {
      id: "assistant-extra-evidence",
      role: "assistant",
      metadata: {
        contextEvidence: [
          {
            key: "context::q1",
            claimType: "context",
            evidenceKind: "context",
            refType: "question",
            refId: "Q1",
            label: "Q1",
            sourceQuestionId: "Q1",
            renderedInCurrentMessage: false,
          },
        ],
      },
      parts: [{ type: "text", text: "Here is the read on Q1." }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message, isStreaming: false }),
    );

    expect(markup).toContain("Additional sources (1)");
  });

  it("reads follow-up suggestions from message metadata", () => {
    const message: UIMessage = {
      id: "assistant-5",
      role: "assistant",
      metadata: {
        followUpSuggestions: [
          "Show this in counts",
          "How was Q1 asked?",
        ],
      },
      parts: [{ type: "text", text: "Overall satisfaction is 45%." }],
    };

    expect(getAnalysisMessageFollowUpItems(message)).toEqual([
      "Show this in counts",
      "How was Q1 asked?",
    ]);
  });

  it("renders a copy affordance on user messages", () => {
    const userMessage: UIMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "What stands out overall?" }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: userMessage }),
    );

    expect(markup).toContain("aria-label=\"Copy message\"");
    expect(markup).toContain("What stands out overall?");
  });

  it("renders a copy affordance on completed assistant messages", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-copy-1",
      role: "assistant",
      parts: [{ type: "text", text: "Overall satisfaction is 45%." }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).toContain("aria-label=\"Copy response\"");
  });

  it("prefers the thread-resolved persisted id for answer footer actions", () => {
    expect(resolveAnalysisFooterMessageId({
      explicitPersistedMessageId: "persisted-from-thread",
      settledPersistedMessageId: null,
      messageId: "transient-client-id",
    })).toBe("persisted-from-thread");
  });

  it("renders citation-free markdown as compact analysis response prose", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-markdown-1",
      role: "assistant",
      parts: [{
        type: "text",
        text: "# Overall read\n\n- **Awareness** is strongest among younger respondents.\n- Check `Q1` before quoting.",
      }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).toContain("data-heading-level=\"1\"");
    expect(markup).toContain("Overall read");
    expect(markup).toContain("<li>");
    expect(markup).toContain("<strong>Awareness</strong>");
    expect(markup).toContain("<code>Q1</code>");
    expect(markup).not.toContain("<h1");
  });

  it("demotes markdown tables in assistant prose to preformatted text", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-markdown-table-1",
      role: "assistant",
      parts: [{
        type: "text",
        text: "Here is a quick summary:\n\n| Segment | Percent |\n| --- | --- |\n| Total | 45% |",
      }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).toContain("<pre>");
    expect(markup).toContain("| Segment | Percent |");
    expect(markup).not.toContain("<table");
  });

  it("hides the copy affordance on assistant messages while streaming", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-streaming-1",
      role: "assistant",
      parts: [{ type: "text", text: "Pulling the age breakdown now..." }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: true }),
    );

    expect(markup).not.toContain("aria-label=\"Copy response\"");
  });

  it("shows the animated loader in the reasoning header before answer reveal begins", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-thinking-1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "Checking the most relevant cuts first." }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: true }),
    );

    expect(markup).toContain("aria-label=\"Loading\"");
  });

  it("uses validation status as the active work label before answer content starts", () => {
    const message: UIMessage = {
      id: "assistant-validating",
      role: "assistant",
      parts: [
        {
          type: "data-analysis-status",
          id: "status-1",
          data: {
            phase: "validating_answer",
            label: "TabulateAI is checking the answer against the run artifacts...",
          },
        },
        { type: "reasoning", text: "Checking support." },
      ],
    };
    const traceEntries = getAnalysisTraceEntries(message);

    expect(getAnalysisValidationStatusLabel(message)).toBe(
      "TabulateAI is checking the answer against the run artifacts...",
    );
    expect(getAnalysisWorkStatusLabel({
      traceEntries,
      validationStatusLabel: getAnalysisValidationStatusLabel(message),
      answerRevealBegins: false,
      isStreaming: true,
    })).toBe("TabulateAI is checking the answer against the run artifacts...");

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message, isStreaming: true }),
    );

    expect(markup).toContain("TabulateAI is checking the answer against the run artifacts...");
  });

  it("uses the settled analysis steps label after answer content starts", () => {
    const message: UIMessage = {
      id: "assistant-answer-started",
      role: "assistant",
      parts: [
        {
          type: "data-analysis-status",
          id: "status-1",
          data: {
            phase: "validating_answer",
            label: "TabulateAI is checking the answer against the run artifacts...",
          },
        },
        { type: "reasoning", text: "Checking support." },
        { type: "text", text: "Here is the answer." },
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message, isStreaming: false }),
    );

    expect(markup).toContain("Analysis steps");
    expect(markup).not.toContain("TabulateAI is checking the answer against the run artifacts...");
  });

  it("removes the animated loader from the reasoning header once answer content is present", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-thinking-2",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Checking the most relevant cuts first." },
        { type: "text", text: "Here is the answer." },
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).not.toContain("aria-label=\"Loading\"");
  });

  it("renders cite chips inline with the sentence and labels them with the question id", () => {
    const cellId = "q1|row_0_1|__total__%3A%3Atotal";
    const assistantMessage: UIMessage = {
      id: "assistant-cite-1",
      role: "assistant",
      parts: [
        {
          type: "tool-confirmCitation",
          toolCallId: "cite-1",
          state: "output-available",
          input: { tableId: "q1", rowLabel: "Very satisfied", columnLabel: "Total" },
          output: {
            status: "confirmed",
            cellId,
            tableId: "q1",
            tableTitle: "Q1 overall",
            questionId: "Q1",
            rowKey: "row_0_1",
            rowLabel: "Very satisfied",
            cutKey: "__total__::total",
            cutName: "Total",
            groupName: null,
            valueMode: "pct",
            displayValue: "45%",
            pct: 45,
            count: 54,
            n: null,
            mean: null,
            baseN: 120,
            sigHigherThan: [],
            sigVsTotal: null,
            sourceRefs: [],
          },
        } as UIMessage["parts"][number],
        {
          type: "text",
          text: "Overall satisfaction is **45%**.",
        },
        makeCitePart([cellId]),
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).toContain("<strong>45%</strong>.");
    expect(markup).not.toContain("</p><button");
    expect(markup).toContain("aria-label=\"Citation Q1\"");
    expect(markup).toContain(">Q1<");
    expect(markup).not.toContain(">¹<");
    expect(markup).not.toContain("**45%**");
  });

  it("renders cited table cells with the same contract-formatted value and anchor used by inline citations", () => {
    const cellId = "q1|row_0_1|__total__%3A%3Atotal";
    const assistantMessage: UIMessage = {
      id: "assistant-cite-rendered-table",
      role: "assistant",
      parts: [
        {
          type: "tool-fetchTable",
          toolCallId: "fetch-1",
          state: "output-available",
          input: { tableId: "q1", cutGroups: null },
          output: {
            status: "available",
            tableId: "q1",
            title: "q1 overall",
            questionId: "Q1",
            questionText: "How satisfied are you?",
            tableType: "frequency",
            surveySection: null,
            baseText: "All respondents",
            tableSubtitle: null,
            userNote: null,
            valueMode: "pct",
            columns: [
              {
                cutKey: "__total__::total",
                cutName: "Total",
                groupName: "Total",
                statLetter: "T",
                baseN: 120,
                isTotal: true,
              },
            ],
            columnGroups: [
              {
                groupKey: "__total__",
                groupName: "Total",
                columns: [
                  {
                    cutKey: "__total__::total",
                    cutName: "Total",
                    groupName: "Total",
                    statLetter: "T",
                    baseN: 120,
                    isTotal: true,
                  },
                ],
              },
            ],
            rows: [
              {
                rowKey: "row_0_1",
                label: "Very satisfied",
                rowKind: "value",
                statType: null,
                valueType: "pct",
                format: { kind: "percent", decimals: 0 },
                indent: 0,
                isNet: false,
                values: [
                  {
                    cutKey: "__total__::total",
                    cutName: "Total",
                    rawValue: 45,
                    displayValue: "stale",
                    pct: 45,
                    count: 54,
                    n: 120,
                    mean: null,
                    sigHigherThan: [],
                    sigVsTotal: null,
                  },
                ],
                cellsByCutKey: {
                  "__total__::total": {
                    cutKey: "__total__::total",
                    cutName: "Total",
                    rawValue: 45,
                    displayValue: "stale",
                    pct: 45,
                    count: 54,
                    n: 120,
                    mean: null,
                    sigHigherThan: [],
                    sigVsTotal: null,
                  },
                },
              },
            ],
            totalRows: 1,
            totalColumns: 1,
            truncatedRows: 0,
            truncatedColumns: 0,
            defaultScope: "matched_groups",
            initialVisibleRowCount: 1,
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
        } as UIMessage["parts"][number],
        {
          type: "tool-confirmCitation",
          toolCallId: "cite-1",
          state: "output-available",
          input: { tableId: "q1", rowLabel: "Very satisfied", columnLabel: "Total" },
          output: {
            status: "confirmed",
            cellId,
            tableId: "q1",
            tableTitle: "Q1 overall",
            questionId: "Q1",
            rowKey: "row_0_1",
            rowLabel: "Very satisfied",
            cutKey: "__total__::total",
            cutName: "Total",
            groupName: null,
            valueMode: "pct",
            displayValue: "45%",
            pct: 45,
            count: 54,
            n: 120,
            mean: null,
            baseN: 120,
            sigHigherThan: [],
            sigVsTotal: null,
            sourceRefs: [],
          },
        } as UIMessage["parts"][number],
        {
          type: "text",
          text: "Overall satisfaction is **45%**.\n\n",
        },
        makeCitePart([cellId]),
        makeRenderPart("q1"),
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).toContain("aria-label=\"Citation Q1\"");
    expect(markup).toContain("analysis-cell-q1-row_0_1-__total__-3A-3Atotal");
    expect(markup).toContain(">45%</span>");
    expect(markup).not.toContain(">stale</span>");
  });

  it("falls back to the table id when citation metadata is unavailable", () => {
    const cellId = "q1|row_0_1|__total__%3A%3Atotal";
    const assistantMessage: UIMessage = {
      id: "assistant-cite-fallback",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Overall satisfaction is 45%.",
        },
        makeCitePart([cellId]),
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).toContain("aria-label=\"Citation q1\"");
    expect(markup).toContain(">q1<");
  });

  it("uses evidence metadata to label citations with the question id when confirmCitation metadata is unavailable", () => {
    const cellId = "a3__standard_overview|A3r2_row_2|group%3Aage%20group%20hids3%3A%3A18%2024";
    const assistantMessage: UIMessage = {
      id: "assistant-cite-evidence-meta",
      role: "assistant",
      metadata: {
        hasGroundedClaims: true,
        evidence: [
          {
            key: "cell::a3-18-24",
            claimType: "cell",
            evidenceKind: "cell",
            refType: "table",
            refId: "a3__standard_overview",
            label: "A3 — Cambridge Savings Bank / 18-24",
            sourceTableId: "a3__standard_overview",
            sourceQuestionId: "A3",
            rowKey: "A3r2_row_2",
            cutKey: "group:age group hids3::18 24",
            renderedInCurrentMessage: true,
          },
        ],
      },
      parts: [
        {
          type: "text",
          text: "Cambridge Savings Bank is at 33%.",
        },
        makeCitePart([cellId]),
      ],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: assistantMessage, isStreaming: false }),
    );

    expect(markup).toContain("aria-label=\"Citation A3\"");
    expect(markup).toContain(">A3<");
    expect(markup).not.toContain(">a3__standard_overview<");
  });

  it("filters inline-covered cell refs out of the Evidence block while preserving uncited support", () => {
    const citedCellId = "q1|row_0_1|__total__%3A%3Atotal";
    const message: UIMessage = {
      id: "assistant-partial-evidence",
      role: "assistant",
      metadata: {
        hasGroundedClaims: true,
        evidence: [
          {
            key: "cell::q1-cited",
            claimType: "cell",
            evidenceKind: "cell",
            refType: "table",
            refId: "q1",
            label: "Q1 overall — Very satisfied / Total",
            sourceTableId: "q1",
            sourceQuestionId: "Q1",
            rowKey: "row_0_1",
            cutKey: "__total__::total",
            renderedInCurrentMessage: true,
          },
          {
            key: "cell::q1-uncited",
            claimType: "cell",
            evidenceKind: "cell",
            refType: "table",
            refId: "q1",
            label: "Q1 overall — Somewhat satisfied / Total",
            sourceTableId: "q1",
            sourceQuestionId: "Q1",
            rowKey: "row_0_2",
            cutKey: "__total__::total",
            renderedInCurrentMessage: true,
          },
        ],
        contextEvidence: [
          {
            key: "context::survey-q1",
            claimType: "context",
            evidenceKind: "context",
            refType: "survey_question",
            refId: "Q1",
            label: "Q1 survey wording",
            sourceQuestionId: "Q1",
            renderedInCurrentMessage: false,
          },
        ],
      },
      parts: [
        {
          type: "text",
          text: "Overall satisfaction is 45%.",
        },
        makeCitePart([citedCellId]),
      ],
    };

    expect(getVisibleEvidenceItems(message, getAnalysisMessageEvidenceItems(message))).toEqual([
      expect.objectContaining({ key: "cell::q1-uncited" }),
    ]);

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message, isStreaming: false }),
    );

    expect(markup).toContain("Additional sources (2)");
    expect(markup).toContain("aria-label=\"Citation Q1\"");
  });

  it("keeps cited cell evidence visible when the supporting table was not rendered inline", () => {
    const citedCellId = "q1|row_0_1|__total__%3A%3Atotal";
    const message: UIMessage = {
      id: "assistant-unrendered-cite-evidence",
      role: "assistant",
      metadata: {
        hasGroundedClaims: true,
        evidence: [
          {
            key: "cell::q1-cited-unrendered",
            claimType: "cell",
            evidenceKind: "cell",
            refType: "table",
            refId: "q1",
            label: "Q1 overall — Very satisfied / Total",
            sourceTableId: "q1",
            sourceQuestionId: "Q1",
            rowKey: "row_0_1",
            cutKey: "__total__::total",
            renderedInCurrentMessage: false,
          },
        ],
      },
      parts: [
        {
          type: "text",
          text: "Overall satisfaction is 45%.",
        },
        makeCitePart([citedCellId]),
      ],
    };

    expect(getVisibleEvidenceItems(message, getAnalysisMessageEvidenceItems(message))).toEqual([
      expect.objectContaining({ key: "cell::q1-cited-unrendered" }),
    ]);
  });

  it("renders an edit affordance on user messages when an edit handler is provided", () => {
    const userMessage: UIMessage = {
      id: "user-edit-1",
      role: "user",
      parts: [{ type: "text", text: "What stands out overall?" }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, {
        message: userMessage,
        onEditUserMessage: async () => {},
      }),
    );

    expect(markup).toContain("aria-label=\"Edit message\"");
  });

  it("omits the edit affordance when no edit handler is provided", () => {
    const userMessage: UIMessage = {
      id: "user-noedit-1",
      role: "user",
      parts: [{ type: "text", text: "What stands out overall?" }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, { message: userMessage }),
    );

    expect(markup).not.toContain("aria-label=\"Edit message\"");
  });

  it("does not render an edit affordance on assistant messages", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-noedit-1",
      role: "assistant",
      parts: [{ type: "text", text: "Here's the overall picture." }],
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisMessage, {
        message: assistantMessage,
        // Even when passed, assistant messages should ignore the prop.
        onEditUserMessage: async () => {},
      }),
    );

    expect(markup).not.toContain("aria-label=\"Edit message\"");
  });
});

describe("AnalysisMessage reveal helpers", () => {
  it("holds incomplete render markers out of the stable text window while streaming", () => {
    expect(splitAnalysisStableTextWindow("Intro [[render tableId=q1", true)).toEqual({
      stableText: "Intro [[render tableId=q1",
      unstableTail: "",
    });
  });

  it("holds incomplete cite markers out of the stable text window while streaming", () => {
    expect(splitAnalysisStableTextWindow("Overall is 45%.[[cite cellIds=q1|r|c", true)).toEqual({
      stableText: "Overall is 45%.[[cite cellIds=q1|r|c",
      unstableTail: "",
    });
  });

  it("keeps sentence boundaries intact for reveal chunking", () => {
    expect(splitAnalysisTextForReveal("Overall is 45%. Next sentence.")).toEqual([
      "Overall is 45%. ",
      "Next sentence.",
    ]);
  });

  it("shows a table shell when the next unreleased entry is a table block", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-shell",
      parts: [
        makeTablePart("tool-1", "q1"),
        { type: "text", text: "Intro.\n\n" },
        makeRenderPart("q1"),
        { type: "text", text: "\n\nClose." },
      ],
    });

    const entries = buildAnalysisRevealEntries(blocks);
    const displayBlocks = buildAnalysisDisplayBlocks(blocks, entries, 1);

    expect(displayBlocks).toEqual([
      expect.objectContaining({
        kind: "text",
        segments: [{ kind: "text", text: "Intro.\n\n" }],
      }),
      expect.objectContaining({ kind: "table", displayState: "shell" }),
    ]);
  });

  it("moves through thinking, handoff, composing, and settled phases", () => {
    expect(getAnalysisAnswerRevealPhase({
      isStreaming: true,
      hasEverStreamed: true,
      releasedEntryCount: 0,
      totalEntryCount: 0,
      unstableTail: "",
    })).toBe("thinking");

    expect(getAnalysisAnswerRevealPhase({
      isStreaming: true,
      hasEverStreamed: true,
      releasedEntryCount: 0,
      totalEntryCount: 2,
      unstableTail: "",
    })).toBe("handoff");

    expect(getAnalysisAnswerRevealPhase({
      isStreaming: false,
      hasEverStreamed: true,
      releasedEntryCount: 1,
      totalEntryCount: 2,
      unstableTail: "",
    })).toBe("composing");

    expect(getAnalysisAnswerRevealPhase({
      isStreaming: false,
      hasEverStreamed: true,
      releasedEntryCount: 2,
      totalEntryCount: 2,
      unstableTail: "",
    })).toBe("settled");
  });

  it("uses longer composed delays for first reveal, paragraph breaks, tables, and post-table settles", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-delays",
      parts: [
        makeTablePart("tool-1", "q1"),
        { type: "text", text: "First sentence.\n\nSecond paragraph.\n\n" },
        makeRenderPart("q1"),
        { type: "text", text: "\n\nWrap up." },
      ],
    });
    const entries = buildAnalysisRevealEntries(blocks);

    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 0, entries })).toBe(260);
    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 1, entries })).toBe(220);
    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 2, entries })).toBe(220);
    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 3, entries })).toBe(160);
  });
});
