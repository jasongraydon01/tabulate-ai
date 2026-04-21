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
});
