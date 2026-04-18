import { describe, expect, it } from "vitest";

import {
  ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION,
  buildAnalysisInstructions,
} from "@/prompts/analysis/production";

describe("analysis agent production prompt", () => {
  it("contains the mission section", () => {
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("<mission>");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("senior analyst colleague");
  });

  it("contains hard bounds including the no-emoji rule", () => {
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("<hard_bounds>");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("NEVER use emojis");
  });

  it("contains the response discipline section with anti-restatement guidance", () => {
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("<response_discipline>");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("No pipe tables");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("table card");
  });

  it("contains the tool usage protocol with exploration workflow", () => {
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("<tool_usage_protocol>");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("EXPLORATION WORKFLOW");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("searchRunCatalog");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("viewTable");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("getTableCard");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("getQuestionContext");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("listBannerCuts");
  });

  it("contains the scratchpad protocol", () => {
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("<scratchpad_protocol>");
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).toContain("scratchpad");
  });

  it("does not contain dataset-specific examples", () => {
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).not.toMatch(/\bQ1\b/);
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).not.toMatch(/\bS9\b/);
    expect(ANALYSIS_AGENT_INSTRUCTIONS_PRODUCTION).not.toMatch(/\bS11\b/);
  });

  it("appends grounding status for available artifacts", () => {
    const result = buildAnalysisInstructions({
      availability: "available",
      missingArtifacts: [],
    });

    expect(result).toContain("<grounding_status>");
    expect(result).toContain("All grounding artifacts are available.");
  });

  it("appends artifact gap details for partial availability", () => {
    const result = buildAnalysisInstructions({
      availability: "partial",
      missingArtifacts: ["planning/21-crosstab-plan.json"],
    });

    expect(result).toContain("Artifact gaps:");
    expect(result).toContain("planning/21-crosstab-plan.json");
  });

  it("appends unavailable warning when artifacts are missing", () => {
    const result = buildAnalysisInstructions({
      availability: "unavailable",
      missingArtifacts: [],
    });

    expect(result).toContain("not available in this session");
    expect(result).toContain("Do not invent run-specific numbers");
  });
});
