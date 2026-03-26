import { describe, it, expect } from 'vitest';
import {
  deriveBaseName,
  resolveBaseToColumn,
  cleanLabel,
  collapseLoopVariables,
  mergeLoopGroups,
} from '../LoopCollapser';
import type { LoopDetectionResult } from '../types';
import type { VerboseDataMap } from '../../processors/DataMapProcessor';

// =============================================================================
// Helper to create a minimal VerboseDataMap variable
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

// =============================================================================
// deriveBaseName
// =============================================================================

describe('deriveBaseName', () => {
  it('simple: A1_* → A1', () => {
    expect(deriveBaseName('A1_*')).toBe('A1');
  });

  it('grid+loop: A16_*r1 → A16r1', () => {
    expect(deriveBaseName('A16_*r1')).toBe('A16r1');
  });

  it('named prefix: hCHANNEL_*r1 → hCHANNELr1', () => {
    expect(deriveBaseName('hCHANNEL_*r1')).toBe('hCHANNELr1');
  });

  it('OE suffix: A13_*r99oe → A13r99oe', () => {
    expect(deriveBaseName('A13_*r99oe')).toBe('A13r99oe');
  });

  it('no separator before wildcard: A*r1 → Ar1', () => {
    expect(deriveBaseName('A*r1')).toBe('Ar1');
  });
});

// =============================================================================
// resolveBaseToColumn
// =============================================================================

describe('resolveBaseToColumn', () => {
  it('simple: A1_* + 2 → A1_2', () => {
    expect(resolveBaseToColumn('A1_*', '2')).toBe('A1_2');
  });

  it('grid+loop: A16_*r1 + 3 → A16_3r1', () => {
    expect(resolveBaseToColumn('A16_*r1', '3')).toBe('A16_3r1');
  });

  it('named prefix: hCHANNEL_*r1 + 1 → hCHANNEL_1r1', () => {
    expect(resolveBaseToColumn('hCHANNEL_*r1', '1')).toBe('hCHANNEL_1r1');
  });
});

// =============================================================================
// cleanLabel
// =============================================================================

describe('cleanLabel', () => {
  it('strips "VAR: " prefix', () => {
    expect(cleanLabel('A1_1: In a few words, describe...', 'A1_1'))
      .toBe('In a few words, describe...');
  });

  it('strips "VAR - " prefix', () => {
    expect(cleanLabel('Q3_2 - Rate your satisfaction', 'Q3_2'))
      .toBe('Rate your satisfaction');
  });

  it('leaves label without prefix unchanged', () => {
    expect(cleanLabel('Just a normal label', 'A1_1'))
      .toBe('Just a normal label');
  });

  it('handles empty label', () => {
    expect(cleanLabel('', 'A1_1')).toBe('');
  });

  it('strips prefix case-insensitively', () => {
    expect(cleanLabel('a1_1: something', 'A1_1')).toBe('something');
  });
});

// =============================================================================
// collapseLoopVariables
// =============================================================================

describe('collapseLoopVariables', () => {
  it('returns unchanged datamap when no loops detected', () => {
    const vars = [makeVar('S1', 'Gender'), makeVar('S2', 'Age')];
    const detection: LoopDetectionResult = {
      hasLoops: false,
      loops: [],
      nonLoopVariables: ['S1', 'S2'],
    };

    const result = collapseLoopVariables(vars, detection);
    expect(result.collapsedDataMap).toHaveLength(2);
    expect(result.loopMappings).toHaveLength(0);
    expect(result.collapsedVariableNames.size).toBe(0);
  });

  it('collapses simple loop: A1_1, A2_1, A1_2, A2_2 → A1, A2', () => {
    const vars = [
      makeVar('A1_1', 'A1_1: Rate drink 1'),
      makeVar('A2_1', 'A2_1: Describe drink 1'),
      makeVar('A1_2', 'A1_2: Rate drink 2'),
      makeVar('A2_2', 'A2_2: Describe drink 2'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [{
        skeleton: 'A-N-_-N',
        iteratorPosition: 3,  // The last numeric token position
        iterations: ['1', '2'],
        bases: ['A1_*', 'A2_*'],
        variables: ['A1_1', 'A2_1', 'A1_2', 'A2_2'],
        diversity: 2,
      }],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    // Should have 2 collapsed variables instead of 4
    expect(result.collapsedDataMap).toHaveLength(2);
    expect(result.collapsedDataMap[0].column).toBe('A1');
    expect(result.collapsedDataMap[1].column).toBe('A2');

    // Labels should be cleaned
    expect(result.collapsedDataMap[0].description).toBe('Rate drink 1');
    expect(result.collapsedDataMap[1].description).toBe('Describe drink 1');

    // Loop mappings
    expect(result.loopMappings).toHaveLength(1);
    expect(result.loopMappings[0].stackedFrameName).toBe('stacked_loop_1');
    expect(result.loopMappings[0].iterations).toEqual(['1', '2']);
    expect(result.loopMappings[0].variables).toHaveLength(2);

    // Variable mapping
    const v1 = result.loopMappings[0].variables[0];
    expect(v1.baseName).toBe('A1');
    expect(v1.iterationColumns).toEqual({ '1': 'A1_1', '2': 'A1_2' });

    // Collapsed names
    expect(result.collapsedVariableNames.has('A1_1')).toBe(true);
    expect(result.collapsedVariableNames.has('A1_2')).toBe(true);

    // baseNameToLoopIndex
    expect(result.baseNameToLoopIndex.get('A1')).toBe(0);
    expect(result.baseNameToLoopIndex.get('A2')).toBe(0);
  });

  it('preserves non-loop variables alongside collapsed ones', () => {
    const vars = [
      makeVar('S1', 'Gender'),
      makeVar('A1_1', 'A1_1: Rate drink 1'),
      makeVar('A2_1', 'A2_1: Describe drink 1'),
      makeVar('A1_2', 'A1_2: Rate drink 2'),
      makeVar('A2_2', 'A2_2: Describe drink 2'),
      makeVar('S2', 'Age'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [{
        skeleton: 'A-N-_-N',
        iteratorPosition: 3,
        iterations: ['1', '2'],
        bases: ['A1_*', 'A2_*'],
        variables: ['A1_1', 'A2_1', 'A1_2', 'A2_2'],
        diversity: 2,
      }],
      nonLoopVariables: ['S1', 'S2'],
    };

    const result = collapseLoopVariables(vars, detection);

    // S1, A1, A2, S2 (collapsed loop vars appear where iteration 1 was)
    expect(result.collapsedDataMap).toHaveLength(4);
    expect(result.collapsedDataMap.map(v => v.column)).toEqual(['S1', 'A1', 'A2', 'S2']);
  });

  it('handles multiple independent loop groups', () => {
    const vars = [
      makeVar('A1_1', 'Rate drink 1'), makeVar('A2_1', 'Describe drink 1'),
      makeVar('A1_2', 'Rate drink 2'), makeVar('A2_2', 'Describe drink 2'),
      makeVar('B1_1', 'Rate brand 1'), makeVar('B2_1', 'Describe brand 1'),
      makeVar('B1_2', 'Rate brand 2'), makeVar('B2_2', 'Describe brand 2'),
      makeVar('B1_3', 'Rate brand 3'), makeVar('B2_3', 'Describe brand 3'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [
        {
          skeleton: 'A-N-_-N',
          iteratorPosition: 3,
          iterations: ['1', '2'],
          bases: ['A1_*', 'A2_*'],
          variables: ['A1_1', 'A2_1', 'A1_2', 'A2_2'],
          diversity: 2,
        },
        {
          skeleton: 'B-N-_-N',
          iteratorPosition: 3,
          iterations: ['1', '2', '3'],
          bases: ['B1_*', 'B2_*'],
          variables: ['B1_1', 'B2_1', 'B1_2', 'B2_2', 'B1_3', 'B2_3'],
          diversity: 2,
        },
      ],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    // Two loop groups → two mappings
    expect(result.loopMappings).toHaveLength(2);
    expect(result.loopMappings[0].stackedFrameName).toBe('stacked_loop_1');
    expect(result.loopMappings[1].stackedFrameName).toBe('stacked_loop_2');

    // 4 collapsed variables total (A1, A2, B1, B2)
    expect(result.collapsedDataMap).toHaveLength(4);

    // baseNameToLoopIndex correctly maps to different loop groups
    expect(result.baseNameToLoopIndex.get('A1')).toBe(0);
    expect(result.baseNameToLoopIndex.get('B1')).toBe(1);
  });

  it('handles non-contiguous iterations', () => {
    const vars = [
      makeVar('A1_1', 'Q1 iter 1'), makeVar('A2_1', 'Q2 iter 1'),
      makeVar('A1_3', 'Q1 iter 3'), makeVar('A2_3', 'Q2 iter 3'),
      makeVar('A1_8', 'Q1 iter 8'), makeVar('A2_8', 'Q2 iter 8'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [{
        skeleton: 'A-N-_-N',
        iteratorPosition: 3,
        iterations: ['1', '3', '8'],
        bases: ['A1_*', 'A2_*'],
        variables: ['A1_1', 'A2_1', 'A1_3', 'A2_3', 'A1_8', 'A2_8'],
        diversity: 2,
      }],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    expect(result.loopMappings[0].iterations).toEqual(['1', '3', '8']);
    expect(result.loopMappings[0].variables[0].iterationColumns).toEqual({
      '1': 'A1_1', '3': 'A1_3', '8': 'A1_8',
    });
  });

  it('skips variables when iteration columns are missing (pre-flight check)', () => {
    // LoopDetector infers iterations 1,2,3 but A1_3 is missing from datamap
    const vars = [
      makeVar('A1_1', 'Q1 iter 1'),
      makeVar('A2_1', 'Q2 iter 1'),
      makeVar('A1_2', 'Q1 iter 2'),
      makeVar('A2_2', 'Q2 iter 2'),
      // A1_3 intentionally missing; A2_3 present
      makeVar('A2_3', 'Q2 iter 3'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [{
        skeleton: 'A-N-_-N',
        iteratorPosition: 3,
        iterations: ['1', '2', '3'],
        bases: ['A1_*', 'A2_*'],
        variables: ['A1_1', 'A2_1', 'A1_2', 'A2_2', 'A1_3', 'A2_3'],
        diversity: 2,
      }],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    // A1 skipped (missing A1_3); A2 included (all columns present)
    expect(result.loopMappings[0].variables).toHaveLength(1);
    expect(result.loopMappings[0].variables[0].baseName).toBe('A2');
    expect(result.loopMappings[0].variables[0].iterationColumns).toEqual({
      '1': 'A2_1',
      '2': 'A2_2',
      '3': 'A2_3',
    });
    // A1_1, A1_2 pass through (not collapsed); A2 collapsed from A2_1, A2_2, A2_3
    expect(result.collapsedDataMap).toHaveLength(3);
    expect(result.collapsedDataMap.map(v => v.column).sort()).toEqual(['A1_1', 'A1_2', 'A2']);
  });

  it('skips loop group entirely when all variables have missing iteration columns', () => {
    const vars = [
      makeVar('A1_1', 'Q1 iter 1'),
      makeVar('A1_2', 'Q1 iter 2'),
      // A1_3 missing - only one base, so entire group gets skipped
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [{
        skeleton: 'A-N-_-N',
        iteratorPosition: 3,
        iterations: ['1', '2', '3'],
        bases: ['A1_*'],
        variables: ['A1_1', 'A1_2', 'A1_3'],
        diversity: 1,
      }],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    expect(result.loopMappings).toHaveLength(0);
    expect(result.collapsedDataMap).toHaveLength(2); // A1_1, A1_2 pass through (none collapsed)
  });

  it('handles grid+loop collapse: A16_1r1, A16_1r2, A16_2r1, A16_2r2', () => {
    const vars = [
      makeVar('A16_1r1', 'A16_1r1: Rate attr 1'),
      makeVar('A16_1r2', 'A16_1r2: Rate attr 2'),
      makeVar('A16_2r1', 'A16_2r1: Rate attr 1'),
      makeVar('A16_2r2', 'A16_2r2: Rate attr 2'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [{
        skeleton: 'A-N-_-N-r-N',
        iteratorPosition: 3, // The position of the iteration number (after _)
        iterations: ['1', '2'],
        bases: ['A16_*r1', 'A16_*r2'],
        variables: ['A16_1r1', 'A16_1r2', 'A16_2r1', 'A16_2r2'],
        diversity: 2,
      }],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    expect(result.collapsedDataMap).toHaveLength(2);
    expect(result.collapsedDataMap[0].column).toBe('A16r1');
    expect(result.collapsedDataMap[1].column).toBe('A16r2');

    expect(result.loopMappings[0].variables[0].iterationColumns).toEqual({
      '1': 'A16_1r1', '2': 'A16_2r1',
    });
  });

  it('copies metadata from iteration-1 variable', () => {
    const vars = [
      makeVar('A1_1', 'Rate drink 1', {
        valueType: 'numeric',
        answerOptions: '1=Poor, 2=Fair, 3=Good, 4=Excellent',
        parentQuestion: 'A1_1',
        normalizedType: 'ordinal_scale',
      }),
      makeVar('A1_2', 'Rate drink 2', {
        valueType: 'numeric',
        answerOptions: '1=Poor, 2=Fair, 3=Good, 4=Excellent',
        parentQuestion: 'A1_2',
        normalizedType: 'ordinal_scale',
      }),
      makeVar('A2_1', 'Describe drink 1'),
      makeVar('A2_2', 'Describe drink 2'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [{
        skeleton: 'A-N-_-N',
        iteratorPosition: 3,
        iterations: ['1', '2'],
        bases: ['A1_*', 'A2_*'],
        variables: ['A1_1', 'A2_1', 'A1_2', 'A2_2'],
        diversity: 2,
      }],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    // Collapsed A1 should have iteration-1's metadata
    const collapsedA1 = result.collapsedDataMap.find(v => v.column === 'A1')!;
    expect(collapsedA1.answerOptions).toBe('1=Poor, 2=Fair, 3=Good, 4=Excellent');
    expect(collapsedA1.normalizedType).toBe('ordinal_scale');
  });

  it('merges skeleton groups with same iterations into one stacked frame', () => {
    // Simulates dataset with 3 different skeleton patterns, all with iterations ['1', '2']
    const vars = [
      // Skeleton 1: A-N-_-N (simple loop vars like A1_1, A1_2)
      makeVar('A1_1', 'Rate drink 1'), makeVar('A2_1', 'Describe drink 1'),
      makeVar('A3_1', 'Score drink 1'),
      makeVar('A1_2', 'Rate drink 2'), makeVar('A2_2', 'Describe drink 2'),
      makeVar('A3_2', 'Score drink 2'),
      // Skeleton 2: A-N-_-N-r-N (grid+loop vars like A9_1r1, A9_2r1)
      makeVar('A9_1r1', 'A9_1r1: Grid attr 1'), makeVar('A9_1r2', 'A9_1r2: Grid attr 2'),
      makeVar('A9_1r3', 'A9_1r3: Grid attr 3'),
      makeVar('A9_2r1', 'A9_2r1: Grid attr 1'), makeVar('A9_2r2', 'A9_2r2: Grid attr 2'),
      makeVar('A9_2r3', 'A9_2r3: Grid attr 3'),
      // Skeleton 3: hCHANNEL-_-N-r-N (named prefix)
      makeVar('hCHANNEL_1r1', 'Channel 1 attr 1'), makeVar('hCHANNEL_1r2', 'Channel 1 attr 2'),
      makeVar('hCHANNEL_1r3', 'Channel 1 attr 3'),
      makeVar('hCHANNEL_2r1', 'Channel 2 attr 1'), makeVar('hCHANNEL_2r2', 'Channel 2 attr 2'),
      makeVar('hCHANNEL_2r3', 'Channel 2 attr 3'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [
        {
          skeleton: 'A-N-_-N',
          iteratorPosition: 3,
          iterations: ['1', '2'],
          bases: ['A1_*', 'A2_*', 'A3_*'],
          variables: ['A1_1', 'A2_1', 'A3_1', 'A1_2', 'A2_2', 'A3_2'],
          diversity: 3,
        },
        {
          skeleton: 'A-N-_-N-r-N',
          iteratorPosition: 3,
          iterations: ['1', '2'],
          bases: ['A9_*r1', 'A9_*r2', 'A9_*r3'],
          variables: ['A9_1r1', 'A9_1r2', 'A9_1r3', 'A9_2r1', 'A9_2r2', 'A9_2r3'],
          diversity: 3,
        },
        {
          skeleton: 'hCHANNEL-_-N-r-N',
          iteratorPosition: 3,
          iterations: ['1', '2'],
          bases: ['hCHANNEL_*r1', 'hCHANNEL_*r2', 'hCHANNEL_*r3'],
          variables: ['hCHANNEL_1r1', 'hCHANNEL_1r2', 'hCHANNEL_1r3', 'hCHANNEL_2r1', 'hCHANNEL_2r2', 'hCHANNEL_2r3'],
          diversity: 3,
        },
      ],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    // All 3 skeleton groups share iterations ['1', '2'] → merged into 1 stacked frame
    expect(result.loopMappings).toHaveLength(1);
    expect(result.loopMappings[0].stackedFrameName).toBe('stacked_loop_1');
    expect(result.loopMappings[0].iterations).toEqual(['1', '2']);

    // Should have 9 collapsed variables (A1, A2, A3, A9r1, A9r2, A9r3, hCHANNELr1, hCHANNELr2, hCHANNELr3)
    expect(result.loopMappings[0].variables).toHaveLength(9);

    // All base names should map to loop index 0
    expect(result.baseNameToLoopIndex.get('A1')).toBe(0);
    expect(result.baseNameToLoopIndex.get('A9r1')).toBe(0);
    expect(result.baseNameToLoopIndex.get('hCHANNELr1')).toBe(0);

    // Skeleton is combined for debugging
    expect(result.loopMappings[0].skeleton).toContain(' + ');

    // Collapsed datamap should have 9 entries
    expect(result.collapsedDataMap).toHaveLength(9);
  });

  it('keeps groups with different iterations separate', () => {
    const vars = [
      // Group 1: iterations ['1', '2']
      makeVar('A1_1', 'Q1 iter 1'), makeVar('A2_1', 'Q2 iter 1'),
      makeVar('A3_1', 'Q3 iter 1'),
      makeVar('A1_2', 'Q1 iter 2'), makeVar('A2_2', 'Q2 iter 2'),
      makeVar('A3_2', 'Q3 iter 2'),
      // Group 2: iterations ['1', '2', '3']
      makeVar('B1_1', 'B1 iter 1'), makeVar('B2_1', 'B2 iter 1'),
      makeVar('B3_1', 'B3 iter 1'),
      makeVar('B1_2', 'B1 iter 2'), makeVar('B2_2', 'B2 iter 2'),
      makeVar('B3_2', 'B3 iter 2'),
      makeVar('B1_3', 'B1 iter 3'), makeVar('B2_3', 'B2 iter 3'),
      makeVar('B3_3', 'B3 iter 3'),
    ];

    const detection: LoopDetectionResult = {
      hasLoops: true,
      loops: [
        {
          skeleton: 'A-N-_-N',
          iteratorPosition: 3,
          iterations: ['1', '2'],
          bases: ['A1_*', 'A2_*', 'A3_*'],
          variables: ['A1_1', 'A2_1', 'A3_1', 'A1_2', 'A2_2', 'A3_2'],
          diversity: 3,
        },
        {
          skeleton: 'B-N-_-N',
          iteratorPosition: 3,
          iterations: ['1', '2', '3'],
          bases: ['B1_*', 'B2_*', 'B3_*'],
          variables: ['B1_1', 'B2_1', 'B3_1', 'B1_2', 'B2_2', 'B3_2', 'B1_3', 'B2_3', 'B3_3'],
          diversity: 3,
        },
      ],
      nonLoopVariables: [],
    };

    const result = collapseLoopVariables(vars, detection);

    // Different iteration sets → stay as 2 separate stacked frames
    expect(result.loopMappings).toHaveLength(2);
    expect(result.loopMappings[0].stackedFrameName).toBe('stacked_loop_1');
    expect(result.loopMappings[1].stackedFrameName).toBe('stacked_loop_2');
    expect(result.loopMappings[0].iterations).toEqual(['1', '2']);
    expect(result.loopMappings[1].iterations).toEqual(['1', '2', '3']);
  });
});

// =============================================================================
// mergeLoopGroups (unit tests)
// =============================================================================

describe('mergeLoopGroups', () => {
  it('merges groups with identical iterations', () => {
    const loops: import('../types').LoopGroup[] = [
      { skeleton: 'A-N-_-N', iteratorPosition: 3, iterations: ['1', '2'], bases: ['A1_*', 'A2_*'], variables: ['A1_1', 'A2_1', 'A1_2', 'A2_2'], diversity: 2 },
      { skeleton: 'A-N-_-N-r-N', iteratorPosition: 3, iterations: ['1', '2'], bases: ['A9_*r1'], variables: ['A9_1r1', 'A9_2r1'], diversity: 1 },
      { skeleton: 'hCHANNEL-_-N-r-N', iteratorPosition: 3, iterations: ['1', '2'], bases: ['hCHANNEL_*r1'], variables: ['hCHANNEL_1r1', 'hCHANNEL_2r1'], diversity: 1 },
    ];

    const merged = mergeLoopGroups(loops);
    expect(merged).toHaveLength(1);
    expect(merged[0].bases).toHaveLength(4); // A1_*, A2_*, A9_*r1, hCHANNEL_*r1
    expect(merged[0].variables).toHaveLength(8); // 4 + 2 + 2
    expect(merged[0].iterations).toEqual(['1', '2']);
    expect(merged[0].skeleton).toBe('A-N-_-N + A-N-_-N-r-N + hCHANNEL-_-N-r-N');
    expect(merged[0].diversity).toBe(4); // 2 + 1 + 1
  });

  it('leaves groups with different iterations separate', () => {
    const loops: import('../types').LoopGroup[] = [
      { skeleton: 'A-N-_-N', iteratorPosition: 3, iterations: ['1', '2'], bases: ['A1_*'], variables: ['A1_1', 'A1_2'], diversity: 1 },
      { skeleton: 'B-N-_-N', iteratorPosition: 3, iterations: ['1', '2', '3'], bases: ['B1_*'], variables: ['B1_1', 'B1_2', 'B1_3'], diversity: 1 },
    ];

    const merged = mergeLoopGroups(loops);
    expect(merged).toHaveLength(2);
  });

  it('returns single group unchanged', () => {
    const loops: import('../types').LoopGroup[] = [
      { skeleton: 'A-N-_-N', iteratorPosition: 3, iterations: ['1', '2'], bases: ['A1_*'], variables: ['A1_1', 'A1_2'], diversity: 1 },
    ];

    const merged = mergeLoopGroups(loops);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(loops[0]); // Same reference, not copied
  });

  it('returns empty array for empty input', () => {
    expect(mergeLoopGroups([])).toEqual([]);
  });
});
