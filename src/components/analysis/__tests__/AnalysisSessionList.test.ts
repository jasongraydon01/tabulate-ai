import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalysisDeleteSessionDialogContent } from "@/components/analysis/AnalysisSessionList";
import { Dialog } from "@/components/ui/dialog";

describe("AnalysisDeleteSessionDialogContent", () => {
  it("renders a plain confirm dialog without the typed-name prompt", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        Dialog,
        { open: true },
        React.createElement(AnalysisDeleteSessionDialogContent, {
          sessionTitle: "Wave 3 Review",
          isPending: false,
          onCancel: () => {},
          onConfirm: () => {},
        }),
      ),
    );

    expect(markup).toContain("Delete chat?");
    expect(markup).toContain("Wave 3 Review");
    expect(markup).toContain("Delete Chat");
    expect(markup).not.toContain("Type the chat title to confirm");
    expect(markup).not.toContain("<input");
  });
});
