/**
 * Message Matcher
 *
 * @deprecated Use enrichDataMapWithMessages instead. Zero production callers.
 * This module was superseded by the datamap enrichment approach which runs
 * before TableGenerator, ensuring all downstream processors inherit correct labels.
 *
 * Waterfall matching of messages from an uploaded message list to MaxDiff
 * variables. Uses a two-step matching strategy:
 *
 *   1. Code match: message code from parsed label → message list code
 *   2. Position match: AnchProbInd_N → row N in message list
 */

import type { MessageListEntry } from './MessageListParser';
import { parseMaxDiffLabel } from './parseMaxDiffLabel';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MatchedMessage {
  /** SPSS variable name */
  variable: string;
  /** Original label from .sav */
  originalLabel: string;
  /** Full-text label from message list (or original if no match) */
  fullTextLabel: string;
  /** How the match was made */
  matchMethod: 'code' | 'position' | 'none';
  /** Message code from parsed label (if available) */
  messageCode?: string;
}

export interface MatchResult {
  /** All matched messages */
  matches: MatchedMessage[];
  /** Summary stats */
  stats: {
    total: number;
    codeMatches: number;
    positionMatches: number;
    unmatched: number;
  };
}

// ─── Matcher ─────────────────────────────────────────────────────────────────

/**
 * Match MaxDiff variables to message list entries.
 *
 * @deprecated Use enrichDataMapWithMessages instead. Zero production callers.
 * @param variables - Array of { variable, label } from consolidated table rows
 * @param messages - Parsed message list entries
 * @returns Match results with full-text labels
 */
export function matchMessages(
  variables: { variable: string; label: string }[],
  messages: MessageListEntry[],
): MatchResult {
  // Build code lookup (case-insensitive)
  const codeMap = new Map<string, MessageListEntry>();
  for (const msg of messages) {
    codeMap.set(msg.code.toUpperCase(), msg);
  }

  const matches: MatchedMessage[] = [];
  let codeMatches = 0;
  let positionMatches = 0;
  let unmatched = 0;

  for (const { variable, label } of variables) {
    const parsed = parseMaxDiffLabel(label);

    // Step 1: Code match via parsed label
    if (parsed && !parsed.isAnchor) {
      const codeKey = parsed.messageCode.toUpperCase();
      const matched = codeMap.get(codeKey);
      if (matched) {
        const codePart = parsed.alternateCode
          ? `${parsed.messageCode} / ${parsed.alternateCode}`
          : parsed.messageCode;
        matches.push({
          variable,
          originalLabel: label,
          fullTextLabel: `${codePart}: ${matched.text}`,
          matchMethod: 'code',
          messageCode: parsed.messageCode,
        });
        codeMatches++;
        continue;
      }
    }

    // Step 2: Position match via numeric suffix
    const suffixMatch = variable.match(/_(\d+)$/);
    if (suffixMatch) {
      const position = parseInt(suffixMatch[1], 10);
      // Position is 1-based, message array is 0-based
      if (position >= 1 && position <= messages.length) {
        const msg = messages[position - 1];
        matches.push({
          variable,
          originalLabel: label,
          fullTextLabel: `${msg.code}: ${msg.text}`,
          matchMethod: 'position',
          messageCode: msg.code,
        });
        positionMatches++;
        continue;
      }
    }

    // No match — keep original label
    matches.push({
      variable,
      originalLabel: label,
      fullTextLabel: label,
      matchMethod: 'none',
      messageCode: parsed?.messageCode,
    });
    unmatched++;
  }

  return {
    matches,
    stats: {
      total: variables.length,
      codeMatches,
      positionMatches,
      unmatched,
    },
  };
}
