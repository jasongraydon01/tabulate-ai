import { describe, it, expect } from 'vitest';
import { normalizePostPass } from '../TablePostProcessor';
import { makeTable, makeRow } from '../../__tests__/fixtures';

describe('TablePostProcessor', () => {
  describe('Rule 1: empty fields normalized', () => {
    it('replaces undefined/null fields with safe defaults', () => {
      const table = makeTable({
        tableId: 't1',
        questionId: undefined as unknown as string,
        surveySection: null as unknown as string,
        rows: [
          makeRow({
            variable: undefined as unknown as string,
            label: null as unknown as string,
            filterValue: undefined as unknown as string,
            isNet: undefined as unknown as boolean,
            netComponents: null as unknown as string[],
            indent: undefined as unknown as number,
          }),
        ],
      });
      const result = normalizePostPass([table]);
      const processed = result.tables[0];
      expect(processed.questionId).toBe('');
      expect(processed.surveySection).toBe('');
      expect(processed.rows[0].variable).toBe('');
      expect(processed.rows[0].label).toBe('');
      expect(processed.rows[0].filterValue).toBe('');
      expect(processed.rows[0].isNet).toBe(false);
      expect(processed.rows[0].netComponents).toEqual([]);
      expect(processed.rows[0].indent).toBe(0);
      expect(result.actions.some(a => a.rule === 'empty_fields_normalized')).toBe(true);
    });

    it('logs no action when all fields already set', () => {
      const table = makeTable({ tableId: 't1' });
      const result = normalizePostPass([table]);
      expect(result.actions.filter(a => a.rule === 'empty_fields_normalized')).toHaveLength(0);
    });
  });

  describe('Rule 2: section cleanup', () => {
    it('strips "SECTION A:" prefix and uppercases', () => {
      const table = makeTable({ tableId: 't1', surveySection: 'SECTION A: SCREENER' });
      const result = normalizePostPass([table]);
      expect(result.tables[0].surveySection).toBe('SCREENER');
      expect(result.actions.some(a => a.rule === 'survey_section_cleaned')).toBe(true);
    });

    it('strips "Section 2B -" prefix pattern', () => {
      const table = makeTable({ tableId: 't1', surveySection: 'Section 2B - Demographics' });
      const result = normalizePostPass([table]);
      expect(result.tables[0].surveySection).toBe('DEMOGRAPHICS');
    });

    it('leaves already-clean section unchanged', () => {
      const table = makeTable({ tableId: 't1', surveySection: 'SCREENER' });
      const result = normalizePostPass([table]);
      expect(result.tables[0].surveySection).toBe('SCREENER');
      expect(result.actions.filter(a => a.rule === 'survey_section_cleaned')).toHaveLength(0);
    });
  });

  describe('Rule 3a: question text validation (warning only)', () => {
    it('warns when questionText is just a variable identifier', () => {
      const table = makeTable({ tableId: 't1', questionId: 'A7', questionText: 'A7' });
      const result = normalizePostPass([table]);
      expect(result.actions.some(a => a.rule === 'suspicious_question_text' && a.severity === 'warn')).toBe(true);
    });

    it('warns when questionText is empty', () => {
      const table = makeTable({ tableId: 't1', questionId: 'A7', questionText: '' });
      const result = normalizePostPass([table]);
      expect(result.actions.some(a => a.rule === 'suspicious_question_text' && a.severity === 'warn')).toBe(true);
    });

    it('does not warn on normal natural-language question text', () => {
      const table = makeTable({
        tableId: 't1',
        questionId: 'A7',
        questionText: 'How might this change impact your prescribing behavior?',
      });
      const result = normalizePostPass([table]);
      expect(result.actions.filter(a => a.rule === 'suspicious_question_text')).toHaveLength(0);
    });
  });

  describe('Rule 3: base text validation (warning only)', () => {
    it('warns on question-description-like base text', () => {
      const table = makeTable({ tableId: 't1', baseText: 'Awareness of treatment options' });
      const result = normalizePostPass([table]);
      // Warning logged but text NOT changed
      expect(result.tables[0].baseText).toBe('Awareness of treatment options');
      expect(result.actions.some(a => a.rule === 'suspicious_base_text' && a.severity === 'warn')).toBe(true);
    });

    it('does not warn on proper audience base text', () => {
      const table = makeTable({ tableId: 't1', baseText: 'All respondents' });
      const result = normalizePostPass([table]);
      expect(result.actions.filter(a => a.rule === 'suspicious_base_text')).toHaveLength(0);
    });
  });

  describe('Rule 3c: unsupported assignment base text', () => {
    it('clears unsupported randomization language when no filter evidence', () => {
      const table = makeTable({
        tableId: 't1',
        baseText: 'Respondents randomly assigned to CAPLYTA',
        additionalFilter: '',
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].baseText).toBe('');
      expect(result.actions.some(a => a.rule === 'unsupported_base_text_cleared')).toBe(true);
    });
  });

  describe('Rule 3b: base text backfill', () => {
    it('backfills baseText from additionalFilter when empty', () => {
      const table = makeTable({
        tableId: 't1',
        additionalFilter: 'Q3 == 1',
        baseText: '',
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].baseText).toBe('Respondents matching filter: Q3 == 1');
      expect(result.actions.some(a => a.rule === 'base_text_backfill')).toBe(true);
    });

    it('does not backfill when baseText already exists', () => {
      const table = makeTable({
        tableId: 't1',
        additionalFilter: 'Q3 == 1',
        baseText: 'Existing base',
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].baseText).toBe('Existing base');
      expect(result.actions.filter(a => a.rule === 'base_text_backfill')).toHaveLength(0);
    });
  });

  describe('Rule 4: trivial NETs', () => {
    it('removes NET that covers all non-NET values', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [
          makeRow({ variable: 'Q1', label: 'NET: All', filterValue: '1,2,3', isNet: true, indent: 0 }),
          makeRow({ variable: 'Q1', label: 'Option A', filterValue: '1', indent: 1 }),
          makeRow({ variable: 'Q1', label: 'Option B', filterValue: '2', indent: 1 }),
          makeRow({ variable: 'Q1', label: 'Option C', filterValue: '3', indent: 1 }),
        ],
      });
      const result = normalizePostPass([table]);
      // Trivial NET removed, 3 remaining rows with indent reset to 0
      expect(result.tables[0].rows).toHaveLength(3);
      expect(result.tables[0].rows.every(r => !r.isNet)).toBe(true);
      expect(result.tables[0].rows.every(r => r.indent === 0)).toBe(true);
      expect(result.actions.some(a => a.rule === 'trivial_net_removed')).toBe(true);
    });

    it('keeps non-trivial NET that covers subset', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [
          makeRow({ variable: 'Q1', label: 'NET: Top 2', filterValue: '1,2', isNet: true, indent: 0 }),
          makeRow({ variable: 'Q1', label: 'Option A', filterValue: '1', indent: 1 }),
          makeRow({ variable: 'Q1', label: 'Option B', filterValue: '2', indent: 1 }),
          makeRow({ variable: 'Q1', label: 'Option C', filterValue: '3', indent: 0 }),
        ],
      });
      const result = normalizePostPass([table]);
      // NET is NOT trivial (covers 2 of 3 values)
      expect(result.tables[0].rows).toHaveLength(4);
      expect(result.tables[0].rows[0].isNet).toBe(true);
      expect(result.actions.filter(a => a.rule === 'trivial_net_removed')).toHaveLength(0);
    });
  });

  describe('Rule 5: source ID casing', () => {
    it('uppercases lowercase IDs in brackets', () => {
      const table = makeTable({
        tableId: 't1',
        userNote: 'Based on [s1] and [q3]',
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].userNote).toBe('Based on [S1] and [Q3]');
      expect(result.actions.some(a => a.rule === 'source_id_casing_normalized')).toBe(true);
    });

    it('leaves already-uppercase IDs unchanged', () => {
      const table = makeTable({
        tableId: 't1',
        userNote: 'Based on [S1] and [Q3]',
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].userNote).toBe('Based on [S1] and [Q3]');
      expect(result.actions.filter(a => a.rule === 'source_id_casing_normalized')).toHaveLength(0);
    });
  });

  describe('Rule 6: duplicate rows', () => {
    it('warns on duplicate variable+filterValue pairs', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1' }),
          makeRow({ variable: 'Q1', filterValue: '1' }),
        ],
      });
      const result = normalizePostPass([table]);
      expect(result.actions.some(a => a.rule === 'duplicate_row_detected' && a.severity === 'warn')).toBe(true);
    });

    it('does not warn for different filterValues', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1' }),
          makeRow({ variable: 'Q1', filterValue: '2' }),
        ],
      });
      const result = normalizePostPass([table]);
      expect(result.actions.filter(a => a.rule === 'duplicate_row_detected')).toHaveLength(0);
    });
  });

  describe('Rule 7: orphan indent', () => {
    it('resets indent to 0 when no NET parent above', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1', indent: 1, isNet: false }),
        ],
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].rows[0].indent).toBe(0);
      expect(result.actions.some(a => a.rule === 'orphan_indent_reset')).toBe(true);
    });

    it('keeps indent when valid NET parent exists', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [
          makeRow({ variable: 'Q1', label: 'NET: Top 2', filterValue: '1,2', isNet: true, indent: 0 }),
          makeRow({ variable: 'Q1', filterValue: '1', indent: 1 }),
        ],
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].rows[1].indent).toBe(1);
      expect(result.actions.filter(a => a.rule === 'orphan_indent_reset')).toHaveLength(0);
    });
  });

  describe('Rule 8: routing instructions stripped', () => {
    it('strips (TERMINATE) from label', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [makeRow({ label: 'Yes (TERMINATE)' })],
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].rows[0].label).toBe('Yes');
      expect(result.actions.some(a => a.rule === 'routing_instruction_stripped')).toBe(true);
    });

    it('strips (CONTINUE TO S4) from label', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [makeRow({ label: 'Option A (CONTINUE TO S4)' })],
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].rows[0].label).toBe('Option A');
    });

    it('leaves clean labels unchanged', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [makeRow({ label: 'Clean label' })],
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].rows[0].label).toBe('Clean label');
      expect(result.actions.filter(a => a.rule === 'routing_instruction_stripped')).toHaveLength(0);
    });
  });

  describe('Phase 2/3 deterministic additions', () => {
    it('normalizes all-row NET emphasis for pure T2B comparison tables', () => {
      const table = makeTable({
        tableId: 't1',
        tableSubtitle: 'T2B Comparison',
        rows: [
          makeRow({ variable: 'Q1', label: 'Brand A', isNet: true }),
          makeRow({ variable: 'Q2', label: 'Brand B', isNet: true }),
        ],
      });
      const result = normalizePostPass([table]);
      expect(result.tables[0].rows.every(r => r.isNet === false)).toBe(true);
      expect(result.actions.some(a => a.rule === 't2b_comparison_net_style_normalized')).toBe(true);
    });

    it('applies split budget by excluding excess tables', () => {
      const t1 = makeTable({ tableId: 'q1_a', questionId: 'Q1', splitFromTableId: 'q1' });
      const t2 = makeTable({ tableId: 'q1_b', questionId: 'Q1', splitFromTableId: 'q1' });
      const t3 = makeTable({ tableId: 'q1_c', questionId: 'Q1', splitFromTableId: 'q1' });
      const result = normalizePostPass([t1, t2, t3], {
        maxdiffPolicy: { maxSplitTablesPerInput: 1 },
      });
      expect(result.tables.filter(t => t.exclude).length).toBe(2);
      expect(result.actions.filter(a => a.rule === 'split_budget_enforced').length).toBe(2);
    });

    it('resolves preferred-message placeholders when message map is provided', () => {
      const table = makeTable({
        tableId: 't1',
        rows: [makeRow({ label: 'I1 preferred message' })],
      });
      const result = normalizePostPass([table], {
        maxdiffMessages: [{ code: 'I1', text: 'Full message text', sourceRow: 1 }],
      });
      expect(result.tables[0].rows[0].label).toBe('I1: Full message text');
      expect(result.actions.some(a => a.rule === 'placeholder_label_resolved')).toBe(true);
    });
  });

  describe('stats', () => {
    it('counts fixes and warnings correctly', () => {
      const table = makeTable({
        tableId: 't1',
        surveySection: 'SECTION A: SCREENER',  // fix: section cleanup
        baseText: 'Awareness of treatment options',  // warn: suspicious
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1' }),
          makeRow({ variable: 'Q1', filterValue: '1' }),  // warn: duplicate
        ],
      });
      const result = normalizePostPass([table]);
      expect(result.stats.tablesProcessed).toBe(1);
      expect(result.stats.totalFixes).toBeGreaterThanOrEqual(1);
      expect(result.stats.totalWarnings).toBeGreaterThanOrEqual(1);
      expect(result.stats.totalFixes + result.stats.totalWarnings).toBe(result.actions.length);
    });
  });

  it('runs field normalization before content rules', () => {
    // surveySection is null → should be normalized to '' BEFORE section cleanup tries to run
    const table = makeTable({
      tableId: 't1',
      surveySection: null as unknown as string,
    });
    const result = normalizePostPass([table]);
    // Should not throw, and section should be ''
    expect(result.tables[0].surveySection).toBe('');
  });
});
