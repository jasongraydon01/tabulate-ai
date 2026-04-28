"use client";

import ReactMarkdown from "react-markdown";
import { isToolUIPart } from "ai";

import { GroundedTableCard } from "@/components/analysis/GroundedTableCard";
import { AnalysisResponseMarkdown } from "@/components/analysis/AnalysisResponseMarkdown";
import type { AnalysisDisplayBlock } from "@/components/analysis/useAnalysisAnswerReveal";
import {
  getAnalysisCellAnchorId,
  getAnalysisEvidenceAnchorId,
} from "@/lib/analysis/anchors";
import { getAnalysisMessageMetadata } from "@/lib/analysis/messages";
import type { AnalysisRenderableInlineSegment } from "@/lib/analysis/renderAnchors";
import { getSettledAnalysisEvidenceItemCellId } from "@/lib/analysis/settledAnswer";
import {
  isAnalysisCellSummary,
  isAnalysisTableCard,
  parseAnalysisCellId,
  type AnalysisEvidenceItem,
} from "@/lib/analysis/types";
import type { AnalysisUIMessage } from "@/lib/analysis/ui";

interface CitationChipMeta {
  chipLabel: string;
  title: string;
}

interface CitationChipLookup {
  exactMetaByCellId: Map<string, CitationChipMeta>;
  chipLabelByTableId: Map<string, string>;
}

function getEvidenceItemCellId(item: AnalysisEvidenceItem): string | null {
  return getSettledAnalysisEvidenceItemCellId(item);
}

function buildCitationChipLookup(message: AnalysisUIMessage): CitationChipLookup {
  const exactMetaByCellId = new Map<string, CitationChipMeta>();
  const chipLabelByTableId = new Map<string, string>();
  const evidenceItems = getAnalysisMessageMetadata(message)?.evidence ?? [];

  for (const item of evidenceItems) {
    if (item.sourceTableId && item.sourceQuestionId?.trim()) {
      chipLabelByTableId.set(item.sourceTableId, item.sourceQuestionId.trim());
    }

    const cellId = getEvidenceItemCellId(item);
    if (!cellId) continue;

    const chipLabel = item.sourceQuestionId?.trim() || item.sourceTableId;
    if (!chipLabel) continue;

    exactMetaByCellId.set(cellId, {
      chipLabel,
      title: item.label,
    });
  }

  for (const part of message.parts) {
    if (
      !isToolUIPart(part)
      || part.type !== "tool-confirmCitation"
      || part.state !== "output-available"
    ) {
      continue;
    }

    const output = part.output;
    if (!isAnalysisCellSummary(output)) {
      continue;
    }

    const chipLabel = output.questionId?.trim() || output.tableId;
    const title = `${output.tableTitle} — ${output.rowLabel} / ${output.cutName}`;
    exactMetaByCellId.set(output.cellId, {
      chipLabel,
      title,
    });
    chipLabelByTableId.set(output.tableId, chipLabel);
  }

  for (const part of message.parts) {
    if (
      !isToolUIPart(part)
      || part.type !== "tool-fetchTable"
      || part.state !== "output-available"
      || !isAnalysisTableCard(part.output)
    ) {
      continue;
    }

    const chipLabel = part.output.questionId?.trim();
    if (!chipLabel) continue;

    chipLabelByTableId.set(part.output.tableId, chipLabel);
  }

  return {
    exactMetaByCellId,
    chipLabelByTableId,
  };
}

function resolveCitationChipMeta(
  cellId: string,
  citeLookup: CitationChipLookup,
): CitationChipMeta | null {
  const exactMeta = citeLookup.exactMetaByCellId.get(cellId);
  if (exactMeta) {
    return exactMeta;
  }

  const parsed = parseAnalysisCellId(cellId);
  if (!parsed) return null;

  const chipLabel = citeLookup.chipLabelByTableId.get(parsed.tableId);
  if (!chipLabel) return null;

  return {
    chipLabel,
    title: `${parsed.tableId} — ${parsed.rowKey} / ${parsed.cutKey}`,
  };
}

function highlightAnchor(target: HTMLElement) {
  target.classList.add("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  }, 1200);
}

function scrollToCellAnchors(cellIds: string[]) {
  const targets = cellIds
    .map((cellId) => document.getElementById(getAnalysisCellAnchorId(cellId)))
    .filter((target): target is HTMLElement => target instanceof HTMLElement);
  if (targets.length === 0) return;

  targets[0].scrollIntoView({ behavior: "smooth", block: "center" });
  for (const target of targets) {
    highlightAnchor(target);
  }
}

function CiteChip({
  cellIds,
  citeLookup,
}: {
  cellIds: string[];
  citeLookup: CitationChipLookup;
}) {
  if (cellIds.length === 0) return null;

  const labels = [...new Set(cellIds.map((cellId) => {
    const meta = resolveCitationChipMeta(cellId, citeLookup);
    if (meta?.chipLabel) return meta.chipLabel;
    const parsed = parseAnalysisCellId(cellId);
    return parsed?.tableId ?? cellId;
  }))];
  const chipLabel = labels.join(",");
  const title = cellIds
    .map((cellId) => {
      const meta = resolveCitationChipMeta(cellId, citeLookup);
      if (meta?.title) return meta.title;
      const parsed = parseAnalysisCellId(cellId);
      if (!parsed) return cellId;
      return `${parsed.tableId} — ${parsed.rowKey} / ${parsed.cutKey}`;
    })
    .join("\n");

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        scrollToCellAnchors(cellIds);
      }}
      title={title}
      className="mx-0.5 inline-flex items-baseline align-super text-[0.65em] font-mono text-tab-teal/90 hover:text-tab-teal underline-offset-2 hover:underline"
      aria-label={`Citation ${chipLabel}`}
    >
      <span>{chipLabel}</span>
    </button>
  );
}

function InlineCitationText({
  segments,
  citeLookup,
}: {
  segments: AnalysisRenderableInlineSegment[];
  citeLookup: CitationChipLookup;
}) {
  return (
    <p className="min-w-0 whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.65] [overflow-wrap:anywhere]">
      {segments.map((segment, segmentIndex) => {
        if (segment.kind === "text") {
          return (
            <ReactMarkdown
              key={`text-${segmentIndex}`}
              components={{
                p: ({ children }) => <>{children}</>,
              }}
            >
              {segment.text}
            </ReactMarkdown>
          );
        }

        return (
          <CiteChip
            key={`cite-${segmentIndex}`}
            cellIds={segment.cellIds}
            citeLookup={citeLookup}
          />
        );
      })}
    </p>
  );
}

export function AnalysisAnswerBody({
  message,
  displayBlocks,
  isRevealing,
}: {
  message: AnalysisUIMessage;
  displayBlocks: AnalysisDisplayBlock[];
  isRevealing: boolean;
}) {
  const citeLookup = buildCitationChipLookup(message);

  return (
    <>
      {displayBlocks.map((block) => {
        if (block.kind === "text") {
          const hasCiteMarkers = block.segments.some((segment) => segment.kind === "cite");

          if (!hasCiteMarkers) {
            return (
              <div key={block.key}>
                <AnalysisResponseMarkdown
                  text={block.segments
                    .filter((segment): segment is Extract<AnalysisRenderableInlineSegment, { kind: "text" }> => segment.kind === "text")
                    .map((segment) => segment.text)
                    .join("")}
                  isStreaming={isRevealing}
                />
              </div>
            );
          }

          return (
            <div
              key={block.key}
              className="prose-analysis min-w-0 max-w-none break-words [overflow-wrap:anywhere]"
            >
              <InlineCitationText
                segments={block.segments}
                citeLookup={citeLookup}
              />
            </div>
          );
        }

        if (block.kind === "placeholder") {
          return (
            <div
              key={block.key}
              className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
            >
              Loading table...
            </div>
          );
        }

        if (block.kind === "missing") {
          return (
            <div
              key={block.key}
              className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
            >
              Referenced table not available.
            </div>
          );
        }

        if (block.kind === "table" && block.part.state === "output-available" && isAnalysisTableCard(block.part.output)) {
          return (
            <div
              key={block.key}
              id={getAnalysisEvidenceAnchorId(block.part.toolCallId)}
              className="scroll-mt-24 rounded-xl transition-shadow duration-300"
            >
              <GroundedTableCard
                card={block.part.output}
                focus={block.focus}
                displayState={block.displayState}
              />
            </div>
          );
        }

        return (
          <div
            key={block.key}
            className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          >
            Loading table...
          </div>
        );
      })}
    </>
  );
}
