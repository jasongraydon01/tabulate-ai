import { describe, it, expect } from 'vitest';
import { resolveIterationLinkedVariables } from '../LoopContextResolver';
import type { LoopGroupMapping } from '../LoopCollapser';
import type { VerboseDataMap } from '../../processors/DataMapProcessor';

// =============================================================================
// Helpers
// =============================================================================

function makeVar(column: string, description: string, overrides?: Partial<VerboseDataMap>): VerboseDataMap {
  return {
    level: 'sub',
    column,
    description,
    valueType: 'numeric',
    answerOptions: '1=Yes, 2=No',
    parentQuestion: '',
    ...overrides,
  };
}

function makeLoopMapping(overrides?: Partial<LoopGroupMapping>): LoopGroupMapping {
  return {
    skeleton: 'A-N-_-N',
    stackedFrameName: 'stacked_loop_1',
    iterations: ['1', '2'],
    variables: [
      { baseName: 'A1', label: 'Question A1', iterationColumns: { '1': 'A1_1', '2': 'A1_2' } },
    ],
    ...overrides,
  };
}

// =============================================================================
// A0: Variable-name suffix match
// =============================================================================

describe('A0: Variable-name suffix match', () => {
  it('finds variables with _N suffix matching iteration values', () => {
    const datamap: VerboseDataMap[] = [
      makeVar('A1', 'Some question'),
      makeVar('Treat_1', 'Applied condition', { answerOptions: '' }),
      makeVar('Treat_2', 'Applied condition', { answerOptions: '' }),
    ];
    const loopMappings = [makeLoopMapping()];
    const collapsed = new Set(['A1_1', 'A1_2']);

    const result = resolveIterationLinkedVariables(datamap, loopMappings, collapsed);

    expect(result.iterationLinkedVariables).toHaveLength(2);
    expect(result.iterationLinkedVariables[0]).toMatchObject({
      variableName: 'Treat_1',
      linkedIteration: '1',
      evidenceSource: 'variable_suffix:_1',
      confidence: 0.9,
    });
    expect(result.iterationLinkedVariables[1]).toMatchObject({
      variableName: 'Treat_2',
      linkedIteration: '2',
      evidenceSource: 'variable_suffix:_2',
    });
  });

  it('skips collapsed (loop) variables', () => {
    const datamap: VerboseDataMap[] = [
      makeVar('A1_1', 'Loop var iter 1'),
      makeVar('A1_2', 'Loop var iter 2'),
      makeVar('Other_1', 'Non-loop var'),
    ];
    const loopMappings = [makeLoopMapping()];
    const collapsed = new Set(['A1_1', 'A1_2']);

    const result = resolveIterationLinkedVariables(datamap, loopMappings, collapsed);

    // Should only find Other_1, not the collapsed loop vars
    expect(result.iterationLinkedVariables).toHaveLength(1);
    expect(result.iterationLinkedVariables[0].variableName).toBe('Other_1');
  });

  it('ignores suffix values not in iteration set', () => {
    const datamap: VerboseDataMap[] = [
      makeVar('Treatment_5', 'Treatment for group 5'),
    ];
    const loopMappings = [makeLoopMapping({ iterations: ['1', '2'] })];

    const result = resolveIterationLinkedVariables(datamap, loopMappings, new Set());

    const suffixFindings = result.iterationLinkedVariables.filter(
      f => f.evidenceSource.startsWith('variable_suffix')
    );
    expect(suffixFindings).toHaveLength(0);
  });
});

// =============================================================================
// A2: Sibling detection
// =============================================================================

describe('A2: Sibling detection', () => {
  it('finds sibling variables with identical descriptions matching iteration count', () => {
    const datamap: VerboseDataMap[] = [
      makeVar('S10a', 'Which best describes the reason for having a drink?'),
      makeVar('S11a', 'Which best describes the reason for having a drink?'),
    ];
    const loopMappings = [makeLoopMapping({ iterations: ['1', '2'] })];

    const result = resolveIterationLinkedVariables(datamap, loopMappings, new Set());

    // Should find 2 sibling candidates
    const siblingFindings = result.iterationLinkedVariables.filter(
      f => f.evidenceSource.startsWith('sibling_candidate')
    );
    expect(siblingFindings).toHaveLength(2);
  });

  it('does not match when count does not match iterations', () => {
    const datamap: VerboseDataMap[] = [
      makeVar('ChR1', 'Online channel'),
      makeVar('ChR2', 'In-store channel'),
      makeVar('ChR3', 'Mobile channel'),
    ];
    // Only 2 iterations but 3 siblings
    const loopMappings = [makeLoopMapping({ iterations: ['1', '2'] })];

    const result = resolveIterationLinkedVariables(datamap, loopMappings, new Set());

    const siblingFindings = result.iterationLinkedVariables.filter(
      f => f.evidenceSource.startsWith('sibling_')
    );
    expect(siblingFindings).toHaveLength(0);
  });
});

// =============================================================================
// A3: Cascading h-prefix/d-prefix
// =============================================================================

describe('A3: Cascading h-prefix/d-prefix', () => {
  it('cascades to h-prefix variants of confirmed mappings', () => {
    // Use suffix-matched base vars (Treat_1, Treat_2) that A0 will find,
    // plus h-prefix variants (hTreat_1, hTreat_2) that A3 should cascade to.
    // Note: hTreat_1 also matches A0 suffix pattern, so we use non-suffix base vars
    // found via A2 sibling detection, then cascade to h-prefix variants.
    const datamap: VerboseDataMap[] = [
      makeVar('S10a', 'Which best describes your reason?', { answerOptions: '' }),
      makeVar('S11a', 'Which best describes your reason?', { answerOptions: '' }),
      makeVar('hS10a', 'Hidden flag for first reason var', { answerOptions: '' }),
      makeVar('hS11a', 'Hidden flag for second reason var', { answerOptions: '' }),
    ];
    const loopMappings = [makeLoopMapping()];

    const result = resolveIterationLinkedVariables(datamap, loopMappings, new Set());

    // Should find 4: 2 from A2 sibling, 2 from A3 cascading
    expect(result.iterationLinkedVariables).toHaveLength(4);
    const cascaded = result.iterationLinkedVariables.filter(
      f => f.evidenceSource.startsWith('cascade_hprefix')
    );
    expect(cascaded).toHaveLength(2);
  });

  it('does not cascade if h-prefix variable does not exist', () => {
    const datamap: VerboseDataMap[] = [
      makeVar('Treat_1', 'Applied condition', { answerOptions: '' }),
      makeVar('Treat_2', 'Applied condition', { answerOptions: '' }),
    ];
    const loopMappings = [makeLoopMapping()];

    const result = resolveIterationLinkedVariables(datamap, loopMappings, new Set());

    // Only A0 findings, no cascading
    expect(result.iterationLinkedVariables).toHaveLength(2);
    const cascaded = result.iterationLinkedVariables.filter(
      f => f.evidenceSource.startsWith('cascade_')
    );
    expect(cascaded).toHaveLength(0);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('Edge cases', () => {
  it('returns empty result when no loop mappings', () => {
    const result = resolveIterationLinkedVariables([], [], new Set());
    expect(result.iterationLinkedVariables).toHaveLength(0);
    expect(result.evidenceSummary).toBe('No loop groups detected.');
  });

  it('builds human-readable evidence summary', () => {
    const datamap: VerboseDataMap[] = [
      makeVar('Treat_1', 'Applied condition', { answerOptions: '' }),
      makeVar('Treat_2', 'Applied condition', { answerOptions: '' }),
    ];
    const loopMappings = [makeLoopMapping()];

    const result = resolveIterationLinkedVariables(datamap, loopMappings, new Set());

    expect(result.evidenceSummary).toContain('Found');
    expect(result.evidenceSummary).toContain('Treat_1');
    expect(result.evidenceSummary).toContain('iteration 1');
  });
});
