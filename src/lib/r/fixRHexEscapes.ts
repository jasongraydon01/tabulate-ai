/**
 * Fix R Unicode hex escape sequences in strings.
 *
 * When R runs under a non-UTF-8 locale (e.g. `C` or `POSIX`, typical in cloud
 * containers), multi-byte UTF-8 characters get emitted as `<xx>` hex escape
 * sequences in JSON output. For example:
 *   - `ñ` (U+00F1) → `<c3><b1>`
 *   - `–` (U+2013) → `<e2><80><93>`
 *   - `±` (U+00B1) → `<c2><b1>`
 *
 * This function finds consecutive runs of `<xx>` patterns and reassembles
 * them into proper UTF-8 characters.
 */

/**
 * Pattern matches one or more consecutive `<xx>` hex byte sequences.
 * Each `<xx>` is exactly 2 hex digits enclosed in angle brackets.
 */
const HEX_ESCAPE_PATTERN = /(?:<[0-9a-f]{2}>)+/gi;

/**
 * Converts R-style `<xx>` hex escape sequences back to UTF-8 characters.
 *
 * @param input - Raw string potentially containing `<xx>` sequences
 * @returns The string with hex escapes replaced by proper UTF-8 characters
 */
export function fixRHexEscapes(input: string): string {
  return input.replace(HEX_ESCAPE_PATTERN, (match) => {
    // Extract individual hex bytes from the matched sequence
    const hexBytes: number[] = [];
    const bytePattern = /<([0-9a-f]{2})>/gi;
    let byteMatch: RegExpExecArray | null;

    while ((byteMatch = bytePattern.exec(match)) !== null) {
      hexBytes.push(parseInt(byteMatch[1], 16));
    }

    // Reassemble bytes into a UTF-8 string
    try {
      return Buffer.from(hexBytes).toString('utf-8');
    } catch {
      // If decoding fails, return the original escaped sequence unchanged
      return match;
    }
  });
}

/**
 * Checks whether a string contains any R hex escape sequences.
 * Useful for logging/diagnostics.
 */
export function containsRHexEscapes(input: string): boolean {
  return HEX_ESCAPE_PATTERN.test(input);
}

/**
 * Counts the number of R hex escape sequence groups in a string.
 * Each group (e.g. `<c3><b1>`) counts as one occurrence.
 */
export function countRHexEscapes(input: string): number {
  const matches = input.match(HEX_ESCAPE_PATTERN);
  return matches ? matches.length : 0;
}
