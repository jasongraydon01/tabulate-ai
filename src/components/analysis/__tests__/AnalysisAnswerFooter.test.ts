import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnalysisAnswerFooter,
  getAnalysisFooterSuggestions,
} from "@/components/analysis/AnalysisAnswerFooter";
import type { AnalysisEvidenceItem } from "@/lib/analysis/types";

const sourceItem: AnalysisEvidenceItem = {
  key: "context::q1",
  claimType: "context",
  evidenceKind: "context",
  refType: "question",
  refId: "Q1",
  label: "Q1 survey wording",
  anchorId: "artifact-1",
  artifactId: "artifact-1",
  sourceTableId: "q1",
  sourceQuestionId: "Q1",
  rowKey: null,
  cutKey: null,
  renderedInCurrentMessage: false,
};

describe("AnalysisAnswerFooter", () => {
  it("renders copy, sources, and feedback in one compact ready footer", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisAnswerFooter, {
        isReady: true,
        reserveSpace: true,
        messageText: "Here is the answer.",
        messageId: "assistant-1",
        sourceItems: [sourceItem],
        feedback: null,
        onSubmitFeedback: async () => {},
        followUpSuggestions: [],
      }),
    );

    expect(markup).toContain("data-analysis-answer-footer-state=\"ready\"");
    expect(markup).toContain("aria-label=\"Copy response\"");
    expect(markup).toContain("aria-label=\"Evidence (1)\"");
    expect(markup).toContain("aria-label=\"Mark response as helpful\"");
    expect(markup).toContain("aria-label=\"Mark response as needing work\"");
  });

  it("reserves the answer footer footprint before the footer is ready", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisAnswerFooter, {
        isReady: false,
        reserveSpace: true,
        messageText: "Here is the answer.",
        messageId: "assistant-1",
        sourceItems: [],
        followUpSuggestions: ["Show this in counts"],
        onSelectFollowUpSuggestion: async () => {},
      }),
    );

    expect(markup).toContain("data-analysis-answer-footer-state=\"reserved\"");
    expect(markup).not.toContain("aria-label=\"Copy response\"");
    expect(markup).not.toContain("Show this in counts");
  });

  it("does not render follow-up suggestion bubbles (deferred until AI-backed re-enable)", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisAnswerFooter, {
        isReady: true,
        reserveSpace: true,
        messageText: "Here is the answer.",
        messageId: "assistant-1",
        sourceItems: [],
        followUpSuggestions: [
          "Break this down by age",
          "Show this in counts",
          "How was Q1 asked?",
        ],
        onSelectFollowUpSuggestion: async () => {},
      }),
    );

    expect(markup).not.toContain("data-analysis-suggestion-slot");
    expect(markup).not.toContain("Show this in counts");
    expect(markup).not.toContain("Break this down by age");
  });

  it("caps the follow-up suggestion helper at three when composer is empty", () => {
    expect(
      getAnalysisFooterSuggestions(
        ["a", "b", "c", "d"],
        false,
      ),
    ).toEqual(["a", "b", "c"]);
    expect(getAnalysisFooterSuggestions(["a"], true)).toEqual([]);
  });

  it("renders pressed state for an existing downvote without auto-opening the correction panel", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisAnswerFooter, {
        isReady: true,
        reserveSpace: true,
        messageText: "Here is the answer.",
        messageId: "assistant-1",
        sourceItems: [],
        feedback: {
          messageId: "assistant-1",
          vote: "down",
          correctionText: "Mention the base size.",
          updatedAt: 123,
        },
        onSubmitFeedback: async () => {},
        followUpSuggestions: [],
      }),
    );

    expect(markup).toContain("aria-pressed=\"true\"");
    expect(markup).toContain("aria-label=\"Remove needs-work feedback\"");
    expect(markup).not.toContain("Optional: what should TabulateAI have said instead?");
    expect(markup).not.toContain("Save feedback");
  });

  it("supports clearing feedback via vote: null in the handler signature", () => {
    const props: React.ComponentProps<typeof AnalysisAnswerFooter> = {
      isReady: true,
      reserveSpace: true,
      messageText: "Here is the answer.",
      messageId: "assistant-1",
      sourceItems: [],
      feedback: null,
      onSubmitFeedback: async (input) => {
        expect(input.vote === "up" || input.vote === "down" || input.vote === null).toBe(true);
      },
      followUpSuggestions: [],
    };
    const markup = renderToStaticMarkup(React.createElement(AnalysisAnswerFooter, props));

    expect(markup).toContain("aria-label=\"Mark response as helpful\"");
    expect(markup).toContain("aria-label=\"Mark response as needing work\"");
  });
});
