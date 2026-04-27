import { describe, expect, it } from "vitest";

import { persistedAnalysisMessagesToUIMessages } from "@/lib/analysis/messages";
import { buildSettledAnalysisAnswer } from "@/lib/analysis/settledAnswer";
import type { AnalysisTableCard } from "@/lib/analysis/types";
import type { AnalysisUIMessage } from "@/lib/analysis/ui";

function tableCard(): AnalysisTableCard {
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
  };
}

describe("settled analysis answer model", () => {
  it("normalizes streamed final parts and persisted replay into equivalent answer blocks", () => {
    const streamedMessage: AnalysisUIMessage = {
      id: "assistant-live",
      role: "assistant",
      metadata: {
        clientTurnId: "turn-1",
        persistedMessageId: "assistant-1",
        persistence: { status: "persisted" },
        followUpSuggestions: ["Show this in counts"],
      },
      parts: [
        {
          type: "tool-fetchTable",
          toolCallId: "fetch-1",
          state: "output-available",
          input: { tableId: "q1", cutGroups: null },
          output: tableCard(),
        } as AnalysisUIMessage["parts"][number],
        { type: "text", text: "Overall satisfaction is 45%." },
        { type: "data-analysis-render", data: { tableId: "q1" } },
      ],
    };
    const [persistedMessage] = persistedAnalysisMessagesToUIMessages(
      [{
        _id: "assistant-1",
        clientTurnId: "turn-1",
        role: "assistant",
        content: "Overall satisfaction is 45%.",
        parts: [
          { type: "tool-fetchTable", state: "output-available", toolCallId: "fetch-1", artifactId: "artifact-1" },
          { type: "text", text: "Overall satisfaction is 45%." },
          { type: "render", tableId: "q1" },
        ],
        followUpSuggestions: ["Show this in counts"],
      }],
      [{
        _id: "artifact-1",
        artifactType: "table_card",
        payload: tableCard(),
      }],
    );

    const streamed = buildSettledAnalysisAnswer(streamedMessage);
    const persisted = buildSettledAnalysisAnswer(persistedMessage);

    expect(streamed.renderableBlocks.map((block) => block.kind)).toEqual(["text", "table"]);
    expect(persisted.renderableBlocks.map((block) => block.kind)).toEqual(["text", "table"]);
    expect(streamed.followUpSuggestions).toEqual(persisted.followUpSuggestions);
    expect(persisted).toMatchObject({
      clientTurnId: "turn-1",
      persistedMessageId: "assistant-1",
      persistenceStatus: "persisted",
      canUsePersistenceActions: true,
    });
  });

  it("keeps cited rendered cells out of additional sources while preserving citation identity", () => {
    const cellId = "q1|row_1|__total__%3A%3Atotal";
    const message: AnalysisUIMessage = {
      id: "assistant-cited",
      role: "assistant",
      metadata: {
        hasGroundedClaims: true,
        evidence: [{
          key: "cell::q1",
          claimType: "cell",
          evidenceKind: "cell",
          refType: "table",
          refId: "q1",
          label: "Q1 — Satisfied / Total",
          sourceTableId: "q1",
          sourceQuestionId: "Q1",
          rowKey: "row_1",
          cutKey: "__total__::total",
          renderedInCurrentMessage: true,
        }],
      },
      parts: [
        { type: "text", text: "Satisfied is 45%." },
        { type: "data-analysis-cite", data: { cellIds: [cellId] } },
      ],
    };

    const settled = buildSettledAnalysisAnswer(message);

    expect(settled.evidenceItems).toHaveLength(1);
    expect(settled.visibleEvidenceItems).toHaveLength(0);
    expect(settled.renderableBlocks[0]).toMatchObject({
      kind: "text",
      segments: [
        { kind: "text", text: "Satisfied is 45%." },
        { kind: "cite", cellIds: [cellId] },
      ],
    });
  });

  it("exposes unsaved persistence state without enabling persistence actions", () => {
    const message: AnalysisUIMessage = {
      id: "assistant-unsaved",
      role: "assistant",
      metadata: {
        clientTurnId: "turn-unsaved",
        persistence: {
          status: "unsaved",
          warning: "Not saved.",
        },
      },
      parts: [{ type: "text", text: "Validated but not persisted." }],
    };

    expect(buildSettledAnalysisAnswer(message)).toMatchObject({
      clientTurnId: "turn-unsaved",
      persistedMessageId: null,
      persistenceStatus: "unsaved",
      persistenceWarning: "Not saved.",
      canUsePersistenceActions: false,
    });
  });
});
