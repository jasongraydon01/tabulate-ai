import { describe, it, expect } from 'vitest';
import {
  detectMaxDiffFamilies,
  DECIPHER_MAXDIFF_PATTERNS,
  type MaxDiffFamilyPattern,
} from '../detectMaxDiffFamilies';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal datamap entry */
function entry(column: string, description: string = '') {
  return { column, description };
}

/** Generate a numbered family of entries */
function generateFamily(prefix: string, count: number, descPrefix: string = '') {
  return Array.from({ length: count }, (_, i) => {
    const num = i + 1;
    return entry(`${prefix}_${num}`, `${descPrefix}: Message ${num}`);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('detectMaxDiffFamilies', () => {
  describe('basic detection', () => {
    it('detects all Decipher MaxDiff families from a mixed datamap', () => {
      const datamap = [
        // Standard survey variables (should be ignored)
        entry('S1', 'What is your specialty?'),
        entry('S2', 'Years of experience'),
        entry('A1r1', 'Brand awareness - Brand A'),
        entry('A1r2', 'Brand awareness - Brand B'),
        // MaxDiff score families
        ...generateFamily('AnchProbInd', 5, 'API'),
        ...generateFamily('AnchProb', 5, 'AP'),
        ...generateFamily('SharPref', 5, 'SharPref'),
        // Raw internals
        ...generateFamily('RawUt', 5, 'RawUt'),
        ...generateFamily('RawExp', 5, 'RawExp'),
      ];

      const result = detectMaxDiffFamilies(datamap);

      expect(result.detected).toBe(true);
      expect(result.families).toHaveLength(5);

      // Check publishable families
      const api = result.families.find(f => f.name === 'AnchProbInd');
      expect(api).toBeDefined();
      expect(api!.publishable).toBe(true);
      expect(api!.defaultEnabled).toBe(true);
      expect(api!.variableCount).toBe(5);
      expect(api!.displayName).toBe('API Scores');

      const ap = result.families.find(f => f.name === 'AnchProb');
      expect(ap).toBeDefined();
      expect(ap!.publishable).toBe(true);
      expect(ap!.defaultEnabled).toBe(false);

      const sharPref = result.families.find(f => f.name === 'SharPref');
      expect(sharPref).toBeDefined();
      expect(sharPref!.publishable).toBe(true);

      // Raw families are non-publishable
      const rawUt = result.families.find(f => f.name === 'RawUt');
      expect(rawUt).toBeDefined();
      expect(rawUt!.publishable).toBe(false);

      const rawExp = result.families.find(f => f.name === 'RawExp');
      expect(rawExp).toBeDefined();
      expect(rawExp!.publishable).toBe(false);
    });

    it('returns only publishable families in questionIdsToAllow', () => {
      const datamap = [
        ...generateFamily('AnchProbInd', 3, 'API'),
        ...generateFamily('AnchProb', 3, 'AP'),
        ...generateFamily('RawUt', 3, 'Raw'),
      ];

      const result = detectMaxDiffFamilies(datamap);

      expect(result.questionIdsToAllow).toEqual(
        expect.arrayContaining(['AnchProbInd', 'AnchProb'])
      );
      expect(result.questionIdsToAllow).not.toContain('RawUt');
    });
  });

  describe('anchor detection', () => {
    it('detects anchor variable by label content', () => {
      const datamap = [
        entry('AnchProbInd_1', 'API: M1 - First message text'),
        entry('AnchProbInd_2', 'API: M2 - Second message text'),
        entry('AnchProbInd_3', 'API: Anchor'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');

      expect(api).toBeDefined();
      expect(api!.anchorVariable).toBe('AnchProbInd_3');
    });

    it('handles anchor label case-insensitively', () => {
      const datamap = [
        entry('AnchProbInd_1', 'API: M1 - Text'),
        entry('AnchProbInd_2', 'API: ANCHOR'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');
      expect(api!.anchorVariable).toBe('AnchProbInd_2');
    });

    it('does not flag non-anchor variables', () => {
      const datamap = [
        entry('AnchProbInd_1', 'API: M1 - Message about anchoring strategy'),
        entry('AnchProbInd_2', 'API: M2 - Another message'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');
      expect(api!.anchorVariable).toBeUndefined();
    });

    it('rejects false positive: description mentions "anchor" in running text', () => {
      const datamap = [
        entry('AnchProbInd_1', 'This message is about an anchor tenant in the building'),
        entry('AnchProbInd_2', 'API: M2 - Another message'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');
      // "anchor tenant" is running text, not the anchor reference point
      expect(api!.anchorVariable).toBeUndefined();
    });

    it('detects anchor via parseMaxDiffLabel (structured detection)', () => {
      const datamap = [
        entry('AnchProbInd_1', 'API: M1 - First message'),
        entry('AnchProbInd_2', 'API: Anchor'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');
      expect(api!.anchorVariable).toBe('AnchProbInd_2');
    });

    it('detects anchor via exact match fallback (no AP/API prefix)', () => {
      const datamap = [
        entry('AnchProbInd_1', 'Some message'),
        entry('AnchProbInd_2', 'Anchor'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');
      expect(api!.anchorVariable).toBe('AnchProbInd_2');
    });

    it('detects anchor with parenthetical note', () => {
      const datamap = [
        entry('AnchProbInd_1', 'Some message'),
        entry('AnchProbInd_2', 'Anchor (reference = 100)'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');
      expect(api!.anchorVariable).toBe('AnchProbInd_2');
    });
  });

  describe('sorting', () => {
    it('sorts variables by numeric suffix', () => {
      const datamap = [
        entry('AnchProbInd_10', 'API: M10'),
        entry('AnchProbInd_2', 'API: M2'),
        entry('AnchProbInd_1', 'API: M1'),
        entry('AnchProbInd_20', 'API: M20'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const api = result.families.find(f => f.name === 'AnchProbInd');

      expect(api!.variables).toEqual([
        'AnchProbInd_1',
        'AnchProbInd_2',
        'AnchProbInd_10',
        'AnchProbInd_20',
      ]);
    });

    it('sorts families: defaultEnabled first, then publishable, then non-publishable', () => {
      const datamap = [
        ...generateFamily('RawExp', 2, 'Raw'),
        ...generateFamily('AnchProb', 2, 'AP'),
        ...generateFamily('AnchProbInd', 2, 'API'),
        ...generateFamily('SharPref', 2, 'SP'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      const names = result.families.map(f => f.name);

      // AnchProbInd is the only defaultEnabled=true
      expect(names[0]).toBe('AnchProbInd');
      // Non-publishable should be last
      expect(names[names.length - 1]).toBe('RawExp');
    });
  });

  describe('edge cases', () => {
    it('returns empty result for datamap with no MaxDiff variables', () => {
      const datamap = [
        entry('S1', 'Screener question'),
        entry('Q1', 'Main question'),
        entry('D1', 'Demographics'),
      ];

      const result = detectMaxDiffFamilies(datamap);

      expect(result.detected).toBe(false);
      expect(result.families).toHaveLength(0);
      expect(result.questionIdsToAllow).toHaveLength(0);
    });

    it('returns empty result for empty datamap', () => {
      const result = detectMaxDiffFamilies([]);

      expect(result.detected).toBe(false);
      expect(result.families).toHaveLength(0);
    });

    it('ignores variables that look similar but do not match patterns', () => {
      const datamap = [
        entry('AnchProbIndex_1', 'Not a match'), // Extra "ex"
        entry('AnchProb1', 'No underscore'),
        entry('xAnchProbInd_1', 'Prefix'),
        entry('SharPref', 'No suffix'),
        entry('RawUt_', 'No number'),
      ];

      const result = detectMaxDiffFamilies(datamap);
      expect(result.detected).toBe(false);
    });

    it('handles a single variable in a family', () => {
      const datamap = [entry('AnchProbInd_1', 'API: Only one')];

      const result = detectMaxDiffFamilies(datamap);
      expect(result.detected).toBe(true);
      expect(result.families[0].variableCount).toBe(1);
    });
  });

  describe('additional patterns', () => {
    it('supports custom patterns via additionalPatterns parameter', () => {
      const customPattern: MaxDiffFamilyPattern = {
        pattern: /^MDScore_\d+$/,
        family: 'MDScore',
        publishable: true,
        defaultEnabled: true,
        displayName: 'MaxDiff Scores',
      };

      const datamap = [
        entry('MDScore_1', 'Custom score 1'),
        entry('MDScore_2', 'Custom score 2'),
      ];

      const result = detectMaxDiffFamilies(datamap, [customPattern]);

      expect(result.detected).toBe(true);
      const md = result.families.find(f => f.name === 'MDScore');
      expect(md).toBeDefined();
      expect(md!.variableCount).toBe(2);
      expect(result.questionIdsToAllow).toContain('MDScore');
    });
  });

  describe('default patterns constant', () => {
    it('exports the default Decipher patterns', () => {
      expect(DECIPHER_MAXDIFF_PATTERNS).toHaveLength(5);
      const familyNames = DECIPHER_MAXDIFF_PATTERNS.map(p => p.family);
      expect(familyNames).toEqual(['AnchProbInd', 'AnchProb', 'SharPref', 'RawUt', 'RawExp']);
    });
  });
});
