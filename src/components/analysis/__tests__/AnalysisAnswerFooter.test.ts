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
    expect(markup).toContain("Additional sources (1)");
    expect(markup).toContain("Helpful");
    expect(markup).toContain("Needs work");
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

  it("caps follow-up suggestions at three stable footer slots", () => {
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
          "Show the related tables for Q1",
        ],
        onSelectFollowUpSuggestion: async () => {},
      }),
    );

    expect(markup.match(/data-analysis-suggestion-slot="true"/g)).toHaveLength(3);
    expect(markup).toContain("Break this down by age");
    expect(markup).toContain("How was Q1 asked?");
    expect(markup).not.toContain("Show the related tables for Q1");
  });

  it("hides suggestions when the composer already has draft text", () => {
    expect(getAnalysisFooterSuggestions(["Show this in counts"], true)).toEqual([]);

    const markup = renderToStaticMarkup(
      React.createElement(AnalysisAnswerFooter, {
        isReady: true,
        reserveSpace: true,
        messageText: "Here is the answer.",
        messageId: "assistant-1",
        sourceItems: [],
        followUpSuggestions: ["Show this in counts"],
        onSelectFollowUpSuggestion: async () => {},
        composerHasDraft: true,
      }),
    );

    expect(markup).not.toContain("data-analysis-suggestion-slot");
    expect(markup).not.toContain("Show this in counts");
    expect(markup).toContain("aria-label=\"Copy response\"");
    expect(markup).not.toContain("min-h-[5rem]");
  });

  it("shows the downvote correction panel when existing feedback needs work", () => {
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

    expect(markup).toContain("Optional: what should TabulateAI have said instead?");
    expect(markup).toContain("Save feedback");
    expect(markup).toContain("Mention the base size.");
  });
});
