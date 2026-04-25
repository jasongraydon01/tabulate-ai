import { describe, expect, it } from "vitest";

import { buildAnalysisCiteMarker } from "@/lib/analysis/citeAnchors";
import { buildAnalysisRenderMarker } from "@/lib/analysis/renderAnchors";
import {
  buildAnalysisStructuredAssistantPartsFromText,
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
});
