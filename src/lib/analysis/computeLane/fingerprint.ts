import { createHash } from 'crypto';

import type { BannerGroupType } from '@/schemas/bannerPlanSchema';
import type { ValidatedGroupType } from '@/schemas/agentOutputSchema';
import type {
  AnalysisSelectedTableCutSpec,
  AnalysisTableRollupSpec,
} from '@/lib/analysis/computeLane/types';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export function buildAnalysisComputeFingerprint(params: {
  parentRunId: string;
  parentArtifactKeys: Record<string, string | null | undefined>;
  requestText: string;
  frozenBannerGroup: BannerGroupType;
  frozenValidatedGroup: ValidatedGroupType;
}): string {
  const hash = createHash('sha256');
  hash.update(stableStringify({
    parentRunId: params.parentRunId,
    parentArtifactKeys: params.parentArtifactKeys,
    requestText: params.requestText,
    frozenBannerGroup: params.frozenBannerGroup,
    frozenValidatedGroup: params.frozenValidatedGroup,
  }));
  return hash.digest('hex');
}

export function buildAnalysisTableRollupFingerprint(params: {
  parentRunId: string;
  parentArtifactKeys: Record<string, string | null | undefined>;
  requestText: string;
  frozenTableRollupSpec: AnalysisTableRollupSpec;
}): string {
  const hash = createHash('sha256');
  hash.update(stableStringify({
    parentRunId: params.parentRunId,
    parentArtifactKeys: params.parentArtifactKeys,
    requestText: params.requestText,
    frozenTableRollupSpec: params.frozenTableRollupSpec,
  }));
  return hash.digest('hex');
}

export function buildAnalysisSelectedTableCutFingerprint(params: {
  parentRunId: string;
  parentArtifactKeys: Record<string, string | null | undefined>;
  requestText: string;
  frozenSelectedTableCutSpec: AnalysisSelectedTableCutSpec;
}): string {
  const hash = createHash('sha256');
  hash.update(stableStringify({
    parentRunId: params.parentRunId,
    parentArtifactKeys: params.parentArtifactKeys,
    requestText: params.requestText,
    frozenSelectedTableCutSpec: params.frozenSelectedTableCutSpec,
  }));
  return hash.digest('hex');
}
