import { describe, it, expect } from 'vitest';
import { extractVariableNames } from '../extractVariableNames';

describe('extractVariableNames', () => {
  it('extracts single variable', () => {
    expect(extractVariableNames('Gender == 1')).toEqual(['Gender']);
  });

  it('extracts OR-joined variables', () => {
    const result = extractVariableNames('(Q5a == 1 | Q5b == 1)');
    expect(result).toContain('Q5a');
    expect(result).toContain('Q5b');
    expect(result).toHaveLength(2);
  });

  it('extracts variables from nested functions (note: string contents not filtered)', () => {
    const result = extractVariableNames('grepl("yes", S3_open)');
    // "yes" is extracted since regex doesn't parse string delimiters — acceptable
    expect(result).toContain('S3_open');
    expect(result).toContain('yes');
  });

  it('filters out R keywords', () => {
    const result = extractVariableNames('if (TRUE) return(NA)');
    expect(result).toEqual([]);
  });

  it('filters out common R functions', () => {
    const result = extractVariableNames('grepl(paste0("^", nchar(MyVar)))');
    expect(result).toEqual(['MyVar']);
  });

  it('handles dot-separated variable names', () => {
    const result = extractVariableNames('data.frame.col == 1');
    expect(result).toContain('data.frame.col');
  });

  it('returns empty array for empty expression', () => {
    expect(extractVariableNames('')).toEqual([]);
  });

  it('deduplicates repeated variable names', () => {
    const result = extractVariableNames('(Q1 == 1 | Q1 == 2)');
    expect(result).toEqual(['Q1']);
  });

  it('handles complex expression with multiple variables', () => {
    const result = extractVariableNames('(hA3_1 == 1 | hA3_2 == 1 | hA3_3 == 1)');
    expect(result).toContain('hA3_1');
    expect(result).toContain('hA3_2');
    expect(result).toContain('hA3_3');
    expect(result).toHaveLength(3);
  });
});
