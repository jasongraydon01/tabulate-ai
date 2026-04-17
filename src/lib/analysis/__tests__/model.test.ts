import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAnalysisAIProvider,
  getAnalysisModelId,
  getAnalysisModelName,
  getAnalysisProviderOptions,
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

  it("supports an anthropic-only analysis provider override", () => {
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

  it("omits anthropic options when analysis uses the default provider path", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");
    vi.stubEnv("ANALYSIS_MODEL", "gpt-5-mini");

    expect(getAnalysisProviderOptions()).toBeUndefined();
    expect(getAnalysisModelId()).toBe("gpt-5-mini");
  });
});
