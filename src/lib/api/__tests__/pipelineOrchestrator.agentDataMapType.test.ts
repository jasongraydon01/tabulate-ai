import { describe, expect, it } from 'vitest';
import { buildAgentDataMapForCrosstab } from '@/lib/api/buildAgentDataMapForCrosstab';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';

function makeVerbose(column: string, normalizedType?: string): VerboseDataMapType {
  return {
    level: 'parent',
    column,
    description: `${column} description`,
    valueType: 'Nominal',
    answerOptions: '1=Yes,2=No',
    parentQuestion: 'NA',
    normalizedType: normalizedType as VerboseDataMapType['normalizedType'],
  };
}

describe('pipelineOrchestrator agentDataMap Type mapping', () => {
  it('includes Type from verbose normalizedType', () => {
    const agentRows = [
      { Column: 'Q1', Description: 'Question 1', Answer_Options: '1=Yes,2=No' },
    ];
    const verbose = [makeVerbose('Q1', 'categorical_select')];

    const result = buildAgentDataMapForCrosstab(agentRows, verbose);
    expect(result[0].Type).toBe('categorical_select');
  });

  it('falls back to empty Type when not found', () => {
    const agentRows = [
      { Column: 'QX', Description: 'Question X', Answer_Options: '1=Yes,2=No' },
    ];
    const verbose = [makeVerbose('Q1', 'categorical_select')];

    const result = buildAgentDataMapForCrosstab(agentRows, verbose);
    expect(result[0].Type).toBe('');
  });
});
