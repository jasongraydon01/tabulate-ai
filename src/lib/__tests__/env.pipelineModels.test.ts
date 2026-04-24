import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAIGateModel,
  getBannerGenerateModel,
  getBannerModel,
  getBaseModel,
  getCrosstabModel,
  getFilterTranslatorModel,
  getLoopGateModel,
  getLoopSemanticsModel,
  getNetEnrichmentModel,
  getReasoningModel,
  getSkipLogicModel,
  getStructureGateModel,
  getSubtypeGateModel,
  getSurveyCleanupModel,
  getTableContextModel,
  getVerificationModel,
} from "@/lib/env";

function expectResponsesModel(
  model: unknown,
  expectedProvider: "openai.responses" | "azure.responses",
  expectedModelId: string,
) {
  expect(model).toMatchObject({
    provider: expectedProvider,
    modelId: expectedModelId,
  });
}

describe("pipeline model selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses OpenAI Responses models across the pipeline getters", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-12345");
    vi.stubEnv("CROSSTAB_MODEL", "gpt-5.4");
    vi.stubEnv("BANNER_MODEL", "gpt-5.4-mini");
    vi.stubEnv("BANNER_GENERATE_MODEL", "gpt-5.4");
    vi.stubEnv("VERIFICATION_MODEL", "gpt-5.4-mini");
    vi.stubEnv("SKIPLOGIC_MODEL", "gpt-5.4-mini");
    vi.stubEnv("FILTERTRANSLATOR_MODEL", "gpt-5.4");
    vi.stubEnv("LOOP_SEMANTICS_MODEL", "gpt-5.4-mini");
    vi.stubEnv("AIGATE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("LOOP_GATE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("SUBTYPE_GATE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("STRUCTURE_GATE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("SURVEY_CLEANUP_MODEL", "gpt-5.4-mini");
    vi.stubEnv("TABLE_CONTEXT_MODEL", "gpt-5.4-mini");
    vi.stubEnv("NET_ENRICHMENT_MODEL", "gpt-5.4-mini");
    vi.stubEnv("REASONING_MODEL", "gpt-5.4");
    vi.stubEnv("BASE_MODEL", "gpt-5.4-mini");

    expectResponsesModel(getCrosstabModel(), "openai.responses", "gpt-5.4");
    expectResponsesModel(getBannerModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getBannerGenerateModel(), "openai.responses", "gpt-5.4");
    expectResponsesModel(getVerificationModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getSkipLogicModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getFilterTranslatorModel(), "openai.responses", "gpt-5.4");
    expectResponsesModel(getLoopSemanticsModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getAIGateModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getLoopGateModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getSubtypeGateModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getStructureGateModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getSurveyCleanupModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getTableContextModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getNetEnrichmentModel(), "openai.responses", "gpt-5.4-mini");
    expectResponsesModel(getReasoningModel(), "openai.responses", "gpt-5.4");
    expectResponsesModel(getBaseModel(), "openai.responses", "gpt-5.4-mini");
  });

  it("uses Azure Responses models across the pipeline getters", () => {
    vi.stubEnv("AI_PROVIDER", "azure");
    vi.stubEnv("AZURE_API_KEY", "azure-test-key-12345");
    vi.stubEnv("AZURE_RESOURCE_NAME", "demo-resource");
    vi.stubEnv("CROSSTAB_MODEL", "gpt-5.4");
    vi.stubEnv("VERIFICATION_MODEL", "gpt-5.4-mini");

    expectResponsesModel(getCrosstabModel(), "azure.responses", "gpt-5.4");
    expectResponsesModel(getVerificationModel(), "azure.responses", "gpt-5.4-mini");
    expectResponsesModel(getReasoningModel(), "azure.responses", "gpt-5.4");
  });
});
