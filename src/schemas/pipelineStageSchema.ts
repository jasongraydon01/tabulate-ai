import { v, type Validator } from 'convex/values';

export const V3_PIPELINE_STAGES = [
  'uploading',
  'parsing',
  'v3_enrichment',
  'v3_fork_join',
  'review_check',
  'crosstab_review_required',
  'applying_review',
  'loading_v3_artifacts',
  'loop_semantics',
  'v3_compute',
  'compute',
  'executing_r',
  'finalizing_tables',
  'contract_build',
  'r2_finalize',
  'complete',
  'error',
  'cancelled',
] as const;

export type V3PipelineStage = (typeof V3_PIPELINE_STAGES)[number];

const V3_PIPELINE_STAGE_SET = new Set<string>(V3_PIPELINE_STAGES);

export function isV3PipelineStage(value: string): value is V3PipelineStage {
  return V3_PIPELINE_STAGE_SET.has(value);
}

export const v3PipelineStageValidator = v.union(
  ...(V3_PIPELINE_STAGES.map((stage) => v.literal(stage)) as [
    Validator<V3PipelineStage>,
    Validator<V3PipelineStage>,
    ...Validator<V3PipelineStage>[],
  ]),
);
