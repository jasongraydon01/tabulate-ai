/**
 * Tests for cut name disambiguation in buildCutsSpec.
 *
 * R named lists require unique keys. When two banner groups have columns with
 * the same display name (e.g., "User" / "Non-User" in both Brand A and
 * Brand B groups), the names must be disambiguated to prevent R from
 * silently overwriting earlier entries.
 */
import { describe, expect, it } from 'vitest';
import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';

type BannerColumn = ValidationResultType['bannerCuts'][0]['columns'][0];

function makeColumn(name: string, adjusted: string, confidence = 0.9): BannerColumn {
  return {
    name,
    adjusted,
    confidence,
    reasoning: `reasoning for ${name}`,
    userSummary: `summary for ${name}`,
    alternatives: [],
    uncertainties: [],
    expressionType: 'direct_variable',
  };
}

describe('CutsSpec cut name disambiguation', () => {
  it('renames cuts with duplicate names across groups', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Brand A Usage',
          columns: [
            makeColumn('User', 'H_BRAND_USEr1 == 1'),
            makeColumn('Non-User', 'H_BRAND_USEr1 == 0'),
          ],
        },
        {
          groupName: 'Brand B Usage',
          columns: [
            makeColumn('User', 'H_BRAND_USEr2 == 1'),
            makeColumn('Non-User', 'H_BRAND_USEr3 == 1'),
          ],
        },
      ],
    };

    const spec = buildCutsSpec(validation);

    // All 4 non-Total cuts should have unique names
    const nonTotalCuts = spec.cuts.filter(c => c.name !== 'Total');
    const names = nonTotalCuts.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);

    // Brand A cuts get group-prefixed names
    expect(names).toContain('Brand A Usage: User');
    expect(names).toContain('Brand A Usage: Non-User');
    expect(names).toContain('Brand B Usage: User');
    expect(names).toContain('Brand B Usage: Non-User');

    // Expressions are preserved correctly
    const brandAUser = spec.cuts.find(c => c.name === 'Brand A Usage: User');
    expect(brandAUser!.rExpression).toBe('H_BRAND_USEr1 == 1');

    const brandBUser = spec.cuts.find(c => c.name === 'Brand B Usage: User');
    expect(brandBUser!.rExpression).toBe('H_BRAND_USEr2 == 1');
  });

  it('does NOT rename cuts with unique names across groups', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Specialty',
          columns: [
            makeColumn('PCP', 'S5 == 1'),
            makeColumn('Pediatrician', 'S5 == 3'),
          ],
        },
        {
          groupName: 'Practice Type',
          columns: [
            makeColumn('Private', 'S10 == 2'),
            makeColumn('Public', 'S10 == 1'),
          ],
        },
      ],
    };

    const spec = buildCutsSpec(validation);
    const nonTotalCuts = spec.cuts.filter(c => c.name !== 'Total');
    const names = nonTotalCuts.map(c => c.name);

    // No disambiguation needed — names stay as-is
    expect(names).toEqual(['PCP', 'Pediatrician', 'Private', 'Public']);
  });

  it('only renames the colliding names, leaves others alone', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Group A',
          columns: [
            makeColumn('Yes', 'Q1 == 1'),
            makeColumn('Unique A', 'Q1 == 2'),
          ],
        },
        {
          groupName: 'Group B',
          columns: [
            makeColumn('Yes', 'Q2 == 1'),
            makeColumn('Unique B', 'Q2 == 2'),
          ],
        },
      ],
    };

    const spec = buildCutsSpec(validation);
    const nonTotalNames = spec.cuts.filter(c => c.name !== 'Total').map(c => c.name);

    // "Yes" collides → disambiguated
    expect(nonTotalNames).toContain('Group A: Yes');
    expect(nonTotalNames).toContain('Group B: Yes');

    // "Unique A" and "Unique B" don't collide → unchanged
    expect(nonTotalNames).toContain('Unique A');
    expect(nonTotalNames).toContain('Unique B');
  });

  it('disambiguation propagates to group.cuts (same object refs)', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Brand A',
          columns: [makeColumn('User', 'Q1 == 1')],
        },
        {
          groupName: 'Brand B',
          columns: [makeColumn('User', 'Q2 == 1')],
        },
      ],
    };

    const spec = buildCutsSpec(validation);

    const brandAGroup = spec.groups.find(g => g.groupName === 'Brand A');
    const brandBGroup = spec.groups.find(g => g.groupName === 'Brand B');

    // Group cuts should reflect disambiguated names
    expect(brandAGroup!.cuts[0].name).toBe('Brand A: User');
    expect(brandBGroup!.cuts[0].name).toBe('Brand B: User');
  });

  it('handles three-way collision', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        { groupName: 'G1', columns: [makeColumn('Yes', 'Q1 == 1')] },
        { groupName: 'G2', columns: [makeColumn('Yes', 'Q2 == 1')] },
        { groupName: 'G3', columns: [makeColumn('Yes', 'Q3 == 1')] },
      ],
    };

    const spec = buildCutsSpec(validation);
    const nonTotalNames = spec.cuts.filter(c => c.name !== 'Total').map(c => c.name);

    expect(nonTotalNames).toEqual(['G1: Yes', 'G2: Yes', 'G3: Yes']);
  });

  it('Total cut is never disambiguated', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        { groupName: 'G1', columns: [makeColumn('User', 'Q1 == 1')] },
        { groupName: 'G2', columns: [makeColumn('User', 'Q2 == 1')] },
      ],
    };

    const spec = buildCutsSpec(validation);
    expect(spec.totalCut!.name).toBe('Total');
  });

  it('stat letters are stable regardless of disambiguation', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'G1',
          columns: [
            makeColumn('User', 'Q1 == 1'),
            makeColumn('Non-User', 'Q1 == 0'),
          ],
        },
        {
          groupName: 'G2',
          columns: [
            makeColumn('User', 'Q2 == 1'),
            makeColumn('Non-User', 'Q2 == 0'),
          ],
        },
      ],
    };

    const spec = buildCutsSpec(validation);
    const nonTotalCuts = spec.cuts.filter(c => c.name !== 'Total');

    // Stat letters are assigned in order, unaffected by renaming
    expect(nonTotalCuts.map(c => c.statLetter)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('ensures uniqueness even when duplicate names appear within the same group', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Region',
          columns: [
            makeColumn('East', 'Q1 == 1'),
            makeColumn('East', 'Q1 == 2'),
          ],
        },
      ],
    };

    const spec = buildCutsSpec(validation);
    const nonTotalNames = spec.cuts.filter(c => c.name !== 'Total').map(c => c.name);

    expect(nonTotalNames).toEqual(['Region: East', 'Region: East (2)']);
    expect(new Set(nonTotalNames).size).toBe(nonTotalNames.length);
  });

  it('reserves the Total stat letter when banner cuts exceed 19 columns', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Large Banner',
          columns: Array.from({ length: 21 }, (_, index) =>
            makeColumn(`Column ${index + 1}`, `Q1 == ${index + 1}`)),
        },
      ],
    };

    const spec = buildCutsSpec(validation);
    const statLetters = spec.cuts.map(c => c.statLetter);
    const nonTotalLetters = spec.cuts.filter(c => c.name !== 'Total').map(c => c.statLetter);

    expect(spec.totalCut!.statLetter).toBe('T');
    expect(nonTotalLetters).not.toContain('T');
    expect(nonTotalLetters.slice(0, 21)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'U', 'V',
    ]);
    expect(new Set(statLetters).size).toBe(statLetters.length);
  });
});
