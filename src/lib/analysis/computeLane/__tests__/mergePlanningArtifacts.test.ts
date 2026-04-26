import { describe, expect, it } from 'vitest';

import { buildExtendedPlanningArtifacts } from '../mergePlanningArtifacts';

describe('buildExtendedPlanningArtifacts', () => {
  it('appends one frozen group without changing parent groups', () => {
    const parentBannerPlan = {
      bannerCuts: [
        { groupName: 'Gender', columns: [{ name: 'Male', original: 'S1=1' }] },
      ],
    };
    const parentCrosstabPlan = {
      bannerCuts: [
        {
          groupName: 'Gender',
          columns: [{
            name: 'Male',
            adjusted: 'S1 == 1',
            confidence: 0.98,
            reasoning: 'Direct match',
            userSummary: 'Matched directly.',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable' as const,
          }],
        },
      ],
    };
    const frozenBannerGroup = {
      groupName: 'Region',
      columns: [{ name: 'North', original: 'REGION=1' }],
    };
    const frozenValidatedGroup = {
      groupName: 'Region',
      columns: [{
        name: 'North',
        adjusted: 'REGION == 1',
        confidence: 0.96,
        reasoning: 'Direct match',
        userSummary: 'Matched directly.',
        alternatives: [],
        uncertainties: [],
        expressionType: 'direct_variable' as const,
      }],
    };

    const merged = buildExtendedPlanningArtifacts({
      parentBannerPlan,
      parentCrosstabPlan,
      frozenBannerGroup,
      frozenValidatedGroup,
    });

    expect(merged.bannerPlan.bannerCuts).toHaveLength(2);
    expect(merged.crosstabPlan.bannerCuts).toHaveLength(2);
    expect(merged.bannerPlan.bannerCuts[0]).toEqual(parentBannerPlan.bannerCuts[0]);
    expect(merged.crosstabPlan.bannerCuts[0]).toEqual(parentCrosstabPlan.bannerCuts[0]);
    expect(merged.bannerPlan.bannerCuts[1]).toEqual(frozenBannerGroup);
    expect(merged.crosstabPlan.bannerCuts[1]).toEqual(frozenValidatedGroup);
  });

  it('rejects duplicate group names so settled groups are not edited', () => {
    expect(() => buildExtendedPlanningArtifacts({
      parentBannerPlan: {
        bannerCuts: [{ groupName: 'Gender', columns: [{ name: 'Male', original: 'S1=1' }] }],
      },
      parentCrosstabPlan: {
        bannerCuts: [{ groupName: 'Gender', columns: [] }],
      },
      frozenBannerGroup: {
        groupName: 'gender',
        columns: [{ name: 'Female', original: 'S1=2' }],
      },
      frozenValidatedGroup: {
        groupName: 'gender',
        columns: [{
          name: 'Female',
          adjusted: 'S1 == 2',
          confidence: 0.95,
          reasoning: 'Direct match',
          userSummary: 'Matched directly.',
          alternatives: [],
          uncertainties: [],
          expressionType: 'direct_variable',
        }],
      },
    })).toThrow(/already exists/);
  });

  it('rejects a frozen banner/validated mismatch', () => {
    expect(() => buildExtendedPlanningArtifacts({
      parentBannerPlan: { bannerCuts: [] },
      parentCrosstabPlan: { bannerCuts: [] },
      frozenBannerGroup: {
        groupName: 'Region',
        columns: [{ name: 'North', original: 'REGION=1' }],
      },
      frozenValidatedGroup: {
        groupName: 'Region',
        columns: [{
          name: 'South',
          adjusted: 'REGION == 2',
          confidence: 0.95,
          reasoning: 'Direct match',
          userSummary: 'Matched directly.',
          alternatives: [],
          uncertainties: [],
          expressionType: 'direct_variable',
        }],
      },
    })).toThrow(/column mismatch/);
  });
});

