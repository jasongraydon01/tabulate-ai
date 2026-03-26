import { describe, it, expect } from 'vitest';
import { parseMaxDiffLabel, formatMaxDiffDisplayLabel } from '../parseMaxDiffLabel';

describe('parseMaxDiffLabel', () => {
  describe('standard formats', () => {
    it('parses API label with alternate variant', () => {
      const result = parseMaxDiffLabel('API: I1 OR ALT I1A - Only CAPLYTA is indicated for schizo...');

      expect(result).toEqual({
        messageCode: 'I1',
        alternateCode: 'I1A',
        isAlternate: true,
        truncatedText: 'Only CAPLYTA is indicated for schizo...',
        scoreType: 'API',
        isAnchor: false,
      });
    });

    it('parses AP label without alternate', () => {
      const result = parseMaxDiffLabel('AP: D4 - In a clinical study, CAPLYTA significantly...');

      expect(result).toEqual({
        messageCode: 'D4',
        isAlternate: false,
        truncatedText: 'In a clinical study, CAPLYTA significantly...',
        scoreType: 'AP',
        isAnchor: false,
      });
    });

    it('parses AP label with alternate', () => {
      const result = parseMaxDiffLabel('AP: E1 OR ALT E1A - Significant improvement in PANSS total...');

      expect(result).toEqual({
        messageCode: 'E1',
        alternateCode: 'E1A',
        isAlternate: true,
        truncatedText: 'Significant improvement in PANSS total...',
        scoreType: 'AP',
        isAnchor: false,
      });
    });

    it('parses API label without alternate', () => {
      const result = parseMaxDiffLabel('API: S3 - Short message text');

      expect(result).toEqual({
        messageCode: 'S3',
        isAlternate: false,
        truncatedText: 'Short message text',
        scoreType: 'API',
        isAnchor: false,
      });
    });
  });

  describe('anchor detection', () => {
    it('parses API anchor label', () => {
      const result = parseMaxDiffLabel('API: Anchor');

      expect(result).toEqual({
        messageCode: 'Anchor',
        isAlternate: false,
        truncatedText: '',
        scoreType: 'API',
        isAnchor: true,
      });
    });

    it('handles anchor case-insensitively', () => {
      const result = parseMaxDiffLabel('API: ANCHOR');

      expect(result).not.toBeNull();
      expect(result!.isAnchor).toBe(true);
    });

    it('handles AP anchor', () => {
      const result = parseMaxDiffLabel('AP: Anchor');

      expect(result).not.toBeNull();
      expect(result!.isAnchor).toBe(true);
      expect(result!.scoreType).toBe('AP');
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(parseMaxDiffLabel('')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(parseMaxDiffLabel(null as unknown as string)).toBeNull();
    });

    it('returns null for non-matching format', () => {
      expect(parseMaxDiffLabel('Just a regular question label')).toBeNull();
      expect(parseMaxDiffLabel('S1: What is your specialty?')).toBeNull();
      expect(parseMaxDiffLabel('Values: 1-5')).toBeNull();
    });

    it('returns null for label with unknown prefix', () => {
      expect(parseMaxDiffLabel('XYZ: M1 - Some text')).toBeNull();
    });

    it('handles extra whitespace', () => {
      const result = parseMaxDiffLabel('  API:  I1  OR  ALT  I1A  -  Message text  ');

      expect(result).not.toBeNull();
      expect(result!.messageCode).toBe('I1');
      expect(result!.alternateCode).toBe('I1A');
    });

    it('handles label with code but no text after dash', () => {
      const result = parseMaxDiffLabel('API: M7');

      expect(result).not.toBeNull();
      expect(result!.messageCode).toBe('M7');
      expect(result!.truncatedText).toBe('');
    });
  });
});

describe('formatMaxDiffDisplayLabel', () => {
  it('formats label with alternate', () => {
    const parsed = parseMaxDiffLabel('API: I1 OR ALT I1A - Only CAPLYTA is indicated...');
    expect(formatMaxDiffDisplayLabel(parsed!)).toBe('I1 / I1A: Only CAPLYTA is indicated...');
  });

  it('formats label without alternate', () => {
    const parsed = parseMaxDiffLabel('AP: D4 - In a clinical study');
    expect(formatMaxDiffDisplayLabel(parsed!)).toBe('D4: In a clinical study');
  });

  it('formats anchor label', () => {
    const parsed = parseMaxDiffLabel('API: Anchor');
    expect(formatMaxDiffDisplayLabel(parsed!)).toBe('Anchor (reference = 100)');
  });

  it('formats code-only label (no text)', () => {
    const parsed = parseMaxDiffLabel('API: M7');
    expect(formatMaxDiffDisplayLabel(parsed!)).toBe('M7');
  });
});
