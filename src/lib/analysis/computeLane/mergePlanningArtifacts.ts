import type { BannerGroupType, BannerPlanInputType } from '@/schemas/bannerPlanSchema';
import type { ValidationResultType, ValidatedGroupType } from '@/schemas/agentOutputSchema';

import type { ExtendedPlanningArtifacts } from './types';

function assertNoDuplicateGroupName(
  groups: Array<{ groupName: string }>,
  nextGroupName: string,
): void {
  const normalizedNext = nextGroupName.trim().toLowerCase();
  const duplicate = groups.find((group) => group.groupName.trim().toLowerCase() === normalizedNext);
  if (duplicate) {
    throw new Error(`A banner group named "${nextGroupName}" already exists on the parent run.`);
  }
}

function assertGroupAlignment(
  bannerGroup: BannerGroupType,
  validatedGroup: ValidatedGroupType,
): void {
  if (bannerGroup.groupName !== validatedGroup.groupName) {
    throw new Error('Frozen banner group and validated group names do not match.');
  }

  const bannerColumns = bannerGroup.columns.map((column) => column.name);
  const validatedColumns = validatedGroup.columns.map((column) => column.name);
  if (bannerColumns.length !== validatedColumns.length) {
    throw new Error('Frozen banner group and validated group column counts do not match.');
  }

  for (let i = 0; i < bannerColumns.length; i++) {
    if (bannerColumns[i] !== validatedColumns[i]) {
      throw new Error(`Frozen group column mismatch at index ${i}: ${bannerColumns[i]} vs ${validatedColumns[i]}.`);
    }
  }
}

export function buildExtendedPlanningArtifacts(params: {
  parentBannerPlan: BannerPlanInputType;
  parentCrosstabPlan: ValidationResultType;
  frozenBannerGroup: BannerGroupType;
  frozenValidatedGroup: ValidatedGroupType;
}): ExtendedPlanningArtifacts {
  assertGroupAlignment(params.frozenBannerGroup, params.frozenValidatedGroup);
  assertNoDuplicateGroupName(params.parentBannerPlan.bannerCuts, params.frozenBannerGroup.groupName);
  assertNoDuplicateGroupName(params.parentCrosstabPlan.bannerCuts, params.frozenValidatedGroup.groupName);

  return {
    bannerPlan: {
      bannerCuts: [
        ...params.parentBannerPlan.bannerCuts.map((group) => ({
          groupName: group.groupName,
          columns: group.columns.map((column) => ({
            name: column.name,
            original: column.original,
          })),
        })),
        params.frozenBannerGroup,
      ],
    },
    crosstabPlan: {
      bannerCuts: [
        ...params.parentCrosstabPlan.bannerCuts.map((group) => ({
          groupName: group.groupName,
          columns: group.columns.map((column) => ({ ...column })),
        })),
        params.frozenValidatedGroup,
      ],
    },
  };
}

