import { describe, it, expect } from 'vitest';
import { DataMapProcessor, inferParentFromSubVariable } from '../DataMapProcessor';
import { makeRawVariable } from '../../__tests__/fixtures';
import type { RawDataMapVariable } from '../DataMapProcessor';

describe('DataMapProcessor', () => {
  const processor = new DataMapProcessor();

  describe('parent inference', () => {
    it('exports inferParentFromSubVariable for reuse', () => {
      expect(inferParentFromSubVariable('S8r1')).toBe('S8');
      expect(inferParentFromSubVariable('A3DKr99c1')).toBe('A3DK');
      expect(inferParentFromSubVariable('Q1')).toBe('NA');
    });

    it('infers parent S8 from S8r1', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'S8', level: 'parent', description: 'Question S8' }),
        makeRawVariable({ column: 'S8r1', level: 'sub', description: 'Row 1' }),
      ];
      const result = processor.enrichVariables(vars);
      const sub = result.verbose.find(v => v.column === 'S8r1');
      expect(sub?.parentQuestion).toBe('S8');
    });

    it('infers parent S8 from S8r1c2', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'S8', level: 'parent' }),
        makeRawVariable({ column: 'S8r1c2', level: 'sub' }),
      ];
      const result = processor.enrichVariables(vars);
      expect(result.verbose.find(v => v.column === 'S8r1c2')?.parentQuestion).toBe('S8');
    });

    it('infers parent A4 from A4c1', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'A4', level: 'parent' }),
        makeRawVariable({ column: 'A4c1', level: 'sub' }),
      ];
      const result = processor.enrichVariables(vars);
      expect(result.verbose.find(v => v.column === 'A4c1')?.parentQuestion).toBe('A4');
    });

    it('infers parent S2 from S2r98oe', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'S2', level: 'parent' }),
        makeRawVariable({ column: 'S2r98oe', level: 'sub' }),
      ];
      const result = processor.enrichVariables(vars);
      expect(result.verbose.find(v => v.column === 'S2r98oe')?.parentQuestion).toBe('S2');
    });

    it('infers parent A3DK from A3DKr99c1', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'A3DK', level: 'parent' }),
        makeRawVariable({ column: 'A3DKr99c1', level: 'sub' }),
      ];
      const result = processor.enrichVariables(vars);
      expect(result.verbose.find(v => v.column === 'A3DKr99c1')?.parentQuestion).toBe('A3DK');
    });

    it('infers parent C3_1 from C3_1r15', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'C3_1', level: 'parent' }),
        makeRawVariable({ column: 'C3_1r15', level: 'sub' }),
      ];
      const result = processor.enrichVariables(vars);
      expect(result.verbose.find(v => v.column === 'C3_1r15')?.parentQuestion).toBe('C3_1');
    });
  });

  describe('parent context', () => {
    it('adds parent context to sub-variables', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'S8', level: 'parent', description: 'Question about awareness' }),
        makeRawVariable({ column: 'S8r1', level: 'sub', description: 'Brand A' }),
      ];
      const result = processor.enrichVariables(vars);
      const sub = result.verbose.find(v => v.column === 'S8r1');
      expect(sub?.context).toBe('S8: Question about awareness');
    });
  });

  describe('type normalization', () => {
    it('classifies admin fields', () => {
      const adminColumns = ['record', 'uuid', 'date', 'status'];
      for (const col of adminColumns) {
        const vars = [makeRawVariable({ column: col, level: 'parent', answerOptions: 'NA' })];
        const result = processor.enrichVariables(vars);
        expect(result.verbose[0].normalizedType).toBe('admin');
      }
    });

    it('classifies h-prefixed columns as admin (without value labels)', () => {
      const vars = [makeRawVariable({ column: 'hRESPONDENT', level: 'parent', answerOptions: 'NA' })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].normalizedType).toBe('admin');
    });

    it('rescues h-prefixed columns with value labels', () => {
      const vars = [makeRawVariable({ column: 'hREGION', level: 'parent', answerOptions: '1=Northeast,2=South' })];
      const result = processor.enrichVariables(vars);
      // Should NOT be classified as admin — it has value labels
      expect(result.verbose[0].normalizedType).not.toBe('admin');
    });

    it('classifies binary flag (0=Unchecked,1=Checked)', () => {
      const vars = [makeRawVariable({
        column: 'Q3r1',
        level: 'sub',
        answerOptions: '0=Unchecked,1=Checked',
      })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].normalizedType).toBe('binary_flag');
    });

    it('classifies categorical_select with labeled options', () => {
      const vars = [makeRawVariable({
        column: 'Q1',
        level: 'parent',
        answerOptions: '1=Yes,2=No,3=Maybe',
      })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].normalizedType).toBe('categorical_select');
    });

    it('classifies text_open', () => {
      const vars = [makeRawVariable({
        column: 'Q5',
        level: 'parent',
        valueType: 'open text',
        answerOptions: 'NA',
      })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].normalizedType).toBe('text_open');
    });
  });

  describe('scale label parsing', () => {
    it('parses scale labels from answer options', () => {
      const vars = [makeRawVariable({
        column: 'Q1',
        level: 'parent',
        answerOptions: '1=Strongly Agree,2=Agree,3=Neutral',
      })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].scaleLabels).toEqual([
        { value: 1, label: 'Strongly Agree' },
        { value: 2, label: 'Agree' },
        { value: 3, label: 'Neutral' },
      ]);
    });

    it('preserves commas inside answer option labels', () => {
      const vars = [makeRawVariable({
        column: 'S15',
        level: 'parent',
        answerOptions: '1=High control IDN (i.e., vaccine usage is heavily informed and managed by the IDN),2=Medium control IDN (i.e., my IDN has some influence in deciding which vaccines HCPs can administer),3=Low control IDN (i.e., HCPs or individual practices are able to freely choose vaccines with few IDN formulary restrictions)',
      })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].scaleLabels).toEqual([
        { value: 1, label: 'High control IDN (i.e., vaccine usage is heavily informed and managed by the IDN)' },
        { value: 2, label: 'Medium control IDN (i.e., my IDN has some influence in deciding which vaccines HCPs can administer)' },
        { value: 3, label: 'Low control IDN (i.e., HCPs or individual practices are able to freely choose vaccines with few IDN formulary restrictions)' },
      ]);
    });
  });

  describe('allowedValues extraction', () => {
    it('extracts numeric values from answer options', () => {
      const vars = [makeRawVariable({
        column: 'Q1',
        level: 'parent',
        answerOptions: '1=Yes,2=No,3=Maybe',
      })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].allowedValues).toEqual([1, 2, 3]);
    });
  });

  describe('dependency detection', () => {
    it('detects "Of those" pattern as dependency', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'A1', level: 'parent', description: 'Overall usage' }),
        makeRawVariable({ column: 'A2', level: 'parent', description: 'Of those who use the product, which do they prefer?' }),
      ];
      const result = processor.enrichVariables(vars);
      const a2 = result.verbose.find(v => v.column === 'A2');
      expect(a2?.dependentOn).toBe('A1');
    });
  });

  describe('dual output generation', () => {
    it('verbose output contains enrichment fields', () => {
      const vars = [makeRawVariable({
        column: 'Q1',
        level: 'parent',
        answerOptions: '1=Yes,2=No',
      })];
      const result = processor.enrichVariables(vars);
      expect(result.verbose[0].normalizedType).toBeDefined();
      expect(result.verbose[0].allowedValues).toBeDefined();
      expect(result.verbose[0].scaleLabels).toBeDefined();
    });

    it('agent output contains only essential fields', () => {
      const vars = [makeRawVariable({
        column: 'Q1',
        level: 'parent',
        description: 'Test question',
        answerOptions: '1=Yes,2=No',
      })];
      const result = processor.enrichVariables(vars);
      const agent = result.agent[0];
      expect(agent.Column).toBe('Q1');
      expect(agent.Description).toBe('Test question');
      expect(agent.Answer_Options).toBe('1=Yes,2=No');
      // ParentQuestion should not be set for parent variables
      expect(agent.ParentQuestion).toBeUndefined();
    });
  });

  describe('full pipeline', () => {
    it('classifies all types correctly for a realistic variable set', () => {
      const vars: RawDataMapVariable[] = [
        makeRawVariable({ column: 'record', level: 'parent', answerOptions: 'NA', valueType: 'numeric' }),
        makeRawVariable({ column: 'Q1', level: 'parent', answerOptions: '1=Yes,2=No' }),
        makeRawVariable({ column: 'Q2', level: 'parent', answerOptions: '0=Unchecked,1=Checked' }),
        makeRawVariable({ column: 'Q3', level: 'parent', valueType: 'open text', answerOptions: 'NA' }),
        makeRawVariable({ column: 'Q4', level: 'parent', description: 'Age in years', answerOptions: 'NA' }),
      ];
      const result = processor.enrichVariables(vars);
      expect(result.verbose.find(v => v.column === 'record')?.normalizedType).toBe('admin');
      expect(result.verbose.find(v => v.column === 'Q1')?.normalizedType).toBe('categorical_select');
      expect(result.verbose.find(v => v.column === 'Q2')?.normalizedType).toBe('binary_flag');
      expect(result.verbose.find(v => v.column === 'Q3')?.normalizedType).toBe('text_open');
      // Q4 has no answer options and no range set — normalizedType may be undefined
    });
  });
});
