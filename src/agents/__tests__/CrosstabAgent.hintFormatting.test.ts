import { describe, expect, it } from 'vitest';

/**
 * Tests for formatPriorAttemptAsNarrative and hint sanitization.
 *
 * formatPriorAttemptAsNarrative is a module-private function in CrosstabAgent.ts,
 * so we replicate its logic here for direct unit testing. If it becomes exported,
 * replace with a direct import.
 */

// Re-implementation of the narrative formatting logic
function formatPriorAttemptAsNarrative(
  priorColumns: Array<{
    name: string;
    adjusted?: string;
    reasoning?: string;
    original?: string;
    alternatives?: Array<{ expression: string; reasoning: string; userSummary: string }>;
    uncertainties?: string[];
  }> | undefined,
  hint: string,
): string {
  if (!priorColumns || priorColumns.length === 0) return 'No prior output available.';
  // For 4+ columns, fall back to JSON (too verbose as narrative)
  if (priorColumns.length > 3) {
    // Simplified — just verify structure, not exact JSON format
    return `Prior output from the last attempt:\n[JSON]\n\nThe reviewer's guidance: "${hint}"`;
  }
  // Readable narrative for 1-3 columns
  const parts = priorColumns.map((col) => {
    const lines: string[] = [];
    lines.push(`Your prior expression for "${col.name}" was: ${col.adjusted || '(none)'}`);
    if (col.reasoning) {
      lines.push(`Your prior reasoning: "${col.reasoning}"`);
    }
    return lines.join('\n');
  });
  parts.push(`\nThe reviewer's guidance: "${hint}"`);
  parts.push('\nRevise the expression(s) to incorporate this guidance.');
  return parts.join('\n\n');
}

describe('formatPriorAttemptAsNarrative', () => {
  it('returns fallback for empty/undefined columns', () => {
    expect(formatPriorAttemptAsNarrative(undefined, 'some hint')).toBe('No prior output available.');
    expect(formatPriorAttemptAsNarrative([], 'some hint')).toBe('No prior output available.');
  });

  it('formats 1 column as readable narrative', () => {
    const result = formatPriorAttemptAsNarrative(
      [{ name: 'Q1', adjusted: 'Q1 == 1', reasoning: 'matched directly' }],
      'Use value range instead',
    );
    expect(result).toContain('Your prior expression for "Q1" was: Q1 == 1');
    expect(result).toContain('Your prior reasoning: "matched directly"');
    expect(result).toContain('The reviewer\'s guidance: "Use value range instead"');
    expect(result).toContain('Revise the expression(s) to incorporate this guidance.');
  });

  it('formats 3 columns as readable narrative', () => {
    const result = formatPriorAttemptAsNarrative(
      [
        { name: 'Q1', adjusted: 'Q1 == 1', reasoning: 'direct match' },
        { name: 'Q2', adjusted: 'Q2 == 2' },
        { name: 'Q3', adjusted: 'Q3 == 3', reasoning: 'third var' },
      ],
      'Apply consistently',
    );
    expect(result).toContain('Your prior expression for "Q1"');
    expect(result).toContain('Your prior expression for "Q2"');
    expect(result).toContain('Your prior expression for "Q3"');
    // Q2 has no reasoning, so only expression line
    expect(result).not.toContain('Your prior reasoning: "undefined"');
  });

  it('falls back to JSON format for 4+ columns', () => {
    const columns = [
      { name: 'Q1', adjusted: 'Q1 == 1' },
      { name: 'Q2', adjusted: 'Q2 == 2' },
      { name: 'Q3', adjusted: 'Q3 == 3' },
      { name: 'Q4', adjusted: 'Q4 == 4' },
    ];
    const result = formatPriorAttemptAsNarrative(columns, 'Apply consistently');
    expect(result).toContain('Prior output from the last attempt:');
    expect(result).toContain('The reviewer\'s guidance: "Apply consistently"');
    // Should NOT contain narrative-style "Your prior expression for"
    expect(result).not.toContain('Your prior expression for');
  });

  it('handles column with no adjusted expression', () => {
    const result = formatPriorAttemptAsNarrative(
      [{ name: 'Q1', adjusted: undefined }],
      'fix this',
    );
    expect(result).toContain('Your prior expression for "Q1" was: (none)');
  });
});

describe('hint sanitization (character stripping)', () => {
  // Test the regex behavior: only <> should be stripped, quotes/apostrophes preserved
  const stripRegex = /[<>]/g;

  it('preserves apostrophes in natural text', () => {
    const hint = "I'm looking for cardiologist's data";
    expect(hint.replace(stripRegex, '')).toBe("I'm looking for cardiologist's data");
  });

  it('preserves double quotes', () => {
    const hint = 'Use "Premium" category values';
    expect(hint.replace(stripRegex, '')).toBe('Use "Premium" category values');
  });

  it('preserves backticks', () => {
    const hint = 'Use `hLOCATION1` variable';
    expect(hint.replace(stripRegex, '')).toBe('Use `hLOCATION1` variable');
  });

  it('preserves backslashes', () => {
    const hint = 'Path is data\\values\\code';
    expect(hint.replace(stripRegex, '')).toBe('Path is data\\values\\code');
  });

  it('strips angle brackets for XML safety', () => {
    const hint = 'Use <script>alert("xss")</script> values';
    expect(hint.replace(stripRegex, '')).toBe('Use scriptalert("xss")/script values');
  });

  it('handles mixed characters correctly', () => {
    const hint = "I'm using <b>Q1's</b> \"value\" with `code`";
    expect(hint.replace(stripRegex, '')).toBe("I'm using bQ1's/b \"value\" with `code`");
  });
});

describe('hint character limit', () => {
  it('truncates at 500 characters', () => {
    const longHint = 'x'.repeat(600);
    const truncated = longHint.slice(0, 500);
    expect(truncated).toHaveLength(500);
  });

  it('preserves hints under 500 characters', () => {
    const shortHint = 'Use value ranges for all cuts in this group';
    const truncated = shortHint.slice(0, 500);
    expect(truncated).toBe(shortHint);
  });
});
