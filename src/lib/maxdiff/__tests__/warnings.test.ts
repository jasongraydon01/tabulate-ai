import { describe, it, expect } from 'vitest';
import { MaxDiffWarnings } from '../warnings';
import { validateVariantOfGraph } from '../MessageListParser';
import type { MessageListEntry } from '../MessageListParser';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function entry(code: string, text: string, variantOf?: string): MessageListEntry {
  return { code, text, sourceRow: 1, ...(variantOf !== undefined && { variantOf }) };
}

// ─── MaxDiffWarnings accumulator ─────────────────────────────────────────────

describe('MaxDiffWarnings', () => {
  it('starts empty', () => {
    const w = new MaxDiffWarnings();
    expect(w.count).toBe(0);
    expect(w.hasWarnings).toBe(false);
    expect(w.toArray()).toEqual([]);
  });

  it('accumulates warnings via add()', () => {
    const w = new MaxDiffWarnings();
    w.add('duplicate_codes', 'Found duplicates', 'I1, I1');
    w.add('empty_codes_generated', '2 rows had empty codes');

    expect(w.count).toBe(2);
    expect(w.hasWarnings).toBe(true);
    expect(w.toArray()).toHaveLength(2);
    expect(w.toArray()[0]).toEqual({
      code: 'duplicate_codes',
      message: 'Found duplicates',
      details: 'I1, I1',
    });
    expect(w.toArray()[1]).toEqual({
      code: 'empty_codes_generated',
      message: '2 rows had empty codes',
    });
  });

  it('merges via addAll()', () => {
    const w1 = new MaxDiffWarnings();
    w1.add('duplicate_codes', 'A');
    const w2 = new MaxDiffWarnings();
    w2.add('empty_codes_generated', 'B');

    w1.addAll(w2);
    expect(w1.count).toBe(2);
  });

  it('adds pre-built warnings via addWarnings()', () => {
    const w = new MaxDiffWarnings();
    w.addWarnings([
      { code: 'variantof_cycle', message: 'Cycle found' },
    ]);
    expect(w.count).toBe(1);
    expect(w.toArray()[0].code).toBe('variantof_cycle');
  });

  it('toArray returns a copy', () => {
    const w = new MaxDiffWarnings();
    w.add('duplicate_codes', 'X');
    const arr = w.toArray();
    arr.push({ code: 'empty_codes_generated', message: 'Y' });
    expect(w.count).toBe(1); // Original unchanged
  });
});

// ─── validateVariantOfGraph ──────────────────────────────────────────────────

describe('validateVariantOfGraph', () => {
  it('returns no warnings for entries without variantOf', () => {
    const entries = [
      entry('I1', 'Message 1'),
      entry('I2', 'Message 2'),
      entry('I3', 'Message 3'),
    ];
    expect(validateVariantOfGraph(entries)).toEqual([]);
  });

  it('returns no warnings for a valid variantOf graph', () => {
    const entries = [
      entry('I1', 'Primary message'),
      entry('I1A', 'Alternate of I1', 'I1'),
      entry('E1', 'Another primary'),
      entry('E1A', 'Alternate of E1', 'E1'),
    ];
    expect(validateVariantOfGraph(entries)).toEqual([]);
  });

  it('detects self-references', () => {
    const entries = [
      entry('I1', 'Message', 'I1'),
    ];
    const warnings = validateVariantOfGraph(entries);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('variantof_self_ref');
    expect(warnings[0].message).toContain('I1');
  });

  it('detects unknown references', () => {
    const entries = [
      entry('I1', 'Message'),
      entry('I1A', 'Alternate', 'NONEXISTENT'),
    ];
    const warnings = validateVariantOfGraph(entries);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('variantof_unknown_ref');
    expect(warnings[0].message).toContain('NONEXISTENT');
  });

  it('detects cycles (A → B → A)', () => {
    const entries = [
      entry('A', 'Message A', 'B'),
      entry('B', 'Message B', 'A'),
    ];
    const warnings = validateVariantOfGraph(entries);
    const cycleWarnings = warnings.filter(w => w.code === 'variantof_cycle');
    expect(cycleWarnings.length).toBeGreaterThanOrEqual(1);
    expect(cycleWarnings[0].message).toContain('→');
  });

  it('detects longer cycles (A → B → C → A)', () => {
    const entries = [
      entry('A', 'Msg A', 'B'),
      entry('B', 'Msg B', 'C'),
      entry('C', 'Msg C', 'A'),
    ];
    const warnings = validateVariantOfGraph(entries);
    const cycleWarnings = warnings.filter(w => w.code === 'variantof_cycle');
    expect(cycleWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('handles case-insensitive references', () => {
    const entries = [
      entry('I1', 'Primary message'),
      entry('I1A', 'Alternate', 'i1'), // lowercase ref to uppercase code
    ];
    expect(validateVariantOfGraph(entries)).toEqual([]);
  });
});
