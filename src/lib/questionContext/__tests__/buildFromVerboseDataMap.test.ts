import { describe, it, expect } from 'vitest';
import { buildQuestionContextFromVerboseDataMap } from '../buildFromVerboseDataMap';
import type { VerboseDataMap } from '../../processors/DataMapProcessor';

describe('buildQuestionContextFromVerboseDataMap', () => {
  it('prefers parsed answerOptions when structured scaleLabels are truncated', () => {
    const verbose: VerboseDataMap[] = [
      {
        level: 'parent',
        parentQuestion: 'S15',
        column: 'S15',
        description: 'Which of the following best describes the IDN you are a part of?',
        valueType: 'Values: 1-3',
        answerOptions: '1=High control IDN (i.e., vaccine usage is heavily informed and managed by the IDN),2=Medium control IDN (i.e., my IDN has some influence in deciding which vaccines HCPs can administer),3=Low control IDN (i.e., HCPs or individual practices are able to freely choose vaccines with few IDN formulary restrictions)',
        context: '',
        normalizedType: 'categorical_select',
        allowedValues: [1, 2, 3],
        scaleLabels: [
          { value: 1, label: 'High control IDN (i.e.' },
          { value: 2, label: 'Medium control IDN (i.e.' },
          { value: 3, label: 'Low control IDN (i.e.' },
        ],
      },
    ];

    const result = buildQuestionContextFromVerboseDataMap(verbose);
    expect(result[0].items[0].valueLabels).toEqual([
      { value: 1, label: 'High control IDN (i.e., vaccine usage is heavily informed and managed by the IDN)' },
      { value: 2, label: 'Medium control IDN (i.e., my IDN has some influence in deciding which vaccines HCPs can administer)' },
      { value: 3, label: 'Low control IDN (i.e., HCPs or individual practices are able to freely choose vaccines with few IDN formulary restrictions)' },
    ]);
  });

  it('keeps structured scaleLabels when they are already higher quality', () => {
    const verbose: VerboseDataMap[] = [
      {
        level: 'parent',
        parentQuestion: 'Q1',
        column: 'Q1',
        description: 'How likely are you to recommend?',
        valueType: 'Values: 1-5',
        answerOptions: '1=1,2=2,3=3,4=4,5=5',
        context: '',
        normalizedType: 'categorical_select',
        allowedValues: [1, 2, 3, 4, 5],
        scaleLabels: [
          { value: 1, label: 'Very unlikely' },
          { value: 2, label: 'Somewhat unlikely' },
          { value: 3, label: 'Neutral' },
          { value: 4, label: 'Somewhat likely' },
          { value: 5, label: 'Very likely' },
        ],
      },
    ];

    const result = buildQuestionContextFromVerboseDataMap(verbose);
    expect(result[0].items[0].valueLabels).toEqual([
      { value: 1, label: 'Very unlikely' },
      { value: 2, label: 'Somewhat unlikely' },
      { value: 3, label: 'Neutral' },
      { value: 4, label: 'Somewhat likely' },
      { value: 5, label: 'Very likely' },
    ]);
  });
});
