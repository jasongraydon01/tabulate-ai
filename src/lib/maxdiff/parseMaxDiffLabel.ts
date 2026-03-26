/**
 * MaxDiff Label Parser
 *
 * Parses structured AP/API variable labels from .sav files to extract
 * message codes, alternate variant codes, truncated text, and metadata.
 *
 * Known label formats (Decipher/Sawtooth):
 *   "API: I1 OR ALT I1A - Only CAPLYTA is indicated for schizo..."
 *   "AP: E1 - Significant improvement in PANSS total..."
 *   "API: Anchor"
 *   "AP: D4 - In a clinical study, CAPLYTA significantly..."
 *
 * Returns null for unrecognizable formats — callers should fall back
 * to using the raw label as-is.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedMaxDiffLabel {
  /** Primary message code (e.g., "I1", "E1", "D4") */
  messageCode: string;
  /** Alternate variant code, if present (e.g., "I1A") */
  alternateCode?: string;
  /** Whether this label has an alternate variant ("OR ALT" pattern) */
  isAlternate: boolean;
  /** Truncated message text after the code/separator (may be incomplete due to .sav label length limits) */
  truncatedText: string;
  /** Score type prefix */
  scoreType: 'API' | 'AP';
  /** Whether this is the anchor reference point (label = "API: Anchor" or similar) */
  isAnchor: boolean;
}

// ─── Regex ───────────────────────────────────────────────────────────────────

/**
 * Main label pattern.
 *
 * Matches:
 *   Group 1: Score type prefix ("API" or "AP")
 *   Group 2: Primary message code ("I1", "E1", "D4", "Anchor", etc.)
 *   Group 3: Optional alternate code after "OR ALT" ("I1A", "E1A")
 *   Group 4: Optional message text after " - " separator
 *
 * Examples:
 *   "API: I1 OR ALT I1A - Only CAPLYTA..."  → ["API", "I1", "I1A", "Only CAPLYTA..."]
 *   "AP: E1 - Significant improvement..."    → ["AP", "E1", undefined, "Significant improvement..."]
 *   "API: Anchor"                            → ["API", "Anchor", undefined, undefined]
 */
const LABEL_PATTERN = /^(API|AP):\s+(.+?)(?:\s+OR\s+ALT\s+(\w+))?\s*(?:-\s*(.+))?$/;

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a MaxDiff variable label into structured components.
 *
 * @param label - The raw variable label from the .sav file
 * @returns Parsed label components, or null if the format is not recognized
 */
export function parseMaxDiffLabel(label: string): ParsedMaxDiffLabel | null {
  if (!label || typeof label !== 'string') return null;

  const trimmed = label.trim();
  const match = trimmed.match(LABEL_PATTERN);

  if (!match) return null;

  const [, scoreTypeRaw, messageCode, alternateCode, text] = match;
  const scoreType = scoreTypeRaw as 'API' | 'AP';
  const isAnchor = /^anchor$/i.test(messageCode.trim());

  return {
    messageCode: messageCode.trim(),
    ...(alternateCode && { alternateCode: alternateCode.trim() }),
    isAlternate: !!alternateCode,
    truncatedText: isAnchor ? '' : (text?.trim() ?? ''),
    scoreType,
    isAnchor,
  };
}

/**
 * Extract a clean display label from a parsed MaxDiff label.
 *
 * Formats:
 *   With alternate: "I1 / I1A: Only CAPLYTA is indicated..."
 *   Without alternate: "D4: In a clinical study..."
 *   Anchor: "Anchor (reference = 100)"
 *
 * @param parsed - Result from parseMaxDiffLabel()
 * @returns Human-friendly label for display in tables
 */
export function formatMaxDiffDisplayLabel(parsed: ParsedMaxDiffLabel): string {
  if (parsed.isAnchor) {
    return 'Anchor (reference = 100)';
  }

  const codePart = parsed.alternateCode
    ? `${parsed.messageCode} / ${parsed.alternateCode}`
    : parsed.messageCode;

  if (parsed.truncatedText) {
    return `${codePart}: ${parsed.truncatedText}`;
  }

  return codePart;
}
