/**
 * Scratchpad tool for reasoning transparency
 * Provides enhanced thinking space for complex variable validation tasks.
 *
 * Pipeline isolation is mandatory: storage is scoped to PipelineContext.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getPipelineEventBus } from '../../lib/events';
import {
  requirePipelineContext,
  toCanonicalContextId,
  type PipelineScratchpadEntry,
} from '../../lib/pipeline/PipelineContext';

type ScratchpadEntry = PipelineScratchpadEntry;

function getAgentEntries(agentName: string): ScratchpadEntry[] {
  const ctx = requirePipelineContext();
  let entries = ctx.scratchpad.byAgent.get(agentName);
  if (!entries) {
    entries = [];
    ctx.scratchpad.byAgent.set(agentName, entries);
  }
  return entries;
}

function getContextEntries(canonicalContextId: string): ScratchpadEntry[] {
  const ctx = requirePipelineContext();
  let entries = ctx.scratchpad.byContext.get(canonicalContextId);
  if (!entries) {
    entries = [];
    ctx.scratchpad.byContext.set(canonicalContextId, entries);
  }
  return entries;
}

function toLogicalContextId(canonicalContextId: string): string {
  const idx = canonicalContextId.indexOf('::');
  return idx >= 0 ? canonicalContextId.slice(idx + 2) : canonicalContextId;
}

/**
 * Legacy wrapper retained for callsites that still invoke this symbol.
 * Hard-cutover behavior: execution MUST already be in an active PipelineContext.
 */
export function runWithScratchpadIsolation<T>(pipelineId: string, fn: () => T | Promise<T>): T | Promise<T> {
  const ctx = requirePipelineContext();
  if (ctx.meta.pipelineId !== pipelineId) {
    throw new Error(
      `Scratchpad pipeline mismatch: expected ${pipelineId}, active ${ctx.meta.pipelineId}`,
    );
  }
  return fn();
}

/**
 * Create a scratchpad tool for a specific agent.
 */
export function createScratchpadTool(agentName: string) {
  return tool({
    description: 'Enhanced thinking space for reasoning models to show validation steps and reasoning. Use "add" to document your analysis, "read" to retrieve all previous entries (useful before producing final output), or "review" to add review notes.',
    inputSchema: z.object({
      action: z.enum(['add', 'review', 'read']).describe('Action: "add" new thoughts, "read" to retrieve all accumulated entries, or "review" to add review notes'),
      content: z.string().describe('Content to add (for "add"/"review"). For "read", pass empty string or a brief note about why you are reading.'),
    }),
    execute: async ({ action, content }) => {
      const timestamp = new Date().toISOString();
      const entries = getAgentEntries(agentName);

      if (action === 'read') {
        if (entries.length === 0) {
          return '[Read] No entries recorded yet.';
        }
        const formatted = entries.map((e, i) => `[${i + 1}] (${e.action}) ${e.content}`).join('\n\n');
        return `[Read] ${entries.length} entries:\n\n${formatted}`;
      }

      entries.push({ timestamp, agentName, action, content });

      if (!getPipelineEventBus().isEnabled()) {
        console.log(`[${agentName} Scratchpad] ${action}: ${content}`);
      }

      switch (action) {
        case 'add':
          return `[Thinking] Added: ${content}`;
        case 'review':
          return `[Review] ${content}`;
        default:
          return `[Scratchpad] Unknown action: ${action}`;
      }
    },
  });
}

// Pre-created tools for each agent (for convenience)
export const crosstabScratchpadTool = createScratchpadTool('CrosstabAgent');
export const bannerScratchpadTool = createScratchpadTool('BannerAgent');
export const verificationScratchpadTool = createScratchpadTool('VerificationAgent');
export const skipLogicScratchpadTool = createScratchpadTool('SkipLogicAgent');
export const filterTranslatorScratchpadTool = createScratchpadTool('FilterTranslatorAgent');
export const aiGateScratchpadTool = createScratchpadTool('AIGateAgent');

// Legacy export for backward compatibility
export const scratchpadTool = crosstabScratchpadTool;

/**
 * Get accumulated scratchpad entries and clear them.
 */
export function getAndClearScratchpadEntries(agentName?: string): ScratchpadEntry[] {
  const ctx = requirePipelineContext();

  if (agentName) {
    const agentEntries = [...(ctx.scratchpad.byAgent.get(agentName) || [])];
    ctx.scratchpad.byAgent.delete(agentName);
    return agentEntries;
  }

  const allAgentEntries = [...ctx.scratchpad.byAgent.values()].flatMap((entries) => entries);
  ctx.scratchpad.byAgent.clear();
  return allAgentEntries;
}

/**
 * Get accumulated entries without clearing (for inspection).
 */
export function getScratchpadEntries(): ScratchpadEntry[] {
  const ctx = requirePipelineContext();
  return [...ctx.scratchpad.byAgent.values()].flatMap((entries) => entries);
}

/**
 * Clear scratchpad entries (call at start of new processing session).
 */
export function clearScratchpadEntries(): void {
  requirePipelineContext().scratchpad.byAgent.clear();
}

// Type export for use in agent definitions
export type ScratchpadTool = ReturnType<typeof createScratchpadTool>;

// =============================================================================
// Context-Isolated Scratchpad (for parallel execution)
// =============================================================================

/**
 * Create a scratchpad tool for a specific context (e.g., tableId).
 */
export function createContextScratchpadTool(agentName: string, contextId: string) {
  const canonicalContextId = toCanonicalContextId(contextId);

  return tool({
    description: 'Enhanced thinking space for reasoning models to show validation steps and reasoning. Use "add" to document your analysis, "read" to retrieve all previous entries, or "review" to add review notes.',
    inputSchema: z.object({
      action: z.enum(['add', 'review', 'read']).describe('Action: "add" new thoughts, "read" to retrieve all accumulated entries, or "review" to add review notes'),
      content: z.string().describe('Content to add (for "add"/"review"). For "read", pass empty string or a brief note.'),
    }),
    execute: async ({ action, content }) => {
      const timestamp = new Date().toISOString();
      const entries = getContextEntries(canonicalContextId);

      if (action === 'read') {
        if (entries.length === 0) {
          return '[Read] No entries recorded yet.';
        }
        const formatted = entries.map((e, i) => `[${i + 1}] (${e.action}) ${e.content}`).join('\n\n');
        return `[Read] ${entries.length} entries:\n\n${formatted}`;
      }

      entries.push({ timestamp, agentName, action, content });

      getPipelineEventBus().emitSlotLog(agentName, contextId, action, content);

      if (!getPipelineEventBus().isEnabled()) {
        console.log(`[${agentName}:${contextId}] ${action}: ${content}`);
      }

      switch (action) {
        case 'add':
          return `[Thinking] Added: ${content}`;
        case 'review':
          return `[Review] ${content}`;
        default:
          return `[Scratchpad] Unknown action: ${action}`;
      }
    },
  });
}

/**
 * Get entries for a specific context and clear them.
 */
export function getContextScratchpadEntries(contextId: string): Array<{
  timestamp: string;
  agentName: string;
  action: string;
  content: string;
}> {
  const ctx = requirePipelineContext();
  const canonicalContextId = toCanonicalContextId(contextId);
  const entries = [...(ctx.scratchpad.byContext.get(canonicalContextId) || [])];
  ctx.scratchpad.byContext.delete(canonicalContextId);
  return entries;
}

/**
 * Get all context entries (for aggregation after parallel execution).
 *
 * @param filterAgentName — if provided, only return entries written by this agent.
 *   Use this when agents run in parallel to avoid scratchpad contamination
 *   (e.g., canonical chain agents picking up CrosstabAgentV2 entries).
 */
export function getAllContextScratchpadEntries(filterAgentName?: string): Array<{
  contextId: string;
  entries: Array<{ timestamp: string; agentName: string; action: string; content: string }>;
}> {
  const ctx = requirePipelineContext();
  const results: Array<{
    contextId: string;
    entries: Array<{ timestamp: string; agentName: string; action: string; content: string }>;
  }> = [];

  for (const [canonicalContextId, entries] of ctx.scratchpad.byContext.entries()) {
    const filtered = filterAgentName
      ? entries.filter(e => e.agentName === filterAgentName)
      : [...entries];
    if (filtered.length > 0) {
      results.push({
        contextId: toLogicalContextId(canonicalContextId),
        entries: filtered,
      });
    }
  }

  return results;
}

/**
 * Clear all context scratchpads.
 */
export function clearAllContextScratchpads(): void {
  requirePipelineContext().scratchpad.byContext.clear();
}

/**
 * Clear context scratchpad entries for a specific agent only.
 * Preserves entries from other agents running in the same pipeline context.
 */
export function clearContextScratchpadsForAgent(agentName: string): void {
  const ctx = requirePipelineContext();

  for (const [canonicalContextId, entries] of ctx.scratchpad.byContext.entries()) {
    const remaining = entries.filter((entry) => entry.agentName !== agentName);
    if (remaining.length === 0) {
      ctx.scratchpad.byContext.delete(canonicalContextId);
    } else {
      ctx.scratchpad.byContext.set(canonicalContextId, remaining);
    }
  }
}

/**
 * Format scratchpad entries as markdown for human-readable output.
 */
export function formatScratchpadAsMarkdown(
  agentName: string,
  entries: Array<{ timestamp: string; agentName?: string; action: string; content: string }>,
): string {
  const header = `# ${agentName} Scratchpad Trace

Generated: ${new Date().toISOString()}
Total entries: ${entries.length}

---
`;

  if (entries.length === 0) {
    return `${header}\n*No scratchpad entries recorded.*\n`;
  }

  const formattedEntries = entries
    .map((entry, index) => {
      const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      });

      const agentPrefix = entry.agentName && entry.agentName !== agentName ? `**Agent**: ${entry.agentName}\n` : '';

      return `## Entry ${index + 1} - ${time}

${agentPrefix}**Action**: \`${entry.action}\`

${entry.content}
`;
    })
    .join('\n---\n\n');

  return header + formattedEntries;
}
