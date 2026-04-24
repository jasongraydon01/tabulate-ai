import { describe, expect, it } from "vitest";

import {
  buildAnalysisCiteMarker,
  buildAnalysisCiteSegments,
  extractAnalysisCiteMarkers,
  stripAnalysisCiteAnchors,
  stripInvalidAnalysisCiteMarkers,
  validateAnalysisCiteMarkers,
} from "@/lib/analysis/citeAnchors";
import { buildAnalysisCellId } from "@/lib/analysis/types";

const CELL_A = buildAnalysisCellId({
  tableId: "A3",
  rowKey: "row_1_csb",
  cutKey: "__total__::total",
});

const CELL_B = buildAnalysisCellId({
  tableId: "A3",
  rowKey: "row_1_csb",
  cutKey: "group:age::25-34",
});

describe("analysis cite markers", () => {
  it("builds the expected marker form for one and many cellIds", () => {
    expect(buildAnalysisCiteMarker([CELL_A])).toBe(`[[cite cellIds=${CELL_A}]]`);
    expect(buildAnalysisCiteMarker([CELL_A, CELL_B])).toBe(
      `[[cite cellIds=${CELL_A},${CELL_B}]]`,
    );
  });

  it("strips cite markers from assistant text", () => {
    const text = `Some number here.${buildAnalysisCiteMarker([CELL_A])}\n\nMore text.`;
    expect(stripAnalysisCiteAnchors(text)).toBe("Some number here.\n\nMore text.");
  });

  it("extracts every marker occurrence with its raw text and cellIds", () => {
    const marker = buildAnalysisCiteMarker([CELL_A, CELL_B]);
    const text = `Before ${marker} after.`;
    const occurrences = extractAnalysisCiteMarkers(text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.cellIds).toEqual([CELL_A, CELL_B]);
    expect(occurrences[0]!.raw).toBe(marker);
    expect(text.slice(occurrences[0]!.start, occurrences[0]!.end)).toBe(marker);
  });

  it("accepts the singular cellId= alias", () => {
    const text = `Value.[[cite cellId=${CELL_A}]] End.`;
    const occurrences = extractAnalysisCiteMarkers(text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.cellIds).toEqual([CELL_A]);
  });

  it("accepts quoted marker bodies", () => {
    const text = `Value.[[cite cellIds="${CELL_A},${CELL_B}"]] End.`;
    const occurrences = extractAnalysisCiteMarkers(text);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.cellIds).toEqual([CELL_A, CELL_B]);
  });

  it("reports no issues when every cellId is confirmed", () => {
    const text = `X${buildAnalysisCiteMarker([CELL_A, CELL_B])}.`;
    const issues = validateAnalysisCiteMarkers({
      text,
      confirmedCellIds: [CELL_A, CELL_B],
    });
    expect(issues).toEqual([]);
  });

  it("flags a marker whose every cellId is unconfirmed as not_confirmed_this_turn", () => {
    const text = `X${buildAnalysisCiteMarker([CELL_A, CELL_B])}.`;
    const issues = validateAnalysisCiteMarkers({ text, confirmedCellIds: [] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe("not_confirmed_this_turn");
    expect(issues[0]!.unconfirmedCellIds).toEqual([CELL_A, CELL_B]);
  });

  it("flags a marker with some confirmed + some unconfirmed cellIds as partial_unconfirmed", () => {
    const text = `X${buildAnalysisCiteMarker([CELL_A, CELL_B])}.`;
    const issues = validateAnalysisCiteMarkers({ text, confirmedCellIds: [CELL_A] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe("partial_unconfirmed");
    expect(issues[0]!.unconfirmedCellIds).toEqual([CELL_B]);
  });

  it("flags empty markers (cellIds= with no body)", () => {
    // Synthesize an empty-body marker by hand — the grammar accepts a lone comma
    // as an unquoted body that resolves to zero cellIds after trimming.
    const text = `X[[cite cellIds=,]] End.`;
    const issues = validateAnalysisCiteMarkers({ text, confirmedCellIds: [] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe("empty");
  });

  it("strips only the invalid marker occurrences and keeps valid ones", () => {
    const good = buildAnalysisCiteMarker([CELL_A]);
    const bad = buildAnalysisCiteMarker([CELL_B]);
    const text = `Good ${good} bad ${bad} end.`;
    const issues = validateAnalysisCiteMarkers({ text, confirmedCellIds: [CELL_A] });
    const stripped = stripInvalidAnalysisCiteMarkers(text, issues);
    expect(stripped).toContain(good);
    expect(stripped).not.toContain(bad);
  });

  it("builds text/cite/text segments in order with 1-based indexWithinMessage", () => {
    const marker1 = buildAnalysisCiteMarker([CELL_A]);
    const marker2 = buildAnalysisCiteMarker([CELL_B]);
    const text = `Alpha ${marker1} beta ${marker2} gamma.`;

    const segments = buildAnalysisCiteSegments(text);
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "cite", "text", "cite", "text"]);

    const first = segments[1];
    const second = segments[3];
    if (first?.kind !== "cite" || second?.kind !== "cite") {
      throw new Error("expected cite segments at indices 1 and 3");
    }
    expect(first.indexWithinMessage).toBe(1);
    expect(second.indexWithinMessage).toBe(2);
    expect(first.cellIds).toEqual([CELL_A]);
    expect(second.cellIds).toEqual([CELL_B]);
  });

  it("returns a single text segment when there are no markers", () => {
    const segments = buildAnalysisCiteSegments("Plain text with no markers.");
    expect(segments).toEqual([{ kind: "text", text: "Plain text with no markers." }]);
  });

  it("returns [] for empty input", () => {
    expect(buildAnalysisCiteSegments("")).toEqual([]);
  });

  it("handles a marker at the very end with no trailing text", () => {
    const marker = buildAnalysisCiteMarker([CELL_A]);
    const segments = buildAnalysisCiteSegments(`Only a number.${marker}`);
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "cite"]);
  });
});
