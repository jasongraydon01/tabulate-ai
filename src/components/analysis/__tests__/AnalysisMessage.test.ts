import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  getAnalysisMessageEvidenceItems,
  getAnalysisMessageFollowUpItems,
  getAnalysisTraceEntries,
  getAnalysisTraceHeaderLabel,
} from "@/components/analysis/AnalysisMessage";

describe("AnalysisMessage trace presentation", () => {
  it("treats scratchpad and tool activity as analysis steps, not reasoning summaries", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-scratchpad",
          toolCallId: "scratch-1",
          state: "output-available",
          input: { action: "add" },
          output: undefined,
        } as UIMessage["parts"][number],
        {
          type: "tool-viewTable",
          toolCallId: "view-1",
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
        id: "scratch-1",
        label: "Internal note",
        state: "output-available",
      },
      {
        kind: "tool",
        id: "view-1",
        label: "Inspecting table",
        state: "output-available",
      },
    ]);
    expect(getAnalysisTraceHeaderLabel(traceEntries, "Inspecting table", false)).toBe("Inspecting table");
    expect(getAnalysisTraceHeaderLabel(traceEntries, "Inspecting table", true)).toBe("Analysis steps");
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

  it("drops empty reasoning events so they do not masquerade as summaries", () => {
    const message: UIMessage = {
      id: "assistant-3",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "   " },
        {
          type: "tool-scratchpad",
          toolCallId: "scratch-2",
          state: "output-available",
          input: { action: "add" },
          output: undefined,
        } as UIMessage["parts"][number],
      ],
    };

    const traceEntries = getAnalysisTraceEntries(message);

    expect(traceEntries).toEqual([
      {
        kind: "tool",
        id: "scratch-2",
        label: "Internal note",
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
});
