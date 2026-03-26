export interface MaxDiffPolicy {
  /**
   * Whether detected choice-task families should remain in the main output.
   * If false, tables are moved to excluded/reference output.
   */
  includeChoiceTaskFamilyInMainOutput: boolean;
  /** Hard cap on output table count per input family/source table. */
  maxSplitTablesPerInput: number;
  /**
   * Whether derived tables are allowed for detected choice-task families.
   * If false, derived variants are excluded.
   */
  allowDerivedTablesForChoiceTasks: boolean;
  /** Whether placeholder labels must be resolved when message mapping exists. */
  placeholderResolutionRequired: boolean;
}

export const DEFAULT_MAXDIFF_POLICY: MaxDiffPolicy = {
  includeChoiceTaskFamilyInMainOutput: false,
  maxSplitTablesPerInput: 20,
  allowDerivedTablesForChoiceTasks: false,
  placeholderResolutionRequired: true,
};

export function resolveMaxDiffPolicy(policy?: Partial<MaxDiffPolicy> | null): MaxDiffPolicy {
  const merged: MaxDiffPolicy = {
    ...DEFAULT_MAXDIFF_POLICY,
    ...(policy || {}),
  };

  if (!Number.isFinite(merged.maxSplitTablesPerInput) || merged.maxSplitTablesPerInput < 1) {
    merged.maxSplitTablesPerInput = DEFAULT_MAXDIFF_POLICY.maxSplitTablesPerInput;
  } else {
    merged.maxSplitTablesPerInput = Math.floor(merged.maxSplitTablesPerInput);
  }

  return merged;
}
