import { describe, expect, it } from 'vitest';
import {
  V3_PIPELINE_STAGES,
  isV3PipelineStage,
} from '../pipelineStageSchema';

describe('pipelineStageSchema', () => {
  it('exports the canonical V3 stage inventory', () => {
    expect(V3_PIPELINE_STAGES).toEqual([
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
      'contract_build',
      'r2_finalize',
      'complete',
      'error',
      'cancelled',
    ]);
  });

  it('accepts valid stages and rejects unaudited values', () => {
    expect(isV3PipelineStage('loading_v3_artifacts')).toBe(true);
    expect(isV3PipelineStage('serialize')).toBe(false);
    expect(isV3PipelineStage('waiting_for_tables')).toBe(false);
  });
});
