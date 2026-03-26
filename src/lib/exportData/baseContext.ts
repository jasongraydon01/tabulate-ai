import {
  buildBaseNoteText,
  buildCompactBaseDisclosureText,
  resolveDisplayBaseText,
} from '@/lib/v3/runtime/canonical/baseDisclosurePresentation';
import type {
  CanonicalBaseDisclosure,
  ComputeRiskSignal,
  PlannedTableBaseViewRole,
  PlannerBaseComparability,
  PlannerBaseSignal,
} from '@/lib/v3/runtime/canonical/types';
import type { BaseContractV1 } from '@/lib/v3/runtime/baseContract';

export interface ExportBaseContext {
  source: CanonicalBaseDisclosure['source'];
  referenceBaseN: number | null;
  itemBaseRange: [number, number] | null;
  displayBaseText: string | null;
  displayNote: string | null;
  compactDisclosureText: string | null;
  baseViewRole: PlannedTableBaseViewRole | null;
  plannerBaseComparability: PlannerBaseComparability | null;
  plannerBaseSignals: PlannerBaseSignal[];
  computeRiskSignals: ComputeRiskSignal[];
  referenceUniverse: BaseContractV1['classification']['referenceUniverse'] | null;
  effectiveBaseMode: BaseContractV1['policy']['effectiveBaseMode'] | null;
  rebasePolicy: BaseContractV1['policy']['rebasePolicy'];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asTuple(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const first = asNumber(value[0]);
  const second = asNumber(value[1]);
  return first != null && second != null ? [first, second] : null;
}

function readBaseDisclosure(value: unknown): CanonicalBaseDisclosure | null {
  const disclosure = asRecord(value);
  if (!disclosure) return null;

  const defaultBaseText = asString(disclosure.defaultBaseText) ?? '';
  const source = disclosure.source === 'contract' ? 'contract' : 'legacy_fallback';
  const rangeDisclosureValue = asRecord(disclosure.rangeDisclosure);

  return {
    referenceBaseN: asNumber(disclosure.referenceBaseN),
    itemBaseRange: asTuple(disclosure.itemBaseRange),
    defaultBaseText,
    defaultNoteTokens: asStringArray(disclosure.defaultNoteTokens) as CanonicalBaseDisclosure['defaultNoteTokens'],
    rangeDisclosure: rangeDisclosureValue
      ? {
          min: asNumber(rangeDisclosureValue.min) ?? 0,
          max: asNumber(rangeDisclosureValue.max) ?? 0,
        }
      : null,
    source,
  };
}

function readBaseContract(value: unknown): {
  referenceUniverse: BaseContractV1['classification']['referenceUniverse'] | null;
  effectiveBaseMode: BaseContractV1['policy']['effectiveBaseMode'] | null;
  rebasePolicy: BaseContractV1['policy']['rebasePolicy'];
} {
  const contract = asRecord(value);
  const classification = asRecord(contract?.classification);
  const policy = asRecord(contract?.policy);

  const referenceUniverse = classification?.referenceUniverse;
  const effectiveBaseMode = policy?.effectiveBaseMode;
  const rebasePolicy = policy?.rebasePolicy === 'exclude_non_substantive_tail'
    ? 'exclude_non_substantive_tail'
    : 'none';

  return {
    referenceUniverse: referenceUniverse === 'total'
      || referenceUniverse === 'question'
      || referenceUniverse === 'cluster'
      || referenceUniverse === 'model'
      ? referenceUniverse
      : null,
    effectiveBaseMode: effectiveBaseMode === 'table_mask_then_row_observed_n'
      || effectiveBaseMode === 'table_mask_shared_n'
      || effectiveBaseMode === 'model'
      ? effectiveBaseMode
      : null,
    rebasePolicy,
  };
}

export function resolveExportBaseContext(table: Record<string, unknown>): ExportBaseContext {
  const baseDisclosure = readBaseDisclosure(table.baseDisclosure);
  const basePolicy = asString(table.basePolicy);
  const baseText = asString(table.baseText);
  const baseContract = readBaseContract(table.baseContract);

  // userNote is intentionally excluded from export base context.
  // WinCross and Q render base text clean; userNote is Excel-only.
  return {
    source: baseDisclosure?.source ?? 'legacy_fallback',
    referenceBaseN: baseDisclosure?.referenceBaseN ?? null,
    itemBaseRange: baseDisclosure?.itemBaseRange ?? null,
    displayBaseText: resolveDisplayBaseText({
      baseDisclosure,
      baseText,
      basePolicy,
    }),
    displayNote: buildBaseNoteText({
      baseDisclosure,
      basePolicy,
    }),
    compactDisclosureText: buildCompactBaseDisclosureText({
      baseDisclosure,
      baseText,
      basePolicy,
    }),
    baseViewRole: table.baseViewRole === 'anchor' || table.baseViewRole === 'precision'
      ? table.baseViewRole
      : null,
    plannerBaseComparability: table.plannerBaseComparability === 'shared'
      || table.plannerBaseComparability === 'varying_but_acceptable'
      || table.plannerBaseComparability === 'split_recommended'
      || table.plannerBaseComparability === 'ambiguous'
      ? table.plannerBaseComparability
      : null,
    plannerBaseSignals: asStringArray(table.plannerBaseSignals) as PlannerBaseSignal[],
    computeRiskSignals: asStringArray(table.computeRiskSignals) as ComputeRiskSignal[],
    referenceUniverse: baseContract.referenceUniverse,
    effectiveBaseMode: baseContract.effectiveBaseMode,
    rebasePolicy: baseContract.rebasePolicy,
  };
}
