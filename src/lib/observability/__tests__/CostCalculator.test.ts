import { describe, expect, it } from "vitest";

import { calculateCostSync } from "@/lib/observability/CostCalculator";

describe("CostCalculator GPT-5.4 fallback pricing", () => {
  it("uses fallback pricing for gpt-5.4", () => {
    const cost = calculateCostSync("openai/gpt-5.4", {
      input: 1_000_000,
      output: 1_000_000,
    });

    expect(cost.inputCost).toBeCloseTo(2.5);
    expect(cost.outputCost).toBeCloseTo(15);
    expect(cost.totalCost).toBeCloseTo(17.5);
  });

  it("uses fallback pricing for gpt-5.4-mini", () => {
    const cost = calculateCostSync("azure/gpt-5.4-mini", {
      input: 1_000_000,
      output: 1_000_000,
    });

    expect(cost.inputCost).toBeCloseTo(0.75);
    expect(cost.outputCost).toBeCloseTo(4.5);
    expect(cost.totalCost).toBeCloseTo(5.25);
  });

  it("uses fallback pricing for gpt-5.4-nano", () => {
    const cost = calculateCostSync("gpt-5.4-nano", {
      input: 1_000_000,
      output: 1_000_000,
    });

    expect(cost.inputCost).toBeCloseTo(0.2);
    expect(cost.outputCost).toBeCloseTo(1.25);
    expect(cost.totalCost).toBeCloseTo(1.45);
  });

  it("prices OpenAI cached input tokens with the cached-input rate when available", () => {
    const cost = calculateCostSync("openai/gpt-4.1", {
      input: 1_000_000,
      output: 100_000,
      inputNoCache: 400_000,
      inputCacheRead: 600_000,
    });

    expect(cost.inputCost).toBeCloseTo(1.1);
    expect(cost.outputCost).toBeCloseTo(0.8);
    expect(cost.totalCost).toBeCloseTo(1.9);
  });

  it("prices Anthropic cache reads and writes with explicit or fallback cache rates", () => {
    const cost = calculateCostSync("anthropic/claude-sonnet-4-6", {
      input: 1_000_000,
      output: 100_000,
      inputNoCache: 300_000,
      inputCacheRead: 500_000,
      inputCacheWrite: 200_000,
    });

    expect(cost.inputCost).toBeCloseTo(1.8);
    expect(cost.outputCost).toBeCloseTo(1.5);
    expect(cost.totalCost).toBeCloseTo(3.3);
  });
});
