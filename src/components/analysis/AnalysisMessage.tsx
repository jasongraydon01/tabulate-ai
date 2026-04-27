"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  isReasoningUIPart,
  isToolUIPart,
} from "ai";
import { Check, ChevronDown, Copy, Link2, Pencil, ThumbsDown, ThumbsUp } from "lucide-react";

import { GroundedTableCard } from "@/components/analysis/GroundedTableCard";
import { AnalysisResponseMarkdown } from "@/components/analysis/AnalysisResponseMarkdown";
import {
  AnalysisWorkDisclosure,
  type AnalysisWorkActivityEntry,
} from "@/components/analysis/AnalysisWorkDisclosure";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  getAnalysisMessageMetadata,
  getAnalysisUIMessageText,
} from "@/lib/analysis/messages";
import {
  getAnalysisCellAnchorId,
  getAnalysisEvidenceAnchorId,
} from "@/lib/analysis/anchors";
import {
  type AnalysisRenderableInlineSegment,
  type AnalysisRenderableBlock,
} from "@/lib/analysis/renderAnchors";
import {
  buildSettledAnalysisAnswer,
  getSettledAnalysisEvidenceItemCellId,
  getSettledAnalysisVisibleEvidenceItems,
} from "@/lib/analysis/settledAnswer";
import { getAnalysisToolActivityLabel } from "@/lib/analysis/toolLabels";
import {
  isAnalysisStatusDataUIPart,
  type AnalysisUIMessage,
} from "@/lib/analysis/ui";
import {
  isAnalysisCellSummary,
  isAnalysisTableCard,
  parseAnalysisCellId,
  type AnalysisEvidenceItem,
  type AnalysisMessageFeedbackRecord,
  type AnalysisMessageFeedbackVote,
} from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

export type AnalysisAnswerRevealPhase = "thinking" | "handoff" | "composing" | "settled";

interface AnalysisStableTextWindow {
  stableText: string;
  unstableTail: string;
}

type AnalysisRevealEntry =
  | { kind: "text"; blockIndex: number; segmentsDelta: AnalysisRenderableInlineSegment[] }
  | { kind: "table"; blockIndex: number }
  | { kind: "missing"; blockIndex: number }
  | { kind: "placeholder"; blockIndex: number };

type AnalysisDisplayBlock =
  | { kind: "text"; key: string; segments: AnalysisRenderableInlineSegment[] }
  | (Extract<AnalysisRenderableBlock, { kind: "table" }> & { displayState: "ready" | "shell" })
  | Extract<AnalysisRenderableBlock, { kind: "missing" | "placeholder" }>;

const ANALYSIS_REVEAL_INITIAL_DELAY_MS = 260;
const ANALYSIS_REVEAL_TEXT_DELAY_MS = 145;
const ANALYSIS_REVEAL_PARAGRAPH_DELAY_MS = 220;
const ANALYSIS_REVEAL_TABLE_HOLD_DELAY_MS = 240;
const ANALYSIS_REVEAL_POST_TABLE_DELAY_MS = 160;

export function splitAnalysisStableTextWindow(
  text: string,
  _isStreaming: boolean,
): AnalysisStableTextWindow {
  return {
    stableText: text,
    unstableTail: "",
  };
}

function splitParagraphForReveal(paragraph: string): string[] {
  if (!paragraph) return [];
  const chunks: string[] = [];
  let sentenceStart = 0;
  let cursor = 0;

  while (cursor < paragraph.length) {
    const char = paragraph[cursor];
    if (!char || !/[.!?]/.test(char)) {
      cursor += 1;
      continue;
    }

    let sentenceEnd = cursor + 1;

    while (sentenceEnd < paragraph.length && /["')\]]/.test(paragraph[sentenceEnd] ?? "")) {
      sentenceEnd += 1;
    }

    while (sentenceEnd < paragraph.length && /\s/.test(paragraph[sentenceEnd] ?? "")) {
      sentenceEnd += 1;
    }

    if (sentenceEnd > sentenceStart) {
      chunks.push(paragraph.slice(sentenceStart, sentenceEnd));
    }
    sentenceStart = sentenceEnd;
    cursor = sentenceEnd;
  }

  if (sentenceStart < paragraph.length) {
    chunks.push(paragraph.slice(sentenceStart));
  }

  return chunks.length > 0 ? chunks : [paragraph];
}

export function splitAnalysisTextForReveal(text: string): string[] {
  if (text.length === 0) return [];

  const chunks: string[] = [];
  const segments = text.split(/(\n{2,})/);

  for (const segment of segments) {
    if (segment.length === 0) continue;

    if (/^\n{2,}$/.test(segment)) {
      if (chunks.length === 0) {
        chunks.push(segment);
      } else {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}${segment}`;
      }
      continue;
    }

    for (const paragraphChunk of splitParagraphForReveal(segment)) {
      chunks.push(paragraphChunk);
    }
  }

  return chunks;
}

function splitAnalysisInlineSegmentsForReveal(
  segments: AnalysisRenderableInlineSegment[],
): AnalysisRenderableInlineSegment[][] {
  const chunks: AnalysisRenderableInlineSegment[][] = [];

  for (const segment of segments) {
    if (segment.kind === "text") {
      const textChunks = splitAnalysisTextForReveal(segment.text);
      for (const textChunk of textChunks) {
        if (textChunk.length === 0) continue;
        chunks.push([{ kind: "text", text: textChunk }]);
      }
      continue;
    }

    if (chunks.length === 0) {
      chunks.push([{ kind: "cite", cellIds: [...segment.cellIds] }]);
      continue;
    }

    chunks[chunks.length - 1]!.push({
      kind: "cite",
      cellIds: [...segment.cellIds],
    });
  }

  return chunks;
}

export function buildAnalysisRevealEntries(
  blocks: AnalysisRenderableBlock[],
): AnalysisRevealEntry[] {
  return blocks.flatMap((block, blockIndex): AnalysisRevealEntry[] => {
    if (block.kind === "text") {
      const chunks = splitAnalysisInlineSegmentsForReveal(block.segments);
      return chunks.map((segmentsDelta) => ({
        kind: "text",
        blockIndex,
        segmentsDelta,
      }));
    }

    return [{
      kind: block.kind,
      blockIndex,
    }];
  });
}

export function buildAnalysisDisplayBlocks(
  blocks: AnalysisRenderableBlock[],
  entries: AnalysisRevealEntry[],
  releasedEntryCount: number,
): AnalysisDisplayBlock[] {
  const releasedTextByBlockIndex = new Map<number, AnalysisRenderableInlineSegment[]>();
  const readyBlockIndexes = new Set<number>();
  const nextEntry = entries[Math.min(releasedEntryCount, entries.length)];
  const nextTableShellBlockIndex = nextEntry?.kind === "table" ? nextEntry.blockIndex : null;

  for (const entry of entries.slice(0, Math.min(releasedEntryCount, entries.length))) {
    if (entry.kind === "text") {
      releasedTextByBlockIndex.set(
        entry.blockIndex,
        [
          ...(releasedTextByBlockIndex.get(entry.blockIndex) ?? []),
          ...entry.segmentsDelta.map<AnalysisRenderableInlineSegment>((segment) => (
            segment.kind === "text"
              ? { kind: "text", text: segment.text }
              : { kind: "cite", cellIds: [...segment.cellIds] }
          )),
        ],
      );
      continue;
    }

    readyBlockIndexes.add(entry.blockIndex);
  }

  const displayBlocks: AnalysisDisplayBlock[] = [];

  blocks.forEach((block, blockIndex) => {
    if (block.kind === "text") {
      const segments = releasedTextByBlockIndex.get(blockIndex);
      if (segments && segments.length > 0) {
        displayBlocks.push({
          kind: "text",
          key: block.key,
          segments,
        });
      }
      return;
    }

    if (block.kind === "table") {
      if (readyBlockIndexes.has(blockIndex)) {
        displayBlocks.push({
          ...block,
          displayState: "ready",
        });
        return;
      }

      if (nextTableShellBlockIndex === blockIndex) {
        displayBlocks.push({
          ...block,
          displayState: "shell",
        });
      }
      return;
    }

    if (readyBlockIndexes.has(blockIndex)) {
      displayBlocks.push(block);
    }
  });

  return displayBlocks;
}

export function getAnalysisAnswerRevealPhase(params: {
  isStreaming: boolean;
  hasEverStreamed: boolean;
  releasedEntryCount: number;
  totalEntryCount: number;
  unstableTail: string;
}): AnalysisAnswerRevealPhase {
  if (!params.hasEverStreamed) {
    return "settled";
  }

  if (params.totalEntryCount === 0 && params.releasedEntryCount === 0) {
    return "thinking";
  }

  if (params.releasedEntryCount === 0) {
    return "handoff";
  }

  if (
    params.releasedEntryCount < params.totalEntryCount
    || params.isStreaming
    || params.unstableTail.length > 0
  ) {
    return "composing";
  }

  return "settled";
}

export function getNextAnalysisRevealDelayMs(params: {
  releasedEntryCount: number;
  entries: AnalysisRevealEntry[];
}): number {
  if (params.releasedEntryCount === 0) {
    return ANALYSIS_REVEAL_INITIAL_DELAY_MS;
  }

  const previousEntry = params.entries[params.releasedEntryCount - 1];
  const nextEntry = params.entries[params.releasedEntryCount];

  if (previousEntry?.kind === "table") {
    return ANALYSIS_REVEAL_POST_TABLE_DELAY_MS;
  }

  if (
    previousEntry?.kind === "text"
    && previousEntry.segmentsDelta.some((segment) => segment.kind === "text" && segment.text.includes("\n\n"))
  ) {
    return ANALYSIS_REVEAL_PARAGRAPH_DELAY_MS;
  }

  if (nextEntry?.kind === "table") {
    return ANALYSIS_REVEAL_TABLE_HOLD_DELAY_MS;
  }

  return ANALYSIS_REVEAL_TEXT_DELAY_MS;
}

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
  const evidenceItems = getAnalysisMessageEvidenceItems(message);

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

function CopyMessageButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  async function handleCopy() {
    const payload = text.trim();
    if (!payload) return;

    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      toast.success("Copied to clipboard");
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <button
      type="button"
      onClick={() => { void handleCopy(); }}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// Strip common markdown markers from reasoning summary text. OpenAI's
// Responses API emits reasoning-summary chunks containing things like
// `**Filtering bank data**` and `- step`, but the UI renders reasoning as
// plain text, so the markers show literally. Stripping is deterministic —
// keep the prompt out of this.
function stripReasoningMarkdown(text: string): string {
  return text
    // Images first (dropped entirely, including alt text).
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Links → keep label, drop url.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Code fences and inline code → keep inner text.
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-zA-Z]*\n?|```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    // Bold / italic via asterisk or underscore — strip the markers, keep text.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_(?!_)([^_\n]+)_(?!_)/g, "$1")
    // Strikethrough.
    .replace(/~~([^~]+)~~/g, "$1")
    // ATX headings at the start of a line.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // Blockquote markers.
    .replace(/^\s*>\s?/gm, "")
    // Unordered list bullets at the start of a line (only spaces/tabs, never
    // newlines — otherwise a leading blank line gets folded into the bullet).
    .replace(/^[ \t]*[-*+]\s+/gm, "")
    // Ordered list numerals at the start of a line.
    .replace(/^[ \t]*\d+\.\s+/gm, "")
    // Horizontal rules on their own line.
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, "");
}

function truncateReasoning(text: string, maxLength = 120): string {
  const stripped = stripReasoningMarkdown(text);
  const firstLine = stripped.split("\n")[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength).trim()}...`;
}

type TraceEntry =
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; state: string };

const MAX_ANALYSIS_REASONING_SUMMARY_UI_CHARS = 600;
const INTERNAL_ANALYSIS_TOOL_NAME_RE = /\b(?:tool-[A-Za-z0-9_-]+|submitAnswer|searchRunCatalog|fetchTable|getQuestionContext|listBannerCuts|confirmCitation|proposeDerivedRun|proposeRowRollup|proposeSelectedTableCut)\b/g;
const JSON_OBJECTISH_LINE_RE = /(?:\{[^\n]*(?:"|:)[^\n]*\}|\[[^\n]*(?:"|:)[^\n]*\])/g;

export function sanitizeAnalysisReasoningSummaryForUI(text: string): string {
  const sanitized = stripReasoningMarkdown(text)
    .replace(INTERNAL_ANALYSIS_TOOL_NAME_RE, "analysis step")
    .replace(JSON_OBJECTISH_LINE_RE, " [details hidden] ")
    .replace(/[<>]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (sanitized.length <= MAX_ANALYSIS_REASONING_SUMMARY_UI_CHARS) {
    return sanitized;
  }

  return `${sanitized.slice(0, MAX_ANALYSIS_REASONING_SUMMARY_UI_CHARS).trim()}...`;
}

export function getAnalysisTraceEntries(message: AnalysisUIMessage): TraceEntry[] {
  if (message.role === "user") {
    return [];
  }

  return message.parts.flatMap((part, index): TraceEntry[] => {
    if (isReasoningUIPart(part)) {
      const text = sanitizeAnalysisReasoningSummaryForUI(part.text);
      if (!text) return [];

      return [{
        kind: "reasoning",
        id: `${message.id}-reasoning-${index}`,
        text,
      }];
    }
    if (isToolUIPart(part)) {
      // `tool-fetchTable` plays two roles: it surfaces as a "Fetching table"
      // chip in the thinking trace here, AND its output data is resolved
      // inline wherever the prose emits a `[[render tableId=…]]` marker.
      // `buildAnalysisRenderableBlocks` handles the render path separately.
      const label = getAnalysisToolActivityLabel(part.type);
      if (!label) return [];
      return [{
        kind: "tool",
        id: part.toolCallId,
        label,
        state: part.state,
      }];
    }
    return [];
  });
}

export function getAnalysisValidationStatusLabel(message: AnalysisUIMessage): string | null {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (!part || !isAnalysisStatusDataUIPart(part)) continue;
    if (part.data.phase !== "validating_answer") continue;
    const label = part.data.label.trim();
    if (label.length > 0) return label;
  }

  return null;
}

export function getAnalysisTraceHeaderLabel(
  traceEntries: TraceEntry[],
  collapsedSummary: string | null,
  isExpanded: boolean,
): string {
  const hasReasoningSummary = traceEntries.some((entry) => entry.kind === "reasoning");
  if (hasReasoningSummary) {
    return isExpanded ? "Reasoning" : (collapsedSummary ?? "Reasoning");
  }

  return isExpanded ? "Analysis steps" : (collapsedSummary ?? "Analysis steps");
}

export function getAnalysisWorkStatusLabel(params: {
  traceEntries: TraceEntry[];
  validationStatusLabel: string | null;
  answerRevealBegins: boolean;
  isStreaming: boolean;
}): string | null {
  if (params.answerRevealBegins) {
    return params.traceEntries.length > 0 ? "Analysis steps" : null;
  }

  if (params.validationStatusLabel) {
    return params.validationStatusLabel;
  }

  for (let index = params.traceEntries.length - 1; index >= 0; index -= 1) {
    const entry = params.traceEntries[index];
    if (entry.kind === "tool") {
      const inProgress = params.isStreaming && entry.state !== "output-available";
      return `${entry.label}${inProgress ? "..." : ""}`;
    }
  }

  for (let index = params.traceEntries.length - 1; index >= 0; index -= 1) {
    const entry = params.traceEntries[index];
    if (entry.kind === "reasoning" && entry.text.trim().length > 0) {
      return truncateReasoning(entry.text);
    }
  }

  return params.traceEntries.length > 0 ? "Analysis steps" : null;
}

export function getAnalysisMessageEvidenceItems(message: AnalysisUIMessage): AnalysisEvidenceItem[] {
  return getAnalysisMessageMetadata(message)?.evidence ?? [];
}

export function getAnalysisMessageFollowUpItems(message: AnalysisUIMessage): string[] {
  return buildSettledAnalysisAnswer(message).followUpSuggestions;
}

export function getVisibleEvidenceItems(
  message: AnalysisUIMessage,
  evidenceItems: AnalysisEvidenceItem[],
): AnalysisEvidenceItem[] {
  return getSettledAnalysisVisibleEvidenceItems(message, evidenceItems);
}

function scrollToEvidenceAnchor(anchorId: string) {
  const target = document.getElementById(getAnalysisEvidenceAnchorId(anchorId));
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  }, 1200);
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

export function AnalysisMessage({
  message,
  isStreaming = false,
  onSelectFollowUpSuggestion,
  feedback = null,
  onSubmitFeedback,
  onEditUserMessage,
}: {
  message: AnalysisUIMessage;
  isStreaming?: boolean;
  // Only passed when the thread is idle AND this is the tail assistant
  // message — so this prop doubles as the "show chips" signal.
  onSelectFollowUpSuggestion?: (suggestion: string) => void | Promise<void>;
  feedback?: AnalysisMessageFeedbackRecord | null;
  onSubmitFeedback?: (input: {
    messageId: string;
    vote: AnalysisMessageFeedbackVote;
    correctionText?: string | null;
  }) => Promise<void>;
  // Passed on persisted user messages when editing is available. Called with
  // the new text — the thread owns the stop / truncate / resend choreography
  // so this can be invoked at any time, including during streaming.
  onEditUserMessage?: (input: { messageId: string; text: string }) => Promise<void>;
}) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const isUser = message.role === "user";
  const hasGroundedTableCard = !isUser && message.parts.some(
    (part) => isToolUIPart(part) && part.type === "tool-fetchTable",
  );
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [draftCorrectionText, setDraftCorrectionText] = useState(feedback?.correctionText ?? "");
  const [optimisticFeedback, setOptimisticFeedback] = useState<AnalysisMessageFeedbackRecord | null>(feedback ?? null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftEditText, setDraftEditText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const hasEverStreamedRef = useRef(isStreaming);
  const hasTouchedThinkingRef = useRef(false);
  const hasAutoCollapsedThinkingRef = useRef(false);

  const traceEntries = getAnalysisTraceEntries(message);
  const effectiveFeedback = optimisticFeedback ?? feedback ?? null;
  const isDownvoteOpen = effectiveFeedback?.vote === "down";
  const citeLookup = buildCitationChipLookup(message);
  const validationStatusLabel = isUser ? null : getAnalysisValidationStatusLabel(message);
  const rawAssistantText = isUser ? "" : getAnalysisUIMessageText(message);

  if (isStreaming) {
    hasEverStreamedRef.current = true;
  }

  const shouldUseRevealController = !isUser && hasEverStreamedRef.current;
  const { unstableTail } = useMemo(
    () => splitAnalysisStableTextWindow(rawAssistantText, shouldUseRevealController && isStreaming),
    [isStreaming, rawAssistantText, shouldUseRevealController],
  );

  const settledAnswer = useMemo(
    () => buildSettledAnalysisAnswer(message, {
      isStreaming: shouldUseRevealController && (isStreaming || unstableTail.length > 0),
    }),
    [isStreaming, message, shouldUseRevealController, unstableTail.length],
  );
  const {
    renderableBlocks,
    sourceItems,
    followUpSuggestions,
    persistenceWarning,
    persistedMessageId,
  } = settledAnswer;
  const shouldShowSources = sourceItems.length > 0;
  const revealEntries = useMemo(
    () => buildAnalysisRevealEntries(renderableBlocks),
    [renderableBlocks],
  );
  const [releasedEntryCount, setReleasedEntryCount] = useState(() => (
    shouldUseRevealController ? 0 : revealEntries.length
  ));

  useEffect(() => {
    if (!shouldUseRevealController) {
      setReleasedEntryCount(revealEntries.length);
      return;
    }

    setReleasedEntryCount((current) => Math.min(current, revealEntries.length));
  }, [revealEntries.length, shouldUseRevealController]);

  const revealPhase = getAnalysisAnswerRevealPhase({
    isStreaming,
    hasEverStreamed: shouldUseRevealController,
    releasedEntryCount,
    totalEntryCount: revealEntries.length,
    unstableTail,
  });
  const displayBlocks = shouldUseRevealController
    ? buildAnalysisDisplayBlocks(renderableBlocks, revealEntries, releasedEntryCount)
    : renderableBlocks.map((block): AnalysisDisplayBlock => {
      if (block.kind === "text") {
        return block;
      }

      if (block.kind === "table") {
        return {
          ...block,
          displayState: "ready",
        };
      }

      return block;
    });
  const answerRevealBegins = displayBlocks.length > 0;
  const isFooterReady = revealPhase === "settled";
  const showWorkLoader = isStreaming && !answerRevealBegins;
  const workStatusLabel = getAnalysisWorkStatusLabel({
    traceEntries,
    validationStatusLabel,
    answerRevealBegins,
    isStreaming,
  });
  const shouldShowWorkDisclosure = !isUser && Boolean(workStatusLabel);

  useEffect(() => {
    if (!shouldUseRevealController) return;
    if (revealEntries.length === 0) return;
    if (releasedEntryCount >= revealEntries.length) return;

    const delayMs = getNextAnalysisRevealDelayMs({
      releasedEntryCount,
      entries: revealEntries,
    });

    const timer = window.setTimeout(() => {
      setReleasedEntryCount((current) => Math.min(current + 1, revealEntries.length));
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [releasedEntryCount, revealEntries, shouldUseRevealController]);

  useEffect(() => {
    setOptimisticFeedback(feedback ?? null);
    setDraftCorrectionText(feedback?.correctionText ?? "");
  }, [feedback]);

  useEffect(() => {
    if (!shouldShowWorkDisclosure || hasTouchedThinkingRef.current || hasAutoCollapsedThinkingRef.current) {
      return;
    }

    if (answerRevealBegins) {
      hasAutoCollapsedThinkingRef.current = true;
      setIsThinkingExpanded(false);
    }
  }, [answerRevealBegins, shouldShowWorkDisclosure]);

  function openEditor() {
    if (!onEditUserMessage) return;
    setDraftEditText(getAnalysisUIMessageText(message));
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setDraftEditText("");
  }

  async function saveEdit() {
    if (!onEditUserMessage) return;
    const nextText = draftEditText.trim();
    const currentText = getAnalysisUIMessageText(message);
    if (!nextText || nextText === currentText) {
      cancelEdit();
      return;
    }

    setIsSavingEdit(true);
    try {
      await onEditUserMessage({ messageId: message.id, text: nextText });
      setIsEditing(false);
      setDraftEditText("");
    } catch (_error) {
      // Parent surfaces the error toast; keep the editor open so the user can retry.
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function submitFeedback(vote: AnalysisMessageFeedbackVote, correctionText?: string | null) {
    if (!onSubmitFeedback || isSubmittingFeedback) return;

    const trimmedCorrectionText = correctionText?.trim() || null;
    const nextFeedback: AnalysisMessageFeedbackRecord = {
      messageId: persistedMessageId ?? message.id,
      vote,
      correctionText: vote === "down" ? trimmedCorrectionText : null,
      updatedAt: Date.now(),
    };

    const previousFeedback = effectiveFeedback;
    setOptimisticFeedback(nextFeedback);
    setIsSubmittingFeedback(true);

    try {
      await onSubmitFeedback({
        messageId: persistedMessageId ?? message.id,
        vote,
        correctionText: vote === "down" ? trimmedCorrectionText : null,
      });
    } catch (_error) {
      setOptimisticFeedback(previousFeedback ?? null);
    } finally {
      setIsSubmittingFeedback(false);
    }
  }

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0",
          hasGroundedTableCard ? "w-full max-w-full" : "max-w-[88%]",
        )}
      >
        {isUser ? (
          isEditing ? (
            <div className="flex w-full flex-col items-stretch gap-2">
              <Textarea
                value={draftEditText}
                onChange={(event) => setDraftEditText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEdit();
                    return;
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void saveEdit();
                  }
                }}
                autoFocus
                disabled={isSavingEdit}
                className="min-h-24 resize-y rounded-2xl bg-primary/10 px-4 py-2 text-sm leading-6"
                placeholder="Edit your message"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSavingEdit}
                  className="rounded-full border border-border/70 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void saveEdit(); }}
                  disabled={isSavingEdit || draftEditText.trim().length === 0}
                  className="rounded-full bg-primary px-3 py-1 text-[11px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingEdit ? "Saving..." : "Save & resend"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-0.5">
              <p className="min-w-0 whitespace-pre-wrap break-words rounded-2xl bg-primary/10 px-4 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
                {getAnalysisUIMessageText(message)}
              </p>
              <div className="flex items-center gap-0.5">
                {onEditUserMessage ? (
                  <button
                    type="button"
                    onClick={openEditor}
                    aria-label="Edit message"
                    title="Edit message"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                ) : null}
                <CopyMessageButton
                  text={getAnalysisUIMessageText(message)}
                  label="Copy message"
                />
              </div>
            </div>
          )
        ) : (
          <div className="min-w-0 space-y-3">
            {shouldShowWorkDisclosure && workStatusLabel ? (
              <AnalysisWorkDisclosure
                entries={traceEntries as AnalysisWorkActivityEntry[]}
                statusLabel={workStatusLabel}
                isOpen={isThinkingExpanded}
                onOpenChange={(open) => {
                  hasTouchedThinkingRef.current = true;
                  setIsThinkingExpanded(open);
                }}
                showLoader={showWorkLoader}
              />
            ) : null}

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
                        isStreaming={shouldUseRevealController && revealPhase !== "settled"}
                      />
                    </div>
                  );
                }

                // Render each segment — markdown for text, inline chip for cite.
                // Streamdown handles one prose block at a time; chips render as
                // inline siblings via a shared wrapper that preserves flow.
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

            {persistenceWarning ? (
              <div className="rounded-xl border border-ct-amber/30 bg-ct-amber-dim px-3 py-2 text-xs leading-5 text-foreground/85">
                {persistenceWarning}
              </div>
            ) : null}

            {isFooterReady && rawAssistantText.length > 0 ? (
              <div className="-mt-2 flex justify-start">
                <CopyMessageButton
                  text={getAnalysisUIMessageText(message)}
                  label="Copy response"
                />
              </div>
            ) : null}

            {shouldShowSources && isFooterReady ? (
              <Collapsible open={isSourcesOpen} onOpenChange={setIsSourcesOpen}>
                <div className="pt-1">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground/70"
                    >
                      <ChevronDown
                        className={cn("h-3 w-3 transition-transform", isSourcesOpen && "rotate-180")}
                      />
                      <span>Additional sources ({sourceItems.length})</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-2">
                      <div className="space-y-1.5">
                        {sourceItems.map((item) => {
                          const cellAnchorCellId = getEvidenceItemCellId(item);
                          const canScrollToRenderedCell = Boolean(
                            item.renderedInCurrentMessage && cellAnchorCellId,
                          );

                          const handleClick = () => {
                            if (canScrollToRenderedCell && cellAnchorCellId) {
                              scrollToCellAnchors([cellAnchorCellId]);
                              return;
                            }
                            if (item.anchorId) {
                              scrollToEvidenceAnchor(item.anchorId);
                            }
                          };

                          const clickable = Boolean(canScrollToRenderedCell || item.anchorId);

                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={clickable ? handleClick : undefined}
                              className={cn(
                                "flex w-full items-center gap-2 text-left text-[11px] leading-5 text-muted-foreground",
                                clickable ? "hover:text-foreground/80" : "cursor-default",
                              )}
                            >
                              <Link2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ) : null}

            {message.role === "assistant" && isFooterReady && onSubmitFeedback ? (
              <div className="space-y-3 pt-1">
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-2 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.14)]">
                    <button
                      type="button"
                      disabled={isSubmittingFeedback}
                      onClick={() => {
                        void submitFeedback("up");
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors",
                        effectiveFeedback?.vote === "up"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
                      )}
                    >
                      <ThumbsUp className="h-3 w-3" />
                      <span>Helpful</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingFeedback}
                      onClick={() => {
                        void submitFeedback("down", draftCorrectionText);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors",
                        effectiveFeedback?.vote === "down"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
                      )}
                    >
                      <ThumbsDown className="h-3 w-3" />
                      <span>Needs work</span>
                    </button>
                  </div>
                </div>

                {isDownvoteOpen ? (
                  <div className="mx-auto max-w-xl space-y-2 rounded-2xl border border-border/60 bg-background/90 p-3 shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      Optional: what should TabulateAI have said instead?
                    </p>
                    <Textarea
                      value={draftCorrectionText}
                      onChange={(event) => setDraftCorrectionText(event.target.value)}
                      disabled={isSubmittingFeedback}
                      className="min-h-20 resize-y text-sm"
                      placeholder="Add a correction or a better framing."
                      maxLength={1000}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-muted-foreground">
                        {draftCorrectionText.trim().length}/1000
                      </span>
                      <button
                        type="button"
                        disabled={isSubmittingFeedback}
                        onClick={() => {
                          void submitFeedback("down", draftCorrectionText);
                        }}
                        className="rounded-full border border-border/70 px-3 py-1 text-[11px] text-foreground/85 transition-colors hover:border-foreground/20 hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save feedback
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isFooterReady && followUpSuggestions.length > 0 && onSelectFollowUpSuggestion ? (
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {followUpSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      void onSelectFollowUpSuggestion(suggestion);
                    }}
                    className="rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-xs text-foreground/85 shadow-[0_8px_24px_rgba(15,23,42,0.12)] transition-colors hover:border-foreground/20 hover:bg-muted/20"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
