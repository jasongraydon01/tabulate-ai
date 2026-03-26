import { describe, expect, it } from "vitest";
import { evaluateRunArtifacts } from "@/lib/evaluation/RunEvaluator";

function makeBaseArtifacts() {
  return {
    banner: {
      bannerCuts: [
        {
          groupName: "Total",
          columns: [
            {
              name: "Total",
              original: "TRUE",
              adjusted: "TRUE",
              statLetter: "A",
              requiresInference: false,
              humanInLoopRequired: false,
              confidence: 0.95,
            },
          ],
        },
      ],
    },
    crosstab: {
      bannerCuts: [
        {
          groupName: "Total",
          columns: [
            {
              name: "Total",
              adjusted: "TRUE",
              alternatives: [{ expression: "TRUE" }],
            },
          ],
        },
      ],
    },
    verification: {
      tables: [
        {
          tableId: "T1",
          tableType: "frequency",
          title: "Sample Title",
          exclude: false,
          rows: [
            { variable: "Q1", label: "Row 1", filterValue: "1", isNet: false },
            { variable: "Q1", label: "Row 2", filterValue: "2", isNet: false },
          ],
        },
      ],
    },
    data: {
      T1: {
        Total: {
          "Q1|1": { n: 100, count: 50, pct: 50, sig_higher_than: [], sig_vs_total: null },
          "Q1|2": { n: 100, count: 30, pct: 30, sig_higher_than: ["B"], sig_vs_total: "A" },
        },
      },
    },
  };
}

describe("RunEvaluator", () => {
  it("returns perfect score for identical artifacts", () => {
    const expected = makeBaseArtifacts();
    const actual = makeBaseArtifacts();
    const result = evaluateRunArtifacts({ expected, actual, runDiagnostics: { warnings: [] } });

    expect(result.score).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.divergenceLevel).toBe("none");
    expect(result.diffCounts.meaningful).toBe(0);
  });

  it("treats small numeric deltas as acceptable", () => {
    const expected = makeBaseArtifacts();
    const actual = makeBaseArtifacts();
    (actual.data as Record<string, unknown>).T1 = {
      Total: {
        "Q1|1": { n: 101, count: 51, pct: 50.08, sig_higher_than: [], sig_vs_total: null },
        "Q1|2": { n: 100, count: 31, pct: 30.03, sig_higher_than: ["B"], sig_vs_total: "A" },
      },
    };

    const result = evaluateRunArtifacts({ expected, actual });
    expect(result.diffCounts.acceptable).toBeGreaterThan(0);
    expect(result.diffCounts.meaningful).toBe(0);
    expect(result.divergenceLevel).toBe("none");
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("marks missing tables as major divergence", () => {
    const expected = makeBaseArtifacts();
    const actual = makeBaseArtifacts();
    actual.verification = { tables: [] };

    const result = evaluateRunArtifacts({ expected, actual });
    expect(result.diffCounts.meaningful).toBeGreaterThan(0);
    expect(result.divergenceLevel).toBe("major");
    expect(result.score).toBeLessThan(88);
  });
});
