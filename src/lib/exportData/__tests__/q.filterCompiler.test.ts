import { describe, expect, it } from 'vitest';
import { compileQFilter } from '@/lib/exportData/q/filterCompiler';

describe('Q filter compiler', () => {
  it('compiles supported operators into filter-tree IR deterministically', () => {
    const compiled = compileQFilter("SEG %in% c('A', 'B') & GENDER == 1");

    expect(compiled.parseStatus).toBe('parsed');
    expect(compiled.loweringStrategy).toBe('direct');
    expect(compiled.reasonCodes).toEqual(['ready']);
    expect(compiled.filterTree).toEqual({
      type: 'and',
      children: [
        {
          type: 'term',
          leftRef: 'SEG',
          op: 'any_of',
          values: ['A', 'B'],
        },
        {
          type: 'term',
          leftRef: 'GENDER',
          op: 'equals',
          values: [1],
        },
      ],
    });
  });

  it('compiles unary negation and missing checks', () => {
    const compiled = compileQFilter('!is.na(Q1) | Q2 != 3');

    expect(compiled.parseStatus).toBe('parsed');
    expect(compiled.loweringStrategy).toBe('direct');
    expect(compiled.filterTree).toEqual({
      type: 'or',
      children: [
        {
          type: 'not',
          child: {
            type: 'term',
            leftRef: 'Q1',
            op: 'is_missing',
            values: [],
          },
        },
        {
          type: 'term',
          leftRef: 'Q2',
          op: 'not_equals',
          values: [3],
        },
      ],
    });
  });

  it('blocks unsupported function calls', () => {
    const compiled = compileQFilter('grepl("A", Q1)');

    expect(compiled.parseStatus).toBe('blocked');
    expect(compiled.loweringStrategy).toBe('blocked');
    expect(compiled.reasonCodes).toContain('unsupported_function_call');
  });

  it('blocks malformed numeric literals', () => {
    const compiled = compileQFilter('Q1 == 1..2');

    expect(compiled.parseStatus).toBe('blocked');
    expect(compiled.loweringStrategy).toBe('blocked');
    expect(compiled.reasonCodes).toContain('unsupported_numeric_literal');
  });

  it('compiles cross-variable comparisons as derived-comparison nodes', () => {
    const compiled = compileQFilter('Q1 == Q2', {
      dataFrameRef: 'wide',
      filterId: 'cut:Demo::Delta@wide',
    });

    expect(compiled.parseStatus).toBe('parsed');
    expect(compiled.loweringStrategy).toBe('derived_variable');
    expect(compiled.reasonCodes).toEqual(['derived_variable_lowering']);
    expect(compiled.filterTree).toMatchObject({
      type: 'derived_comparison',
      leftVar: 'Q1',
      op: '==',
      rightVar: 'Q2',
      helperVarName: expect.stringMatching(/^hawktab_cv_[a-f0-9]{16}_/),
    });
  });

  it('uses stable helper names for identical filter/expression inputs', () => {
    const first = compileQFilter('Q1 == Q2', {
      dataFrameRef: 'wide',
      filterId: 'cut:Demo::Delta@wide',
    });
    const second = compileQFilter('Q1 == Q2', {
      dataFrameRef: 'wide',
      filterId: 'cut:Demo::Delta@wide',
    });

    expect(first.parseStatus).toBe('parsed');
    expect(second.parseStatus).toBe('parsed');
    expect(first.filterTree).toEqual(second.filterTree);
  });

  it('changes helper prefix when expression fingerprint changes for same filter id', () => {
    const first = compileQFilter('Q1 == Q2', {
      dataFrameRef: 'wide',
      filterId: 'cut:Demo::Delta@wide',
    });
    const second = compileQFilter('Q1 != Q2', {
      dataFrameRef: 'wide',
      filterId: 'cut:Demo::Delta@wide',
    });

    expect(first.parseStatus).toBe('parsed');
    expect(second.parseStatus).toBe('parsed');
    expect(first.filterTree).not.toEqual(second.filterTree);
  });

  it('blocks cross-variable comparisons when compile context is missing', () => {
    const compiled = compileQFilter('Q1 == Q2');

    expect(compiled.parseStatus).toBe('blocked');
    expect(compiled.loweringStrategy).toBe('blocked');
    expect(compiled.reasonCodes).toContain('cross_variable_comparison');
  });
});
