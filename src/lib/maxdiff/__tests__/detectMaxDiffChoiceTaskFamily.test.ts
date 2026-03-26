import { describe, expect, it } from 'vitest';
import { detectMaxDiffChoiceTaskFamily } from '../detectMaxDiffChoiceTaskFamily';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';

function makeEntry(
  column: string,
  description: string,
  parentQuestion: string,
  answerOptions = '1=A;2=B;3=C;4=D;5=E;6=F;7=G;8=H',
): VerboseDataMapType {
  return {
    level: 'sub',
    column,
    description,
    valueType: 'Values: 1-8',
    answerOptions,
    parentQuestion,
    normalizedType: 'categorical_select',
  } as unknown as VerboseDataMapType;
}

describe('detectMaxDiffChoiceTaskFamily', () => {
  it('detects high-confidence choice-task family by structure', () => {
    const datamap: VerboseDataMapType[] = [
      makeEntry('X1', 'Most preferred message', 'QX'),
      makeEntry('X2', 'Least preferred message', 'QX'),
      makeEntry('X3', 'Most preferred message', 'QX'),
      makeEntry('X4', 'Least preferred message', 'QX'),
      makeEntry('X5', 'Most preferred message', 'QX'),
      makeEntry('X6', 'Least preferred message', 'QX'),
      makeEntry('X7', 'Most preferred message', 'QX'),
      makeEntry('X8', 'Least preferred message', 'QX'),
    ];

    const result = detectMaxDiffChoiceTaskFamily(datamap);
    expect(result.detected).toBe(true);
    expect(result.questionIds).toContain('QX');
    expect(result.candidates[0].confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('does not detect weak/non-paired structures', () => {
    const datamap: VerboseDataMapType[] = [
      makeEntry('A1', 'Awareness item 1', 'QA', '1=Yes;2=No'),
      makeEntry('A2', 'Awareness item 2', 'QA', '1=Yes;2=No'),
      makeEntry('A3', 'Awareness item 3', 'QA', '1=Yes;2=No'),
      makeEntry('A4', 'Awareness item 4', 'QA', '1=Yes;2=No'),
      makeEntry('A5', 'Awareness item 5', 'QA', '1=Yes;2=No'),
      makeEntry('A6', 'Awareness item 6', 'QA', '1=Yes;2=No'),
    ];

    const result = detectMaxDiffChoiceTaskFamily(datamap);
    expect(result.detected).toBe(false);
    expect(result.questionIds).toHaveLength(0);
  });
});

