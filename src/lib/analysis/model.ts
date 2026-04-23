import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type {
  OpenAILanguageModelChatOptions,
  OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";

import { getAzureProvider, getEnvironmentConfig, getOpenAIProvider } from "@/lib/env";
import type { ReasoningEffort } from "@/lib/types";

export type AnalysisAIProvider = "anthropic" | "openai" | "azure";
type AnalysisAnthropicEffort = "low" | "medium" | "high" | "max";
type AnalysisTextVerbosity = NonNullable<OpenAILanguageModelChatOptions["textVerbosity"]>;
type AnalysisReasoningSummary = "auto" | "detailed";

const VALID_ANALYSIS_TEXT_VERBOSITY: AnalysisTextVerbosity[] = ["low", "medium", "high"];
const VALID_ANALYSIS_REASONING_SUMMARIES: AnalysisReasoningSummary[] = ["auto", "detailed"];

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

function parseAnalysisReasoningEffort(
  value: string | undefined,
  envVarName: string,
  fallback?: ReasoningEffort,
): ReasoningEffort | undefined {
  if (!value) return fallback;
  const normalized = value.toLowerCase().trim() as ReasoningEffort;
  if (["none", "minimal", "low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized;
  }

  if (fallback) {
    console.warn(`[analysis/model.ts] Invalid ${envVarName} "${value}", using default "${fallback}"`);
    return fallback;
  }

  console.warn(`[analysis/model.ts] Invalid ${envVarName} "${value}", using provider default`);
  return undefined;
}

function parseAnalysisTextVerbosity(value: string | undefined): AnalysisTextVerbosity | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim() as AnalysisTextVerbosity;
  if (VALID_ANALYSIS_TEXT_VERBOSITY.includes(normalized)) {
    return normalized;
  }

  console.warn(`[analysis/model.ts] Invalid ANALYSIS_TEXT_VERBOSITY "${value}", using provider default`);
  return undefined;
}

function parseAnalysisReasoningSummary(value: string | undefined): AnalysisReasoningSummary | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim() as AnalysisReasoningSummary;
  if (VALID_ANALYSIS_REASONING_SUMMARIES.includes(normalized)) {
    return normalized;
  }

  console.warn(`[analysis/model.ts] Invalid ANALYSIS_REASONING_SUMMARY "${value}", using provider default`);
  return undefined;
}

function getAnalysisOpenAIResponsesProviderOptions():
  | { openai: OpenAILanguageModelResponsesOptions }
  | undefined {
  if (getAnalysisAIProvider() === "anthropic") {
    return undefined;
  }

  const reasoningEffort = parseAnalysisReasoningEffort(
    process.env.ANALYSIS_REASONING_EFFORT,
    "ANALYSIS_REASONING_EFFORT",
    "medium",
  );
  const textVerbosity = parseAnalysisTextVerbosity(process.env.ANALYSIS_TEXT_VERBOSITY);
  const reasoningSummary = parseAnalysisReasoningSummary(process.env.ANALYSIS_REASONING_SUMMARY);

  const options: OpenAILanguageModelResponsesOptions = {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(textVerbosity ? { textVerbosity } : {}),
    ...(reasoningSummary ? { reasoningSummary } : {}),
  };

  if (Object.keys(options).length === 0) {
    return undefined;
  }

  return { openai: options };
}

function getAnalysisOpenAIChatProviderOptions(args: {
  reasoningEnvVarName: "ANALYSIS_TITLE_REASONING_EFFORT";
  fallbackReasoningEffort?: ReasoningEffort;
}): { openai: OpenAILanguageModelChatOptions } | undefined {
  if (getAnalysisAIProvider() === "anthropic") {
    return undefined;
  }

  const reasoningEffort = parseAnalysisReasoningEffort(
    process.env[args.reasoningEnvVarName],
    args.reasoningEnvVarName,
    args.fallbackReasoningEffort,
  );

  const options: OpenAILanguageModelChatOptions = {
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };

  if (Object.keys(options).length === 0) {
    return undefined;
  }

  return { openai: options };
}

function getAnalysisProvider() {
  const provider = getAnalysisAIProvider();
  if (provider === "openai") {
    return getOpenAIProvider();
  }
  if (provider === "azure") {
    return getAzureProvider();
  }
  return null;
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

  // Use the Responses API on OpenAI/Azure so reasoning summaries surface as
  // streamed reasoning parts. The Chat Completions path silently drops
  // `reasoningSummary` because that option only exists on Responses.
  return getAnalysisProvider()!.responses(modelId);
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

  // Titles stay on Chat Completions — they don't need reasoning summaries,
  // and `reasoningEffort: "none"` is cleanly supported there.
  return getAnalysisProvider()!.chat(modelId);
}

export function getAnalysisModelName(): string {
  return `${getAnalysisAIProvider()}/${getAnalysisModelId()}`;
}

export function getAnalysisTitleModelName(): string {
  return `${getAnalysisAIProvider()}/${getAnalysisTitleModelId()}`;
}

export function getAnalysisProviderOptions():
  | { anthropic: AnthropicLanguageModelOptions }
  | { openai: OpenAILanguageModelResponsesOptions }
  | undefined {
  if (getAnalysisAIProvider() === "anthropic") {
    const options: AnthropicLanguageModelOptions = {
      effort: parseAnalysisAnthropicEffort(process.env.ANALYSIS_ANTHROPIC_EFFORT),
    };

    if (parseAdaptiveThinkingFlag(process.env.ANALYSIS_ENABLE_ADAPTIVE_THINKING)) {
      options.thinking = { type: "adaptive" };
    }

    return { anthropic: options };
  }

  return getAnalysisOpenAIResponsesProviderOptions();
}

export function getAnalysisTitleProviderOptions():
  | { anthropic: AnthropicLanguageModelOptions }
  | { openai: OpenAILanguageModelChatOptions }
  | undefined {
  if (getAnalysisAIProvider() === "anthropic") {
    return {
      anthropic: {
        effort: "low",
      },
    };
  }

  return getAnalysisOpenAIChatProviderOptions({
    reasoningEnvVarName: "ANALYSIS_TITLE_REASONING_EFFORT",
    fallbackReasoningEffort: "none",
  });
}
