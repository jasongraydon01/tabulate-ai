import { describe, expect, it } from 'vitest';
import { groupDataMapDetailed } from '../DataMapGrouper';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';

function makeParent(column: string): VerboseDataMapType {
  return {
    level: 'parent',
    column,
    description: `${column} description`,
    valueType: 'Values: 1-5',
    answerOptions: '1=Low,2=Medium,3=High,4=Very High,5=Top',
    parentQuestion: 'NA',
    normalizedType: 'categorical_select',
    allowedValues: [1, 2, 3, 4, 5],
  };
}

function makeSub(
  column: string,
  parentQuestion: string,
  description: string,
  allowedValues: number[] = [1, 2, 3, 4, 5],
  context?: string
): VerboseDataMapType {
  return {
    level: 'sub',
    column,
    description,
    valueType: `Values: ${allowedValues.join('-')}`,
    answerOptions: allowedValues.map(v => `${v}=Label ${v}`).join(','),
    parentQuestion,
    normalizedType: 'categorical_select',
    allowedValues,
    context,
  };
}

function buildFamily(
  base: string,
  siblingCount: number,
  suffixes: string[],
  labelBuilder: (siblingIndex: number, suffix: string) => string,
  contextBuilder?: (siblingIndex: number, suffix: string) => string | undefined
): VerboseDataMapType[] {
  const rows: VerboseDataMapType[] = [];
  for (let i = 1; i <= siblingCount; i++) {
    rows.push(makeParent(`${base}_${i}`));
  }
  for (let i = 1; i <= siblingCount; i++) {
    for (const suffix of suffixes) {
      rows.push(
        makeSub(
          `${base}_${i}${suffix}`,
          `${base}_${i}`,
          labelBuilder(i, suffix),
          [1, 2, 3, 4, 5],
          contextBuilder?.(i, suffix)
        )
      );
    }
  }
  return rows;
}

function makeOeSub(
  column: string,
  parentQuestion: string,
  description: string,
): VerboseDataMapType {
  return {
    level: 'sub',
    column,
    description,
    valueType: 'Open Text',
    answerOptions: 'NA',
    parentQuestion,
    normalizedType: 'text_open',
  };
}

describe('DataMapGrouper OE-only sub-group detachment', () => {
  // This fix targets the includeOpenEnds:true path (used by step 00 enricher).
  // When includeOpenEnds is false (production pipeline default), OE subs are
  // filtered out before grouping, so the parent naturally gets its own group.
  const oeOptions = { includeOpenEnds: true };

  it('detaches OE subs when parent variable exists, giving parent its own group', () => {
    const dataMap: VerboseDataMapType[] = [
      makeParent('Q3'),
      makeOeSub('Q3r9oe', 'Q3', 'Q3r9oe: What is your role? - Other (specify):'),
    ];

    const result = groupDataMapDetailed(dataMap, oeOptions);

    // Parent should get its own group with categorical metadata
    const parentGroup = result.groups.find(g => g.questionId === 'Q3');
    expect(parentGroup).toBeDefined();
    expect(parentGroup?.items).toHaveLength(1);
    expect(parentGroup?.items[0].column).toBe('Q3');
    expect(parentGroup?.items[0].normalizedType).toBe('categorical_select');

    // OE sub should get its own standalone group
    const oeGroup = result.groups.find(g => g.questionId === 'Q3r9oe');
    expect(oeGroup).toBeDefined();
    expect(oeGroup?.items).toHaveLength(1);
    expect(oeGroup?.items[0].column).toBe('Q3r9oe');
    expect(oeGroup?.items[0].normalizedType).toBe('text_open');
  });

  it('detaches multiple OE subs from the same parent', () => {
    const dataMap: VerboseDataMapType[] = [
      makeParent('Q7'),
      makeOeSub('Q7r9oe', 'Q7', 'Q7r9oe: Primary reason? - Other:'),
      makeOeSub('Q7r99oe', 'Q7', 'Q7r99oe: Primary reason? - Please specify:'),
    ];

    const result = groupDataMapDetailed(dataMap, oeOptions);

    const parentGroup = result.groups.find(g => g.questionId === 'Q7');
    expect(parentGroup).toBeDefined();
    expect(parentGroup?.items[0].column).toBe('Q7');
    expect(parentGroup?.items[0].normalizedType).toBe('categorical_select');

    expect(result.groups.find(g => g.questionId === 'Q7r9oe')).toBeDefined();
    expect(result.groups.find(g => g.questionId === 'Q7r99oe')).toBeDefined();
  });

  it('does NOT detach when subs are not all text_open (normal grid)', () => {
    const dataMap: VerboseDataMapType[] = [
      makeParent('Q5'),
      makeSub('Q5r1', 'Q5', 'Q5r1: Option A', [0, 1]),
      makeSub('Q5r2', 'Q5', 'Q5r2: Option B', [0, 1]),
      makeSub('Q5r3', 'Q5', 'Q5r3: Option C', [0, 1]),
    ];

    const result = groupDataMapDetailed(dataMap, oeOptions);

    // Parent should NOT get its own group — subs are the data
    const parentGroup = result.groups.find(g => g.questionId === 'Q5' && g.items[0]?.column === 'Q5');
    expect(parentGroup).toBeUndefined();

    // Group should contain the subs
    const subGroup = result.groups.find(g => g.questionId === 'Q5');
    expect(subGroup).toBeDefined();
    expect(subGroup?.items).toHaveLength(3);
    expect(subGroup?.items.map(i => i.column)).toEqual(['Q5r1', 'Q5r2', 'Q5r3']);
  });

  it('does NOT detach when parent variable does not exist in .sav', () => {
    // Only the OE sub exists, no parent variable
    const dataMap: VerboseDataMapType[] = [
      makeOeSub('Q3r9oe', 'Q3', 'Q3r9oe: What is your role? - Other (specify):'),
    ];

    const result = groupDataMapDetailed(dataMap, oeOptions);

    // Should behave as before: single group under parent ID with OE item
    const group = result.groups.find(g => g.questionId === 'Q3');
    expect(group).toBeDefined();
    expect(group?.items).toHaveLength(1);
    expect(group?.items[0].column).toBe('Q3r9oe');
    expect(group?.items[0].normalizedType).toBe('text_open');

    // No standalone OE group should be created
    expect(result.groups.find(g => g.questionId === 'Q3r9oe')).toBeUndefined();
  });

  it('does NOT detach mixed groups (some OE, some non-OE subs)', () => {
    const dataMap: VerboseDataMapType[] = [
      makeParent('Q9'),
      makeSub('Q9r1', 'Q9', 'Q9r1: Option A', [0, 1]),
      makeSub('Q9r2', 'Q9', 'Q9r2: Option B', [0, 1]),
      makeOeSub('Q9r9oe', 'Q9', 'Q9r9oe: Other specify'),
    ];

    const result = groupDataMapDetailed(dataMap, oeOptions);

    // Group should keep all subs together (not all are text_open)
    const group = result.groups.find(g => g.questionId === 'Q9');
    expect(group).toBeDefined();
    expect(group?.items).toHaveLength(3);
    expect(group?.items.map(i => i.column)).toEqual(['Q9r1', 'Q9r2', 'Q9r9oe']);

    // Parent should NOT get its own group
    expect(result.groups.filter(g => g.questionId === 'Q9')).toHaveLength(1);
  });

  it('without includeOpenEnds, parent naturally gets its own group (OE filtered out)', () => {
    const dataMap: VerboseDataMapType[] = [
      makeParent('Q3'),
      makeOeSub('Q3r9oe', 'Q3', 'Q3r9oe: What is your role? - Other (specify):'),
    ];

    // Default options (includeOpenEnds: false) — production pipeline path
    const result = groupDataMapDetailed(dataMap);

    // OE sub is filtered out, parent gets its own group
    const parentGroup = result.groups.find(g => g.questionId === 'Q3');
    expect(parentGroup).toBeDefined();
    expect(parentGroup?.items).toHaveLength(1);
    expect(parentGroup?.items[0].column).toBe('Q3');
    expect(parentGroup?.items[0].normalizedType).toBe('categorical_select');

    // No OE group exists (filtered out)
    expect(result.groups.find(g => g.questionId === 'Q3r9oe')).toBeUndefined();
  });
});

describe('DataMapGrouper regrouping v2', () => {
  it('extracts sub-item labels and shared question text from sub-variable descriptions', () => {
    const dataMap: VerboseDataMapType[] = [
      makeSub(
        'A7r1',
        'A7',
        'A7r1: Makes PCSK9s easier to get covered by insurance - How might this impact prescribing?',
        [0, 1],
      ),
      makeSub(
        'A7r2',
        'A7',
        'A7r2: Offers an option to patients who cannot take statins - How might this impact prescribing?',
        [0, 1],
      ),
    ];

    const result = groupDataMapDetailed(dataMap);
    const group = result.groups.find(g => g.questionId === 'A7');

    expect(group).toBeDefined();
    expect(group?.questionText).toBe('How might this impact prescribing?');
    expect(group?.items[0].label).toBe('Makes PCSK9s easier to get covered by insurance');
    expect(group?.items[0].subItemLabel).toBe('Makes PCSK9s easier to get covered by insurance');
    expect(group?.items[1].label).toBe('Offers an option to patients who cannot take statins');
  });

  it('keeps natural-language question text when suffix regrouping is applied', () => {
    const dataMap = buildFamily(
      'D1',
      3,
      ['r1', 'r2'],
      (idx, suffix) => suffix === 'r1'
        ? `Brand ${idx} awareness score`
        : `Brand ${idx} consideration score`,
      () => 'D1: Which attributes matter most when selecting a brand?'
    );

    const result = groupDataMapDetailed(dataMap, {
      regrouping: { minAxisMargin: 0 },
    });

    const regrouped = result.groups.find(g => g.questionId === 'D1_r1');
    expect(regrouped).toBeDefined();
    expect(regrouped?.questionText).toBe('Which attributes matter most when selecting a brand?');
  });

  it('prefers suffix axis when suffix groups are semantically cohesive', () => {
    const dataMap = buildFamily(
      'D1',
      3,
      ['r1', 'r2'],
      (idx, suffix) => suffix === 'r1'
        ? `Brand ${idx} awareness score`
        : `Brand ${idx} consideration score`,
      (_idx, suffix) => suffix === 'r1' ? 'awareness' : 'consideration'
    );

    const result = groupDataMapDetailed(dataMap, {
      regrouping: { minAxisMargin: 0 },
    });

    expect(result.groups.some(g => g.questionId === 'D1_r1')).toBe(true);
    expect(result.groups.some(g => g.questionId === 'D1_r2')).toBe(true);

    const family = result.regroupDecisionReport?.families.find(f => f.familyBase === 'D1');
    expect(family?.selectedAxis).toBe('suffix_axis');
    expect(family?.applied).toBe(true);
  });

  it('prefers sibling axis when sibling groups are semantically cohesive', () => {
    const dataMap = buildFamily(
      'D2',
      3,
      ['r1', 'r2'],
      (idx, suffix) => idx === 1
        ? `Efficacy metric ${suffix}`
        : idx === 2
          ? `Safety metric ${suffix}`
          : `Access metric ${suffix}`,
      (idx) => idx === 1 ? 'efficacy' : idx === 2 ? 'safety' : 'access'
    );

    const result = groupDataMapDetailed(dataMap, {
      regrouping: { minAxisMargin: 0 },
    });

    const family = result.regroupDecisionReport?.families.find(f => f.familyBase === 'D2');
    expect(family?.selectedAxis).toBe('sibling_axis');
    expect(family?.applied).toBe(true);
    expect(result.groups.some(g => g.questionId === 'D2_r1')).toBe(false);
    expect(result.groups.some(g => g.questionId === 'D2_1')).toBe(true);
  });

  it('uses deterministic flat fallback when margin is below threshold', () => {
    const dataMap = buildFamily(
      'D3',
      3,
      ['r1', 'r2', 'r3'],
      (idx, suffix) => `Metric ${idx} ${suffix}`,
      (_idx, suffix) => `shared-${suffix}`
    );

    const result = groupDataMapDetailed(dataMap, {
      regrouping: { minAxisMargin: 0.95 },
    });

    expect(result.groups.some(g => g.questionId === 'D3')).toBe(true);
    const family = result.regroupDecisionReport?.families.find(f => f.familyBase === 'D3');
    expect(family?.selectedAxis).toBe('flat_fallback');
    expect(family?.fallbackReason).toBe('low_margin');
  });

  it('respects allow/block family patterns', () => {
    const d1 = buildFamily('D1', 3, ['r1', 'r2'], (idx, suffix) => `D1 ${idx} ${suffix}`);
    const d2 = buildFamily('D2', 3, ['r1', 'r2'], (idx, suffix) => `D2 ${idx} ${suffix}`);

    const result = groupDataMapDetailed([...d1, ...d2], {
      regrouping: {
        minAxisMargin: 0,
        allowFamilyPatterns: ['^D1$'],
        blockFamilyPatterns: ['^D2$'],
      },
    });

    const d1Decision = result.regroupDecisionReport?.families.find(f => f.familyBase === 'D1');
    const d2Decision = result.regroupDecisionReport?.families.find(f => f.familyBase === 'D2');

    expect(d1Decision?.fallbackReason).not.toBe('family_pattern_blocked');
    expect(d2Decision?.fallbackReason).toBe('family_pattern_blocked');
  });

  it('respects suffix pattern allow/block behavior', () => {
    const dataMap = buildFamily(
      'C3',
      3,
      ['c1', 'c2'],
      (idx, suffix) => suffix === 'c1' ? `Brand ${idx} awareness` : `Brand ${idx} trial`,
      (_idx, suffix) => suffix === 'c1' ? 'awareness' : 'trial'
    );

    const allowed = groupDataMapDetailed(dataMap, {
      regrouping: {
        minAxisMargin: 0,
        allowedSuffixPatterns: ['^c\\d+$'],
      },
    });
    expect(allowed.groups.some(g => g.questionId === 'C3_c1')).toBe(true);

    const blocked = groupDataMapDetailed(dataMap, {
      regrouping: {
        minAxisMargin: 0,
        allowedSuffixPatterns: ['^c\\d+$'],
        blockedSuffixPatterns: ['^c2$'],
      },
    });
    const blockedFamily = blocked.regroupDecisionReport?.families.find(f => f.familyBase === 'C3');
    expect(blockedFamily?.fallbackReason).toBe('suffix_pattern_blocked');
  });

  it('reverts family on fitness failure', () => {
    const dataMap = buildFamily(
      'F1',
      3,
      ['r1', 'r2'],
      (idx, suffix) => suffix === 'r1' ? `Brand ${idx} awareness` : `Brand ${idx} trial`,
      (_idx, suffix) => suffix === 'r1' ? 'awareness' : 'trial'
    );

    const result = groupDataMapDetailed(dataMap, {
      regrouping: {
        minAxisMargin: 0,
        minRowsPerRegroupedTable: 10,
      },
    });

    const family = result.regroupDecisionReport?.families.find(f => f.familyBase === 'F1');
    expect(family?.applied).toBe(false);
    expect(family?.boundsCheckPassed).toBe(false);
    expect(result.groups.some(g => g.questionId === 'F1_1')).toBe(true);
    expect(result.groups.some(g => g.questionId === 'F1_r1')).toBe(false);
  });

  it('is deterministic across repeated runs', () => {
    const dataMap = buildFamily(
      'Z9',
      4,
      ['r1', 'r2', 'r3'],
      (idx, suffix) => `${suffix} metric for segment ${idx}`,
      (_idx, suffix) => suffix
    );

    const first = groupDataMapDetailed(dataMap, { regrouping: { minAxisMargin: 0 } });
    const second = groupDataMapDetailed(dataMap, { regrouping: { minAxisMargin: 0 } });

    expect(first.groups.map(g => g.questionId)).toEqual(second.groups.map(g => g.questionId));
    expect(first.groups.map(g => g.items.map(i => i.column))).toEqual(second.groups.map(g => g.items.map(i => i.column)));

    const firstDecision = first.regroupDecisionReport?.families.find(f => f.familyBase === 'Z9');
    const secondDecision = second.regroupDecisionReport?.families.find(f => f.familyBase === 'Z9');
    expect(firstDecision?.selectedAxis).toBe(secondDecision?.selectedAxis);
  });

  it('ignores invalid regex patterns and records warning', () => {
    const dataMap = buildFamily('R1', 3, ['r1', 'r2'], (idx, suffix) => `${idx} ${suffix}`);
    const result = groupDataMapDetailed(dataMap, {
      regrouping: {
        allowedSuffixPatterns: ['[invalid'],
      },
    });

    expect(result.regroupDecisionReport?.warnings.some(w => w.includes('Invalid allowedSuffixPatterns'))).toBe(true);
    expect(result.groups.length).toBeGreaterThan(0);
  });
});
