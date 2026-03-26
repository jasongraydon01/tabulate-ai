import { describe, expect, it } from 'vitest';

import {
  registerPipelineCleanup,
  runWithPipelineContext,
} from '../PipelineContext';
import {
  createContextScratchpadTool,
  getContextScratchpadEntries,
  getAllContextScratchpadEntries,
  clearContextScratchpadsForAgent,
} from '../../../agents/tools/scratchpad';
import {
  createContextRuleEmitterTool,
  getContextEmittedRules,
} from '../../../agents/tools/ruleEmitter';
import { CircuitBreaker, setActiveCircuitBreaker } from '../../CircuitBreaker';
import { retryWithPolicyHandling } from '../../retryWithPolicyHandling';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sampleRule = {
  ruleId: 'rule_1',
  surveyText: 'If Q1=1 skip to Q3',
  appliesTo: ['Q3'],
  plainTextRule: 'Skip to Q3 when Q1 is 1',
  ruleType: 'table-level' as const,
  conditionDescription: 'Q1 equals 1',
  translationContext: '',
};

describe('PipelineContext isolation', () => {
  it('isolates scratchpad entries for identical logical context IDs across concurrent pipelines', async () => {
    const [runAEntries, runBEntries] = await Promise.all([
      runWithPipelineContext(
        { pipelineId: 'pipeline-A', runId: 'run-A', source: 'pipelineRunner' },
        async () => {
          const tool = createContextScratchpadTool('FilterTranslatorAgent', 'chunk-1') as unknown as {
            execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
          };
          await tool.execute({ action: 'add', content: 'from-run-A' }, undefined);
          await wait(10);
          return getContextScratchpadEntries('chunk-1');
        },
      ),
      runWithPipelineContext(
        { pipelineId: 'pipeline-B', runId: 'run-B', source: 'pipelineRunner' },
        async () => {
          const tool = createContextScratchpadTool('FilterTranslatorAgent', 'chunk-1') as unknown as {
            execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
          };
          await tool.execute({ action: 'add', content: 'from-run-B' }, undefined);
          await wait(10);
          return getContextScratchpadEntries('chunk-1');
        },
      ),
    ]);

    expect(runAEntries).toHaveLength(1);
    expect(runAEntries[0].content).toBe('from-run-A');

    expect(runBEntries).toHaveLength(1);
    expect(runBEntries[0].content).toBe('from-run-B');
  });

  it('isolates scratchpad entries by agent within the same context ID', async () => {
    const result = await runWithPipelineContext(
      { pipelineId: 'pipeline-agent-filter', runId: 'run-1', source: 'pipelineRunner' },
      async () => {
        const tableContextTool = createContextScratchpadTool('TableContextAgent', 'Q1') as unknown as {
          execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
        };
        const netTool = createContextScratchpadTool('NETEnrichmentAgent', 'Q1') as unknown as {
          execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
        };

        await tableContextTool.execute({ action: 'add', content: 'table-context-note' }, undefined);
        await netTool.execute({ action: 'add', content: 'net-note' }, undefined);

        return {
          tableContext: getAllContextScratchpadEntries('TableContextAgent'),
          net: getAllContextScratchpadEntries('NETEnrichmentAgent'),
        };
      },
    );

    expect(result.tableContext).toHaveLength(1);
    expect(result.tableContext[0].entries.map((e) => e.content)).toEqual(['table-context-note']);
    expect(result.net).toHaveLength(1);
    expect(result.net[0].entries.map((e) => e.content)).toEqual(['net-note']);
  });

  it('clears scratchpads for one agent without removing entries from other agents', async () => {
    const result = await runWithPipelineContext(
      { pipelineId: 'pipeline-agent-clear', runId: 'run-1', source: 'pipelineRunner' },
      async () => {
        const tableContextTool = createContextScratchpadTool('TableContextAgent', 'Q1') as unknown as {
          execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
        };
        const netTool = createContextScratchpadTool('NETEnrichmentAgent', 'Q1') as unknown as {
          execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
        };

        await tableContextTool.execute({ action: 'add', content: 'table-context-note' }, undefined);
        await netTool.execute({ action: 'add', content: 'net-note' }, undefined);

        clearContextScratchpadsForAgent('NETEnrichmentAgent');

        return {
          tableContext: getAllContextScratchpadEntries('TableContextAgent'),
          net: getAllContextScratchpadEntries('NETEnrichmentAgent'),
        };
      },
    );

    expect(result.tableContext).toHaveLength(1);
    expect(result.tableContext[0].entries.map((e) => e.content)).toEqual(['table-context-note']);
    expect(result.net).toHaveLength(0);
  });

  it('keeps scratchpad isolation across concurrent runs even when pipelineId is the same', async () => {
    const [runAEntries, runBEntries] = await Promise.all([
      runWithPipelineContext(
        { pipelineId: 'pipeline-shared', runId: 'run-A', source: 'pipelineRunner' },
        async () => {
          const tool = createContextScratchpadTool('NETEnrichmentAgent', 'chunk-1') as unknown as {
            execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
          };
          await tool.execute({ action: 'add', content: 'from-run-A' }, undefined);
          await wait(10);
          return getContextScratchpadEntries('chunk-1');
        },
      ),
      runWithPipelineContext(
        { pipelineId: 'pipeline-shared', runId: 'run-B', source: 'pipelineRunner' },
        async () => {
          const tool = createContextScratchpadTool('NETEnrichmentAgent', 'chunk-1') as unknown as {
            execute: (input: { action: 'add' | 'review' | 'read'; content: string }, options?: unknown) => Promise<string>;
          };
          await tool.execute({ action: 'add', content: 'from-run-B' }, undefined);
          await wait(10);
          return getContextScratchpadEntries('chunk-1');
        },
      ),
    ]);

    expect(runAEntries).toHaveLength(1);
    expect(runAEntries[0].content).toBe('from-run-A');
    expect(runBEntries).toHaveLength(1);
    expect(runBEntries[0].content).toBe('from-run-B');
  });

  it('isolates rule emitter state for identical context IDs across concurrent pipelines', async () => {
    const [runARules, runBRules] = await Promise.all([
      runWithPipelineContext(
        { pipelineId: 'pipeline-A', runId: 'run-A', source: 'pipelineRunner' },
        async () => {
          const tool = createContextRuleEmitterTool('SkipLogicAgent', 'chunk-1') as unknown as {
            execute: (input: typeof sampleRule, options?: unknown) => Promise<string>;
          };
          await tool.execute({ ...sampleRule, ruleId: 'rule-A' }, undefined);
          await wait(10);
          return getContextEmittedRules('chunk-1');
        },
      ),
      runWithPipelineContext(
        { pipelineId: 'pipeline-B', runId: 'run-B', source: 'pipelineRunner' },
        async () => {
          const tool = createContextRuleEmitterTool('SkipLogicAgent', 'chunk-1') as unknown as {
            execute: (input: typeof sampleRule, options?: unknown) => Promise<string>;
          };
          await tool.execute({ ...sampleRule, ruleId: 'rule-B' }, undefined);
          await wait(10);
          return getContextEmittedRules('chunk-1');
        },
      ),
    ]);

    expect(runARules.map((r) => r.ruleId)).toEqual(['rule-A']);
    expect(runBRules.map((r) => r.ruleId)).toEqual(['rule-B']);
  });

  it('uses per-run circuit breaker state and prevents cross-run breaker trips', async () => {
    let breakerATripped = false;
    let breakerBTripped = false;

    const breakerA = new CircuitBreaker({
      threshold: 1,
      classifications: ['transient'],
      onTrip: () => {
        breakerATripped = true;
      },
    });

    const breakerB = new CircuitBreaker({
      threshold: 1,
      classifications: ['transient'],
      onTrip: () => {
        breakerBTripped = true;
      },
    });

    const [runAResult, runBResult] = await Promise.all([
      runWithPipelineContext(
        { pipelineId: 'pipeline-A', runId: 'run-A', source: 'pipelineRunner' },
        async () => {
          setActiveCircuitBreaker(breakerA);
          return retryWithPolicyHandling(async () => {
            throw new Error('network error');
          }, { maxAttempts: 1 });
        },
      ),
      runWithPipelineContext(
        { pipelineId: 'pipeline-B', runId: 'run-B', source: 'pipelineRunner' },
        async () => {
          setActiveCircuitBreaker(breakerB);
          return retryWithPolicyHandling(async () => 'ok', { maxAttempts: 1 });
        },
      ),
    ]);

    expect(runAResult.success).toBe(false);
    expect(runBResult.success).toBe(true);
    expect(breakerATripped).toBe(true);
    expect(breakerBTripped).toBe(false);
  });

  it('always runs registered cleanup callbacks when execution fails', async () => {
    let cleaned = false;

    await expect(
      runWithPipelineContext(
        { pipelineId: 'pipeline-cleanup', runId: 'run-cleanup', source: 'pipelineRunner' },
        async () => {
          registerPipelineCleanup(() => {
            cleaned = true;
          });
          throw new Error('forced failure');
        },
      ),
    ).rejects.toThrow('forced failure');

    expect(cleaned).toBe(true);
  });
});
