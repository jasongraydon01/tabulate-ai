"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  type AnalysisRenderableBlock,
  type AnalysisRenderableInlineSegment,
} from "@/lib/analysis/renderAnchors";

export type AnalysisAnswerRevealPhase = "thinking" | "handoff" | "composing" | "settled";

export type AnalysisRevealEntry =
  | { kind: "text"; blockIndex: number; segmentsDelta: AnalysisRenderableInlineSegment[] }
  | { kind: "table"; blockIndex: number }
  | { kind: "missing"; blockIndex: number }
  | { kind: "placeholder"; blockIndex: number };

export type AnalysisDisplayBlock =
  | { kind: "text"; key: string; segments: AnalysisRenderableInlineSegment[] }
  | (Extract<AnalysisRenderableBlock, { kind: "table" }> & { displayState: "ready" | "shell" })
  | Extract<AnalysisRenderableBlock, { kind: "missing" | "placeholder" }>;

const ANALYSIS_REVEAL_INITIAL_DELAY_MS = 260;
const ANALYSIS_REVEAL_TEXT_DELAY_MS = 145;
const ANALYSIS_REVEAL_PARAGRAPH_DELAY_MS = 220;
const ANALYSIS_REVEAL_TABLE_HOLD_DELAY_MS = 240;
const ANALYSIS_REVEAL_POST_TABLE_DELAY_MS = 160;

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
  shouldAnimateReveal: boolean;
  isStreaming: boolean;
  releasedEntryCount: number;
  totalEntryCount: number;
}): AnalysisAnswerRevealPhase {
  if (!params.shouldAnimateReveal) {
    return "settled";
  }

  if (params.totalEntryCount === 0 && params.releasedEntryCount === 0) {
    return "thinking";
  }

  if (params.releasedEntryCount === 0) {
    return "handoff";
  }

  if (params.releasedEntryCount < params.totalEntryCount || params.isStreaming) {
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

function buildInstantAnalysisDisplayBlocks(blocks: AnalysisRenderableBlock[]): AnalysisDisplayBlock[] {
  return blocks.map((block): AnalysisDisplayBlock => {
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
}

export function useAnalysisAnswerReveal({
  renderableBlocks,
  isStreaming,
}: {
  renderableBlocks: AnalysisRenderableBlock[];
  isStreaming: boolean;
}) {
  const revealModeRef = useRef<"animated" | "instant">(isStreaming ? "animated" : "instant");

  if (isStreaming) {
    revealModeRef.current = "animated";
  }

  const shouldAnimateReveal = revealModeRef.current === "animated";
  const revealEntries = useMemo(
    () => buildAnalysisRevealEntries(renderableBlocks),
    [renderableBlocks],
  );
  const [releasedEntryCount, setReleasedEntryCount] = useState(() => (
    shouldAnimateReveal ? 0 : revealEntries.length
  ));

  useEffect(() => {
    if (!shouldAnimateReveal) {
      setReleasedEntryCount(revealEntries.length);
      return;
    }

    setReleasedEntryCount((current) => Math.min(current, revealEntries.length));
  }, [revealEntries.length, shouldAnimateReveal]);

  useEffect(() => {
    if (!shouldAnimateReveal) return;
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
  }, [releasedEntryCount, revealEntries, shouldAnimateReveal]);

  const revealPhase = getAnalysisAnswerRevealPhase({
    isStreaming,
    shouldAnimateReveal,
    releasedEntryCount,
    totalEntryCount: revealEntries.length,
  });
  const displayBlocks = shouldAnimateReveal
    ? buildAnalysisDisplayBlocks(renderableBlocks, revealEntries, releasedEntryCount)
    : buildInstantAnalysisDisplayBlocks(renderableBlocks);

  return {
    answerRevealBegins: displayBlocks.length > 0,
    displayBlocks,
    isFooterReady: revealPhase === "settled",
    isRevealing: shouldAnimateReveal && revealPhase !== "settled",
    releasedEntryCount,
    revealEntries,
    revealPhase,
    shouldAnimateReveal,
  };
}
