import type { ExtendedTableDefinition, ExtendedTableRow } from '@/schemas/verificationAgentSchema';
import type { EnhancerRuntimeContext } from './types';
import { allocateStableId } from '../enhancerDeterminism';

interface DistributionLike {
  n: number;
  min: number;
  max: number;
}

function getDistribution(tableId: string, ctx: EnhancerRuntimeContext): DistributionLike | null {
  const meta = ctx.tableMetaById.get(tableId);
  if (!meta?.distribution) return null;
  return {
    n: meta.distribution.n,
    min: meta.distribution.min,
    max: meta.distribution.max,
  };
}

/** Nice step candidates — clean multiples that analysts expect to see. */
const NICE_STEPS = [1, 2, 5, 10, 15, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/**
 * Build analyst-friendly bins with clean boundaries.
 *
 * Selects from `NICE_STEPS` the step size that produces 3-7 bins with boundaries
 * at clean multiples. Falls back to equal-width bucketing if no candidate works.
 */
export function buildBins(min: number, max: number): Array<{ label: string; filterValue: string }> {
  const intMin = Math.floor(min);
  const intMax = Math.ceil(max);

  if (intMax <= intMin) return [];
  if (intMax - intMin <= 2) {
    return [{ label: `${intMin}-${intMax}`, filterValue: `${intMin}-${intMax}` }];
  }

  type Candidate = { step: number; niceStart: number; binCount: number };
  const candidates: Candidate[] = [];

  for (const step of NICE_STEPS) {
    const niceStart = Math.floor(intMin / step) * step;
    const binCount = Math.ceil((intMax - niceStart) / step);
    if (binCount >= 3 && binCount <= 7) {
      candidates.push({ step, niceStart, binCount });
    }
  }

  if (candidates.length === 0) {
    return buildEqualWidthBins(intMin, intMax, 5);
  }

  // Pick the candidate closest to 5 bins; tie-break on larger step (more readable)
  candidates.sort((a, b) => {
    const distA = Math.abs(a.binCount - 5);
    const distB = Math.abs(b.binCount - 5);
    if (distA !== distB) return distA - distB;
    return b.step - a.step; // larger step wins
  });

  const best = candidates[0];
  const bins: Array<{ label: string; filterValue: string }> = [];

  for (let i = 0; i < best.binCount; i++) {
    const start = best.niceStart + i * best.step;
    // Last bin: clamp upper bound to actual max if it falls short
    const rawEnd = start + best.step - 1;
    const end = i === best.binCount - 1 ? Math.max(rawEnd, intMax) : rawEnd;
    const label = `${start}-${end}`;
    bins.push({ label, filterValue: `${start}-${end}` });
  }

  return bins;
}

/** Original equal-width bucketing — fallback when no nice step yields 3-7 bins. */
function buildEqualWidthBins(
  intMin: number,
  intMax: number,
  count: number,
): Array<{ label: string; filterValue: string }> {
  const bins: Array<{ label: string; filterValue: string }> = [];
  if (count <= 0) return bins;

  const width = (intMax - intMin + 1) / count;
  let previousEnd = intMin - 1;

  for (let i = 0; i < count; i++) {
    const rawStart = i === 0 ? intMin : Math.floor(intMin + width * i);
    const rawEnd = i === count - 1 ? intMax : Math.floor(intMin + width * (i + 1) - 1);
    const start = Math.max(rawStart, previousEnd + 1);
    const end = Math.max(start, rawEnd);
    previousEnd = end;

    const label = `${start}-${end}`;
    bins.push({ label, filterValue: `${start}-${end}` });
  }

  return bins;
}

export function applyMeanRowsBinning(
  table: ExtendedTableDefinition,
  ctx: EnhancerRuntimeContext,
): {
  derived: ExtendedTableDefinition[];
  applied: string[];
  skipped: Array<{ rule: string; reason: string }>;
  flaggedForAI: string[];
} {
  const derived: ExtendedTableDefinition[] = [];
  const applied: string[] = [];
  const skipped: Array<{ rule: string; reason: string }> = [];
  const flaggedForAI: string[] = [];

  if (table.tableType !== 'mean_rows') {
    skipped.push({ rule: 'mean_rows_binning', reason: 'table_not_mean_rows' });
    return { derived, applied, skipped, flaggedForAI };
  }

  const dist = getDistribution(table.tableId, ctx);
  if (!dist) {
    skipped.push({ rule: 'mean_rows_binning', reason: 'missing_distribution_metadata' });
    flaggedForAI.push('missing_distribution_for_binning');
    return { derived, applied, skipped, flaggedForAI };
  }

  if (dist.n < ctx.options.minMeanRowsBinSample) {
    skipped.push({ rule: 'mean_rows_binning', reason: 'sample_below_threshold' });
    flaggedForAI.push('mean_rows_low_sample_for_bins');
    return { derived, applied, skipped, flaggedForAI };
  }

  if (dist.max <= dist.min) {
    skipped.push({ rule: 'mean_rows_binning', reason: 'invalid_distribution_range' });
    return { derived, applied, skipped, flaggedForAI };
  }

  const sourceVariable = table.rows[0]?.variable || table.questionId;
  const bins = buildBins(dist.min, dist.max);
  const binRows: ExtendedTableRow[] = bins.map((bin) => ({
    variable: sourceVariable,
    label: bin.label,
    filterValue: bin.filterValue,
    isNet: false,
    netComponents: [],
    indent: 0,
  }));

  const desiredId = `${table.tableId}_binned`;
  const derivedId = allocateStableId(desiredId, ctx.usedIds, ctx.report.idCollisions);

  derived.push({
    ...table,
    tableId: derivedId,
    sourceTableId: table.tableId,
    tableType: 'frequency',
    isDerived: true,
    tableSubtitle: 'Distribution',
    rows: binRows,
    lastModifiedBy: 'TableEnhancer',
  });

  applied.push('mean_rows_distribution_binning');

  return { derived, applied, skipped, flaggedForAI };
}
