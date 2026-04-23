import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { buildDeterministicFollowUpSuggestions } from "@/lib/analysis/followups";

describe("deterministic follow-up suggestions", () => {
  it("builds stable suggestions from grounded table cards", () => {
    const responseParts: UIMessage["parts"] = [
      {
        type: "tool-fetchTable",
        toolCallId: "tool-1",
        state: "output-available",
        input: {
          tableId: "q1_total",
          rowFilter: null,
          cutFilter: null,
          valueMode: "pct",
        },
        output: {
          status: "available",
          tableId: "q1_total",
          title: "Q1 overall",
          questionId: "Q1",
          questionText: "How satisfied are you?",
          tableType: "frequency",
          surveySection: null,
          baseText: "All respondents",
          tableSubtitle: null,
          userNote: null,
          valueMode: "pct",
          columns: [
            {
              cutKey: "__total__",
              cutName: "Total",
              groupName: "Total",
              statLetter: null,
              baseN: 200,
              isTotal: true,
            },
          ],
          rows: [],
          totalRows: 0,
          totalColumns: 1,
          truncatedRows: 0,
          truncatedColumns: 0,
          focusedCutIds: null,
          requestedRowFilter: null,
          requestedCutFilter: null,
          significanceTest: null,
          significanceLevel: null,
          comparisonGroups: [],
          sourceRefs: [],
        },
      } as UIMessage["parts"][number],
    ];

    expect(buildDeterministicFollowUpSuggestions({
      groundingContext: {
        tables: {
          q1_total: { questionId: "Q1" },
          q1_followup: { questionId: "Q1" },
        },
        bannerGroups: [],
        bannerPlanGroups: [],
      } as never,
      groundingRefs: [],
      responseParts,
    })).toEqual([
      "Show this in counts",
      "Show the base sizes here",
      "How was Q1 asked?",
      "Show the related tables for Q1",
    ]);
  });

  it("returns no suggestions for ungrounded assistant turns", () => {
    expect(buildDeterministicFollowUpSuggestions({
      groundingContext: {
        tables: {},
        bannerGroups: [],
        bannerPlanGroups: [],
      } as never,
      groundingRefs: [],
      responseParts: [{ type: "text", text: "Here is a general thought." }],
    })).toEqual([]);
  });
});
