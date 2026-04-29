import { describe, expect, it } from "vitest";

import {
  extractAnalysisStructuredAssistantPartsFromSubmitAnswer,
  extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer,
  getAnalysisTextFromStructuredAssistantParts,
} from "@/lib/analysis/structuredParts";

describe("analysis structured assistant parts", () => {
  it("builds prose-only assistant text from structured parts without reserializing markers", () => {
    expect(getAnalysisTextFromStructuredAssistantParts([
      { type: "text", text: "Intro." },
      { type: "render", tableId: "q1" },
      { type: "text", text: "Close." },
      { type: "cite", cellIds: ["q1|row|cut"] },
    ])).toBe("Intro.\n\nClose.");
  });

  it("extracts structured assistant parts from the submitAnswer tool payload", () => {
    expect(extractAnalysisStructuredAssistantPartsFromSubmitAnswer([
      {
        type: "tool-submitAnswer",
        toolCallId: "submit-1",
        state: "output-available",
        input: {
          parts: [
            { type: "text", text: "Intro." },
            { type: "render", tableId: "q1", focus: { groupNames: ["Age"] } },
            { type: "cite", cellIds: ["q1|row|cut"] },
          ],
        },
        output: {
          parts: [
            { type: "text", text: "Intro." },
            { type: "render", tableId: "q1", focus: { groupNames: ["Age"] } },
            { type: "cite", cellIds: ["q1|row|cut"] },
          ],
        },
      } as never,
    ])).toEqual([
      { type: "text", text: "Intro." },
      { type: "render", tableId: "q1", focus: { groupNames: ["Age"] } },
      { type: "cite", cellIds: ["q1|row|cut"] },
    ]);
  });

  it("drops no-op Total group focus from structured render parts", () => {
    expect(extractAnalysisStructuredAssistantPartsFromSubmitAnswer([
      {
        type: "tool-submitAnswer",
        toolCallId: "submit-1",
        state: "output-available",
        input: {
          parts: [
            {
              type: "render",
              tableId: "q1",
              focus: {
                rowLabels: ["Aware"],
                groupNames: ["Total", "Age", "Total (T)"],
                groupRefs: ["__total__", "group:age", "__total__::total"],
              },
            },
          ],
        },
        output: {
          parts: [
            {
              type: "render",
              tableId: "q1",
              focus: {
                rowLabels: ["Aware"],
                groupNames: ["Total", "Age", "Total (T)"],
                groupRefs: ["__total__", "group:age", "__total__::total"],
              },
            },
          ],
        },
      } as never,
    ])).toEqual([
      {
        type: "render",
        tableId: "q1",
        focus: {
          rowLabels: ["Aware"],
          groupNames: ["Age"],
          groupRefs: ["group:age"],
        },
      },
    ]);
  });

  it("strictly extracts structured assistant parts when submitAnswer is the only final answer contract", () => {
    expect(extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer([
      {
        type: "tool-searchRunCatalog",
        toolCallId: "search-1",
        state: "output-available",
        input: { query: "awareness" },
        output: { matches: ["Q1"] },
      } as never,
      {
        type: "tool-submitAnswer",
        toolCallId: "submit-1",
        state: "output-available",
        input: {
          parts: [
            { type: "text", text: "Intro." },
            { type: "cite", cellIds: ["q1|row|cut"] },
          ],
        },
        output: {
          parts: [
            { type: "text", text: "Intro." },
            { type: "cite", cellIds: ["q1|row|cut"] },
          ],
        },
      } as never,
    ])).toEqual({
      ok: true,
      submitAnswerIndex: 1,
      parts: [
        { type: "text", text: "Intro." },
        { type: "cite", cellIds: ["q1|row|cut"] },
      ],
    });
  });

  it("fails strict extraction when submitAnswer is missing", () => {
    expect(extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer([
      { type: "text", text: "Plain prose fallback." } as never,
    ])).toMatchObject({
      ok: false,
      reason: "missing_submit_answer",
    });
  });

  it("fails strict extraction when assistant prose appears outside submitAnswer", () => {
    expect(extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer([
      { type: "text", text: "Leaked prose." } as never,
      {
        type: "tool-submitAnswer",
        toolCallId: "submit-1",
        state: "output-available",
        input: {
          parts: [{ type: "text", text: "Final answer." }],
        },
        output: {
          parts: [{ type: "text", text: "Final answer." }],
        },
      } as never,
    ])).toMatchObject({
      ok: false,
      reason: "assistant_text_outside_submit_answer",
    });
  });

  it("allows trailing non-prose tool parts after submitAnswer", () => {
    expect(extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer([
      {
        type: "tool-submitAnswer",
        toolCallId: "submit-1",
        state: "output-available",
        input: {
          parts: [{ type: "text", text: "Final answer." }],
        },
        output: {
          parts: [{ type: "text", text: "Final answer." }],
        },
      } as never,
      {
        type: "tool-searchRunCatalog",
        toolCallId: "search-2",
        state: "output-available",
        input: { query: "late" },
        output: { matches: [] },
      } as never,
    ])).toEqual({
      ok: true,
      submitAnswerIndex: 0,
      parts: [{ type: "text", text: "Final answer." }],
    });
  });

  it("allows trailing reasoning metadata after submitAnswer", () => {
    expect(extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer([
      {
        type: "tool-submitAnswer",
        toolCallId: "submit-1",
        state: "output-available",
        input: {
          parts: [{ type: "text", text: "Final answer." }],
        },
        output: {
          parts: [{ type: "text", text: "Final answer." }],
        },
      } as never,
      {
        type: "reasoning",
        text: "Provider-supplied reasoning summary.",
        state: "done",
      } as never,
    ])).toEqual({
      ok: true,
      submitAnswerIndex: 0,
      parts: [{ type: "text", text: "Final answer." }],
    });
  });
});
