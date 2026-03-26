/**
 * V3 Runtime — Non-substantive code detection
 *
 * Shared utility for identifying non-substantive tail labels
 * (Don't Know, Refused, Not Applicable, etc.) in scale/ordinal items.
 *
 * Used by:
 *   - assemble.ts (row separation, statsSpec)
 *   - prefill.ts (scale anchor note filtering)
 */

// Patterns that indicate a non-substantive response option
const NON_SUBSTANTIVE_TAIL_PATTERNS = [
  /don't know/i,
  /do not know/i,
  /\bdk\b/i,
  /unsure/i,
  /have never used/i,
  /have no impressions/i,
  /did not have prior knowledge/i,
  /no opinion/i,
  /not sure/i,
  /none of (the )?above/i,
  /refus(?:e|ed|al)/i,
  /prefer not to (?:answer|say|state|disclose)/i,
  /\b(?:n\s*\/\s*a|na)\b/i,
  /not applicable/i,
];

/**
 * Returns true if the label matches a non-substantive tail pattern
 * (e.g., "Don't Know", "Not Applicable", "Unsure").
 */
export function isNonSubstantiveTail(label: string): boolean {
  return NON_SUBSTANTIVE_TAIL_PATTERNS.some(rx => rx.test(label));
}

export function getNonSubstantiveLabels(
  labels: Array<{ label: string }>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of labels) {
    const label = item.label?.trim();
    if (!label || !isNonSubstantiveTail(label) || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }

  return result;
}

export function getTrailingNonSubstantiveLabels(
  labels: Array<{ label: string }>,
): string[] {
  const trailing: string[] = [];
  const seen = new Set<string>();

  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const label = labels[i]?.label?.trim();
    if (!label || !isNonSubstantiveTail(label)) break;
    if (seen.has(label)) continue;
    seen.add(label);
    trailing.push(label);
  }

  return trailing.reverse();
}
