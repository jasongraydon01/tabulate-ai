import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnalysisDeleteSessionDialogContent,
  AnalysisSessionList,
} from "@/components/analysis/AnalysisSessionList";
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

describe("AnalysisSessionList", () => {
  it("shows a generated-title indicator for AI-generated chat titles", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisSessionList, {
        sessions: [
          {
            _id: "session-1",
            title: "Brand Attribute Comparison",
            titleSource: "generated",
            status: "active",
            createdAt: Date.UTC(2026, 3, 20),
            lastMessageAt: Date.UTC(2026, 3, 20),
          },
        ],
        selectedSessionId: "session-1",
        isLoading: false,
        isCreating: false,
        isOpen: true,
        onToggle: () => {},
        onCreateSession: async () => {},
        onSelectSession: () => {},
        onRenameSession: async () => {},
        onDeleteSession: async () => {},
      }),
    );

    expect(markup).toContain("Brand Attribute Comparison");
    expect(markup).toContain("Generated");
  });
});
