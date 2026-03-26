import { describe, it, expect } from 'vitest';
import {
  ExcludeUpdateSchema,
  ExcludeRequestSchema,
  RegenerateTableRequestSchema,
  RegenerateRequestSchema,
} from '../tableReviewSchema';

describe('ExcludeUpdateSchema', () => {
  it('accepts valid exclude update', () => {
    const result = ExcludeUpdateSchema.safeParse({
      tableId: 'q1',
      exclude: true,
      excludeReason: 'Low base size',
    });
    expect(result.success).toBe(true);
  });

  it('accepts without excludeReason', () => {
    const result = ExcludeUpdateSchema.safeParse({
      tableId: 'q1',
      exclude: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty tableId', () => {
    const result = ExcludeUpdateSchema.safeParse({
      tableId: '',
      exclude: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects tableId over 200 chars', () => {
    const result = ExcludeUpdateSchema.safeParse({
      tableId: 'a'.repeat(201),
      exclude: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects excludeReason over 500 chars', () => {
    const result = ExcludeUpdateSchema.safeParse({
      tableId: 'q1',
      exclude: true,
      excludeReason: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing exclude boolean', () => {
    const result = ExcludeUpdateSchema.safeParse({
      tableId: 'q1',
    });
    expect(result.success).toBe(false);
  });
});

describe('ExcludeRequestSchema', () => {
  it('accepts valid request with one update', () => {
    const result = ExcludeRequestSchema.safeParse({
      updates: [{ tableId: 'q1', exclude: true }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty updates array', () => {
    const result = ExcludeRequestSchema.safeParse({
      updates: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 500 updates', () => {
    const updates = Array.from({ length: 501 }, (_, i) => ({
      tableId: `q${i}`,
      exclude: true,
    }));
    const result = ExcludeRequestSchema.safeParse({ updates });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 500 updates', () => {
    const updates = Array.from({ length: 500 }, (_, i) => ({
      tableId: `q${i}`,
      exclude: true,
    }));
    const result = ExcludeRequestSchema.safeParse({ updates });
    expect(result.success).toBe(true);
  });
});

describe('RegenerateTableRequestSchema', () => {
  it('accepts valid regenerate request', () => {
    const result = RegenerateTableRequestSchema.safeParse({
      tableId: 'q1',
      feedback: 'Add a NET for top 2 box',
      includeRelated: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty feedback', () => {
    const result = RegenerateTableRequestSchema.safeParse({
      tableId: 'q1',
      feedback: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects feedback over 2000 chars', () => {
    const result = RegenerateTableRequestSchema.safeParse({
      tableId: 'q1',
      feedback: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts without includeRelated', () => {
    const result = RegenerateTableRequestSchema.safeParse({
      tableId: 'q1',
      feedback: 'Fix the labels',
    });
    expect(result.success).toBe(true);
  });
});

describe('RegenerateRequestSchema', () => {
  it('accepts valid regenerate request', () => {
    const result = RegenerateRequestSchema.safeParse({
      tables: [{ tableId: 'q1', feedback: 'Fix it' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty tables array', () => {
    const result = RegenerateRequestSchema.safeParse({
      tables: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 tables', () => {
    const tables = Array.from({ length: 21 }, (_, i) => ({
      tableId: `q${i}`,
      feedback: 'Fix it',
    }));
    const result = RegenerateRequestSchema.safeParse({ tables });
    expect(result.success).toBe(false);
  });
});
