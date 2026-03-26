import { describe, expect, it } from 'vitest';
import type { AgentBannerGroup } from '../../contextBuilder';
import type { VerboseDataMap } from '../../processors/DataMapProcessor';
import { validateBannerGroups } from '../validateBannerGroups';

function makeVar(
  column: string,
  parentQuestion: string,
  level: 'parent' | 'sub' = 'sub',
): VerboseDataMap {
  return {
    level,
    column,
    description: `${column} description`,
    valueType: 'Nominal',
    answerOptions: '1=Yes,2=No',
    parentQuestion,
  };
}

function makeGroup(groupName: string, originals: string[]): AgentBannerGroup {
  return {
    groupName,
    columns: originals.map((original, idx) => ({
      name: `Col ${idx + 1}`,
      original,
    })),
  };
}

describe('validateBannerGroups', () => {
  it('rejects groups with fewer than 2 columns', () => {
    const groups = [makeGroup('Single', ['Q1==1'])];
    const datamap = [makeVar('Q1', 'NA', 'parent')];
    const result = validateBannerGroups(groups, datamap);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('MIN_COLUMNS');
  });

  it('accepts groups where all columns share one parent family', () => {
    const groups = [makeGroup('S8 Family', ['S8r1==1', 'S8r2==1'])];
    const datamap = [makeVar('S8r1', 'S8'), makeVar('S8r2', 'S8')];
    const result = validateBannerGroups(groups, datamap);

    expect(result.invalid).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
  });

  it('rejects groups that mix parent families', () => {
    const groups = [makeGroup('Mixed', ['S8r1==1', 'S9r2==1'])];
    const datamap = [makeVar('S8r1', 'S8'), makeVar('S9r2', 'S9')];
    const result = validateBannerGroups(groups, datamap);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('MIXED_PARENTS');
  });

  it('accepts parent-level variables when family is self', () => {
    const groups = [makeGroup('Q3 Split', ['Q3==1', 'Q3==2'])];
    const datamap = [makeVar('Q3', 'NA', 'parent')];
    const result = validateBannerGroups(groups, datamap);

    expect(result.invalid).toHaveLength(0);
    expect(result.valid).toHaveLength(1);
  });

  it('rejects unresolved variables', () => {
    const groups = [makeGroup('Unknown Vars', ['XYZ_foo==1', 'XYZ_bar==1'])];
    const datamap: VerboseDataMap[] = [];
    const result = validateBannerGroups(groups, datamap);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('UNRESOLVED_VARIABLES');
    expect(result.invalid[0].unresolvedVariables).toContain('XYZ_foo');
  });

  it('rejects groups with no variable references', () => {
    const groups = [makeGroup('No Vars', ['TRUE', 'FALSE'])];
    const datamap = [makeVar('Q1', 'NA', 'parent')];
    const result = validateBannerGroups(groups, datamap);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('NO_VARIABLE_REFERENCES');
  });
});
