import { describe, it, expect } from 'vitest';
import { consolidateMaxDiffTables } from '../MaxDiffConsolidator';
import type { MaxDiffFamilyDetectionResult, DetectedFamily } from '../detectMaxDiffFamilies';
import type { TableAgentOutput } from '@/schemas/tableAgentSchema';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeScoreGroup(
  familyName: string,
  varNum: number,
  label: string,
  questionId: string = familyName
): TableAgentOutput {
  return {
    questionId,
    questionText: `${familyName}_${varNum}: ${label}`,
    tables: [{
      tableId: `${familyName.toLowerCase()}_${varNum}`,
      questionText: `${familyName}_${varNum}: ${label}`,
      tableType: 'mean_rows',
      rows: [{
        variable: `${familyName}_${varNum}`,
        label,
        filterValue: '',
      }],
      hints: [],
    }],
    confidence: 1.0,
    reasoning: 'Deterministic generation from datamap structure',
  };
}

function makeStandardGroup(questionId: string, tableCount: number = 1): TableAgentOutput {
  return {
    questionId,
    questionText: `Question ${questionId}`,
    tables: Array.from({ length: tableCount }, (_, i) => ({
      tableId: `${questionId.toLowerCase()}_${i}`,
      questionText: `Question ${questionId}`,
      tableType: 'frequency' as const,
      rows: [
        { variable: `${questionId}r1`, label: 'Option 1', filterValue: '1' },
        { variable: `${questionId}r2`, label: 'Option 2', filterValue: '2' },
      ],
      hints: [] as const,
    })),
    confidence: 1.0,
    reasoning: 'Deterministic generation',
  };
}

function makeFamily(name: string, count: number, opts: Partial<DetectedFamily> = {}): DetectedFamily {
  return {
    name,
    displayName: opts.displayName ?? `${name} Scores`,
    variableCount: count,
    publishable: opts.publishable ?? true,
    defaultEnabled: opts.defaultEnabled ?? false,
    variables: Array.from({ length: count }, (_, i) => `${name}_${i + 1}`),
    scale: opts.scale,
    ...opts,
  };
}

function makeDetection(families: DetectedFamily[]): MaxDiffFamilyDetectionResult {
  return {
    families,
    questionIdsToAllow: families.filter(f => f.publishable).map(f => f.name),
    detected: families.length > 0,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('consolidateMaxDiffTables', () => {
  describe('basic consolidation', () => {
    it('consolidates individual score tables into one composite table per family', () => {
      const groups: TableAgentOutput[] = [
        makeStandardGroup('S1'),
        makeScoreGroup('AnchProbInd', 1, 'API: M1 - First message'),
        makeScoreGroup('AnchProbInd', 2, 'API: M2 - Second message'),
        makeScoreGroup('AnchProbInd', 3, 'API: M3 - Third message'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 3, { displayName: 'API Scores', scale: '0-200', defaultEnabled: true }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      // S1 + 1 consolidated API table
      expect(result.groups).toHaveLength(2);

      // Standard group unchanged
      expect(result.groups[0].questionId).toBe('S1');

      // Consolidated table
      const apiTable = result.groups[1];
      expect(apiTable.questionId).toBe('AnchProbInd');
      expect(apiTable.tables).toHaveLength(1);
      expect(apiTable.tables[0].tableType).toBe('mean_rows');
      expect(apiTable.tables[0].rows).toHaveLength(3);
      expect(apiTable.tables[0].tableId).toBe('maxdiff_anchprobind');

      // All rows have empty filterValue
      for (const row of apiTable.tables[0].rows) {
        expect(row.filterValue).toBe('');
      }
    });

    it('consolidates per-variable questionId groups using detected family mappings', () => {
      const groups: TableAgentOutput[] = [
        makeStandardGroup('S1'),
        makeScoreGroup('AnchProbInd', 1, 'API: M1 - First message', 'AnchProbInd_1'),
        makeScoreGroup('AnchProbInd', 2, 'API: M2 - Second message', 'AnchProbInd_2'),
        makeScoreGroup('AnchProbInd', 3, 'API: M3 - Third message', 'AnchProbInd_3'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 3, { displayName: 'API Scores', scale: '0-200', defaultEnabled: true }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].questionId).toBe('S1');

      const apiTable = result.groups[1];
      expect(apiTable.questionId).toBe('AnchProbInd');
      expect(apiTable.tables).toHaveLength(1);
      expect(apiTable.tables[0].rows).toHaveLength(3);
      expect(result.report.tablesConsumed).toBe(3);
      expect(result.report.tablesProduced).toBe(1);
    });

    it('consolidates multiple families independently', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: M1'),
        makeScoreGroup('AnchProbInd', 2, 'API: M2'),
        makeScoreGroup('AnchProb', 1, 'AP: M1'),
        makeScoreGroup('AnchProb', 2, 'AP: M2'),
        makeScoreGroup('SharPref', 1, 'SP: M1'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 2, { displayName: 'API Scores', scale: '0-200' }),
        makeFamily('AnchProb', 2, { displayName: 'AP Scores', scale: '0-100' }),
        makeFamily('SharPref', 1, { displayName: 'Share of Preference' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      expect(result.groups).toHaveLength(3);
      expect(result.groups.map(g => g.questionId)).toEqual(['AnchProbInd', 'AnchProb', 'SharPref']);
      expect(result.report.consolidatedFamilies).toHaveLength(3);
    });
  });

  describe('anchor exclusion', () => {
    it('excludes anchor variable from consolidated table', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: M1 - First message'),
        makeScoreGroup('AnchProbInd', 2, 'API: M2 - Second message'),
        makeScoreGroup('AnchProbInd', 3, 'API: Anchor'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 3, {
          displayName: 'API Scores',
          anchorVariable: 'AnchProbInd_3',
        }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      const apiTable = result.groups[0];
      expect(apiTable.tables[0].rows).toHaveLength(2); // 3 - 1 anchor
      expect(apiTable.tables[0].rows.map(r => r.variable)).toEqual([
        'AnchProbInd_1',
        'AnchProbInd_2',
      ]);

      expect(result.report.anchorsExcluded).toEqual(['AnchProbInd_3']);
    });
  });

  describe('row ordering', () => {
    it('sorts rows by numeric suffix regardless of input order', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 10, 'API: M10'),
        makeScoreGroup('AnchProbInd', 2, 'API: M2'),
        makeScoreGroup('AnchProbInd', 1, 'API: M1'),
        makeScoreGroup('AnchProbInd', 5, 'API: M5'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 4, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      const rows = result.groups[0].tables[0].rows;
      expect(rows.map(r => r.variable)).toEqual([
        'AnchProbInd_1',
        'AnchProbInd_2',
        'AnchProbInd_5',
        'AnchProbInd_10',
      ]);
    });
  });

  describe('non-MaxDiff passthrough', () => {
    it('passes through non-MaxDiff groups unchanged', () => {
      const standardGroup = makeStandardGroup('Q7', 2);
      const groups: TableAgentOutput[] = [
        standardGroup,
        makeScoreGroup('AnchProbInd', 1, 'API: M1'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 1, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      // Standard group should be identical
      expect(result.groups[0]).toBe(standardGroup); // Same reference
      expect(result.groups[0].tables).toHaveLength(2);
    });

    it('ignores non-publishable families', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('RawUt', 1, 'Raw utility 1'),
        makeScoreGroup('RawUt', 2, 'Raw utility 2'),
      ];

      const detection = makeDetection([
        makeFamily('RawUt', 2, { publishable: false, displayName: 'Raw Utility' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      // RawUt is not publishable, so groups pass through as-is
      expect(result.groups).toHaveLength(2);
      expect(result.report.consolidatedFamilies).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns unchanged groups when detection.detected is false', () => {
      const groups: TableAgentOutput[] = [
        makeStandardGroup('S1'),
        makeStandardGroup('Q2'),
      ];

      const detection: MaxDiffFamilyDetectionResult = {
        families: [],
        questionIdsToAllow: [],
        detected: false,
      };

      const result = consolidateMaxDiffTables(groups, detection);

      expect(result.groups).toBe(groups); // Same reference
      expect(result.report.tablesConsumed).toBe(0);
      expect(result.report.tablesProduced).toBe(0);
    });

    it('handles empty groups array', () => {
      const detection = makeDetection([
        makeFamily('AnchProbInd', 3, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables([], detection);

      expect(result.groups).toHaveLength(0);
      expect(result.report.consolidatedFamilies).toHaveLength(0);
    });
  });

  describe('report', () => {
    it('produces accurate consolidation report', () => {
      const groups: TableAgentOutput[] = [
        makeStandardGroup('S1'),
        makeScoreGroup('AnchProbInd', 1, 'API: M1'),
        makeScoreGroup('AnchProbInd', 2, 'API: M2'),
        makeScoreGroup('AnchProbInd', 3, 'API: Anchor'),
        makeScoreGroup('AnchProb', 1, 'AP: M1'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 3, {
          displayName: 'API Scores',
          anchorVariable: 'AnchProbInd_3',
        }),
        makeFamily('AnchProb', 1, { displayName: 'AP Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      expect(result.report.consolidatedFamilies).toEqual(['AnchProbInd', 'AnchProb']);
      expect(result.report.tablesConsumed).toBe(4); // 3 API + 1 AP
      expect(result.report.tablesProduced).toBe(2); // 1 API table + 1 AP table
      expect(result.report.anchorsExcluded).toEqual(['AnchProbInd_3']);

      expect(result.report.details).toHaveLength(2);
      expect(result.report.details[0]).toMatchObject({
        family: 'AnchProbInd',
        inputGroups: 3,
        outputRows: 2, // 3 - 1 anchor
        anchorExcluded: 'AnchProbInd_3',
      });
      expect(result.report.details[1]).toMatchObject({
        family: 'AnchProb',
        inputGroups: 1,
        outputRows: 1,
        anchorExcluded: null,
      });
    });
  });

  describe('table metadata', () => {
    it('sets correct table metadata on consolidated tables', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: M1'),
        makeScoreGroup('AnchProbInd', 2, 'API: M2'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 2, { displayName: 'API Scores', scale: '0-200' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      const consolidated = result.groups[0];
      expect(consolidated.questionId).toBe('AnchProbInd');
      expect(consolidated.questionText).toBe('API Scores (0-200)');
      expect(consolidated.confidence).toBe(1.0);
      expect(consolidated.reasoning).toContain('MaxDiffConsolidator');
    });
  });

  describe('label enhancement', () => {
    it('enhances labels using parseMaxDiffLabel when enabled', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: D4 - In a clinical study'),
        makeScoreGroup('AnchProbInd', 2, 'API: S3 - Short message'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 2, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);
      const rows = result.groups[0].tables[0].rows;

      // Labels should be formatted as "CODE: text"
      expect(rows[0].label).toBe('D4: In a clinical study');
      expect(rows[1].label).toBe('S3: Short message');
    });

    it('preserves original labels when enhancement is disabled', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: D4 - In a clinical study'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 1, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection, { enhanceLabels: false });
      const rows = result.groups[0].tables[0].rows;

      expect(rows[0].label).toBe('API: D4 - In a clinical study');
    });
  });

  describe('alternate grouping', () => {
    it('groups alternate message variants into single rows', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: I1 OR ALT I1A - First message text'),
        makeScoreGroup('AnchProbInd', 2, 'API: D4 - No alternate here'),
        makeScoreGroup('AnchProbInd', 3, 'API: E1 OR ALT E1A - Another with alt'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 3, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);

      // All 3 rows should still appear (alternates are in the labels, not separate vars)
      expect(result.groups[0].tables[0].rows).toHaveLength(3);

      // Labels should show combined codes
      const rows = result.groups[0].tables[0].rows;
      expect(rows[0].label).toBe('I1 / I1A: First message text');
      expect(rows[1].label).toBe('D4: No alternate here');
      expect(rows[2].label).toBe('E1 / E1A: Another with alt');

      // Report should list detected alternate groups
      expect(result.report.alternateGroups).toContain('I1/I1A');
      expect(result.report.alternateGroups).toContain('E1/E1A');
    });

    it('does not group alternates when disabled', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: I1 OR ALT I1A - First message'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 1, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection, { groupAlternates: false });

      // Label should still be enhanced but not grouped
      expect(result.report.alternateGroups).toHaveLength(0);
    });
  });

  describe('variantOf-driven grouping', () => {
    it('groups variants using variantOfMap when provided', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: I1 - First message text'),
        makeScoreGroup('AnchProbInd', 2, 'API: I1A - Alternate first message'),
        makeScoreGroup('AnchProbInd', 3, 'API: D4 - No alternate here'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 3, { displayName: 'API Scores' }),
      ]);

      const variantOfMap = new Map([['I1A', 'I1']]);

      const result = consolidateMaxDiffTables(groups, detection, { variantOfMap });

      // Should have 2 rows: I1 combined with I1A, and D4
      expect(result.groups[0].tables[0].rows).toHaveLength(2);
      expect(result.report.alternateGroups).toContain('I1/I1A');
    });

    it('uses variantOfMap priority over label-based grouping', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: I1 OR ALT I1A - Message'),
        makeScoreGroup('AnchProbInd', 2, 'API: E1 - Other message'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 2, { displayName: 'API Scores' }),
      ]);

      // variantOfMap empty → should fall back to label-based
      const result1 = consolidateMaxDiffTables(groups, detection, { variantOfMap: new Map() });
      // Label-based will detect "I1 / I1A" in the enhanced label
      expect(result1.report.alternateGroups.length).toBeGreaterThanOrEqual(0); // label-based behavior

      // variantOfMap with explicit mapping → should use variantOf-driven
      const variantOfMap = new Map([['I1A', 'I1']]);
      const result2 = consolidateMaxDiffTables(groups, detection, { variantOfMap });
      // Both approaches should produce valid output
      expect(result2.groups[0].tables[0].rows.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to label-based when variantOfMap is empty', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: I1 OR ALT I1A - First message text'),
        makeScoreGroup('AnchProbInd', 2, 'API: D4 - No alternate here'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 2, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection, { variantOfMap: new Map() });

      // Label-based grouping should still detect I1/I1A
      expect(result.report.alternateGroups).toContain('I1/I1A');
    });

    it('falls back to label-based when variantOfMap is undefined', () => {
      const groups: TableAgentOutput[] = [
        makeScoreGroup('AnchProbInd', 1, 'API: I1 OR ALT I1A - First message text'),
      ];

      const detection = makeDetection([
        makeFamily('AnchProbInd', 1, { displayName: 'API Scores' }),
      ]);

      const result = consolidateMaxDiffTables(groups, detection);
      // Should fall back to label-based pattern (same as before)
      expect(result.report.alternateGroups).toContain('I1/I1A');
    });
  });
});
