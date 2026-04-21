import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAnalysisAIProvider,
  getAnalysisModel,
  getAnalysisModelId,
  getAnalysisModelName,
  getAnalysisProviderOptions,
  getAnalysisTitleProviderOptions,
} from "@/lib/analysis/model";

describe("analysis model config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults analysis provider to the global AI provider when not explicitly set", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");

    expect(getAnalysisAIProvider()).toBe("openai");
  });

  it("uses the direct OpenAI Responses API for analysis when the global provider is azure", () => {
    vi.stubEnv("AI_PROVIDER", "azure");
    vi.stubEnv("AZURE_API_KEY", "azure-test-key-12345");
    vi.stubEnv("AZURE_RESOURCE_NAME", "demo-resource");
    vi.stubEnv("ANALYSIS_AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");
    vi.stubEnv("ANALYSIS_MODEL", "gpt-5.4-mini");

    const model = getAnalysisModel() as { provider: string; modelId: string };

    expect(getAnalysisAIProvider()).toBe("openai");
    expect(getAnalysisModelName()).toBe("openai/gpt-5.4-mini");
    // Responses API so reasoning summaries can stream to the UI.
    expect(model.provider).toBe("openai.responses");
    expect(model.modelId).toBe("gpt-5.4-mini");
  });

  it("uses the Azure Responses API for analysis when the global provider is openai", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");
    vi.stubEnv("ANALYSIS_AI_PROVIDER", "azure");
    vi.stubEnv("AZURE_API_KEY", "azure-test-key-12345");
    vi.stubEnv("AZURE_RESOURCE_NAME", "demo-resource");
    vi.stubEnv("ANALYSIS_MODEL", "gpt-5.4");

    const model = getAnalysisModel() as { provider: string; modelId: string };

    expect(getAnalysisAIProvider()).toBe("azure");
    expect(getAnalysisModelName()).toBe("azure/gpt-5.4");
    expect(model.provider).toBe("azure.responses");
    expect(model.modelId).toBe("gpt-5.4");
  });

  it("supports an anthropic analysis provider override", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");
    vi.stubEnv("ANALYSIS_AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-12345");

    expect(getAnalysisAIProvider()).toBe("anthropic");
    expect(getAnalysisModelId()).toBe("claude-sonnet-4-6");
    expect(getAnalysisModelName()).toBe("anthropic/claude-sonnet-4-6");
  });

  it("builds anthropic provider options with adaptive thinking by default", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");
    vi.stubEnv("ANALYSIS_AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-12345");
    vi.stubEnv("ANALYSIS_ANTHROPIC_EFFORT", "high");

    expect(getAnalysisProviderOptions()).toEqual({
      anthropic: {
        effort: "high",
        thinking: { type: "adaptive" },
      },
    });
  });

  it("supports GPT-5.4 family model ids for analysis", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");

    vi.stubEnv("ANALYSIS_MODEL", "gpt-5.4");
    expect(getAnalysisModelId()).toBe("gpt-5.4");

    vi.stubEnv("ANALYSIS_MODEL", "gpt-5.4-mini");
    expect(getAnalysisModelId()).toBe("gpt-5.4-mini");

    vi.stubEnv("ANALYSIS_MODEL", "gpt-5.4-nano");
    expect(getAnalysisModelId()).toBe("gpt-5.4-nano");
  });

  it("builds OpenAI analysis provider options when reasoning and verbosity are configured", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");
    vi.stubEnv("ANALYSIS_MODEL", "gpt-5.4-mini");
    vi.stubEnv("ANALYSIS_REASONING_EFFORT", "low");
    vi.stubEnv("ANALYSIS_TEXT_VERBOSITY", "high");
    vi.stubEnv("ANALYSIS_REASONING_SUMMARY", "auto");

    expect(getAnalysisProviderOptions()).toEqual({
      openai: {
        reasoningEffort: "low",
        textVerbosity: "high",
        reasoningSummary: "auto",
      },
    });
  });

  it("uses a cheap default title reasoning effort and allows an explicit override", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");

    expect(getAnalysisTitleProviderOptions()).toEqual({
      openai: {
        reasoningEffort: "none",
      },
    });

    vi.stubEnv("ANALYSIS_TITLE_REASONING_EFFORT", "high");
    expect(getAnalysisTitleProviderOptions()).toEqual({
      openai: {
        reasoningEffort: "high",
      },
    });
  });
});
