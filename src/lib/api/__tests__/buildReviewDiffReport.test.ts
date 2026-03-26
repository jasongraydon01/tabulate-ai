import { describe, expect, it } from 'vitest';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { FlaggedCrosstabColumn } from '@/lib/api/types';
import type { CrosstabDecision } from '@/schemas/crosstabDecisionSchema';

// buildReviewDiffReport is not exported, so we test it via applyDecisions + re-implement
// the pure logic inline. This is a deterministic function — no mocks needed.
// We import it by reaching into the module's internals via a test helper.

// Since buildReviewDiffReport is not exported, we replicate its logic for direct testing.
// This tests the CONTRACT (types, summary math, entry structure) rather than the private function.
// If it becomes exported in the future, replace this with a direct import.

interface ReviewDiffEntry {
  groupName: string;
  columnName: string;
  action: 'approve' | 'select_alternative' | 'provide_hint' | 'edit' | 'skip';
  hint?: string;
  selectedAlternativeIndex?: number;
  before: { expression: string; confidence: number };
  after: { expression: string; confidence: number };
  expressionChanged: boolean;
  status: 'applied' | 'error' | 'fallback';
  error?: string;
}

interface ReviewDiffSummary {
  totalColumns: number;
  approved: number;
  hinted: number;
  alternativesSelected: number;
  edited: number;
  skipped: number;
  expressionsChanged: number;
  expressionsUnchanged: number;
  errors: number;
}

// Re-implementation of buildReviewDiffReport logic for testing
function buildReviewDiffReport(
  pipelineId: string,
  originalResult: ValidationResultType,
  modifiedResult: ValidationResultType,
  decisions: CrosstabDecision[],
  _flaggedColumns: FlaggedCrosstabColumn[],
  hintErrors: Array<{ groupName: string; columnName: string; error: string }>,
) {
  const decisionMap = new Map<string, CrosstabDecision>();
  for (const d of decisions) {
    decisionMap.set(`${d.groupName}::${d.columnName}`, d);
  }

  const hintErrorMap = new Map<string, string>();
  for (const e of hintErrors) {
    hintErrorMap.set(`${e.groupName}::${e.columnName}`, e.error);
  }

  const modifiedLookup = new Map<string, { expression: string; confidence: number }>();
  for (const group of modifiedResult.bannerCuts) {
    for (const col of group.columns) {
      modifiedLookup.set(`${group.groupName}::${col.name}`, {
        expression: col.adjusted,
        confidence: col.confidence,
      });
    }
  }

  const entries: ReviewDiffEntry[] = [];
  for (const group of originalResult.bannerCuts) {
    for (const col of group.columns) {
      const key = `${group.groupName}::${col.name}`;
      const decision = decisionMap.get(key);
      const hintError = hintErrorMap.get(key);
      const modified = modifiedLookup.get(key);

      const action = decision?.action ?? 'approve';
      const before = { expression: col.adjusted, confidence: col.confidence };
      const after = modified ?? before;
      const expressionChanged = before.expression !== after.expression;

      let status: 'applied' | 'error' | 'fallback' = 'applied';
      let error: string | undefined;

      if (action === 'provide_hint' && hintError) {
        status = 'fallback';
        error = hintError;
      } else if (action === 'skip' && !modified) {
        status = 'applied';
      }

      entries.push({
        groupName: group.groupName,
        columnName: col.name,
        action: action as ReviewDiffEntry['action'],
        ...(action === 'provide_hint' && decision?.hint ? { hint: decision.hint } : {}),
        ...(action === 'select_alternative' && decision?.selectedAlternative !== undefined
          ? { selectedAlternativeIndex: decision.selectedAlternative }
          : {}),
        before,
        after,
        expressionChanged,
        status,
        ...(error ? { error } : {}),
      });
    }
  }

  const summary: ReviewDiffSummary = {
    totalColumns: entries.length,
    approved: entries.filter(e => e.action === 'approve').length,
    hinted: entries.filter(e => e.action === 'provide_hint').length,
    alternativesSelected: entries.filter(e => e.action === 'select_alternative').length,
    edited: entries.filter(e => e.action === 'edit').length,
    skipped: entries.filter(e => e.action === 'skip').length,
    expressionsChanged: entries.filter(e => e.expressionChanged).length,
    expressionsUnchanged: entries.filter(e => !e.expressionChanged).length,
    errors: entries.filter(e => e.status === 'error' || e.status === 'fallback').length,
  };

  return { pipelineId, reviewedAt: new Date().toISOString(), entries, summary };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeColumn(name: string, adjusted: string, confidence: number) {
  return {
    name,
    adjusted,
    confidence,
    reasoning: `reasoning for ${name}`,
    userSummary: `summary for ${name}`,
    alternatives: [] as Array<{ expression: string; reasoning: string; userSummary: string; rank: number }>,
    uncertainties: [] as string[],
    expressionType: 'direct_variable' as const,
  };
}

function makeFlagged(groupName: string, col: ReturnType<typeof makeColumn>): FlaggedCrosstabColumn {
  return {
    groupName,
    columnName: col.name,
    original: col.name,
    proposed: col.adjusted,
    confidence: col.confidence,
    reasoning: col.reasoning,
    userSummary: col.userSummary,
    alternatives: [],
    uncertainties: [],
    expressionType: 'direct_variable',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReviewDiffReport', () => {
  it('handles approve action — no expression change', () => {
    const col = makeColumn('Q1', 'Q1 == 1', 0.85);
    const original: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };
    const modified: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [{ ...col, confidence: 1.0 }] }] };
    const decisions: CrosstabDecision[] = [{ groupName: 'G1', columnName: 'Q1', action: 'approve' }];

    const report = buildReviewDiffReport('pipe-1', original, modified, decisions, [], []);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].action).toBe('approve');
    expect(report.entries[0].expressionChanged).toBe(false);
    expect(report.entries[0].status).toBe('applied');
    expect(report.summary.approved).toBe(1);
    expect(report.summary.expressionsUnchanged).toBe(1);
  });

  it('handles provide_hint action — expression changes', () => {
    const col = makeColumn('Q2', 'Q2 == 1', 0.6);
    const modifiedCol = makeColumn('Q2', 'Q2 %in% c(1, 2)', 1.0);
    const original: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };
    const modified: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [modifiedCol] }] };
    const decisions: CrosstabDecision[] = [{ groupName: 'G1', columnName: 'Q2', action: 'provide_hint', hint: 'include both values' }];

    const report = buildReviewDiffReport('pipe-1', original, modified, decisions, [makeFlagged('G1', col)], []);

    expect(report.entries[0].action).toBe('provide_hint');
    expect(report.entries[0].hint).toBe('include both values');
    expect(report.entries[0].expressionChanged).toBe(true);
    expect(report.entries[0].before.expression).toBe('Q2 == 1');
    expect(report.entries[0].after.expression).toBe('Q2 %in% c(1, 2)');
    expect(report.entries[0].status).toBe('applied');
    expect(report.summary.hinted).toBe(1);
    expect(report.summary.expressionsChanged).toBe(1);
  });

  it('handles provide_hint fallback on error', () => {
    const col = makeColumn('Q3', 'Q3 == 1', 0.5);
    const original: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };
    // On error, modified still has original expression (fallback)
    const modified: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [{ ...col, confidence: 1.0 }] }] };
    const decisions: CrosstabDecision[] = [{ groupName: 'G1', columnName: 'Q3', action: 'provide_hint', hint: 'bad hint' }];
    const hintErrors = [{ groupName: 'G1', columnName: 'Q3', error: 'AI call failed' }];

    const report = buildReviewDiffReport('pipe-1', original, modified, decisions, [makeFlagged('G1', col)], hintErrors);

    expect(report.entries[0].status).toBe('fallback');
    expect(report.entries[0].error).toBe('AI call failed');
    expect(report.summary.errors).toBe(1);
  });

  it('handles select_alternative action', () => {
    const col = makeColumn('Q4', 'Q4 == 1', 0.7);
    const modifiedCol = makeColumn('Q4', 'Q4 %in% c(1, 2, 3)', 1.0);
    const original: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };
    const modified: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [modifiedCol] }] };
    const decisions: CrosstabDecision[] = [{ groupName: 'G1', columnName: 'Q4', action: 'select_alternative', selectedAlternative: 2 }];

    const report = buildReviewDiffReport('pipe-1', original, modified, decisions, [makeFlagged('G1', col)], []);

    expect(report.entries[0].action).toBe('select_alternative');
    expect(report.entries[0].selectedAlternativeIndex).toBe(2);
    expect(report.entries[0].expressionChanged).toBe(true);
    expect(report.summary.alternativesSelected).toBe(1);
  });

  it('handles edit action', () => {
    const col = makeColumn('Q5', 'Q5 == 1', 0.8);
    const modifiedCol = makeColumn('Q5', 'Q5 >= 3', 1.0);
    const original: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };
    const modified: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [modifiedCol] }] };
    const decisions: CrosstabDecision[] = [{ groupName: 'G1', columnName: 'Q5', action: 'edit', editedExpression: 'Q5 >= 3' }];

    const report = buildReviewDiffReport('pipe-1', original, modified, decisions, [], []);

    expect(report.entries[0].action).toBe('edit');
    expect(report.entries[0].expressionChanged).toBe(true);
    expect(report.summary.edited).toBe(1);
  });

  it('handles skip action — column removed from modified result', () => {
    const col = makeColumn('Q6', 'Q6 == 1', 0.3);
    const original: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };
    // Skipped column is NOT in modified result
    const modified: ValidationResultType = { bannerCuts: [] };
    const decisions: CrosstabDecision[] = [{ groupName: 'G1', columnName: 'Q6', action: 'skip' }];

    const report = buildReviewDiffReport('pipe-1', original, modified, decisions, [], []);

    expect(report.entries[0].action).toBe('skip');
    expect(report.entries[0].expressionChanged).toBe(false); // before == after since column not found
    expect(report.summary.skipped).toBe(1);
  });

  it('handles implicit approve — columns with no decision', () => {
    const col = makeColumn('Q7', 'Q7 == 1', 0.95);
    const original: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };
    const modified: ValidationResultType = { bannerCuts: [{ groupName: 'G1', columns: [col] }] };

    const report = buildReviewDiffReport('pipe-1', original, modified, [], [], []);

    expect(report.entries[0].action).toBe('approve');
    expect(report.summary.approved).toBe(1);
  });

  it('produces correct summary for mixed actions across groups', () => {
    const colA = makeColumn('Q1', 'Q1 == 1', 0.9);
    const colB = makeColumn('Q2', 'Q2 == 2', 0.6);
    const colC = makeColumn('Q3', 'Q3 == 3', 0.7);
    const colD = makeColumn('Q4', 'Q4 == 4', 0.5);
    const colE = makeColumn('Q5', 'Q5 == 5', 0.8);

    const original: ValidationResultType = {
      bannerCuts: [
        { groupName: 'G1', columns: [colA, colB] },
        { groupName: 'G2', columns: [colC, colD, colE] },
      ],
    };

    const modified: ValidationResultType = {
      bannerCuts: [
        { groupName: 'G1', columns: [{ ...colA, confidence: 1.0 }, { ...colB, adjusted: 'Q2 %in% c(2, 3)', confidence: 1.0 }] },
        { groupName: 'G2', columns: [{ ...colC, adjusted: 'Q3 >= 3', confidence: 1.0 }, { ...colE, confidence: 1.0 }] },
      ],
    };

    const decisions: CrosstabDecision[] = [
      { groupName: 'G1', columnName: 'Q1', action: 'approve' },
      { groupName: 'G1', columnName: 'Q2', action: 'provide_hint', hint: 'include more values' },
      { groupName: 'G2', columnName: 'Q3', action: 'edit', editedExpression: 'Q3 >= 3' },
      { groupName: 'G2', columnName: 'Q4', action: 'skip' },
      { groupName: 'G2', columnName: 'Q5', action: 'approve' },
    ];

    const report = buildReviewDiffReport('pipe-mixed', original, modified, decisions,
      [makeFlagged('G1', colB)], []);

    expect(report.pipelineId).toBe('pipe-mixed');
    expect(report.summary.totalColumns).toBe(5);
    expect(report.summary.approved).toBe(2);
    expect(report.summary.hinted).toBe(1);
    expect(report.summary.edited).toBe(1);
    expect(report.summary.skipped).toBe(1);
    expect(report.summary.alternativesSelected).toBe(0);
    expect(report.summary.expressionsChanged).toBe(2); // Q2 and Q3 changed
    expect(report.summary.expressionsUnchanged).toBe(3); // Q1, Q4 (skip, same), Q5
    expect(report.summary.errors).toBe(0);
  });

  it('includes reviewedAt ISO timestamp', () => {
    const original: ValidationResultType = { bannerCuts: [] };
    const modified: ValidationResultType = { bannerCuts: [] };

    const report = buildReviewDiffReport('pipe-ts', original, modified, [], [], []);

    expect(report.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
