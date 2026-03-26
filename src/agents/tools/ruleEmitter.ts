/**
 * Rule Emitter tool for SkipLogicAgent
 *
 * Pipeline isolation is mandatory: storage is scoped to PipelineContext.
 */

/**
 * @deprecated Not needed — no AI rule extraction in deterministic pipeline.
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

import { tool } from 'ai';
import { SkipRuleSchema, type SkipRule } from '../../schemas/skipLogicSchema';
import { getPipelineEventBus } from '../../lib/events';
import { requirePipelineContext, toCanonicalContextId } from '../../lib/pipeline/PipelineContext';

function warnDeprecatedRuleEmitterUsage(): void {
  console.warn('[DEPRECATED] ruleEmitter tool called — this should not be invoked in the active pipeline. Use DeterministicBaseEngine instead.');
}

function getContextRules(canonicalContextId: string): SkipRule[] {
  const ctx = requirePipelineContext();
  let rules = ctx.ruleEmitter.byContext.get(canonicalContextId);
  if (!rules) {
    rules = [];
    ctx.ruleEmitter.byContext.set(canonicalContextId, rules);
  }
  return rules;
}

function toLogicalContextId(canonicalContextId: string): string {
  const idx = canonicalContextId.indexOf('::');
  return idx >= 0 ? canonicalContextId.slice(idx + 2) : canonicalContextId;
}

/**
 * Create a rule emitter tool for single-pass mode.
 */
export function createRuleEmitterTool(agentName: string) {
  warnDeprecatedRuleEmitterUsage();
  return tool({
    description:
      'Emit a skip/show/filter rule as soon as you discover it. Call this tool IMMEDIATELY when you confirm a rule — do not wait until the end. Each call records one rule. Fields are validated on submission; if validation fails you will see an error message and can fix and re-emit.',
    inputSchema: SkipRuleSchema,
    execute: async (input) => {
      const parsed = SkipRuleSchema.safeParse(input);

      if (!parsed.success) {
        const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        const msg = `[ERROR] emitRule validation failed: ${errors}. Fix the fields and call emitRule again.`;

        if (!getPipelineEventBus().isEnabled()) {
          console.warn(`[${agentName}] ${msg}`);
        }

        return msg;
      }

      const ctx = requirePipelineContext();
      const rule = parsed.data;
      ctx.ruleEmitter.emittedRules.push(rule);

      const appliesStr = rule.appliesTo.join(', ');
      const logMsg = `Emitted rule ${rule.ruleId} (${rule.ruleType}) -> ${appliesStr}`;

      getPipelineEventBus().emitSlotLog(agentName, 'emitRule', 'emit', logMsg);

      if (!getPipelineEventBus().isEnabled()) {
        console.log(`[${agentName}] ${logMsg}`);
      }

      return `[OK] Rule ${rule.ruleId} emitted (${ctx.ruleEmitter.emittedRules.length} total). Continue scanning.`;
    },
  });
}

/** Get all emitted rules (without clearing) */
export function getEmittedRules(): SkipRule[] {
  warnDeprecatedRuleEmitterUsage();
  return [...requirePipelineContext().ruleEmitter.emittedRules];
}

/** Clear emitted rules (call at start of new processing session) */
export function clearEmittedRules(): void {
  warnDeprecatedRuleEmitterUsage();
  requirePipelineContext().ruleEmitter.emittedRules = [];
}

/**
 * Create a rule emitter tool for a specific context (e.g., chunk ID).
 * Returns rules in isolation from other contexts.
 */
export function createContextRuleEmitterTool(agentName: string, contextId: string) {
  warnDeprecatedRuleEmitterUsage();
  const canonicalContextId = toCanonicalContextId(contextId);

  return tool({
    description:
      'Emit a skip/show/filter rule as soon as you discover it. Call this tool IMMEDIATELY when you confirm a rule — do not wait until the end. Each call records one rule. Fields are validated on submission; if validation fails you will see an error message and can fix and re-emit.',
    inputSchema: SkipRuleSchema,
    execute: async (input) => {
      const parsed = SkipRuleSchema.safeParse(input);

      if (!parsed.success) {
        const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        const msg = `[ERROR] emitRule validation failed: ${errors}. Fix the fields and call emitRule again.`;

        if (!getPipelineEventBus().isEnabled()) {
          console.warn(`[${agentName}:${contextId}] ${msg}`);
        }

        return msg;
      }

      const rule = parsed.data;
      const rules = getContextRules(canonicalContextId);
      rules.push(rule);

      const appliesStr = rule.appliesTo.join(', ');
      const logMsg = `Emitted rule ${rule.ruleId} (${rule.ruleType}) -> ${appliesStr}`;

      getPipelineEventBus().emitSlotLog(agentName, contextId, 'emit', logMsg);

      if (!getPipelineEventBus().isEnabled()) {
        console.log(`[${agentName}:${contextId}] ${logMsg}`);
      }

      return `[OK] Rule ${rule.ruleId} emitted (${rules.length} total for this chunk). Continue scanning.`;
    },
  });
}

/** Get emitted rules for a specific context */
export function getContextEmittedRules(contextId: string): SkipRule[] {
  warnDeprecatedRuleEmitterUsage();
  return [...(requirePipelineContext().ruleEmitter.byContext.get(toCanonicalContextId(contextId)) || [])];
}

/** Get all context-isolated emitted rules (for aggregation after parallel execution) */
export function getAllContextEmittedRules(): Array<{
  contextId: string;
  rules: SkipRule[];
}> {
  warnDeprecatedRuleEmitterUsage();
  const ctx = requirePipelineContext();
  return [...ctx.ruleEmitter.byContext.entries()].map(([canonicalContextId, rules]) => ({
    contextId: toLogicalContextId(canonicalContextId),
    rules: [...rules],
  }));
}

/** Clear all context-isolated emitters */
export function clearAllContextEmitters(): void {
  warnDeprecatedRuleEmitterUsage();
  requirePipelineContext().ruleEmitter.byContext.clear();
}
