/**
 * MaxDiff Family Detection
 *
 * Pure, deterministic function that scans a datamap and identifies MaxDiff
 * variable families by naming patterns. No AI involved.
 *
 * Detection patterns start with Decipher/Sawtooth conventions and can be
 * extended with additional patterns for other platforms (Lighthouse, Discover).
 *
 * Primary gate is always `projectSubType === 'maxdiff'` — detection is a
 * secondary signal, not an activation trigger.
 */

import { parseMaxDiffLabel } from './parseMaxDiffLabel';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MaxDiffFamilyPattern {
  /** Regex matching variable names in this family */
  pattern: RegExp;
  /** Human-readable family name (e.g., "AnchProbInd") */
  family: string;
  /** Whether this family produces publishable output */
  publishable: boolean;
  /** Whether this family is included by default (vs opt-in) */
  defaultEnabled: boolean;
  /** Display name for consolidated table titles */
  displayName: string;
  /** Score scale description (e.g., "0-200") */
  scale?: string;
}

export interface DetectedFamily {
  /** Family identifier (e.g., "AnchProbInd") */
  name: string;
  /** Display name for table titles (e.g., "API Scores") */
  displayName: string;
  /** Number of variables detected in this family */
  variableCount: number;
  /** Whether this family produces publishable output */
  publishable: boolean;
  /** Whether this family is included by default */
  defaultEnabled: boolean;
  /** Variable name of the anchor (if detected), e.g., "AnchProbInd_31" */
  anchorVariable?: string;
  /** All variable names in this family, sorted by numeric suffix */
  variables: string[];
  /** Score scale description */
  scale?: string;
}

export interface MaxDiffFamilyDetectionResult {
  /** All detected families (publishable and non-publishable) */
  families: DetectedFamily[];
  /** Question IDs to allowlist in the survey filter (publishable families only) */
  questionIdsToAllow: string[];
  /** Whether any MaxDiff families were detected at all */
  detected: boolean;
}

// ─── Default Patterns (Decipher/Sawtooth) ────────────────────────────────────

export const DECIPHER_MAXDIFF_PATTERNS: MaxDiffFamilyPattern[] = [
  {
    pattern: /^AnchProbInd_\d+$/,
    family: 'AnchProbInd',
    publishable: true,
    defaultEnabled: true,
    displayName: 'API Scores',
    scale: '0-200',
  },
  {
    pattern: /^AnchProb_\d+$/,
    family: 'AnchProb',
    publishable: true,
    defaultEnabled: false,
    displayName: 'AP Scores',
    scale: '0-100',
  },
  {
    pattern: /^SharPref_\d+$/,
    family: 'SharPref',
    publishable: true,
    defaultEnabled: false,
    displayName: 'Share of Preference',
  },
  {
    pattern: /^RawUt_\d+$/,
    family: 'RawUt',
    publishable: false,
    defaultEnabled: false,
    displayName: 'Raw Utility',
  },
  {
    pattern: /^RawExp_\d+$/,
    family: 'RawExp',
    publishable: false,
    defaultEnabled: false,
    displayName: 'Raw Exposure',
  },
];

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Detect MaxDiff variable families from a datamap.
 *
 * Scans variable names (the `column` field of each datamap entry) against
 * known MaxDiff family patterns. Groups variables by family and identifies
 * anchor variables by label content.
 *
 * @param datamap - Array of datamap entries with at least `column` and `description` fields
 * @param additionalPatterns - Optional extra patterns to check beyond defaults
 * @returns Detection result with families and allowlist
 */
export function detectMaxDiffFamilies(
  datamap: { column: string; description: string }[],
  additionalPatterns: MaxDiffFamilyPattern[] = [],
): MaxDiffFamilyDetectionResult {
  const allPatterns = [...DECIPHER_MAXDIFF_PATTERNS, ...additionalPatterns];

  // Group variables by family
  const familyMap = new Map<string, {
    pattern: MaxDiffFamilyPattern;
    variables: { column: string; description: string; numericSuffix: number }[];
  }>();

  for (const entry of datamap) {
    for (const pat of allPatterns) {
      if (pat.pattern.test(entry.column)) {
        if (!familyMap.has(pat.family)) {
          familyMap.set(pat.family, { pattern: pat, variables: [] });
        }
        // Extract numeric suffix for sorting
        const suffixMatch = entry.column.match(/_(\d+)$/);
        const numericSuffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;
        familyMap.get(pat.family)!.variables.push({
          column: entry.column,
          description: entry.description,
          numericSuffix,
        });
        break; // A variable matches at most one family
      }
    }
  }

  // Build result
  const families: DetectedFamily[] = [];
  const questionIdsToAllow: string[] = [];

  for (const [familyName, { pattern, variables }] of familyMap) {
    // Sort by numeric suffix
    variables.sort((a, b) => a.numericSuffix - b.numericSuffix);

    // Detect anchor — two-tier:
    //   1. Parse via parseMaxDiffLabel → isAnchor (structured, reliable)
    //   2. Fallback: strip AP:/API: prefix, check for exact "Anchor" match
    // This avoids false positives from descriptions mentioning "anchor" in running text.
    const anchorVar = variables.find(v => {
      const parsed = parseMaxDiffLabel(v.description);
      if (parsed?.isAnchor) return true;
      // Fallback: strip known prefixes and check for exact anchor match
      const stripped = v.description.replace(/^(API|AP)\s*:\s*/i, '').trim();
      return /^anchor(\s*\(.*\))?$/i.test(stripped);
    });

    const family: DetectedFamily = {
      name: familyName,
      displayName: pattern.displayName,
      variableCount: variables.length,
      publishable: pattern.publishable,
      defaultEnabled: pattern.defaultEnabled,
      variables: variables.map(v => v.column),
      scale: pattern.scale,
      ...(anchorVar && { anchorVariable: anchorVar.column }),
    };

    families.push(family);

    // Only publishable families go into the allowlist
    if (pattern.publishable) {
      questionIdsToAllow.push(familyName);
    }
  }

  // Sort families: publishable + defaultEnabled first, then publishable, then non-publishable
  families.sort((a, b) => {
    if (a.defaultEnabled !== b.defaultEnabled) return a.defaultEnabled ? -1 : 1;
    if (a.publishable !== b.publishable) return a.publishable ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    families,
    questionIdsToAllow,
    detected: families.length > 0,
  };
}
