import { AsyncLocalStorage } from 'node:async_hooks';
import type { SkipRule } from '../../schemas/skipLogicSchema';
import type { CircuitBreaker } from '../CircuitBreaker';

export type PipelineContextSource =
  | 'pipelineRunner'
  | 'orchestrator'
  | 'reviewCompletion'
  | 'analysisPreflight'
  | 'analysisExtension';

export interface PipelineContextMeta {
  pipelineId: string;
  runId: string;
  sessionId?: string;
  source: PipelineContextSource;
}

export type PipelineLifecycleState = 'initializing' | 'running' | 'cleaning' | 'closed';

export interface PipelineScratchpadEntry {
  timestamp: string;
  agentName: string;
  action: string;
  content: string;
}

export interface PipelineCleanupFn {
  (): void | Promise<void>;
}

export interface PipelineContext {
  meta: PipelineContextMeta;
  scratchpad: {
    byAgent: Map<string, PipelineScratchpadEntry[]>;
    byContext: Map<string, PipelineScratchpadEntry[]>;
  };
  /** @deprecated Used by deprecated SkipLogicAgent pipeline. DeterministicBaseEngine replaces AI-driven skip logic. */
  ruleEmitter: {
    emittedRules: SkipRule[];
    byContext: Map<string, SkipRule[]>;
  };
  resilience: {
    circuitBreaker: CircuitBreaker | null;
  };
  logging: {
    activeRunLogId?: string;
  };
  lifecycle: PipelineLifecycleState;
  cleanup: Set<PipelineCleanupFn>;
}

const pipelineContextStorage = new AsyncLocalStorage<PipelineContext>();

function createContext(meta: PipelineContextMeta): PipelineContext {
  return {
    meta,
    scratchpad: {
      byAgent: new Map<string, PipelineScratchpadEntry[]>(),
      byContext: new Map<string, PipelineScratchpadEntry[]>(),
    },
    ruleEmitter: {
      emittedRules: [],
      byContext: new Map<string, SkipRule[]>(),
    },
    resilience: {
      circuitBreaker: null,
    },
    logging: {},
    lifecycle: 'initializing',
    cleanup: new Set<PipelineCleanupFn>(),
  };
}

export function getPipelineContext(): PipelineContext | null {
  return pipelineContextStorage.getStore() ?? null;
}

export function requirePipelineContext(): PipelineContext {
  const ctx = getPipelineContext();
  if (!ctx) {
    throw new Error('PipelineContext is required but missing. Ensure execution is wrapped in runWithPipelineContext().');
  }
  return ctx;
}

export function registerPipelineCleanup(fn: PipelineCleanupFn): void {
  requirePipelineContext().cleanup.add(fn);
}

export function toCanonicalContextId(logicalContextId: string): string {
  const { pipelineId } = requirePipelineContext().meta;
  return `${pipelineId}::${logicalContextId}`;
}

export async function runWithPipelineContext<T>(
  meta: PipelineContextMeta,
  fn: () => Promise<T> | T,
): Promise<T> {
  const context = createContext(meta);
  return pipelineContextStorage.run(context, async () => {
    context.lifecycle = 'running';
    try {
      return await fn();
    } finally {
      context.lifecycle = 'cleaning';
      const cleanups = [...context.cleanup];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (err) {
          console.error('[PipelineContext] Cleanup callback failed:', err);
        }
      }
      context.cleanup.clear();
      context.lifecycle = 'closed';
    }
  });
}
