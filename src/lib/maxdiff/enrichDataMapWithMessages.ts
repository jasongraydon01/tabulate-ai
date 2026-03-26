/**
 * DataMap Enrichment with MaxDiff Messages
 *
 * Replaces truncated .sav labels in the verbose datamap with full-text messages
 * from the wizard grid or uploaded message list file. This runs BEFORE
 * TableGenerator, so all downstream processors (consolidator, VerificationAgent,
 * R script, Excel) inherit correct labels automatically.
 *
 * Two enrichment gaps are addressed:
 *   Gap 1 — Score variable labels (description field): MaxDiff family variables
 *           like AnchProbInd_1 have labels truncated by SPSS format limits.
 *   Gap 2 — Downstream question value labels (scaleLabels): Survey questions
 *           whose response options ARE the messages (e.g., "Which messages
 *           would make you most likely to...") also have truncated labels.
 */

import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { MessageListEntry } from './MessageListParser';
import type { MaxDiffFamilyDetectionResult } from './detectMaxDiffFamilies';
import { parseMaxDiffLabel } from './parseMaxDiffLabel';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnrichmentStats {
  /** Number of variable descriptions enriched (Gap 1) */
  variableLabelsEnriched: number;
  /** Number of scale/value labels enriched (Gap 2) */
  valueLabelsEnriched: number;
  /** Total messages available for matching */
  totalMessages: number;
  /** Message codes that didn't match any variable or value label */
  unmatchedMessages: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a case-insensitive code → full text lookup from message entries.
 */
function buildCodeMap(messages: MessageListEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.code && m.text) {
      map.set(m.code.toUpperCase().trim(), m.text.trim());
    }
  }
  return map;
}

/**
 * Regex to extract a leading message code from a value label.
 * Matches patterns like "I1:", "D4 -", "E1A /", "I1A:", etc.
 */
const VALUE_LABEL_CODE_PATTERN = /^([A-Z]\d+[A-Z]?)\s*[:\/\-]\s*/i;

/**
 * Try to find the full text for a value label by matching its leading code prefix.
 * Returns the enriched label or null if no match.
 */
function enrichValueLabel(label: string, codeMap: Map<string, string>): string | null {
  const match = label.match(VALUE_LABEL_CODE_PATTERN);
  if (!match) return null;

  const code = match[1].toUpperCase();
  const fullText = codeMap.get(code);
  if (!fullText) return null;

  // Preserve the original prefix format (e.g., "I1: ") and replace the rest
  const prefix = match[0]; // includes separator
  return `${prefix}${fullText}`;
}

/**
 * Try fuzzy truncation matching: if the label (minus trailing "...") is a
 * prefix of any message text, return the full message text with code prefix.
 */
function enrichByTruncationMatch(
  label: string,
  codeMap: Map<string, string>,
): string | null {
  // Strip trailing ellipsis or whitespace
  const cleaned = label.replace(/\.{2,}\s*$/, '').trim();
  if (cleaned.length < 15) return null; // too short for reliable truncation detection

  for (const [code, fullText] of codeMap) {
    if (fullText.startsWith(cleaned)) {
      return `${code}: ${fullText}`;
    }
  }
  return null;
}

/**
 * Resolve placeholder-style variable descriptions such as:
 * - "I1 preferred message"
 * - "Message 1"
 */
function enrichDescriptionPlaceholder(
  description: string,
  codeMap: Map<string, string>,
): string | null {
  const trimmed = description.trim();

  const codePreferred = trimmed.match(/^([A-Z]\d+[A-Z]?)\s+preferred message$/i);
  if (codePreferred) {
    const code = codePreferred[1].toUpperCase();
    const fullText = codeMap.get(code);
    if (fullText) return `${code}: ${fullText}`;
  }

  const messageIndex = trimmed.match(/^message\s+(\d+)$/i);
  if (messageIndex) {
    const idx = parseInt(messageIndex[1], 10);
    if (Number.isFinite(idx) && idx > 0) {
      const sortedCodes = [...codeMap.keys()].sort((a, b) => a.localeCompare(b));
      const code = sortedCodes[idx - 1];
      if (code) {
        const fullText = codeMap.get(code)!;
        return `${code}: ${fullText}`;
      }
    }
  }

  return null;
}

// ─── Main Function ───────────────────────────────────────────────────────────

/**
 * Enrich the verbose datamap with full-text MaxDiff messages.
 *
 * Pure function — returns a new array; does not mutate the input.
 *
 * @param verboseDataMap - Current datamap (may have truncated labels)
 * @param messages - Resolved messages from wizard or file
 * @param maxdiffDetection - Detection result identifying MaxDiff family variables
 * @returns Enriched datamap and statistics
 */
export function enrichDataMapWithMessages(
  verboseDataMap: VerboseDataMapType[],
  messages: MessageListEntry[],
  maxdiffDetection: MaxDiffFamilyDetectionResult,
): { enriched: VerboseDataMapType[]; stats: EnrichmentStats; variantOfMap: Map<string, string> } {
  const codeMap = buildCodeMap(messages);
  const matchedCodes = new Set<string>();
  let variableLabelsEnriched = 0;
  let valueLabelsEnriched = 0;

  // Build a set of all MaxDiff family variable names for fast lookup
  const maxdiffVariables = new Set<string>();
  for (const family of maxdiffDetection.families) {
    for (const varName of family.variables) {
      maxdiffVariables.add(varName);
    }
  }

  const enriched = verboseDataMap.map((entry) => {
    let newEntry = entry;

    // ─── Gap 1: Enrich MaxDiff score variable labels (description) ────────
    if (maxdiffVariables.has(entry.column)) {
      const parsed = parseMaxDiffLabel(entry.description);
      if (parsed && !parsed.isAnchor && parsed.messageCode) {
        const code = parsed.messageCode.toUpperCase();
        const fullText = codeMap.get(code);
        if (fullText) {
          // Rebuild description preserving the original format:
          // "API: I1 OR ALT I1A - <FULL TEXT>"
          const altPart = parsed.alternateCode
            ? ` OR ALT ${parsed.alternateCode}`
            : '';
          const newDescription = `${parsed.scoreType}: ${parsed.messageCode}${altPart} - ${fullText}`;
          newEntry = { ...newEntry, description: newDescription };
          matchedCodes.add(code);
          // Also mark the alternate code as matched — it's present in this
          // variable's label alongside the primary, not as a standalone variable.
          if (parsed.alternateCode) {
            matchedCodes.add(parsed.alternateCode.toUpperCase());
          }
          variableLabelsEnriched++;
        }
      }
    }

    // Gap 1b: Resolve placeholder descriptions where possible
    const placeholderResolved = enrichDescriptionPlaceholder(newEntry.description, codeMap);
    if (placeholderResolved && placeholderResolved !== newEntry.description) {
      const codeMatch = placeholderResolved.match(/^([A-Z]\d+[A-Z]?)\s*:/);
      if (codeMatch) matchedCodes.add(codeMatch[1].toUpperCase());
      newEntry = { ...newEntry, description: placeholderResolved };
      variableLabelsEnriched++;
    }

    // ─── Gap 2: Enrich value labels (scaleLabels) for ANY variable ────────
    if (entry.scaleLabels && entry.scaleLabels.length > 0) {
      let labelsChanged = false;
      const newScaleLabels = entry.scaleLabels.map((sl) => {
        // Try code-prefix match first
        const enriched = enrichValueLabel(sl.label, codeMap);
        if (enriched) {
          const codeMatch = sl.label.match(VALUE_LABEL_CODE_PATTERN);
          if (codeMatch) matchedCodes.add(codeMatch[1].toUpperCase());
          labelsChanged = true;
          return { ...sl, label: enriched };
        }

        // Try truncation match as fallback
        const truncMatch = enrichByTruncationMatch(sl.label, codeMap);
        if (truncMatch) {
          labelsChanged = true;
          return { ...sl, label: truncMatch };
        }

        return sl;
      });

      if (labelsChanged) {
        valueLabelsEnriched += newScaleLabels.filter(
          (sl, i) => sl.label !== entry.scaleLabels![i].label
        ).length;

        // Also update answerOptions to stay consistent with scaleLabels
        const newAnswerOptions = newScaleLabels
          .map((sl) => `${sl.value}=${sl.label}`)
          .join('; ');

        newEntry = {
          ...newEntry,
          scaleLabels: newScaleLabels,
          answerOptions: newAnswerOptions,
        };
      }
    }

    return newEntry;
  });

  // Compute unmatched messages
  const allCodes = [...codeMap.keys()];
  const unmatchedMessages = allCodes.filter((c) => !matchedCodes.has(c));

  // Build variantOfMap from message entries (code → variantOf code, case-insensitive)
  const variantOfMap = new Map<string, string>();
  for (const m of messages) {
    if (m.variantOf) {
      variantOfMap.set(m.code.toUpperCase(), m.variantOf.toUpperCase());
    }
  }

  return {
    enriched,
    stats: {
      variableLabelsEnriched,
      valueLabelsEnriched,
      totalMessages: messages.length,
      unmatchedMessages,
    },
    variantOfMap,
  };
}
