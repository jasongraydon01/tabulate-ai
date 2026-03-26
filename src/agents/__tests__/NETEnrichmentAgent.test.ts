import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NetEnrichmentResult } from '../../schemas/netEnrichmentSchema';

// Mock dependencies before importing the module
vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn(({ schema }) => schema),
  },
  stepCountIs: vi.fn(() => () => false),
}));

vi.mock('../../lib/env', () => ({
  getNetEnrichmentModel: vi.fn(() => 'mock-model'),
  getNetEnrichmentModelName: vi.fn(() => 'azure/gpt-5-mini'),
  getNetEnrichmentModelTokenLimit: vi.fn(() => 128000),
  getNetEnrichmentReasoningEffort: vi.fn(() => 'medium'),
  getPromptVersions: vi.fn(() => ({ netEnrichmentPromptVersion: 'production' })),
  getGenerationConfig: vi.fn(() => ({ temperature: 0, seed: 42, parallelToolCalls: false })),
  getGenerationSamplingParams: vi.fn(() => ({})),
}));

vi.mock('../tools/scratchpad', () => ({
  createContextScratchpadTool: vi.fn(() => ({ type: 'function', function: { name: 'scratchpad' } })),
  getAllContextScratchpadEntries: vi.fn(() => []),
  clearContextScratchpadsForAgent: vi.fn(),
  clearAllContextScratchpads: vi.fn(),
  formatScratchpadAsMarkdown: vi.fn(() => ''),
}));

vi.mock('../../prompts', () => ({
  getNetEnrichmentPrompt: vi.fn(() => 'mock prompt'),
}));

vi.mock('../../lib/retryWithPolicyHandling', () => ({
  retryWithPolicyHandling: vi.fn(async (fn) => {
    const result = await fn({});
    return { success: true, result, attempts: 1, wasPolicyError: false };
  }),
}));

vi.mock('../../lib/observability/AgentMetrics', () => ({
  recordAgentMetrics: vi.fn(),
}));

vi.mock('../../lib/errors/ErrorPersistence', () => ({
  persistAgentErrorAuto: vi.fn(),
}));

vi.mock('../../lib/promptSanitization', () => ({
  RESEARCH_DATA_PREAMBLE: '[PREAMBLE]',
  sanitizeForAzureContentFilter: vi.fn((text: string) => text),
}));

vi.mock('../../lib/v3/runtime/canonical/netEnrichmentRenderer', () => ({
  renderNetEnrichmentBlock: vi.fn(() => '<mock-xml />'),
}));

// Now import the module under test
import { reviewNetEnrichmentBatch } from '../NETEnrichmentAgent';
import { generateText } from 'ai';
import { recordAgentMetrics } from '../../lib/observability/AgentMetrics';
import { sanitizeForAzureContentFilter } from '../../lib/promptSanitization';
import { renderNetEnrichmentBlock } from '../../lib/v3/runtime/canonical/netEnrichmentRenderer';
import { buildEntryBaseContract, projectTableBaseContract } from '../../lib/v3/runtime/baseContract';
import type { CanonicalTable, CanonicalRow, QuestionIdEntry } from '../../lib/v3/runtime/canonical/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    variable: 'Q1_1',
    label: 'Option A',
    filterValue: '1',
    rowKind: 'value',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig: null,
    ...overrides,
  };
}

function makeTable(overrides: Partial<CanonicalTable> = {}): CanonicalTable {
  const table: CanonicalTable = {
    tableId: 'Q1__standard_overview',
    questionId: 'Q1',
    familyRoot: 'Q1',
    sourceTableId: 'Q1__standard_overview',
    splitFromTableId: '',
    tableKind: 'standard_overview',
    analyticalSubtype: 'standard',
    normalizedType: 'binary_flag',
    tableType: 'frequency',
    questionText: 'Which do you use?',
    rows: [
      makeRow({ variable: 'Q1_1', label: 'A' }),
      makeRow({ variable: 'Q1_2', label: 'B' }),
      makeRow({ variable: 'Q1_3', label: 'C' }),
      makeRow({ variable: 'Q1_4', label: 'D' }),
      makeRow({ variable: 'Q1_5', label: 'E' }),
    ],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    basePolicy: 'total',
    baseSource: 'question',
    questionBase: 500,
    itemBase: null,
    baseContract: projectTableBaseContract(buildEntryBaseContract({
      totalN: 500,
      questionBase: 500,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'total',
      questionBase: 500,
      itemBase: null,
    }),
    baseText: 'Total',
    isDerived: false,
    sortOrder: 1,
    sortBlock: 'Q1',
    surveySection: '',
    userNote: '',
    tableSubtitle: '',
    splitReason: null,
    appliesToItem: null,
    computeMaskAnchorVariable: null,
    appliesToColumn: null,
    additionalFilter: '',
    exclude: false,
    excludeReason: '',
    filterReviewRequired: false,
    lastModifiedBy: 'assembler',
    notes: [],
    ...overrides,
    stimuliSetSlice: overrides.stimuliSetSlice ?? null,
    binarySide: overrides.binarySide ?? null,
  };
  table.baseContract = overrides.baseContract ?? projectTableBaseContract(buildEntryBaseContract({
    totalN: table.questionBase,
    questionBase: table.questionBase,
    itemBase: table.itemBase,
    itemBaseRange: null,
    hasVariableItemBases: false,
    variableBaseReason: null,
    rankingDetail: null,
    exclusionReason: null,
  }), {
    basePolicy: table.basePolicy,
    questionBase: table.questionBase,
    itemBase: table.itemBase,
  });
  return table;
}

function makeEntry(): QuestionIdEntry {
  const entry: QuestionIdEntry = {
    questionId: 'Q1',
    questionText: 'Test question',
    variables: ['Q1_1'],
    variableCount: 1,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'enricher',
    subtypeConfidence: 0.9,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: null,
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'binary_flag',
    items: [],
    totalN: 500,
    questionBase: 500,
    isFiltered: false,
    gapFromTotal: null,
    gapPct: null,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 500,
      questionBase: 500,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: null,
    proposedBaseLabel: null,
    stimuliSets: null,
    displayQuestionId: null,
    displayQuestionText: null,
    sectionHeader: null,
    itemActivity: null,
    hasMessageMatches: false,
    _aiGateReview: null,
    _reconciliation: null,
  };
  entry.baseContract = buildEntryBaseContract({
    totalN: entry.totalN,
    questionBase: entry.questionBase,
    itemBase: null,
    itemBaseRange: entry.itemBaseRange,
    hasVariableItemBases: entry.hasVariableItemBases,
    variableBaseReason: entry.variableBaseReason,
    rankingDetail: entry.rankingDetail,
    exclusionReason: entry.exclusionReason,
  });
  return entry;
}

const mockAIResult: NetEnrichmentResult = {
  tableId: 'Q1__standard_overview',
  noNetsNeeded: true,
  reasoning: 'No meaningful groupings.',
  suggestedSubtitle: '',
  nets: [],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NETEnrichmentAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { result: mockAIResult },
      usage: { inputTokens: 100, outputTokens: 50 },
    });
  });

  it('returns results for batch of tables', async () => {
    const contexts = [{
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: ['5 value rows'],
    }];

    const result = await reviewNetEnrichmentBatch(contexts, '/tmp/test');

    expect(result.results).toHaveLength(1);
    expect(result.results[0].tableId).toBe('Q1__standard_overview');
    expect(result.results[0].noNetsNeeded).toBe(true);
  });

  it('records metrics after AI call', async () => {
    const contexts = [{
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: [],
    }];

    await reviewNetEnrichmentBatch(contexts, '/tmp/test');

    expect(recordAgentMetrics).toHaveBeenCalledWith(
      'NETEnrichmentAgent',
      'azure/gpt-5-mini',
      expect.objectContaining({ input: 100, output: 50 }),
      expect.any(Number),
    );
  });

  it('builds system/user prompts from preamble + prompt selector + rendered XML', async () => {
    const contexts = [{
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: [],
    }];

    await reviewNetEnrichmentBatch(contexts, '/tmp/test');

    expect(renderNetEnrichmentBlock).toHaveBeenCalledTimes(1);
    expect(sanitizeForAzureContentFilter).toHaveBeenCalledWith('<mock-xml />');
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      system: '[PREAMBLE]mock prompt',
      prompt: '<mock-xml />',
    }));
  });

  it('computes summary correctly', async () => {
    (generateText as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        output: { result: { ...mockAIResult, noNetsNeeded: true } },
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValueOnce({
        output: {
          result: {
            tableId: 'Q2__standard_overview',
            noNetsNeeded: false,
            reasoning: 'Groups found.',
            suggestedSubtitle: 'NET Summary',
            nets: [{ netLabel: 'Group', components: ['Q2_1', 'Q2_2'], reasoning: 'Related' }],
          },
        },
        usage: { inputTokens: 100, outputTokens: 80 },
      });

    const contexts = [
      { table: makeTable(), entry: makeEntry(), surveyQuestion: undefined, triageReasons: [] },
      { table: makeTable({ tableId: 'Q2__standard_overview' }), entry: makeEntry(), surveyQuestion: undefined, triageReasons: [] },
    ];

    const result = await reviewNetEnrichmentBatch(contexts, '/tmp/test');

    expect(result.summary.totalTables).toBe(2);
    expect(result.summary.tablesSkipped).toBe(1);
    expect(result.summary.tablesWithNets).toBe(1);
    expect(result.summary.netsProposed).toBe(1);
  });

  it('returns noNetsNeeded fallback on error', async () => {
    (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

    // Need to also mock retryWithPolicyHandling to propagate the error
    const { retryWithPolicyHandling } = await import('../../lib/retryWithPolicyHandling');
    (retryWithPolicyHandling as ReturnType<typeof vi.fn>).mockImplementationOnce(async (fn: (...args: unknown[]) => Promise<unknown>) => {
      try {
        const result = await fn({});
        return { success: true, result, attempts: 1, wasPolicyError: false };
      } catch {
        return { success: false, error: 'API error', attempts: 1, wasPolicyError: false };
      }
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const contexts = [{
      table: makeTable(),
      entry: makeEntry(),
      surveyQuestion: undefined,
      triageReasons: [],
    }];

    const result = await reviewNetEnrichmentBatch(contexts, '/tmp/test');

    expect(result.results).toHaveLength(1);
    // Should get a fallback result (either noNetsNeeded or error-based)
    expect(result.results[0].noNetsNeeded).toBe(true);

    warnSpy.mockRestore();
  });
});
