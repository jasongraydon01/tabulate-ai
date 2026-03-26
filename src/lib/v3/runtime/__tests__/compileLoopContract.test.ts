import { describe, expect, it } from 'vitest';

import type { LoopSemanticsPolicy, BannerGroupPolicy } from '@/schemas/loopSemanticsPolicySchema';
import { createRespondentAnchoredFallbackPolicy } from '@/schemas/loopSemanticsPolicySchema';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import {
  generatePortableHelperName,
  preClassifyRespondentGroups,
  compileLoopContract,
} from '../compileLoopContract';

// =============================================================================
// Test Fixtures
// =============================================================================

function makeLoopMapping(overrides?: Partial<LoopGroupMapping>): LoopGroupMapping {
  return {
    skeleton: 'Q-N-_-N',
    stackedFrameName: 'stacked_loop_1',
    iterations: ['1', '2'],
    variables: [
      {
        baseName: 'Q5',
        label: 'Rating',
        iterationColumns: { '1': 'Q5a', '2': 'Q5b' },
      },
    ],
    ...overrides,
  };
}

function makeEntityGroupPolicy(overrides?: Partial<BannerGroupPolicy>): BannerGroupPolicy {
  return {
    groupName: 'Classification',
    anchorType: 'entity',
    shouldPartition: true,
    comparisonMode: 'suppress',
    stackedFrameName: 'stacked_loop_1',
    implementation: {
      strategy: 'alias_column',
      aliasName: '.hawktab_class_code',
      sourcesByIteration: [
        { iteration: '1', variable: 'Q5a' },
        { iteration: '2', variable: 'Q5b' },
      ],
      notes: 'Entity-anchored: OR pattern matches iterations',
    },
    confidence: 0.92,
    evidence: ['OR pattern across 2 variables matches 2 iterations'],
    ...overrides,
  };
}

function makeRespondentGroupPolicy(overrides?: Partial<BannerGroupPolicy>): BannerGroupPolicy {
  return {
    groupName: 'Gender',
    anchorType: 'respondent',
    shouldPartition: true,
    comparisonMode: 'suppress',
    stackedFrameName: '',
    implementation: {
      strategy: 'none',
      aliasName: '',
      sourcesByIteration: [],
      notes: '',
    },
    confidence: 0.95,
    evidence: ['Single variable per cut, no OR pattern'],
    ...overrides,
  };
}

function makePolicy(groups: BannerGroupPolicy[]): LoopSemanticsPolicy {
  return {
    policyVersion: '1.0',
    bannerGroups: groups,
    warnings: [],
    reasoning: 'Test policy',
    fallbackApplied: false,
    fallbackReason: '',
  };
}

// =============================================================================
// generatePortableHelperName
// =============================================================================

describe('generatePortableHelperName', () => {
  it('produces SPSS-valid name: starts with letter, alphanum + underscore only', () => {
    const name = generatePortableHelperName('Needs State');
    expect(name).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    expect(name.startsWith('HT_')).toBe(true);
  });

  it('does not exceed 64 characters', () => {
    const longGroupName = 'A'.repeat(100);
    const name = generatePortableHelperName(longGroupName);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith('HT_')).toBe(true);
  });

  it('handles special characters by sanitizing', () => {
    const name = generatePortableHelperName('Type A/B (Primary)');
    expect(name).toMatch(/^HT_[a-z0-9_]+$/);
    expect(name).not.toContain('/');
    expect(name).not.toContain('(');
    expect(name).not.toContain(')');
  });

  it('handles empty group name', () => {
    const name = generatePortableHelperName('');
    expect(name).toMatch(/^HT_group_[a-f0-9]{4}$/);
  });

  it('produces different names for different inputs', () => {
    const name1 = generatePortableHelperName('Group A');
    const name2 = generatePortableHelperName('Group B');
    expect(name1).not.toBe(name2);
  });

  it('disambiguates collisions via existingNames', () => {
    const existing = new Set<string>();
    const name1 = generatePortableHelperName('Test', existing);
    existing.add(name1);
    const name2 = generatePortableHelperName('Test', existing);
    expect(name2).not.toBe(name1);
  });

  it('does not contain dots (SPSS-invalid)', () => {
    const name = generatePortableHelperName('.hawktab_test');
    expect(name).not.toContain('.');
  });
});

// =============================================================================
// preClassifyRespondentGroups
// =============================================================================

describe('preClassifyRespondentGroups', () => {
  it('classifies groups with no loop variables as respondent', () => {
    const cuts = [
      { name: 'Male', groupName: 'Gender', rExpression: 'Gender == 1' },
      { name: 'Female', groupName: 'Gender', rExpression: 'Gender == 2' },
    ];
    const loopMappings = [makeLoopMapping()];
    const result = preClassifyRespondentGroups(cuts, loopMappings);
    expect(result.has('Gender')).toBe(true);
  });

  it('does NOT classify groups that reference loop variables as respondent', () => {
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
    ];
    const loopMappings = [makeLoopMapping()];
    const result = preClassifyRespondentGroups(cuts, loopMappings);
    expect(result.has('Classification')).toBe(false);
  });

  it('handles mixed groups correctly', () => {
    const cuts = [
      { name: 'Male', groupName: 'Gender', rExpression: 'Gender == 1' },
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
    ];
    const loopMappings = [makeLoopMapping()];
    const result = preClassifyRespondentGroups(cuts, loopMappings);
    expect(result.has('Gender')).toBe(true);
    expect(result.has('Classification')).toBe(false);
  });

  it('classifies all groups as respondent when no loop mappings exist', () => {
    const cuts = [
      { name: 'Male', groupName: 'Gender', rExpression: 'Gender == 1' },
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
    ];
    const result = preClassifyRespondentGroups(cuts, []);
    expect(result.has('Gender')).toBe(true);
    expect(result.has('Classification')).toBe(true);
  });
});

// =============================================================================
// compileLoopContract
// =============================================================================

describe('compileLoopContract', () => {
  it('compiles a pure respondent group (no loop vars) with deterministic classification', () => {
    const policy = makePolicy([makeRespondentGroupPolicy()]);
    const cuts = [
      { name: 'Male', groupName: 'Gender', rExpression: 'Gender == 1' },
      { name: 'Female', groupName: 'Gender', rExpression: 'Gender == 2' },
    ];
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['Gender', 'Q5a', 'Q5b']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    expect(contract.contractVersion).toBe('1.0');
    expect(contract.groups).toHaveLength(1);

    const group = contract.groups[0];
    expect(group.groupName).toBe('Gender');
    expect(group.anchorType).toBe('respondent');
    expect(group.classificationSource).toBe('deterministic_no_loop_vars');
    expect(group.confidence).toBe(1.0);
    expect(group.targetFrame).toBe('');
    expect(group.targetFrames).toEqual([]);
    expect(group.helperColumnName).toBe('');
    expect(group.helperBranches).toEqual([]);
    expect(group.compiledCuts).toHaveLength(2);
    expect(group.compiledCuts[0].compiledExpression).toBe('Gender == 1');
    expect(group.compiledCuts[0].wasTransformed).toBe(false);
  });

  it('compiles an entity-anchored group with alias substitution', () => {
    const policy = makePolicy([makeEntityGroupPolicy()]);
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
      { name: 'Type B', groupName: 'Classification', rExpression: '(Q5a == 2 | Q5b == 2)' },
    ];
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['Q5a', 'Q5b', 'Gender']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    expect(group.anchorType).toBe('entity');
    expect(group.classificationSource).toBe('agent_entity');
    expect(group.targetFrame).toBe('stacked_loop_1');
    expect(group.targetFrames).toEqual(['stacked_loop_1']);
    expect(group.helperColumnName).toMatch(/^HT_/);
    expect(group.helperBranches).toHaveLength(2);
    expect(group.helperBranches[0]).toEqual({ iteration: '1', sourceVariable: 'Q5a' });
    expect(group.helperBranches[1]).toEqual({ iteration: '2', sourceVariable: 'Q5b' });

    // Cuts should be transformed to use helper column name
    expect(group.compiledCuts).toHaveLength(2);
    expect(group.compiledCuts[0].wasTransformed).toBe(true);
    expect(group.compiledCuts[0].compiledExpression).toContain(group.helperColumnName);
    expect(group.compiledCuts[0].compiledExpression).not.toContain('Q5a');
    expect(group.compiledCuts[0].compiledExpression).not.toContain('Q5b');
  });

  it('assigns entity group to ALL compatible frames (multi-frame)', () => {
    const policy = makePolicy([makeEntityGroupPolicy()]);
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
    ];
    // 3 frames with 2 iterations each — all should be targeted
    const loopMappings = [
      makeLoopMapping({ stackedFrameName: 'stacked_loop_1' }),
      makeLoopMapping({ stackedFrameName: 'stacked_loop_2', skeleton: 'B-N-_-N' }),
      makeLoopMapping({ stackedFrameName: 'stacked_loop_3', skeleton: 'C-N-_-N' }),
    ];
    const knownColumns = new Set(['Q5a', 'Q5b']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    expect(group.anchorType).toBe('entity');
    expect(group.targetFrames).toEqual(['stacked_loop_1', 'stacked_loop_2', 'stacked_loop_3']);
    expect(group.targetFrame).toBe('stacked_loop_1'); // backward compat = first frame
  });

  it('only assigns entity group to frames with matching iteration count', () => {
    const policy = makePolicy([makeEntityGroupPolicy()]);
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
    ];
    // 2 frames with 2 iterations + 1 frame with 3 iterations
    const loopMappings = [
      makeLoopMapping({ stackedFrameName: 'stacked_loop_1', iterations: ['1', '2'] }),
      makeLoopMapping({ stackedFrameName: 'stacked_loop_2', iterations: ['1', '2'], skeleton: 'B-N-_-N' }),
      makeLoopMapping({ stackedFrameName: 'stacked_loop_3', iterations: ['1', '2', '3'], skeleton: 'C-N-_-N' }),
    ];
    const knownColumns = new Set(['Q5a', 'Q5b']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    expect(group.anchorType).toBe('entity');
    // Only the 2-iteration frames should be targeted (entity has 2 sources)
    expect(group.targetFrames).toEqual(['stacked_loop_1', 'stacked_loop_2']);
    expect(group.targetFrames).not.toContain('stacked_loop_3');
  });

  it('falls back to respondent when no frames have compatible iteration count', () => {
    const policy = makePolicy([makeEntityGroupPolicy({
      implementation: {
        strategy: 'alias_column',
        aliasName: 'HT_test',
        sourcesByIteration: [
          { iteration: '1', variable: 'Q5a' },
          { iteration: '2', variable: 'Q5b' },
          { iteration: '3', variable: 'Q5c' },
        ],
        notes: 'test',
      },
    })]);
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1 | Q5c == 1)' },
    ];
    // All frames have 2 iterations, but entity has 3 sources
    const loopMappings = [makeLoopMapping({ iterations: ['1', '2'] })];
    const knownColumns = new Set(['Q5a', 'Q5b', 'Q5c']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    expect(group.anchorType).toBe('respondent');
    expect(group.classificationSource).toBe('fallback_no_compatible_frames');
    expect(contract.hasFallbacks).toBe(true);
  });

  it('falls back to respondent when duplicate transforms detected', () => {
    // If two cuts check the same value on different loop variables, transformation
    // produces identical expressions — which means it's not truly entity-anchored
    const policy = makePolicy([makeEntityGroupPolicy({
      groupName: 'Location',
      implementation: {
        strategy: 'alias_column',
        aliasName: '.hawktab_loc',
        sourcesByIteration: [
          { iteration: '1', variable: 'hLOCr1' },
          { iteration: '2', variable: 'hLOCr2' },
        ],
        notes: 'test',
      },
    })]);
    // Both cuts reference DIFFERENT variables but check == 1 → after transform both become HT_xxx == 1
    const cuts = [
      { name: 'Location R1', groupName: 'Location', rExpression: 'hLOCr1 == 1' },
      { name: 'Location R2', groupName: 'Location', rExpression: 'hLOCr2 == 1' },
    ];
    const loopMappings = [makeLoopMapping({
      variables: [{
        baseName: 'hLOC',
        label: 'Location',
        iterationColumns: { '1': 'hLOCr1', '2': 'hLOCr2' },
      }],
    })];
    const knownColumns = new Set(['hLOCr1', 'hLOCr2']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    expect(group.anchorType).toBe('respondent');
    expect(group.classificationSource).toBe('fallback_duplicate_transform');
    expect(group.helperColumnName).toBe('');
    expect(contract.hasFallbacks).toBe(true);
    expect(contract.warnings.length).toBeGreaterThan(0);
  });

  it('falls back to respondent when all source variables are missing', () => {
    // The cuts must reference actual loop columns so the group isn't pre-classified
    // as deterministic_no_loop_vars. But the sourcesByIteration points to missing vars.
    const policy = makePolicy([makeEntityGroupPolicy({
      implementation: {
        strategy: 'alias_column',
        aliasName: '.hawktab_test',
        sourcesByIteration: [
          { iteration: '1', variable: 'MISSING_A' },
          { iteration: '2', variable: 'MISSING_B' },
        ],
        notes: 'test',
      },
    })]);
    // Cuts reference loop columns (Q5a, Q5b) so group passes pre-classification
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
    ];
    const loopMappings = [makeLoopMapping()];
    // Q5a/Q5b are loop columns but MISSING_A/B (the source vars) are not in known columns
    const knownColumns = new Set(['Gender', 'Q5a', 'Q5b']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    expect(group.anchorType).toBe('respondent');
    expect(group.classificationSource).toBe('fallback_missing_sources');
    expect(contract.hasFallbacks).toBe(true);
  });

  it('handles mixed entity + respondent groups correctly', () => {
    const policy = makePolicy([
      makeEntityGroupPolicy(),
      makeRespondentGroupPolicy(),
    ]);
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | Q5b == 1)' },
      { name: 'Male', groupName: 'Gender', rExpression: 'Gender == 1' },
    ];
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['Q5a', 'Q5b', 'Gender']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    expect(contract.groups).toHaveLength(2);

    const entityGroup = contract.groups.find(g => g.groupName === 'Classification')!;
    expect(entityGroup.anchorType).toBe('entity');
    expect(entityGroup.classificationSource).toBe('agent_entity');
    expect(entityGroup.targetFrames).toEqual(['stacked_loop_1']);

    const respondentGroup = contract.groups.find(g => g.groupName === 'Gender')!;
    expect(respondentGroup.anchorType).toBe('respondent');
    expect(respondentGroup.classificationSource).toBe('deterministic_no_loop_vars');
    expect(respondentGroup.targetFrames).toEqual([]);
  });

  it('handles a fallback policy (agent failed) correctly', () => {
    const policy = createRespondentAnchoredFallbackPolicy(['Gender', 'Age'], 'Agent timeout');
    const cuts = [
      { name: 'Male', groupName: 'Gender', rExpression: 'Gender == 1' },
      { name: '18-34', groupName: 'Age', rExpression: 'Age %in% c(1,2)' },
    ];
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['Gender', 'Age', 'Q5a', 'Q5b']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    expect(contract.sourcePolicyWasFallback).toBe(true);
    expect(contract.hasFallbacks).toBe(true);
    for (const group of contract.groups) {
      expect(group.anchorType).toBe('respondent');
    }
  });

  it('handles groups with empty cuts', () => {
    const policy = makePolicy([makeRespondentGroupPolicy()]);
    // No cuts for the Gender group
    const cuts: Array<{ name: string; groupName: string; rExpression: string }> = [];
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['Gender']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    expect(group.compiledCuts).toEqual([]);
  });

  it('preserves available frames from loop mappings', () => {
    const policy = makePolicy([makeRespondentGroupPolicy()]);
    const cuts = [
      { name: 'Male', groupName: 'Gender', rExpression: 'Gender == 1' },
    ];
    const loopMappings = [
      makeLoopMapping({ stackedFrameName: 'stacked_loop_1' }),
      makeLoopMapping({ stackedFrameName: 'stacked_loop_2', skeleton: 'B-N-_-N' }),
    ];
    const knownColumns = new Set(['Gender']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    expect(contract.availableFrames).toEqual(['stacked_loop_1', 'stacked_loop_2']);
  });

  it('warns but continues when some source variables are missing', () => {
    const policy = makePolicy([makeEntityGroupPolicy({
      implementation: {
        strategy: 'alias_column',
        aliasName: '.hawktab_test',
        sourcesByIteration: [
          { iteration: '1', variable: 'Q5a' },     // exists
          { iteration: '2', variable: 'MISSING' },  // doesn't exist
        ],
        notes: 'test',
      },
    })]);
    const cuts = [
      { name: 'Type A', groupName: 'Classification', rExpression: '(Q5a == 1 | MISSING == 1)' },
    ];
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['Q5a']); // MISSING not present

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    // Should still be entity-anchored (only partial missing)
    expect(group.anchorType).toBe('entity');
    // But only one helper branch (the valid one)
    expect(group.helperBranches).toHaveLength(1);
    expect(group.helperBranches[0].sourceVariable).toBe('Q5a');
    // Warning should be present
    expect(contract.warnings.some(w => w.includes('MISSING'))).toBe(true);
  });

  it('trusts agent entity classification when cuts reference non-loop-detected variables', () => {
    // S10a/S11a are iteration-linked but NOT in loop iteration columns —
    // exactly the case the LoopSemanticsPolicyAgent exists to handle.
    const policy = makePolicy([makeEntityGroupPolicy({
      groupName: 'Need States',
      confidence: 0.95,
      stackedFrameName: 'stacked_loop_1',
      implementation: {
        strategy: 'alias_column',
        aliasName: 'HT_need_state',
        sourcesByIteration: [
          { iteration: '1', variable: 'S10a' },
          { iteration: '2', variable: 'S11a' },
        ],
        notes: 'Entity: OR pattern across S10a/S11a matches iterations',
      },
    })]);
    // Cuts reference S10a/S11a which are NOT in loop iteration columns
    const cuts = [
      { name: 'Connection', groupName: 'Need States', rExpression: '(S10a == 1 | S11a == 1)' },
      { name: 'Status', groupName: 'Need States', rExpression: '(S10a == 2 | S11a == 2)' },
    ];
    // Loop mapping has Q5a/Q5b as iteration columns — NOT S10a/S11a
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['S10a', 'S11a', 'Q5a', 'Q5b']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    // Agent's entity classification should be trusted (conf 0.95 > 0.75 threshold)
    expect(group.anchorType).toBe('entity');
    expect(group.classificationSource).toBe('agent_entity');
    expect(group.helperColumnName).toMatch(/^HT_/);
    expect(group.helperBranches).toHaveLength(2);
    expect(group.compiledCuts[0].wasTransformed).toBe(true);
    // Should target the frame (2 sources = 2 iterations match)
    expect(group.targetFrames).toEqual(['stacked_loop_1']);
  });

  it('overrides low-confidence agent entity classification when no loop vars in cuts', () => {
    const policy = makePolicy([makeEntityGroupPolicy({
      groupName: 'Ambiguous',
      confidence: 0.5, // Below threshold
      stackedFrameName: 'stacked_loop_1',
      implementation: {
        strategy: 'alias_column',
        aliasName: 'HT_ambiguous',
        sourcesByIteration: [
          { iteration: '1', variable: 'X1' },
          { iteration: '2', variable: 'X2' },
        ],
        notes: 'Low confidence entity classification',
      },
    })]);
    // Cuts reference X1/X2 which are NOT in loop iteration columns
    const cuts = [
      { name: 'Type A', groupName: 'Ambiguous', rExpression: '(X1 == 1 | X2 == 1)' },
    ];
    const loopMappings = [makeLoopMapping()];
    const knownColumns = new Set(['X1', 'X2', 'Q5a', 'Q5b']);

    const contract = compileLoopContract({ policy, cuts, loopMappings, knownColumns });

    const group = contract.groups[0];
    // Low confidence + no loop vars → deterministic wins
    expect(group.anchorType).toBe('respondent');
    expect(group.classificationSource).toBe('deterministic_no_loop_vars');
    expect(contract.warnings.some(w => w.includes('below threshold'))).toBe(true);
  });
});
