import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";

import { getActiveProvider, getEnvironmentConfig } from "@/lib/env";

export type AnalysisAIProvider = "anthropic" | "openai" | "azure";
type AnalysisAnthropicEffort = "low" | "medium" | "high" | "max";
type AnalysisOpenAIReasoningEffort = "minimal";

function parseAnalysisProvider(value: string | undefined): AnalysisAIProvider | null {
  const normalized = value?.toLowerCase().trim();
  if (normalized === "anthropic" || normalized === "openai" || normalized === "azure") {
    return normalized;
  }
  return null;
}

function parseAnalysisAnthropicEffort(value: string | undefined): AnalysisAnthropicEffort {
  const normalized = value?.toLowerCase().trim();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "max") {
    return normalized;
  }
  return "medium";
}

function parseAdaptiveThinkingFlag(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase().trim();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return true;
}

export function getAnalysisAIProvider(): AnalysisAIProvider {
  const explicitProvider = parseAnalysisProvider(process.env.ANALYSIS_AI_PROVIDER);
  if (explicitProvider) return explicitProvider;

  const fallbackProvider = getEnvironmentConfig().aiProvider;
  if (fallbackProvider === "openai" || fallbackProvider === "azure") {
    return fallbackProvider;
  }

  return "openai";
}

export function getAnalysisModelId(): string {
  const explicitModel = process.env.ANALYSIS_MODEL?.trim();
  if (explicitModel) return explicitModel;

  if (getAnalysisAIProvider() === "anthropic") {
    return "claude-sonnet-4-6";
  }

  return getEnvironmentConfig().reasoningModel;
}

export function getAnalysisTitleModelId(): string {
  const explicitModel = process.env.ANALYSIS_TITLE_MODEL?.trim();
  if (explicitModel) return explicitModel;

  return getAnalysisModelId();
}

export function getAnalysisModel() {
  const provider = getAnalysisAIProvider();
  const modelId = getAnalysisModelId();

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required when ANALYSIS_AI_PROVIDER=anthropic");
    }

    return createAnthropic({ apiKey }).chat(modelId);
  }

  return getActiveProvider().chat(modelId);
}

export function getAnalysisTitleModel() {
  const provider = getAnalysisAIProvider();
  const modelId = getAnalysisTitleModelId();

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required when ANALYSIS_AI_PROVIDER=anthropic");
    }

    return createAnthropic({ apiKey }).chat(modelId);
  }

  return getActiveProvider().chat(modelId);
}

export function getAnalysisModelName(): string {
  return `${getAnalysisAIProvider()}/${getAnalysisModelId()}`;
}

export function getAnalysisTitleModelName(): string {
  return `${getAnalysisAIProvider()}/${getAnalysisTitleModelId()}`;
}

export function getAnalysisProviderOptions():
  | { anthropic: AnthropicLanguageModelOptions }
  | undefined {
  if (getAnalysisAIProvider() !== "anthropic") {
    return undefined;
  }

  const options: AnthropicLanguageModelOptions = {
    effort: parseAnalysisAnthropicEffort(process.env.ANALYSIS_ANTHROPIC_EFFORT),
  };

  if (parseAdaptiveThinkingFlag(process.env.ANALYSIS_ENABLE_ADAPTIVE_THINKING)) {
    options.thinking = { type: "adaptive" };
  }

  return { anthropic: options };
}

export function getAnalysisTitleProviderOptions():
  | { anthropic: AnthropicLanguageModelOptions }
  | { openai: { reasoningEffort: AnalysisOpenAIReasoningEffort } }
  | undefined {
  if (getAnalysisAIProvider() === "anthropic") {
    return {
      anthropic: {
        effort: "low",
      },
    };
  }

  return {
    openai: {
      reasoningEffort: "minimal",
    },
  };
}
