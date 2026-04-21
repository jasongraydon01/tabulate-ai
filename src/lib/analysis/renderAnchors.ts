import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import { isAnalysisTableCard, type AnalysisTableCard } from "@/lib/analysis/types";

export const ANALYSIS_TABLE_RENDER_ANCHOR = "[[render-table]]";

type TableCardUIPart = UIMessage["parts"][number] & {
  type: "tool-getTableCard";
  toolCallId: string;
  state: "output-available";
  output: AnalysisTableCard;
};

export type AnalysisRenderableBlock =
  | { kind: "text"; key: string; text: string }
  | { kind: "placeholder"; key: string }
  | { kind: "table"; key: string; part: TableCardUIPart };

function normalizeRenderableText(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getRenderableTableParts(parts: UIMessage["parts"]): TableCardUIPart[] {
  function isTableCardUIPart(part: UIMessage["parts"][number]): part is TableCardUIPart {
    return (
      isToolUIPart(part)
      && part.type === "tool-getTableCard"
      && part.state === "output-available"
      && typeof part.toolCallId === "string"
      && isAnalysisTableCard(part.output)
    );
  }

  return parts.flatMap((part) => {
    if (isTableCardUIPart(part)) {
      return [part];
    }

    return [];
  });
}

export function stripAnalysisRenderAnchors(text: string): string {
  return normalizeRenderableText(text.replaceAll(ANALYSIS_TABLE_RENDER_ANCHOR, "\n\n"));
}

export function buildAnalysisRenderableBlocks(
  message: Pick<UIMessage, "id" | "parts">,
  options?: {
    isStreaming?: boolean;
  },
): AnalysisRenderableBlock[] {
  const text = message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
  const tableParts = [...getRenderableTableParts(message.parts)];
  const hasAnchor = text.includes(ANALYSIS_TABLE_RENDER_ANCHOR);

  if (!hasAnchor) {
    if (text.trim().length === 0 && options?.isStreaming && tableParts.length > 0) {
      return [];
    }

    const blocks: AnalysisRenderableBlock[] = [];
    const cleanedText = normalizeRenderableText(text);
    if (cleanedText) {
      blocks.push({
        kind: "text",
        key: `${message.id}-text-0`,
        text: cleanedText,
      });
    }

    tableParts.forEach((part, index) => {
      blocks.push({
        kind: "table",
        key: `${message.id}-table-${part.toolCallId ?? index}`,
        part,
      });
    });

    return blocks;
  }

  const blocks: AnalysisRenderableBlock[] = [];
  const segments = text.split(ANALYSIS_TABLE_RENDER_ANCHOR);

  segments.forEach((segment, index) => {
    const cleanedSegment = normalizeRenderableText(segment);
    if (cleanedSegment) {
      blocks.push({
        kind: "text",
        key: `${message.id}-text-${index}`,
        text: cleanedSegment,
      });
    }

    if (index >= segments.length - 1) return;

    const nextTable = tableParts.shift();
    if (!nextTable) {
      if (options?.isStreaming) {
        blocks.push({
          kind: "placeholder",
          key: `${message.id}-placeholder-${index}`,
        });
      }
      return;
    }

    blocks.push({
      kind: "table",
      key: `${message.id}-table-${nextTable.toolCallId ?? index}`,
      part: nextTable,
    });
  });

  tableParts.forEach((part, index) => {
    blocks.push({
      kind: "table",
      key: `${message.id}-table-fallback-${part.toolCallId ?? index}`,
      part,
    });
  });

  return blocks;
}
