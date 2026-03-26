/**
 * V3 Runtime — Shared Base Contract
 *
 * Additive metadata contract introduced in Phase 1 of the base-system refactor.
 * This contract is persisted alongside existing legacy base fields so later
 * phases can migrate consumers gradually without changing runtime behavior.
 */

export type BaseSignal =
  | 'filtered-base'
  | 'varying-item-bases'
  | 'ranking-artifact'
  | 'ranking-artifact-ambiguous'
  | 'zero-respondents'
  | 'rebased-base'
  | 'model-derived-base'
  | 'validity-constrained-base'
  | 'low-base'
  | 'dead-items-removed'
  | 'weighted-effective-base'
  | 'compute-mask-required'
  | 'selection-exercise';

export interface BaseContractV1 {
  version: 1;
  reference: {
    totalN: number | null;
    questionBase: number | null;
    itemBase: number | null;
    itemBaseRange: [number, number] | null;
  };
  classification: {
    situation: 'uniform' | 'filtered' | 'varying_items' | 'validity_constrained' | 'rebased' | 'model_derived' | null;
    referenceUniverse: 'total' | 'question' | 'cluster' | 'model' | null;
    variationClass: 'none' | 'genuine' | 'ranking_artifact' | 'ranking_ambiguous' | null;
    comparabilityStatus: 'shared' | 'varying_but_acceptable' | 'split_recommended' | 'ambiguous' | null;
  };
  policy: {
    effectiveBaseMode: 'table_mask_then_row_observed_n' | 'table_mask_shared_n' | 'model' | null;
    validityPolicy: 'none';
    rebasePolicy: 'none' | 'exclude_non_substantive_tail';
  };
  signals: BaseSignal[];
}

export interface EntryBaseContractInput {
  totalN: number | null;
  questionBase: number | null;
  itemBase: number | null;
  itemBaseRange: [number, number] | null;
  hasVariableItemBases: boolean | null;
  variableBaseReason: 'ranking-artifact' | 'genuine' | null;
  rankingDetail: { K: number } | null | undefined;
  exclusionReason: string | null | undefined;
}

export interface TableBaseContractProjectionInput {
  basePolicy: string;
  questionBase: number | null;
  itemBase: number | null;
}

export function makeEmptyBaseContract(): BaseContractV1 {
  return {
    version: 1,
    reference: {
      totalN: null,
      questionBase: null,
      itemBase: null,
      itemBaseRange: null,
    },
    classification: {
      situation: null,
      referenceUniverse: null,
      variationClass: null,
      comparabilityStatus: null,
    },
    policy: {
      effectiveBaseMode: null,
      validityPolicy: 'none',
      rebasePolicy: 'none',
    },
    signals: [],
  };
}

function uniqueSignals(signals: BaseSignal[]): BaseSignal[] {
  return Array.from(new Set(signals));
}

export function buildEntryBaseContract(input: EntryBaseContractInput): BaseContractV1 {
  const out = makeEmptyBaseContract();
  out.reference.totalN = input.totalN;
  out.reference.questionBase = input.questionBase;
  out.reference.itemBase = input.itemBase;
  out.reference.itemBaseRange = input.itemBaseRange;

  const hasComparableBases =
    input.totalN != null &&
    input.questionBase != null &&
    Number.isFinite(input.totalN) &&
    Number.isFinite(input.questionBase);

  const isFiltered = hasComparableBases && (input.questionBase as number) < (input.totalN as number);
  const hasVariableItemBases = input.hasVariableItemBases === true;
  const rankingAmbiguous = Boolean(
    input.rankingDetail?.K &&
    hasVariableItemBases &&
    isFiltered,
  );

  if (hasVariableItemBases) {
    out.classification.situation = 'varying_items';
  } else if (isFiltered) {
    out.classification.situation = 'filtered';
  } else if (hasComparableBases && input.questionBase === input.totalN) {
    out.classification.situation = 'uniform';
  }

  if (hasComparableBases && input.questionBase === input.totalN) {
    out.classification.referenceUniverse = 'total';
  } else if (isFiltered || hasVariableItemBases) {
    out.classification.referenceUniverse = 'question';
  }

  if (!hasVariableItemBases) {
    out.classification.variationClass = 'none';
    out.classification.comparabilityStatus = 'shared';
  } else if (rankingAmbiguous) {
    out.classification.variationClass = 'ranking_ambiguous';
    out.classification.comparabilityStatus = 'ambiguous';
  } else if (input.variableBaseReason === 'ranking-artifact') {
    out.classification.variationClass = 'ranking_artifact';
    out.classification.comparabilityStatus = 'varying_but_acceptable';
  } else {
    out.classification.variationClass = 'genuine';
    out.classification.comparabilityStatus = 'split_recommended';
  }

  const signals: BaseSignal[] = [];
  if (isFiltered) signals.push('filtered-base');
  if (hasVariableItemBases) signals.push('varying-item-bases');
  if (out.classification.variationClass === 'ranking_artifact') signals.push('ranking-artifact');
  if (out.classification.variationClass === 'ranking_ambiguous') signals.push('ranking-artifact-ambiguous');
  if (input.exclusionReason === 'zero_respondents') signals.push('zero-respondents');
  out.signals = uniqueSignals(signals);

  return out;
}

export function projectTableBaseContract(
  entryContract: BaseContractV1 | null | undefined,
  table: TableBaseContractProjectionInput,
): BaseContractV1 {
  const base = entryContract ? cloneBaseContract(entryContract) : makeEmptyBaseContract();

  base.reference.questionBase = table.questionBase;
  base.reference.itemBase = table.itemBase;

  if (table.basePolicy === 'score_family_model_base') {
    base.classification.referenceUniverse = 'model';
    base.classification.situation = 'model_derived';
    base.policy.effectiveBaseMode = 'model';
    base.signals = uniqueSignals([...base.signals, 'model-derived-base']);
    return base;
  }

  if (table.basePolicy.includes('cluster_base')) {
    base.classification.referenceUniverse = 'cluster';
  }

  if (table.basePolicy.includes('rebased')) {
    base.classification.situation = 'rebased';
    base.policy.rebasePolicy = 'exclude_non_substantive_tail';
    base.signals = uniqueSignals([...base.signals, 'rebased-base']);
  } else {
    base.policy.rebasePolicy = 'none';
  }

  // Selection exercise: NA means "not selected" (not "not shown").
  // Use shared table base so all rows use nrow(cut_data) as denominator.
  if (table.basePolicy === 'selection_exercise_shared') {
    base.policy.effectiveBaseMode = 'table_mask_shared_n';
    base.signals = uniqueSignals([...base.signals, 'selection-exercise']);
    return base;
  }

  base.policy.effectiveBaseMode = 'table_mask_then_row_observed_n';
  return base;
}

export function cloneBaseContract(contract: BaseContractV1): BaseContractV1 {
  return {
    version: contract.version,
    reference: {
      totalN: contract.reference.totalN,
      questionBase: contract.reference.questionBase,
      itemBase: contract.reference.itemBase,
      itemBaseRange: contract.reference.itemBaseRange,
    },
    classification: {
      situation: contract.classification.situation,
      referenceUniverse: contract.classification.referenceUniverse,
      variationClass: contract.classification.variationClass,
      comparabilityStatus: contract.classification.comparabilityStatus,
    },
    policy: {
      effectiveBaseMode: contract.policy.effectiveBaseMode,
      validityPolicy: contract.policy.validityPolicy,
      rebasePolicy: contract.policy.rebasePolicy,
    },
    signals: [...contract.signals],
  };
}
