import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildAnalysisTimelineEntries,
  hasVisibleAnalysisMessageParts,
  PendingAnalysisMessage,
  shouldShowAnalysisMessageActions,
  shouldShowAnalysisPendingState,
} from "@/components/analysis/AnalysisThread";
import type { AnalysisComputeJobView } from "@/lib/analysis/computeLane/jobView";
import type { AnalysisUIMessage as UIMessage } from "@/lib/analysis/ui";

describe("AnalysisThread action visibility", () => {
  it("shows actions for the latest assistant turn when nothing follows it", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Here is the answer." }] },
    ];

    expect(shouldShowAnalysisMessageActions(messages, 1)).toBe(true);
  });

  it("hides actions for an assistant turn once a later user message exists", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Here is the answer." }] },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "Make that tighter." }] },
    ];

    expect(shouldShowAnalysisMessageActions(messages, 1)).toBe(false);
  });

  it("hides actions on older assistant turns when a newer assistant response exists", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "First question" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "First answer" }] },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "Follow-up" }] },
      { id: "assistant-2", role: "assistant", parts: [{ type: "text", text: "Second answer" }] },
    ];

    expect(shouldShowAnalysisMessageActions(messages, 1)).toBe(false);
    expect(shouldShowAnalysisMessageActions(messages, 3)).toBe(true);
  });
});

describe("AnalysisThread pending state", () => {
  it("shows the pending state while submitted before an assistant message exists", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
    ];

    expect(shouldShowAnalysisPendingState(messages, "submitted")).toBe(true);
  });

  it("keeps the pending state visible while streaming if the assistant shell has no visible parts yet", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
      { id: "assistant-1", role: "assistant", parts: [] },
    ];

    expect(shouldShowAnalysisPendingState(messages, "streaming")).toBe(true);
  });

  it("hides the pending state once the assistant has visible reasoning or tool activity", () => {
    const reasoningMessage: UIMessage = {
      id: "assistant-reasoning",
      role: "assistant",
      parts: [{ type: "reasoning", text: "Checking the age cuts first." }],
    };
    const toolMessage: UIMessage = {
      id: "assistant-tool",
      role: "assistant",
      parts: [
        {
          type: "tool-searchRunCatalog",
          toolCallId: "search-1",
          state: "input-available",
          input: { query: "awareness" },
        } as UIMessage["parts"][number],
      ],
    };

    expect(hasVisibleAnalysisMessageParts(reasoningMessage)).toBe(true);
    expect(hasVisibleAnalysisMessageParts(toolMessage)).toBe(true);
    expect(shouldShowAnalysisPendingState([reasoningMessage], "streaming")).toBe(false);
    expect(shouldShowAnalysisPendingState([toolMessage], "streaming")).toBe(false);
  });

  it("treats structured analysis data parts as visible", () => {
    const message: UIMessage = {
      id: "assistant-structured",
      role: "assistant",
      parts: [
        {
          type: "data-analysis-render",
          id: "render-1",
          data: { tableId: "q1" },
        },
      ],
    };

    expect(hasVisibleAnalysisMessageParts(message)).toBe(true);
  });

  it("treats whitespace-only text and reasoning parts as not yet visible", () => {
    const message: UIMessage = {
      id: "assistant-empty",
      role: "assistant",
      parts: [
        { type: "text", text: "   " },
        { type: "reasoning", text: "   " },
      ],
    };

    expect(hasVisibleAnalysisMessageParts(message)).toBe(false);
    expect(shouldShowAnalysisPendingState([message], "streaming")).toBe(true);
  });

  it("renders the loading placeholder without the old status dropdown copy", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PendingAnalysisMessage),
    );

    expect(markup).toContain("TabulateAI is reading the run artifacts...");
    expect(markup).not.toContain("TabulateAI is analyzing the artifacts...");
    expect(markup).not.toContain("Checking the run artifacts");
    expect(markup).not.toContain("Grounding the answer");
    expect(markup).not.toContain("<svg");
  });
});

describe("AnalysisThread timeline entries", () => {
  it("keeps turn-scoped compute jobs after the assistant turn instead of raw timestamp order", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        metadata: { clientTurnId: "turn-1", persistedMessageId: "user-1", persistence: { status: "persisted" } },
        parts: [{ type: "text", text: "Add region cuts" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        metadata: { clientTurnId: "turn-1", persistedMessageId: "assistant-1", persistence: { status: "persisted" } },
        parts: [{ type: "text", text: "Proposal created" }],
      },
    ];
    const computeJobs: AnalysisComputeJobView[] = [{
      id: "job-1",
      jobType: "banner_extension_recompute",
      status: "proposed",
      effectiveStatus: "proposed",
      requestText: "Add region cuts",
      originClientTurnId: "turn-1",
      originUserMessageId: "user-1",
      originAssistantMessageId: "assistant-1",
      createdAt: 200,
      updatedAt: 200,
    }];

    const entries = buildAnalysisTimelineEntries({
      messages,
      computeJobs,
      messageCreatedAtById: {
        "user-1": 100,
        "assistant-1": 300,
      },
    });

    expect(entries.map((entry) => entry.key)).toEqual([
      "message-user-1",
      "message-assistant-1",
      "compute-job-job-1",
    ]);
  });

  it("places an agent-created proposal card below the assistant reasoning for its originating turn", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        metadata: { clientTurnId: "turn-agent", persistedMessageId: "user-1", persistence: { status: "persisted" } },
        parts: [{ type: "text", text: "Add region cuts across the tabs" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        metadata: { clientTurnId: "turn-agent", persistedMessageId: "assistant-1", persistence: { status: "persisted" } },
        parts: [
          { type: "reasoning", text: "Considering proposal requirements" },
          {
            type: "text",
            text: "I prepared a derived-run proposal. Review the card before confirming.",
          },
        ],
      },
    ];
    const computeJobs: AnalysisComputeJobView[] = [{
      id: "job-agent-1",
      jobType: "banner_extension_recompute",
      status: "proposed",
      effectiveStatus: "proposed",
      requestText: "Add region cuts across the tabs",
      proposedGroup: {
        groupName: "Region",
        cuts: [{
          name: "North",
          original: "North region",
          userSummary: "Matched the region variable.",
        }],
      },
      confirmToken: "opaque-token",
      originClientTurnId: "turn-agent",
      originUserMessageId: "user-1",
      createdAt: 150,
      updatedAt: 150,
    }];

    const entries = buildAnalysisTimelineEntries({
      messages,
      computeJobs,
      messageCreatedAtById: {
        "user-1": 100,
        "assistant-1": 200,
      },
    });

    expect(entries.map((entry) => entry.kind)).toEqual([
      "message",
      "message",
      "compute-job",
    ]);
    expect(entries[2]).toMatchObject({
      kind: "compute-job",
      job: {
        id: "job-agent-1",
        proposedGroup: { groupName: "Region" },
      },
    });
  });

  it("falls legacy timestamp-only jobs into the nearest preceding turn without placing them above reasoning", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Add region cuts" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Checking proposal scope." },
          { type: "text", text: "I prepared a proposal." },
        ],
      },
    ];
    const computeJobs: AnalysisComputeJobView[] = [{
      id: "legacy-job-1",
      jobType: "banner_extension_recompute",
      status: "proposed",
      effectiveStatus: "proposed",
      requestText: "Add region cuts",
      createdAt: 150,
      updatedAt: 150,
    }];

    const entries = buildAnalysisTimelineEntries({
      messages,
      computeJobs,
      messageCreatedAtById: {
        "user-1": 100,
        "assistant-1": 200,
      },
    });

    expect(entries.map((entry) => entry.key)).toEqual([
      "message-user-1",
      "message-assistant-1",
      "compute-job-legacy-job-1",
    ]);
  });

  it("places direct compute-preflight cards after their visible initiating user message", () => {
    const messages: UIMessage[] = [
      {
        id: "user-direct",
        role: "user",
        metadata: { clientTurnId: "turn-direct", persistedMessageId: "user-direct", persistence: { status: "persisted" } },
        parts: [{ type: "text", text: "Create this as a derived run" }],
      },
    ];
    const computeJobs: AnalysisComputeJobView[] = [{
      id: "job-direct",
      jobType: "banner_extension_recompute",
      status: "proposed",
      effectiveStatus: "proposed",
      requestText: "Create this as a derived run",
      originClientTurnId: "turn-direct",
      originUserMessageId: "user-direct",
      createdAt: 150,
      updatedAt: 150,
    }];

    const entries = buildAnalysisTimelineEntries({
      messages,
      computeJobs,
      messageCreatedAtById: {
        "user-direct": 100,
      },
    });

    expect(entries.map((entry) => entry.key)).toEqual([
      "message-user-direct",
      "compute-job-job-direct",
    ]);
  });

  it("holds direct compute-preflight cards until their initiating turn is visible", () => {
    const entries = buildAnalysisTimelineEntries({
      messages: [],
      computeJobs: [{
        id: "job-direct",
        jobType: "banner_extension_recompute",
        status: "proposed",
        effectiveStatus: "proposed",
        requestText: "Create this as a derived run",
        originClientTurnId: "turn-direct",
        originUserMessageId: "user-direct",
        createdAt: 150,
        updatedAt: 150,
      }],
      messageCreatedAtById: {},
    });

    expect(entries).toEqual([]);
  });
});
