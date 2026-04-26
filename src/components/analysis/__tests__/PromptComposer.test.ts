import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PromptComposer } from "@/components/analysis/PromptComposer";

describe("PromptComposer", () => {
  it("renders a separate derived-run action next to normal chat send", () => {
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

    expect(markup).toContain("Create derived run");
    expect(markup).toContain("title=\"Send message\"");
    expect(markup).toContain("title=\"Create derived run\"");
  });
});
