import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnalysisDeleteSessionDialogContent,
  AnalysisSessionList,
  formatSessionTime,
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
  it("formats recent session timestamps with relative labels", () => {
    const now = new Date(Date.UTC(2026, 3, 21, 18, 0));

    expect(formatSessionTime(Date.UTC(2026, 3, 21, 15, 30), now)).toContain("Today");
    expect(formatSessionTime(Date.UTC(2026, 3, 20, 15, 30), now)).toContain("Yesterday");
    expect(formatSessionTime(Date.UTC(2026, 3, 18, 15, 30), now)).toContain("Sat");
    expect(formatSessionTime(Date.UTC(2026, 2, 12, 15, 30), now)).toContain("Mar");
  });

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
    expect(markup).toMatch(/(Today|Yesterday|[A-Z][a-z]{2} \d{1,2}:\d{2}|[A-Z][a-z]{2} \d{1,2})/);
  });

  it("renders the richer empty state copy when no chats exist", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisSessionList, {
        sessions: [],
        selectedSessionId: null,
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

    expect(markup).toContain("No chats yet");
    expect(markup).toContain("grounded answers");
  });
});
