import { describe, it, expect } from 'vitest';
import {
  TableContextOutputSchema,
  TableContextTableResultSchema,
  TableContextRowLabelOverrideSchema,
} from '../tableContextSchema';

describe('TableContextRowLabelOverrideSchema', () => {
  it('validates a valid override', () => {
    const result = TableContextRowLabelOverrideSchema.safeParse({
      variable: 'Q3_1',
      label: 'Strongly Agree',
      reason: 'Survey label is more readable',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = TableContextRowLabelOverrideSchema.safeParse({
      variable: 'Q3_1',
      label: 'Strongly Agree',
      // missing reason
    });
    expect(result.success).toBe(false);
  });
});

describe('TableContextTableResultSchema', () => {
  it('validates a minimal no-changes result', () => {
    const result = TableContextTableResultSchema.safeParse({
      tableId: 'Q3_overview',
      tableSubtitle: 'Overall satisfaction',
      userNote: '',
      baseText: 'Total Respondents',
      noChangesNeeded: true,
      reasoning: 'Prefill values are adequate.',
      rowLabelOverrides: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates a result with changes and row overrides', () => {
    const result = TableContextTableResultSchema.safeParse({
      tableId: 'Q7_grid_row',
      tableSubtitle: 'Product Satisfaction by Feature',
      userNote: 'Scale: 1=Poor, 5=Excellent',
      baseText: 'Respondents who purchased product',
      noChangesNeeded: false,
      reasoning: 'Subtitle needed context for grid structure. Base description refined for filtered sample.',
      rowLabelOverrides: [
        {
          variable: 'Q7r1',
          label: 'Build Quality',
          reason: 'Survey label more descriptive than .sav label',
        },
        {
          variable: 'Q7r2',
          label: 'Battery Life',
          reason: 'Survey label preferred',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rowLabelOverrides).toHaveLength(2);
    }
  });

  it('rejects missing required field', () => {
    const result = TableContextTableResultSchema.safeParse({
      tableId: 'Q3_overview',
      // missing tableSubtitle
      userNote: '',
      baseText: 'Total Respondents',
      noChangesNeeded: true,
      reasoning: 'OK',
      rowLabelOverrides: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('TableContextOutputSchema', () => {
  it('validates with empty tables array', () => {
    const result = TableContextOutputSchema.safeParse({
      tables: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates with multiple table results', () => {
    const result = TableContextOutputSchema.safeParse({
      tables: [
        {
          tableId: 'Q1_overview',
          tableSubtitle: '',
          userNote: '',
          baseText: 'Total Respondents',
          noChangesNeeded: true,
          reasoning: 'No changes needed.',
          rowLabelOverrides: [],
        },
        {
          tableId: 'Q2_detail',
          tableSubtitle: 'By Region',
          userNote: 'Multiple responses allowed',
          baseText: 'Respondents aware of brand',
          noChangesNeeded: false,
          reasoning: 'Subtitle added for clarity.',
          rowLabelOverrides: [],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tables).toHaveLength(2);
    }
  });

  it('rejects when tables is not an array', () => {
    const result = TableContextOutputSchema.safeParse({
      tables: 'not an array',
    });
    expect(result.success).toBe(false);
  });
});
