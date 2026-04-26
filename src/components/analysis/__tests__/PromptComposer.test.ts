import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PromptComposer } from "@/components/analysis/PromptComposer";

describe("PromptComposer", () => {
  it("moves derived-run creation behind a subtle plus menu trigger", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PromptComposer, {
        value: "Add a region banner",
        onChange: () => {},
        onSubmit: async () => {},
        onComputeSubmit: async () => {},
        onStop: () => {},
        isBusy: false,
        isComputeBusy: false,
      }),
    );

    expect(markup).toContain("title=\"More actions\"");
    expect(markup).toContain("aria-haspopup=\"menu\"");
    expect(markup).toContain("title=\"Send message\"");
    expect(markup).not.toContain("title=\"Create derived run\"");
  });
});
