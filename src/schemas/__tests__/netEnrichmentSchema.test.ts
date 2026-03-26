import { describe, it, expect } from 'vitest';
import {
  NetGroupSchema,
  NetEnrichmentResultSchema,
  NetEnrichmentOutputSchema,
} from '../netEnrichmentSchema';

describe('NetGroupSchema', () => {
  it('validates a valid NET group', () => {
    const result = NetGroupSchema.safeParse({
      netLabel: 'Category A (NET)',
      components: ['Q1_1', 'Q1_2', 'Q1_3'],
      reasoning: 'These items share a natural grouping',
    });
    expect(result.success).toBe(true);
  });

  it('validates with empty components array', () => {
    const result = NetGroupSchema.safeParse({
      netLabel: 'Group',
      components: [],
      reasoning: 'Empty group',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing netLabel', () => {
    const result = NetGroupSchema.safeParse({
      components: ['Q1_1'],
      reasoning: 'Missing label',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string components', () => {
    const result = NetGroupSchema.safeParse({
      netLabel: 'Group',
      components: [1, 2, 3],
      reasoning: 'Numeric components',
    });
    expect(result.success).toBe(false);
  });
});

describe('NetEnrichmentResultSchema', () => {
  it('validates noNetsNeeded=true with empty nets', () => {
    const result = NetEnrichmentResultSchema.safeParse({
      tableId: 'Q5__standard_overview',
      noNetsNeeded: true,
      reasoning: 'Only 3 distinct options — no meaningful groupings.',
      suggestedSubtitle: '',
      nets: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates noNetsNeeded=false with populated nets', () => {
    const result = NetEnrichmentResultSchema.safeParse({
      tableId: 'Q12__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Provider types have natural clinical groupings.',
      suggestedSubtitle: 'NET Summary',
      nets: [
        {
          netLabel: 'Category A (NET)',
          components: ['Q12_1', 'Q12_2', 'Q12_3'],
          reasoning: 'Related items in the first group',
        },
        {
          netLabel: 'Category B (NET)',
          components: ['Q12_4', 'Q12_5'],
          reasoning: 'Related items in the second group',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nets).toHaveLength(2);
    }
  });

  it('rejects missing required fields', () => {
    const result = NetEnrichmentResultSchema.safeParse({
      tableId: 'Q5__standard_overview',
      noNetsNeeded: true,
      // missing reasoning, suggestedSubtitle, nets
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing tableId', () => {
    const result = NetEnrichmentResultSchema.safeParse({
      noNetsNeeded: true,
      reasoning: 'No NETs needed.',
      suggestedSubtitle: '',
      nets: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('NetEnrichmentOutputSchema', () => {
  it('validates wrapper with noNetsNeeded result', () => {
    const result = NetEnrichmentOutputSchema.safeParse({
      result: {
        tableId: 'Q3__standard_overview',
        noNetsNeeded: true,
        reasoning: 'No groupings add value.',
        suggestedSubtitle: '',
        nets: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it('validates wrapper with nets result', () => {
    const result = NetEnrichmentOutputSchema.safeParse({
      result: {
        tableId: 'Q7__standard_overview',
        noNetsNeeded: false,
        reasoning: 'Items form two natural groups.',
        suggestedSubtitle: 'NET Summary',
        nets: [
          {
            netLabel: 'Group X (NET)',
            components: ['Q7_1', 'Q7_2'],
            reasoning: 'Conceptually related',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing result field', () => {
    const result = NetEnrichmentOutputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects result as string', () => {
    const result = NetEnrichmentOutputSchema.safeParse({
      result: 'not an object',
    });
    expect(result.success).toBe(false);
  });
});
