import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  buildDownloadFilename,
  FILENAME_TO_VARIANT_SUFFIX,
} from '../downloadFilename';

describe('sanitizeFilename', () => {
  it('strips illegal characters', () => {
    expect(sanitizeFilename('My:Project/Name')).toBe('MyProjectName');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizeFilename('My   Project')).toBe('My Project');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizeFilename('  My Project  ')).toBe('My Project');
  });

  it('strips leading/trailing dots', () => {
    expect(sanitizeFilename('..hidden.project..')).toBe('hidden.project');
  });

  it('handles combined illegal characters', () => {
    expect(sanitizeFilename('A*B?C<D>E|F"G\\H')).toBe('ABCDEFGH');
  });

  it('returns empty string for all-illegal input', () => {
    expect(sanitizeFilename('***')).toBe('');
  });
});

describe('buildDownloadFilename', () => {
  // Fixed timestamp: 2026-02-22T12:00:00.000Z
  const ts = new Date('2026-02-22T12:00:00Z').getTime();

  it('builds the primary crosstabs filename', () => {
    expect(buildDownloadFilename('My Project', ts, 'crosstabs.xlsx')).toBe(
      'TabulateAI - My Project - 2026-02-22.xlsx',
    );
  });

  it('appends variant suffix for weighted', () => {
    expect(buildDownloadFilename('Test', ts, 'crosstabs-weighted.xlsx')).toBe(
      'TabulateAI - Test - 2026-02-22 (Weighted).xlsx',
    );
  });

  it('appends variant suffix for unweighted', () => {
    expect(buildDownloadFilename('Test', ts, 'crosstabs-unweighted.xlsx')).toBe(
      'TabulateAI - Test - 2026-02-22 (Unweighted).xlsx',
    );
  });

  it('appends variant suffix for counts', () => {
    expect(buildDownloadFilename('Test', ts, 'crosstabs-counts.xlsx')).toBe(
      'TabulateAI - Test - 2026-02-22 (Counts).xlsx',
    );
  });

  it('appends variant suffix for weighted counts', () => {
    expect(buildDownloadFilename('Test', ts, 'crosstabs-weighted-counts.xlsx')).toBe(
      'TabulateAI - Test - 2026-02-22 (Weighted Counts).xlsx',
    );
  });

  it('sanitizes project name', () => {
    expect(buildDownloadFilename('A/B:C', ts, 'crosstabs.xlsx')).toBe(
      'TabulateAI - ABC - 2026-02-22.xlsx',
    );
  });

  it('handles unknown filename gracefully (no variant suffix)', () => {
    expect(buildDownloadFilename('Test', ts, 'unknown.xlsx')).toBe(
      'TabulateAI - Test - 2026-02-22.xlsx',
    );
  });
});

describe('FILENAME_TO_VARIANT_SUFFIX', () => {
  it('has entries for all known crosstab variants', () => {
    expect(Object.keys(FILENAME_TO_VARIANT_SUFFIX)).toEqual([
      'crosstabs.xlsx',
      'crosstabs-weighted.xlsx',
      'crosstabs-unweighted.xlsx',
      'crosstabs-counts.xlsx',
      'crosstabs-weighted-counts.xlsx',
    ]);
  });

  it('primary variant has empty suffix', () => {
    expect(FILENAME_TO_VARIANT_SUFFIX['crosstabs.xlsx']).toBe('');
  });
});
