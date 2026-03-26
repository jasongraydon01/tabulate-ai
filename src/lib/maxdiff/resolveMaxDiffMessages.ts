/**
 * Shared MaxDiff Message Resolution
 *
 * Implements the message priority ladder used by all 3 pipeline paths.
 * Prevents code duplication across PipelineRunner, pipelineOrchestrator,
 * and reviewCompletion.
 *
 * Priority:
 *   1. config.maxdiffMessages — structured data from wizard grid
 *   2. messageListPath — uploaded file, parsed at call site
 *   3. .sav label parsing — fallback (truncated labels)
 */

import type { ProjectConfig } from '@/schemas/projectConfigSchema';
import type { MessageListEntry } from './MessageListParser';
import { MaxDiffWarnings } from './warnings';
import fs from 'fs/promises';

export interface ResolvedMessages {
  /** Pre-resolved entries (priority 1), or null if caller should parse file / use .sav */
  entries: MessageListEntry[] | null;
  /** How messages were resolved */
  source: 'wizard' | 'file' | 'sav';
}

/**
 * Determine the message source based on available data.
 *
 * When source is 'wizard', entries are pre-built from config — skip file parsing entirely.
 * When source is 'file', entries is null — caller should parse the file at messageListPath.
 * When source is 'sav', entries is null — caller falls back to .sav labels.
 */
export function resolveMaxDiffMessages(
  config: ProjectConfig | undefined,
  messageListPath?: string | null,
): ResolvedMessages {
  // Priority 1: Structured messages from wizard grid
  if (config?.maxdiffMessages && config.maxdiffMessages.length > 0) {
    return {
      entries: config.maxdiffMessages.map((m, i) => ({
        code: m.code,
        text: m.text,
        sourceRow: i + 1,
        ...(m.variantOf ? { variantOf: m.variantOf } : {}),
      })),
      source: 'wizard',
    };
  }

  // Priority 2: File path exists — caller should parse
  if (messageListPath) {
    return { entries: null, source: 'file' };
  }

  // Priority 3: Fall back to .sav labels
  return { entries: null, source: 'sav' };
}

/**
 * Resolve AND parse MaxDiff messages in a single call.
 *
 * Unlike `resolveMaxDiffMessages`, this async wrapper handles the file-parsing
 * step automatically when source is 'file', so callers don't need to branch.
 * Returns entries for all resolvable sources (wizard, file); returns null
 * entries only for 'sav' fallback.
 *
 * When a `warnings` accumulator is provided, parsing failures produce a
 * structured warning + sav fallback instead of throwing.
 */
export async function resolveAndParseMaxDiffMessages(
  config: ProjectConfig | undefined,
  messageListPath?: string | null,
  warnings?: MaxDiffWarnings,
): Promise<ResolvedMessages> {
  const resolution = resolveMaxDiffMessages(config, messageListPath);

  // Validate variantOf graph for wizard-sourced entries
  if (resolution.source === 'wizard' && resolution.entries && resolution.entries.length > 0) {
    const hasVariants = resolution.entries.some(e => e.variantOf);
    if (hasVariants && warnings) {
      const { validateVariantOfGraph } = await import('./MessageListParser');
      const graphWarnings = validateVariantOfGraph(resolution.entries);
      warnings.addWarnings(graphWarnings);
    }
  }

  if (resolution.source === 'file' && messageListPath) {
    // Fast-path missing/unreadable files before importing the heavier parser stack.
    // This keeps fallback behavior deterministic under full-suite load.
    try {
      await fs.access(messageListPath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (warnings) {
        warnings.add(
          'parse_error_fallback',
          `Failed to access message list file — falling back to .sav labels: ${detail}`,
          messageListPath,
        );
        return { entries: null, source: 'sav' };
      }
      throw new Error(`Failed to access message list file "${messageListPath}": ${detail}`);
    }

    try {
      const { parseMessageListFile, validateVariantOfGraph } = await import('./MessageListParser');
      const parsed = await parseMessageListFile(messageListPath);

      if (parsed.messages.length === 0) {
        if (warnings) {
          warnings.add(
            'parse_fallback_to_sav',
            'Message list file was empty — falling back to .sav labels',
            messageListPath,
          );
        }
        return { entries: null, source: 'sav' };
      }

      // Surface duplicate codes as warnings
      if (warnings && parsed.duplicateCodes.length > 0) {
        warnings.add(
          'duplicate_codes',
          `Duplicate message codes found: ${parsed.duplicateCodes.join(', ')}`,
          `${parsed.duplicateCodes.length} code(s) appear more than once`,
        );
      }

      // Surface auto-generated codes as warnings
      if (warnings && parsed.emptyCodeRows.length > 0) {
        warnings.add(
          'empty_codes_generated',
          `${parsed.emptyCodeRows.length} row(s) had empty codes — auto-generated as ROW_N`,
          `Rows: ${parsed.emptyCodeRows.join(', ')}`,
        );
      }

      // Validate variantOf graph
      if (warnings) {
        const graphWarnings = validateVariantOfGraph(parsed.messages);
        warnings.addWarnings(graphWarnings);
      }

      return { entries: parsed.messages, source: 'file' };
    } catch (error) {
      if (warnings) {
        warnings.add(
          'parse_error_fallback',
          `Failed to parse message list file — falling back to .sav labels: ${error instanceof Error ? error.message : String(error)}`,
          messageListPath,
        );
        return { entries: null, source: 'sav' };
      }
      // No warnings accumulator — re-throw for backward compat
      throw error;
    }
  }

  return resolution;
}
