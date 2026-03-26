/**
 * MaxDiff Warning Types & Accumulator
 *
 * Structured warnings for non-fatal issues encountered during MaxDiff
 * message resolution, parsing, and enrichment. These are informational —
 * they don't block the pipeline, but they surface potential data quality
 * issues for the user.
 *
 * Written to `maxdiff/warnings.json` and included in PipelineSummary.maxdiff.
 */

// ─── Warning Codes ──────────────────────────────────────────────────────────

export type MaxDiffWarningCode =
  | 'parse_fallback_to_sav'
  | 'parse_error_fallback'
  | 'duplicate_codes'
  | 'empty_codes_generated'
  | 'unmatched_messages'
  | 'xls_parse_failure'
  | 'variantof_unknown_ref'
  | 'variantof_self_ref'
  | 'variantof_cycle';

// ─── Warning Type ───────────────────────────────────────────────────────────

export interface MaxDiffWarning {
  /** Warning code for programmatic handling */
  code: MaxDiffWarningCode;
  /** Human-readable description */
  message: string;
  /** Optional additional context */
  details?: string;
}

// ─── Accumulator ────────────────────────────────────────────────────────────

/**
 * Accumulates MaxDiff warnings during pipeline execution.
 *
 * Usage:
 *   const warnings = new MaxDiffWarnings();
 *   warnings.add('duplicate_codes', 'Found 2 duplicate message codes', 'I1, I1');
 *   // ... pass warnings through pipeline stages ...
 *   const all = warnings.toArray();
 */
export class MaxDiffWarnings {
  private readonly warnings: MaxDiffWarning[] = [];

  /** Add a single warning */
  add(code: MaxDiffWarningCode, message: string, details?: string): void {
    this.warnings.push({ code, message, ...(details !== undefined && { details }) });
  }

  /** Merge all warnings from another accumulator */
  addAll(other: MaxDiffWarnings): void {
    this.warnings.push(...other.warnings);
  }

  /** Add pre-built warning objects */
  addWarnings(items: MaxDiffWarning[]): void {
    this.warnings.push(...items);
  }

  /** Get all accumulated warnings */
  toArray(): MaxDiffWarning[] {
    return [...this.warnings];
  }

  /** Number of accumulated warnings */
  get count(): number {
    return this.warnings.length;
  }

  /** Whether any warnings have been accumulated */
  get hasWarnings(): boolean {
    return this.warnings.length > 0;
  }
}
