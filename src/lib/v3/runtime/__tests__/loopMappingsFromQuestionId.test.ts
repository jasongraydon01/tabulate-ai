import { describe, it, expect } from 'vitest';
import { deriveLoopMappings, _testing } from '../loopMappingsFromQuestionId';
import type { QuestionIdEntry } from '../questionId/types';

const { deriveBaseName, deriveBaseFromAlignment } = _testing;

// =============================================================================
// deriveBaseName
// =============================================================================

describe('deriveBaseName', () => {
  it('strips clean _N suffix', () => {
    expect(deriveBaseName('A1_1', '1')).toBe('A1');
    expect(deriveBaseName('hBrand_2', '2')).toBe('hBrand');
    expect(deriveBaseName('Q5_3', '3')).toBe('Q5');
    expect(deriveBaseName('VAR_10', '10')).toBe('VAR');
  });

  it('uses cross-iteration alignment for grid-in-loop columns', () => {
    // The iteration marker _1/_2 is in the middle, not at the end
    expect(deriveBaseName('hCHANNEL_1r1', '1', 'hCHANNEL_2r1')).toBe('hCHANNEL_r1');
    expect(deriveBaseName('hCHANNEL_1r2', '1', 'hCHANNEL_2r2')).toBe('hCHANNEL_r2');
    expect(deriveBaseName('hCHANNEL_1r5', '1', 'hCHANNEL_2r5')).toBe('hCHANNEL_r5');
  });

  it('uses alignment for bare-digit iteration suffixes', () => {
    expect(deriveBaseName('Brand1', '1', 'Brand2')).toBe('Brand');
    expect(deriveBaseName('Loop1A', '1', 'Loop2A')).toBe('LoopA');
  });

  it('falls back to column as-is when no pattern matches and no alignment col', () => {
    expect(deriveBaseName('WeirdCol', '1')).toBe('WeirdCol');
    expect(deriveBaseName('X_Y_Z', '3')).toBe('X_Y_Z');
  });

  it('prefers _N suffix over alignment when both would match', () => {
    // _1$ matches, so alignment is not needed
    expect(deriveBaseName('Q5_1', '1', 'Q5_2')).toBe('Q5');
  });

  it('handles underscore-separated grid-in-loop', () => {
    // Q5_1_r1 vs Q5_2_r1 — iteration is _1 in the middle
    expect(deriveBaseName('Q5_1_r1', '1', 'Q5_2_r1')).toBe('Q5_r1');
  });
});

// =============================================================================
// deriveBaseFromAlignment
// =============================================================================

describe('deriveBaseFromAlignment', () => {
  it('handles grid-in-loop (varying middle digit)', () => {
    expect(deriveBaseFromAlignment('hCHANNEL_1r1', 'hCHANNEL_2r1')).toBe('hCHANNEL_r1');
    expect(deriveBaseFromAlignment('hCHANNEL_1r3', 'hCHANNEL_2r3')).toBe('hCHANNEL_r3');
  });

  it('handles bare trailing digit', () => {
    expect(deriveBaseFromAlignment('Brand1', 'Brand2')).toBe('Brand');
  });

  it('handles no common structure', () => {
    expect(deriveBaseFromAlignment('ABC', 'XYZ')).toBeNull();
  });

  it('handles identical columns', () => {
    expect(deriveBaseFromAlignment('Same', 'Same')).toBe('Same');
  });

  it('handles different length columns', () => {
    // iter 1 vs iter 10 — only the first char after prefix differs
    expect(deriveBaseFromAlignment('Q_1_A', 'Q_2_A')).toBe('Q_A');
  });

  it('cleans double separators from prefix+suffix join', () => {
    // prefix 'A1_', suffix '_r1' — should produce 'A1_r1', not 'A1__r1'
    expect(deriveBaseFromAlignment('A1_1_r1', 'A1_2_r1')).toBe('A1_r1');
  });

  it('cleans trailing separator when suffix is empty', () => {
    expect(deriveBaseFromAlignment('Test_1', 'Test_2')).toBe('Test');
  });
});

// =============================================================================
// deriveLoopMappings — integration
// =============================================================================

function makeLoopEntry(
  questionId: string,
  familyBase: string,
  iterationIndex: number,
  items: { column: string; label: string }[],
): QuestionIdEntry {
  return {
    questionId,
    questionText: `Question ${questionId}`,
    questionType: 'multi_response' as const,
    analyticalSubtype: 'standard_frequency' as const,
    items: items.map(i => ({
      column: i.column,
      label: i.label,
      spssFormat: 'F1.0',
      rClass: 'haven_labelled',
      valueLabelCount: 2,
    })),
    context: '',
    parentId: null,
    loopQuestionId: familyBase,
    loop: {
      detected: true,
      familyBase,
      iterationIndex,
      iterationLabel: `Iteration ${iterationIndex + 1}`,
      totalIterations: 2,
      isFirstIteration: iterationIndex === 0,
    },
    base: { detected: false },
    weight: { detected: false, weightVariable: null },
    lastModifiedBy: 'test',
    lastModifiedAt: 'enricher',
  } as unknown as QuestionIdEntry;
}

describe('deriveLoopMappings', () => {
  it('produces correct baseNames for grid-in-loop (hCHANNEL pattern)', () => {
    const entries = [
      makeLoopEntry('hCHANNEL_1', 'hCHANNEL', 0, [
        { column: 'hCHANNEL_1r1', label: 'Supermarket' },
        { column: 'hCHANNEL_1r2', label: 'Mass Merch' },
        { column: 'hCHANNEL_1r3', label: 'Convenience' },
      ]),
      makeLoopEntry('hCHANNEL_2', 'hCHANNEL', 1, [
        { column: 'hCHANNEL_2r1', label: 'Supermarket' },
        { column: 'hCHANNEL_2r2', label: 'Mass Merch' },
        { column: 'hCHANNEL_2r3', label: 'Convenience' },
      ]),
    ];

    const result = deriveLoopMappings(entries);

    expect(result.hasLoops).toBe(true);
    expect(result.loopMappings).toHaveLength(1);

    const group = result.loopMappings[0];
    expect(group.iterations).toEqual(['1', '2']);
    expect(group.variables).toHaveLength(3);

    // BaseNames should be clean, iteration-neutral names
    expect(group.variables[0].baseName).toBe('hCHANNEL_r1');
    expect(group.variables[1].baseName).toBe('hCHANNEL_r2');
    expect(group.variables[2].baseName).toBe('hCHANNEL_r3');

    // All baseNames should be unique
    const baseNames = group.variables.map(v => v.baseName);
    expect(new Set(baseNames).size).toBe(baseNames.length);

    // Iteration columns should be correct
    expect(group.variables[0].iterationColumns).toEqual({
      '1': 'hCHANNEL_1r1',
      '2': 'hCHANNEL_2r1',
    });
  });

  it('produces correct baseNames for simple _N loop', () => {
    const entries = [
      makeLoopEntry('Q5_1', 'Q5', 0, [
        { column: 'Q5_1', label: 'Score' },
      ]),
      makeLoopEntry('Q5_2', 'Q5', 1, [
        { column: 'Q5_2', label: 'Score' },
      ]),
    ];

    const result = deriveLoopMappings(entries);
    expect(result.loopMappings[0].variables[0].baseName).toBe('Q5');
  });

  it('collapses non-first-iteration columns', () => {
    const entries = [
      makeLoopEntry('A_1', 'A', 0, [
        { column: 'A_1', label: 'Item' },
      ]),
      makeLoopEntry('A_2', 'A', 1, [
        { column: 'A_2', label: 'Item' },
      ]),
    ];

    const result = deriveLoopMappings(entries);
    expect(result.collapsedVariableNames.has('A_2')).toBe(true);
    expect(result.collapsedVariableNames.has('A_1')).toBe(false);
  });

  it('handles duplicate baseName fallback gracefully', () => {
    // Construct a pathological case where alignment would produce duplicates.
    // Both items in iter1 differ from iter2 only at the same position,
    // but have different common suffixes — this shouldn't produce duplicates
    // with the alignment approach, but the safety net should catch it if it does.
    const entries = [
      makeLoopEntry('X_1', 'X', 0, [
        { column: 'X_1_a', label: 'A' },
        { column: 'X_1_b', label: 'B' },
      ]),
      makeLoopEntry('X_2', 'X', 1, [
        { column: 'X_2_a', label: 'A' },
        { column: 'X_2_b', label: 'B' },
      ]),
    ];

    const result = deriveLoopMappings(entries);
    const baseNames = result.loopMappings[0].variables.map(v => v.baseName);
    // BaseNames should be unique
    expect(new Set(baseNames).size).toBe(baseNames.length);
    expect(baseNames).toEqual(['X_a', 'X_b']);
  });

  it('skips families with only one member', () => {
    const entries = [
      makeLoopEntry('Solo_1', 'Solo', 0, [
        { column: 'Solo_1', label: 'Alone' },
      ]),
    ];

    const result = deriveLoopMappings(entries);
    expect(result.hasLoops).toBe(false);
    expect(result.loopMappings).toHaveLength(0);
  });
});
