import { describe, expect, it } from "vitest";

import { buildAnalysisCiteMarker } from "@/lib/analysis/citeAnchors";
import { buildAnalysisRenderMarker } from "@/lib/analysis/renderAnchors";
import {
  buildAnalysisStructuredAssistantPartsFromText,
  extractAnalysisStructuredAssistantPartsFromSubmitAnswer,
  extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer,
  getAnalysisTextFromStructuredAssistantParts,
  serializeAnalysisStructuredAssistantPartsToText,
} from "@/lib/analysis/structuredParts";

describe("analysis structured assistant parts", () => {
  it("parses prose-only assistant text into a single text part", () => {
    expect(buildAnalysisStructuredAssistantPartsFromText("Hello world.")).toEqual([
      { type: "text", text: "Hello world." },
    ]);
  });

  it("parses prose, render, and cite markers in order", () => {
    const cite = buildAnalysisCiteMarker(["q1|row|cut"]);
    const render = buildAnalysisRenderMarker("q1", {
      rowLabels: ["CSB"],
      groupNames: ["Age"],
    });
    const text = `Intro.\n\n${render}\n\nValue.${cite} End.`;

    expect(buildAnalysisStructuredAssistantPartsFromText(text)).toEqual([
      { type: "text", text: "Intro." },
      {
        type: "render",
        tableId: "q1",
        focus: {
          rowLabels: ["CSB"],
          groupNames: ["Age"],
        },
      },
      { type: "text", text: "Value." },
      { type: "cite", cellIds: ["q1|row|cut"] },
      { type: "text", text: " End." },
    ]);
  });

  it("serializes structured parts back to legacy marker text for the current renderer", () => {
    const serialized = serializeAnalysisStructuredAssistantPartsToText([
      { type: "text", text: "Intro." },
      {
        type: "render",
        tableId: "q1",
        focus: {
          rowLabels: ["CSB"],
          groupNames: ["Age"],
        },
      },
      { type: "text", text: "Value." },
      { type: "cite", cellIds: ["q1|row|cut"] },
    ]);

    expect(serialized).toBe(
      `Intro.\n\n${buildAnalysisRenderMarker("q1", {
        rowLabels: ["CSB"],
        groupNames: ["Age"],
      })}\n\nValue.${buildAnalysisCiteMarker(["q1|row|cut"])}`,
    );
  });

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

  it("fails strict extraction when submitAnswer is not the final assistant action", () => {
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
    ])).toMatchObject({
      ok: false,
      reason: "submit_answer_not_last",
    });
  });
});
