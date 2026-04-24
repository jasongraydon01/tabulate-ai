import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock, responsesMock, chatMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  responsesMock: vi.fn((deployment: string) => ({
    provider: "openai.responses",
    modelId: deployment,
  })),
  chatMock: vi.fn((deployment: string) => ({
    provider: "openai.chat",
    modelId: deployment,
  })),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("../../env", () => ({
  getActiveProvider: vi.fn(() => ({
    responses: responsesMock,
    chat: chatMock,
  })),
  getEnvironmentConfig: vi.fn(() => ({
    aiProvider: "openai",
  })),
}));

import { runHealthCheckForAgentModels } from "../HealthCheck";

describe("runHealthCheckForAgentModels", () => {
  beforeEach(() => {
    generateTextMock.mockResolvedValue({ text: "OK" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("probes deployments through the Responses API", async () => {
    const result = await runHealthCheckForAgentModels([
      { agent: "BannerGenerateAgent", model: "gpt-5.4" },
    ]);

    expect(result.success).toBe(true);
    expect(responsesMock).toHaveBeenCalledWith("gpt-5.4");
    expect(chatMock).not.toHaveBeenCalled();
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "openai.responses",
          modelId: "gpt-5.4",
        }),
        maxOutputTokens: 16,
      }),
    );
  });
});
