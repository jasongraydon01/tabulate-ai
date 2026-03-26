import type { AgentBannerGroup } from '../contextBuilder';
import { extractVariablesFromFilter } from '../filters/filterUtils';
import { type VerboseDataMap, inferParentFromSubVariable } from '../processors/DataMapProcessor';

export type BannerGroupValidationCode =
  | 'MIN_COLUMNS'
  | 'MIXED_PARENTS'
  | 'UNRESOLVED_VARIABLES'
  | 'NO_VARIABLE_REFERENCES';

export interface InvalidBannerGroupIssue {
  group: AgentBannerGroup;
  groupIndex: number;
  groupName: string;
  code: BannerGroupValidationCode;
  reason: string;
  parents: string[];
  unresolvedVariables: string[];
}

export interface BannerGroupValidationResult {
  valid: AgentBannerGroup[];
  invalid: InvalidBannerGroupIssue[];
  stats: {
    total: number;
    valid: number;
    invalid: number;
    byCode: Record<BannerGroupValidationCode, number>;
  };
}

function resolveVariableFamily(
  variableName: string,
  datamapByColumn: Map<string, VerboseDataMap>,
): { family: string | null; unresolved: boolean } {
  const entry = datamapByColumn.get(variableName);
  if (entry) {
    if (entry.parentQuestion && entry.parentQuestion !== 'NA') {
      return { family: entry.parentQuestion, unresolved: false };
    }
    return { family: entry.column, unresolved: false };
  }

  const inferredParent = inferParentFromSubVariable(variableName);
  if (inferredParent !== 'NA') {
    return { family: inferredParent, unresolved: false };
  }

  return { family: null, unresolved: true };
}

function createEmptyCounts(): Record<BannerGroupValidationCode, number> {
  return {
    MIN_COLUMNS: 0,
    MIXED_PARENTS: 0,
    UNRESOLVED_VARIABLES: 0,
    NO_VARIABLE_REFERENCES: 0,
  };
}

export function validateBannerGroups(
  groups: AgentBannerGroup[],
  verboseDataMap: VerboseDataMap[],
): BannerGroupValidationResult {
  const datamapByColumn = new Map<string, VerboseDataMap>();
  for (const row of verboseDataMap) {
    datamapByColumn.set(row.column, row);
  }

  const valid: AgentBannerGroup[] = [];
  const invalid: InvalidBannerGroupIssue[] = [];
  const byCode = createEmptyCounts();

  groups.forEach((group, groupIndex) => {
    if (group.columns.length < 2) {
      const issue: InvalidBannerGroupIssue = {
        group,
        groupIndex,
        groupName: group.groupName,
        code: 'MIN_COLUMNS',
        reason: `Group has only ${group.columns.length} column(s); minimum is 2`,
        parents: [],
        unresolvedVariables: [],
      };
      byCode[issue.code] += 1;
      invalid.push(issue);
      return;
    }

    const extractedVariables = new Set<string>();
    for (const column of group.columns) {
      const variables = extractVariablesFromFilter(column.original || '');
      for (const variableName of variables) {
        extractedVariables.add(variableName);
      }
    }

    if (extractedVariables.size === 0) {
      const issue: InvalidBannerGroupIssue = {
        group,
        groupIndex,
        groupName: group.groupName,
        code: 'NO_VARIABLE_REFERENCES',
        reason: 'No variable references were found in group filter expressions',
        parents: [],
        unresolvedVariables: [],
      };
      byCode[issue.code] += 1;
      invalid.push(issue);
      return;
    }

    const parents = new Set<string>();
    const unresolvedVariables = new Set<string>();

    for (const variableName of extractedVariables) {
      const resolved = resolveVariableFamily(variableName, datamapByColumn);
      if (resolved.unresolved || !resolved.family) {
        unresolvedVariables.add(variableName);
      } else {
        parents.add(resolved.family);
      }
    }

    if (unresolvedVariables.size > 0) {
      const unresolved = [...unresolvedVariables].sort();
      const issue: InvalidBannerGroupIssue = {
        group,
        groupIndex,
        groupName: group.groupName,
        code: 'UNRESOLVED_VARIABLES',
        reason: `Group references unresolved variable(s): ${unresolved.join(', ')}`,
        parents: [...parents].sort(),
        unresolvedVariables: unresolved,
      };
      byCode[issue.code] += 1;
      invalid.push(issue);
      return;
    }

    if (parents.size !== 1) {
      const parentList = [...parents].sort();
      const issue: InvalidBannerGroupIssue = {
        group,
        groupIndex,
        groupName: group.groupName,
        code: 'MIXED_PARENTS',
        reason: `Group mixes variable families: ${parentList.join(', ')}`,
        parents: parentList,
        unresolvedVariables: [],
      };
      byCode[issue.code] += 1;
      invalid.push(issue);
      return;
    }

    valid.push(group);
  });

  return {
    valid,
    invalid,
    stats: {
      total: groups.length,
      valid: valid.length,
      invalid: invalid.length,
      byCode,
    },
  };
}
