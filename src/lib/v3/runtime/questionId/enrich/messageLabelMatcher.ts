/**
 * V3 Runtime — Step 09d: Message Label Matcher
 *
 * Matches message template codes to item labels within each question.
 * Used for message testing / stimulus evaluation surveys where .sav labels
 * are often truncated versions of full template messages.
 *
 * Two matching passes:
 *   1. Code extraction — regex-extract codes like "I1", "E1A", "AP: I1" from labels
 *   2. Truncation prefix — word-level fuzzy prefix match tolerating typos & format diffs
 *
 * Ported from: scripts/v3-enrichment/09d-message-label-matcher.ts
 *
 * No file I/O for output — the orchestrator handles artifact persistence.
 * File I/O is limited to reading the message template file (via parseMessageListFile).
 */

import path from 'path';

import { parseMessageListFile, type MessageListEntry } from '@/lib/maxdiff/MessageListParser';

import type {
  QuestionIdEntry,
  QuestionIdItem,
  SurveyMetadata,
} from '../types';

// =============================================================================
// Input / Output
// =============================================================================

export interface MessageLabelMatcherInput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  /** Path to the dataset directory (contains the message template file) */
  datasetPath: string;
}

export interface MessageLabelMatcherOutput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
}

// =============================================================================
// Internal Types
// =============================================================================

interface ItemMatch {
  column: string;
  label: string;
  matchedCode: string | null;
  matchedText: string | null;
  matchMethod: 'code_extraction' | 'truncation_prefix' | 'scale_label_code' | null;
  confidence: number;
  altCode: string | null;
  altText: string | null;
}

// =============================================================================
// Code / Variant Map Builders
// =============================================================================

/**
 * Build a lookup from message codes (uppercased) to full text.
 */
function buildCodeMap(messages: MessageListEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    map.set(m.code.toUpperCase(), m.text);
  }
  return map;
}

/**
 * Build a variant lookup: child code → parent code (uppercase).
 * e.g., I1A → I1
 */
function buildVariantMap(messages: MessageListEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.variantOf) {
      map.set(m.code.toUpperCase(), m.variantOf.toUpperCase());
    }
  }
  return map;
}

/**
 * Build a reverse variant lookup: parent code → first child code (uppercase).
 * e.g., I1 → I1A
 */
function buildReverseVariantMap(messages: MessageListEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.variantOf) {
      const parent = m.variantOf.toUpperCase();
      if (!map.has(parent)) {
        map.set(parent, m.code.toUpperCase());
      }
    }
  }
  return map;
}

// =============================================================================
// Code Extraction (Pass 1)
// =============================================================================

/**
 * Extract message codes from item labels.
 *
 * Patterns recognized:
 *   - "AP: I1 - ..."  or  "API: I1 - ..."         → code = "I1"
 *   - "AP: I1 OR ALT I1A - ..."                    → code = "I1", alt = "I1A"
 *   - "I1 preferred message - ..."                  → code = "I1"
 *   - "E1 preferred message"                        → code = "E1"
 *   - Scale labels like "I1: text" or "I1 - text"   → code = "I1"
 */
function extractCodeFromLabel(label: string): { code: string; altCode: string | null } | null {
  const apMatch = label.match(/^(?:AP|API):\s*([A-Z]\w*?)(?:\s+OR\s+ALT\s+([A-Z]\w*?))?\s*-/i);
  if (apMatch) {
    return { code: apMatch[1].toUpperCase(), altCode: apMatch[2]?.toUpperCase() ?? null };
  }

  const prefMatch = label.match(/^([A-Z]\d+[A-Z]?)\s+preferred\s+message/i);
  if (prefMatch) {
    return { code: prefMatch[1].toUpperCase(), altCode: null };
  }

  const scalePrefixMatch = label.match(/^([A-Z]\d+[A-Z]?)[\s]*[:\/\-]\s/i);
  if (scalePrefixMatch) {
    return { code: scalePrefixMatch[1].toUpperCase(), altCode: null };
  }

  return null;
}

// =============================================================================
// Text Extraction & Normalization (Pass 2)
// =============================================================================

/**
 * Strip variable prefix and instruction suffix from a label,
 * leaving the message text suitable for fuzzy comparison.
 *
 * When `questionText` is provided (from the enriched QuestionIdEntry), it is
 * used to locate and strip the question stem from the label. This is more
 * reliable than pattern-matching because the stem text is already known.
 */
function extractMessageText(label: string, questionText?: string): string {
  let text = label;
  // 1. Strip variable name prefix (e.g., "B700r101: ")
  text = text.replace(/^[A-Za-z0-9_]+:\s*/, '');
  // 2. Strip scenario ranking prefix
  text = text.replace(/^Scenario\s+\d+\s+Ranking\s*-\s*/i, '');

  // 3. Strip question stem — prefer using known questionText if available
  if (questionText && questionText.length >= 10) {
    // Take the first several words of questionText as an anchor to find where
    // the stem begins in the label. The label may be truncated at 255 chars so
    // we can't rely on the full questionText being present.
    const anchorWords = normalize(questionText).split(/\s+/).slice(0, 6).join(' ');
    if (anchorWords.length >= 10) {
      const normalizedText = normalize(text);
      // Use the last occurrence to avoid clipping on a phrase that appears
      // inside message text earlier in the label.
      const anchorIdx = normalizedText.lastIndexOf(anchorWords);
      if (anchorIdx > 0) {
        const beforeAnchor = normalizedText.substring(0, anchorIdx);
        // Only strip when the anchor is preceded by a clear separator.
        // Message labels are typically "message text - question stem".
        if (/[-:]\s*$/.test(beforeAnchor)) {
          const stripped = beforeAnchor.replace(/[-:]\s*$/, '').trim();
          if (stripped.length > 0) {
            return stripped;
          }
        }
      }
    }
  }

  // Fallback: regex-based stem stripping for common question stem patterns
  text = text.replace(/\s*-\s*(?:Which|For the next|In this|If you|\[res\s).*/i, '');
  return text.trim();
}

/**
 * Normalize text for comparison: lowercase, collapse whitespace,
 * normalize smart quotes and dashes.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''""]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// Fuzzy Word Matching
// =============================================================================

/**
 * Compute edit distance between two words (Levenshtein).
 * Capped at `maxDist + 1` for early exit.
 */
function wordEditDistance(a: string, b: string, maxDist: number = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

/**
 * Check if two words are "close enough" to be considered the same word.
 * Exact match, or edit distance <= 2 for words longer than 4 characters.
 */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length <= 4 || b.length <= 4) return false;
  return wordEditDistance(a, b, 2) <= 2;
}

/**
 * Word-level fuzzy prefix matching.
 *
 * Tokenizes both label and template into words, then walks through them
 * with a two-pointer approach that handles:
 *   - Typos: "recommeded" ~ "recommended" (edit distance <= 2)
 *   - Insertions in template: "1)" markers in template that don't appear in label
 *
 * Returns the number of label words matched and total template words consumed.
 */
function fuzzyWordPrefixMatch(
  labelWords: string[],
  templateWords: string[],
): { labelMatched: number; templateConsumed: number } {
  let li = 0;
  let ti = 0;
  const maxSkips = 3;

  while (li < labelWords.length && ti < templateWords.length) {
    if (wordsMatch(labelWords[li], templateWords[ti])) {
      li++;
      ti++;
      continue;
    }

    let skipped = false;
    for (let skip = 1; skip <= maxSkips && ti + skip < templateWords.length; skip++) {
      if (wordsMatch(labelWords[li], templateWords[ti + skip])) {
        ti += skip + 1;
        li++;
        skipped = true;
        break;
      }
    }

    if (!skipped) break;
  }

  return { labelMatched: li, templateConsumed: ti };
}

// =============================================================================
// Truncation Match (Pass 2)
// =============================================================================

/**
 * Check if labelText is a truncated prefix of any template message.
 * Uses word-level fuzzy matching to tolerate typos and minor formatting differences
 * (e.g., numbered list markers "1)", "2)" present in template but not in label).
 * Returns the best match (most label words matched, then tightest template fit).
 */
function findTruncationMatch(
  labelText: string,
  codeMap: Map<string, string>,
  minLength: number = 30,
): { code: string; text: string; confidence: number } | null {
  const normalizedLabel = normalize(labelText);
  if (normalizedLabel.length < minLength) return null;

  const labelWords = normalizedLabel.split(/\s+/);
  if (labelWords.length < 4) return null;

  let bestMatch: {
    code: string;
    text: string;
    confidence: number;
    labelMatched: number;
    tightness: number;
  } | null = null;

  for (const [code, fullText] of codeMap) {
    const normalizedFull = normalize(fullText);
    const templateWords = normalizedFull.split(/\s+/);

    const { labelMatched, templateConsumed } = fuzzyWordPrefixMatch(labelWords, templateWords);

    const labelCoverage = labelMatched / labelWords.length;
    if (labelCoverage < 0.7) continue;

    // Tightness: what fraction of the template's words did the label actually cover?
    // Distinguishes code 12 (35/35 = 1.0) from code 9 (35/38 = 0.92) when both
    // match all label words but code 9 has extra words the label skipped.
    const tightness = labelMatched / templateWords.length;
    const confidence = templateConsumed / templateWords.length;
    if (confidence >= 0.2) {
      const isBetter = !bestMatch
        || labelMatched > bestMatch.labelMatched
        || (labelMatched === bestMatch.labelMatched && tightness > bestMatch.tightness);
      if (isBetter) {
        bestMatch = { code, text: fullText, confidence: Math.max(confidence, 0.5), labelMatched, tightness };
      }
    }
  }

  return bestMatch ? { code: bestMatch.code, text: bestMatch.text, confidence: bestMatch.confidence } : null;
}

// =============================================================================
// Variant Signal Detection
// =============================================================================

/**
 * Detect whether a label signals that the respondent saw one of two variants.
 */
function labelSignalsVariant(label: string): boolean {
  return /preferred\s+message/i.test(label) || /\balt\b/i.test(label) || /\bOR\s+ALT\b/i.test(label);
}

// =============================================================================
// Per-Item Matching Orchestrator
// =============================================================================

/**
 * Match a single item against the template messages.
 */
function matchItem(
  item: { column: string; label: string; scaleLabels?: Array<{ value: number | string; label: string }> },
  codeMap: Map<string, string>,
  variantMap: Map<string, string>,
  reverseVariantMap: Map<string, string>,
  questionText?: string,
): ItemMatch {
  const result: ItemMatch = {
    column: item.column,
    label: item.label,
    matchedCode: null,
    matchedText: null,
    matchMethod: null,
    confidence: 0,
    altCode: null,
    altText: null,
  };

  const hasVariantSignal = labelSignalsVariant(item.label);

  // Pass 1: Code extraction from item label
  const codeResult = extractCodeFromLabel(item.label);
  if (codeResult) {
    const fullText = codeMap.get(codeResult.code);
    if (fullText !== undefined) {
      result.matchedCode = codeResult.code;
      result.matchedText = fullText;
      result.matchMethod = 'code_extraction';
      result.confidence = 1.0;

      if (codeResult.altCode) {
        result.altCode = codeResult.altCode;
        result.altText = codeMap.get(codeResult.altCode) ?? null;
      }

      if (!result.altCode && hasVariantSignal) {
        const parent = variantMap.get(codeResult.code);
        if (parent) {
          result.altCode = parent;
          result.altText = codeMap.get(parent) ?? null;
        } else {
          const child = reverseVariantMap.get(codeResult.code);
          if (child) {
            result.altCode = child;
            result.altText = codeMap.get(child) ?? null;
          }
        }
      }

      return result;
    }
  }

  // Pass 1b: Code extraction from scale labels
  if (item.scaleLabels && item.scaleLabels.length > 0) {
    for (const sl of item.scaleLabels) {
      const slCode = extractCodeFromLabel(sl.label);
      if (slCode) {
        const fullText = codeMap.get(slCode.code);
        if (fullText !== undefined) {
          result.matchedCode = slCode.code;
          result.matchedText = fullText;
          result.matchMethod = 'scale_label_code';
          result.confidence = 0.9;
          return result;
        }
      }
    }
  }

  // Pass 2: Truncation prefix matching (word-level fuzzy)
  // Use known questionText to strip the question stem from the label,
  // leaving only the stimulus/message text for cleaner matching.
  const strippedText = extractMessageText(item.label, questionText);
  if (strippedText.length >= 30) {
    const truncMatch = findTruncationMatch(strippedText, codeMap);
    if (truncMatch && truncMatch.confidence >= 0.3) {
      result.matchedCode = truncMatch.code;
      result.matchedText = truncMatch.text;
      result.matchMethod = 'truncation_prefix';
      result.confidence = truncMatch.confidence;
      return result;
    }
  }

  return result;
}

// =============================================================================
// Entry-Level Helpers
// =============================================================================

/**
 * Enrich items for an entry that has no message matches (passthrough).
 * Adds null message fields to each item and hasMessageMatches=false to entry.
 */
function enrichEntryNoMatch(entry: QuestionIdEntry): QuestionIdEntry {
  const enrichedItems: QuestionIdItem[] = (entry.items || []).map(item => ({
    ...item,
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null,
    matchConfidence: 0,
  }));

  return {
    ...entry,
    hasMessageMatches: false,
    items: enrichedItems,
  };
}

/**
 * Process a single entry against the message template maps.
 * Returns the enriched entry with message fields on each item.
 */
function enrichEntryWithMessages(
  entry: QuestionIdEntry,
  codeMap: Map<string, string>,
  variantMap: Map<string, string>,
  reverseVariantMap: Map<string, string>,
): QuestionIdEntry {
  if (!entry.items || entry.items.length === 0) {
    return enrichEntryNoMatch(entry);
  }

  let questionMatchCount = 0;
  const enrichedItems: QuestionIdItem[] = [];

  for (const item of entry.items) {
    const match = matchItem(item, codeMap, variantMap, reverseVariantMap, entry.questionText);

    enrichedItems.push({
      ...item,
      messageCode: match.matchedCode,
      messageText: match.matchedText,
      altCode: match.altCode,
      altText: match.altText,
      matchMethod: match.matchMethod,
      matchConfidence: match.confidence,
    });

    if (match.matchedCode) {
      questionMatchCount++;
    }
  }

  return {
    ...entry,
    hasMessageMatches: questionMatchCount > 0,
    items: enrichedItems,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Run the message label matcher (step 09d).
 *
 * For message testing surveys with a template file, parses the template and
 * matches each item label to a template message via code extraction or
 * fuzzy prefix matching. For non-message-testing surveys, passes entries
 * through with `hasMessageMatches: false` and null message fields on items.
 *
 * @param input - Entries, metadata, and dataset path
 * @returns Enriched entries with message matching fields
 */
export async function runMessageLabelMatcher(
  input: MessageLabelMatcherInput,
): Promise<MessageLabelMatcherOutput> {
  const { entries, metadata, datasetPath } = input;

  // Non-message-testing surveys: passthrough with null message fields
  if (!metadata.isMessageTestingSurvey || !metadata.messageTemplatePath) {
    return {
      entries: entries.map(entry => enrichEntryNoMatch(entry)),
      metadata,
    };
  }

  // Parse the message template file — handle both absolute and relative paths
  const templatePath = path.isAbsolute(metadata.messageTemplatePath)
    ? metadata.messageTemplatePath
    : path.join(datasetPath, metadata.messageTemplatePath);
  let messages: MessageListEntry[];
  try {
    const parseResult = await parseMessageListFile(templatePath);
    messages = parseResult.messages;
  } catch (err) {
    // Template parsing failed — fall back to passthrough rather than crashing
    console.warn(
      `[messageLabelMatcher] Failed to parse template at ${templatePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      entries: entries.map(entry => enrichEntryNoMatch(entry)),
      metadata,
    };
  }

  if (messages.length === 0) {
    return {
      entries: entries.map(entry => enrichEntryNoMatch(entry)),
      metadata,
    };
  }

  // Build lookup maps
  const codeMap = buildCodeMap(messages);
  const variantMap = buildVariantMap(messages);
  const reverseVariantMap = buildReverseVariantMap(messages);

  // Match each entry's items against the template
  const enrichedEntries = entries.map(entry =>
    enrichEntryWithMessages(entry, codeMap, variantMap, reverseVariantMap),
  );

  return {
    entries: enrichedEntries,
    metadata,
  };
}
