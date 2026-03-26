import type {
  ComputeRiskSignal,
  PlannedTableBaseViewRole,
  PlannerBaseComparability,
  PlannerBaseSignal,
} from '@/lib/v3/runtime/canonical/types';
import type { BaseContractV1 } from '@/lib/v3/runtime/baseContract';

export type ComputeTableMaskIntent =
  | 'none'
  | 'question_universe'
  | 'precision_item'
  | 'cluster_universe'
  | 'legacy_additional_filter'
  | 'model';

export type ComputeTableMaskRecipeV1 =
  | { kind: 'none' }
  | { kind: 'any_answered'; variables: string[] }
  | { kind: 'variable_answered'; variable: string }
  | { kind: 'model' };

export type ComputeValidityPolicyV1 = 'none' | 'legacy_expression';

export type ComputeRowUniverseModeV1 =
  | 'masked_row_observed_n'
  | 'masked_shared_table_n'
  | 'model';

export type ComputeRowAggregationModeV1 =
  | 'none'
  | 'single_variable_value_set'
  | 'any_component_selected'
  | 'row_sum_components'
  | 'not_answered'
  | 'stat_summary';

export interface ComputeRowContextV1 {
  version: 1;
  universeMode: ComputeRowUniverseModeV1;
  aggregationMode: ComputeRowAggregationModeV1;
  sourceVariable: string | null;
  componentVariables: string[];
  componentValues: string[];
}

export interface ComputeTableContextV1 {
  version: 1;
  referenceUniverse: BaseContractV1['classification']['referenceUniverse'];
  effectiveBaseMode: BaseContractV1['policy']['effectiveBaseMode'];
  tableMaskIntent: ComputeTableMaskIntent;
  tableMaskRecipe: ComputeTableMaskRecipeV1 | null;
  rebasePolicy: BaseContractV1['policy']['rebasePolicy'];
  rebaseSourceVariables: string[];
  rebaseExcludedValues: number[];
  validityPolicy: ComputeValidityPolicyV1;
  validityExpression: string | null;
  referenceBaseN: number | null;
  itemBaseRange: [number, number] | null;
  baseViewRole: PlannedTableBaseViewRole | null;
  plannerBaseComparability: PlannerBaseComparability | null;
  plannerBaseSignals: PlannerBaseSignal[];
  computeRiskSignals: ComputeRiskSignal[];
  legacyCompatibility: {
    basePolicy: string;
    additionalFilter: string;
  };
}
