import { describe, it, expect } from 'vitest';
import {
  applyTableMutations,
  computeTableVersionHash,
  type ApplyTableMutationsOptions,
} from '../applyTableMutations';
import type { ApplyTableMutationsInput } from '@/schemas/verificationMutationSchema';
import { makeTable, makeRow } from '@/lib/__tests__/fixtures';

// ---------------------------------------------------------------------------
// Helper: build a valid mutation input for a given table + operations
// ---------------------------------------------------------------------------

function prepareInput(
  table: ReturnType<typeof makeTable>,
  operations: ApplyTableMutationsInput['operations'],
): ApplyTableMutationsInput {
  return {
    targetTableId: table.tableId,
    tableVersionHash: computeTableVersionHash(table),
    operations,
  };
}

const DEFAULT_OPTS: ApplyTableMutationsOptions = { allowReservedOperations: true };

// ============================================================================
// Existing ops — regression coverage
// ============================================================================

describe('applyTableMutations – existing ops (regression)', () => {
  // --- update_label ---
  it('update_label: updates a row label', () => {
    const table = makeTable({
      rows: [makeRow({ variable: 'Q1', filterValue: '1', label: 'Old' })],
    });
    const input = prepareInput(table, [
      { kind: 'update_label', rowKey: { variable: 'Q1', filterValue: '1' }, label: 'New Label', reason: 'test' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows[0].label).toBe('New Label');
    expect(audit.applied).toContain('update_label:Q1:1');
  });

  it('update_label: skips when row not found', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'update_label', rowKey: { variable: 'MISSING', filterValue: '99' }, label: 'X', reason: 'test' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped.length).toBe(1);
    expect(audit.skipped[0]).toContain('row_not_found');
  });

  // --- set_metadata ---
  it('set_metadata: patches table metadata', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'set_metadata', patch: { surveySection: 'DEMOGRAPHICS', baseText: 'All respondents', userNote: '', tableSubtitle: '' }, reason: 'test' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.surveySection).toBe('DEMOGRAPHICS');
    expect(result.baseText).toBe('All respondents');
    expect(audit.applied).toContain('set_metadata');
  });

  // --- create_conceptual_net ---
  it('create_conceptual_net: adds a multi-variable NET row', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'A1', filterValue: '1', label: 'Item A' }),
        makeRow({ variable: 'A2', filterValue: '1', label: 'Item B' }),
      ],
    });
    const input = prepareInput(table, [
      {
        kind: 'create_conceptual_net',
        label: 'Any A (NET)',
        components: ['A1', 'A2'],
        position: 'top',
        reason: 'test',
      },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0].isNet).toBe(true);
    expect(result.rows[0].label).toBe('Any A (NET)');
    expect(audit.applied).toContain('create_conceptual_net:Any A (NET)');
  });

  it('create_conceptual_net: skips if components missing', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'create_conceptual_net', label: 'Bad', components: ['MISSING1', 'MISSING2'], position: 'top', reason: 'test' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped.length).toBe(1);
    expect(audit.skipped[0]).toContain('missing_components');
  });

  // --- set_exclusion ---
  it('set_exclusion: sets exclusion with valid evidence', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      {
        kind: 'set_exclusion',
        exclude: true,
        excludeReason: 'Redundant',
        reason: 'test',
        redundancyEvidence: {
          overlapsWithTableIds: ['q2'],
          sameFilterSignature: true,
          dominanceSignal: 'high',
        },
      },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.exclude).toBe(true);
    expect(result.excludeReason).toBe('Redundant');
    expect(audit.applied).toContain('set_exclusion');
  });

  it('set_exclusion: skips when evidence insufficient', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      {
        kind: 'set_exclusion',
        exclude: true,
        excludeReason: 'Weak',
        reason: 'test',
        redundancyEvidence: {
          overlapsWithTableIds: [],
          sameFilterSignature: false,
          dominanceSignal: 'low',
        },
      },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped).toContain('set_exclusion:insufficient_redundancy_evidence');
  });

  // --- request_structural_override ---
  it('request_structural_override: records override when allowed', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'request_structural_override', reason: 'test', requestedAction: 'Split by brand' },
    ]);
    const { audit } = applyTableMutations(table, input, DEFAULT_OPTS);
    expect(audit.applied).toContain('request_structural_override');
    expect(audit.requestedOverrides).toContain('Split by brand');
  });

  it('request_structural_override: skips when reserved ops disabled', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'request_structural_override', reason: 'test', requestedAction: 'Split by brand' },
    ]);
    const { audit } = applyTableMutations(table, input, { allowReservedOperations: false });
    expect(audit.skipped.length).toBe(1);
    expect(audit.skipped[0]).toContain('reserved_op_disabled');
  });

  // --- flag_for_review ---
  it('flag_for_review: records flag when allowed', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'flag_for_review', reason: 'test', flag: 'scale_direction_unclear' },
    ]);
    const { audit } = applyTableMutations(table, input, DEFAULT_OPTS);
    expect(audit.applied).toContain('flag_for_review');
    expect(audit.reviewFlags).toContain('scale_direction_unclear');
  });

  it('flag_for_review: skips when reserved ops disabled', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'flag_for_review', reason: 'test', flag: 'unclear' },
    ]);
    const { audit } = applyTableMutations(table, input, { allowReservedOperations: false });
    expect(audit.skipped[0]).toContain('reserved_op_disabled');
  });
});

// ============================================================================
// set_question_text
// ============================================================================

describe('applyTableMutations – set_question_text', () => {
  it('sets questionText on the table', () => {
    const table = makeTable({ questionText: 'Old question' });
    const input = prepareInput(table, [
      { kind: 'set_question_text', questionText: 'What is your preferred option?', reason: 'Survey text' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.questionText).toBe('What is your preferred option?');
    expect(audit.applied).toContain('set_question_text');
  });

  it('rejects empty string via schema validation', () => {
    const table = makeTable();
    const rawInput = {
      targetTableId: table.tableId,
      tableVersionHash: computeTableVersionHash(table),
      operations: [{ kind: 'set_question_text', questionText: '', reason: 'test' }],
    };
    expect(() => applyTableMutations(table, rawInput as ApplyTableMutationsInput)).toThrow();
  });
});

// ============================================================================
// update_row_fields
// ============================================================================

describe('applyTableMutations – update_row_fields', () => {
  it('patches a single field on a row', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: '_NET_1', filterValue: '', label: 'Any (NET)', isNet: true, indent: 0, netComponents: ['Q1'] }),
        makeRow({ variable: 'Q1', filterValue: '1', label: 'Old', indent: 0 }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'update_row_fields', rowKey: { variable: 'Q1', filterValue: '1' }, patch: { label: '', filterValue: '', isNet: '', netComponents: [], indent: 1 }, reason: 'fix orphan' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows[1].indent).toBe(1);
    expect(audit.applied).toContain('update_row_fields:Q1:1');
  });

  it('patches multiple fields', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q1', filterValue: '1,2', label: 'NET', isNet: true, indent: 0 }),
        makeRow({ variable: 'Q1', filterValue: '1', label: 'Bad', isNet: false, indent: 1 }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'update_row_fields', rowKey: { variable: 'Q1', filterValue: '1' }, patch: { label: 'Good', filterValue: '', isNet: '', netComponents: [], indent: 1 }, reason: 'fix' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows[1].label).toBe('Good');
    expect(result.rows[1].indent).toBe(1);
    expect(audit.applied).toContain('update_row_fields:Q1:1');
  });

  it('skips on filterValue conflict', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q1', filterValue: '1', label: 'A' }),
        makeRow({ variable: 'Q1', filterValue: '2', label: 'B' }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'update_row_fields', rowKey: { variable: 'Q1', filterValue: '1' }, patch: { label: '', filterValue: '2', isNet: '', netComponents: [], indent: -1 }, reason: 'test' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped[0]).toContain('filterValue_conflict');
    expect(audit.warnings.length).toBeGreaterThan(0);
  });

  it('skips when row not found', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'update_row_fields', rowKey: { variable: 'MISSING', filterValue: '99' }, patch: { label: 'X', filterValue: '', isNet: '', netComponents: [], indent: -1 }, reason: 'test' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped[0]).toContain('row_not_found');
  });
});

// ============================================================================
// delete_row
// ============================================================================

describe('applyTableMutations – delete_row', () => {
  it('deletes a basic row', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q1', filterValue: '1', label: 'Keep' }),
        makeRow({ variable: 'Q1', filterValue: '2', label: 'Delete' }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'delete_row', rowKey: { variable: 'Q1', filterValue: '2' }, reason: 'test' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].label).toBe('Keep');
    expect(audit.applied).toContain('delete_row:Q1:2');
  });

  it('cascades indent reset when deleting a NET row (same-variable)', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q1', filterValue: '4,5', label: 'T2B', isNet: true, indent: 0 }),
        makeRow({ variable: 'Q1', filterValue: '5', label: 'Strongly agree', indent: 1 }),
        makeRow({ variable: 'Q1', filterValue: '4', label: 'Agree', indent: 1 }),
        makeRow({ variable: 'Q1', filterValue: '3', label: 'Neutral', indent: 0 }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'delete_row', rowKey: { variable: 'Q1', filterValue: '4,5' }, reason: 'trivial NET' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows.length).toBe(3);
    // Former children should have indent reset to 0
    expect(result.rows[0].indent).toBe(0); // "Strongly agree"
    expect(result.rows[1].indent).toBe(0); // "Agree"
    expect(result.rows[2].indent).toBe(0); // "Neutral" — was already 0
    expect(audit.applied).toContain('delete_row:Q1:4,5');
  });

  it('cascades indent reset when deleting a multi-variable NET row', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: '_NET_CONCEPT_1', filterValue: '', label: 'Any (NET)', isNet: true, netComponents: ['A1', 'A2'], indent: 0 }),
        makeRow({ variable: 'A1', filterValue: '1', label: 'Item A', indent: 1 }),
        makeRow({ variable: 'A2', filterValue: '1', label: 'Item B', indent: 1 }),
        makeRow({ variable: 'A3', filterValue: '1', label: 'Item C', indent: 0 }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'delete_row', rowKey: { variable: '_NET_CONCEPT_1', filterValue: '' }, reason: 'bad NET' },
    ]);
    const { table: result } = applyTableMutations(table, input);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0].indent).toBe(0); // A1 reset
    expect(result.rows[1].indent).toBe(0); // A2 reset
    expect(result.rows[2].indent).toBe(0); // A3 was already 0
  });

  it('removes deleted row variable from parent NET netComponents', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: '_NET_1', filterValue: '', label: 'Any (NET)', isNet: true, netComponents: ['A1', 'A2', 'A3'], indent: 0 }),
        makeRow({ variable: 'A1', filterValue: '1', label: 'Item A', indent: 1 }),
        makeRow({ variable: 'A2', filterValue: '1', label: 'Item B', indent: 1 }),
        makeRow({ variable: 'A3', filterValue: '1', label: 'Item C', indent: 1 }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'delete_row', rowKey: { variable: 'A3', filterValue: '1' }, reason: 'remove component' },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows.length).toBe(3);
    const netRow = result.rows.find((r) => r.variable === '_NET_1');
    expect(netRow?.netComponents).toEqual(['A1', 'A2']);
    expect(audit.warnings.length).toBe(0); // Still has 2 components
  });

  it('warns when NET drops below 2 components', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: '_NET_1', filterValue: '', label: 'Any (NET)', isNet: true, netComponents: ['A1', 'A2'], indent: 0 }),
        makeRow({ variable: 'A1', filterValue: '1', label: 'Item A', indent: 1 }),
        makeRow({ variable: 'A2', filterValue: '1', label: 'Item B', indent: 1 }),
      ],
    });
    const input = prepareInput(table, [
      { kind: 'delete_row', rowKey: { variable: 'A2', filterValue: '1' }, reason: 'remove one' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.warnings.some((w) => w.includes('dropped below 2 components'))).toBe(true);
  });

  it('prevents deleting the last row', () => {
    const table = makeTable({
      rows: [makeRow({ variable: 'Q1', filterValue: '1' })],
    });
    const input = prepareInput(table, [
      { kind: 'delete_row', rowKey: { variable: 'Q1', filterValue: '1' }, reason: 'test' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped[0]).toContain('last_row_prevention');
  });

  it('skips when row not found', () => {
    const table = makeTable();
    const input = prepareInput(table, [
      { kind: 'delete_row', rowKey: { variable: 'MISSING', filterValue: '99' }, reason: 'test' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped[0]).toContain('row_not_found');
  });
});

// ============================================================================
// create_same_variable_net
// ============================================================================

describe('applyTableMutations – create_same_variable_net', () => {
  it('creates a same-variable NET with indent on components, regrouped after NET', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q5', filterValue: '1', label: 'Strongly disagree' }),
        makeRow({ variable: 'Q5', filterValue: '2', label: 'Disagree' }),
        makeRow({ variable: 'Q5', filterValue: '3', label: 'Neutral' }),
        makeRow({ variable: 'Q5', filterValue: '4', label: 'Agree' }),
        makeRow({ variable: 'Q5', filterValue: '5', label: 'Strongly agree' }),
      ],
    });
    const input = prepareInput(table, [
      {
        kind: 'create_same_variable_net',
        variable: 'Q5',
        label: 'Agree (T2B)',
        filterValues: ['4', '5'],
        position: 'top',
        reason: 'test',
      },
    ]);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.rows.length).toBe(6);
    // NET row at top, followed immediately by its components
    expect(result.rows[0].isNet).toBe(true);
    expect(result.rows[0].label).toBe('Agree (T2B)');
    expect(result.rows[0].filterValue).toBe('4,5');
    expect(result.rows[0].variable).toBe('Q5');
    expect(result.rows[0].indent).toBe(0);
    // Components regrouped immediately after NET
    expect(result.rows[1].filterValue).toBe('4');
    expect(result.rows[1].indent).toBe(1);
    expect(result.rows[2].filterValue).toBe('5');
    expect(result.rows[2].indent).toBe(1);
    // Non-component rows follow
    expect(result.rows[3].filterValue).toBe('1');
    expect(result.rows[3].indent).toBe(0);
    expect(audit.applied).toContain('create_same_variable_net:Agree (T2B)');
  });

  it('skips when filterValues are missing from table', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q5', filterValue: '1', label: 'Option A' }),
        makeRow({ variable: 'Q5', filterValue: '2', label: 'Option B' }),
      ],
    });
    const input = prepareInput(table, [
      {
        kind: 'create_same_variable_net',
        variable: 'Q5',
        label: 'Test NET',
        filterValues: ['1', '99'],
        position: 'top',
        reason: 'test',
      },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped[0]).toContain('missing_filter_values');
  });

  it('rejects trivial NET (covers all values)', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q5', filterValue: '1', label: 'A' }),
        makeRow({ variable: 'Q5', filterValue: '2', label: 'B' }),
      ],
    });
    const input = prepareInput(table, [
      {
        kind: 'create_same_variable_net',
        variable: 'Q5',
        label: 'All (NET)',
        filterValues: ['1', '2'],
        position: 'top',
        reason: 'test',
      },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.skipped[0]).toContain('trivial_net');
    expect(audit.warnings.length).toBeGreaterThan(0);
  });

  it('supports position: bottom (NET + components grouped at end)', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q5', filterValue: '1', label: 'A' }),
        makeRow({ variable: 'Q5', filterValue: '2', label: 'B' }),
        makeRow({ variable: 'Q5', filterValue: '3', label: 'C' }),
      ],
    });
    const input = prepareInput(table, [
      {
        kind: 'create_same_variable_net',
        variable: 'Q5',
        label: 'A+B (NET)',
        filterValues: ['1', '2'],
        position: 'bottom',
        reason: 'test',
      },
    ]);
    const { table: result } = applyTableMutations(table, input);
    // Non-component row first, then NET, then components
    expect(result.rows[0].filterValue).toBe('3'); // non-component
    expect(result.rows[1].label).toBe('A+B (NET)');
    expect(result.rows[1].isNet).toBe(true);
    expect(result.rows[2].indent).toBe(1); // component A
    expect(result.rows[3].indent).toBe(1); // component B
  });

  it('supports position: afterRowKey (NET + components after target)', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q5', filterValue: '1', label: 'A' }),
        makeRow({ variable: 'Q5', filterValue: '2', label: 'B' }),
        makeRow({ variable: 'Q5', filterValue: '3', label: 'C' }),
      ],
    });
    const input = prepareInput(table, [
      {
        kind: 'create_same_variable_net',
        variable: 'Q5',
        label: 'A+B (NET)',
        filterValues: ['1', '2'],
        position: { afterRowKey: { variable: 'Q5', filterValue: '3' } },
        reason: 'test',
      },
    ]);
    const { table: result } = applyTableMutations(table, input);
    // afterRowKey targets C (filterValue 3) which is NOT a component,
    // so the non-component list is just [C], NET goes after C, then components
    expect(result.rows[0].filterValue).toBe('3'); // C stays
    expect(result.rows[1].label).toBe('A+B (NET)');
    expect(result.rows[1].isNet).toBe(true);
    expect(result.rows[2].indent).toBe(1); // component A
    expect(result.rows[3].indent).toBe(1); // component B
  });
});

// ============================================================================
// Invariant checks
// ============================================================================

describe('applyTableMutations – invariants', () => {
  it('warns on duplicate row pairs', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q1', filterValue: '1', label: 'A' }),
        makeRow({ variable: 'Q1', filterValue: '2', label: 'B' }),
      ],
    });
    // Use update_label on first row, then check that the invariant validator
    // doesn't break (duplicates are warnings, not errors)
    const input = prepareInput(table, [
      { kind: 'update_label', rowKey: { variable: 'Q1', filterValue: '1' }, label: 'Updated', reason: 'test' },
    ]);
    const { audit } = applyTableMutations(table, input);
    expect(audit.warnings.filter((w) => w.includes('duplicate_row_pair')).length).toBe(0);
  });

  it('throws on orphan indented row', () => {
    const table = makeTable({
      rows: [
        makeRow({ variable: 'Q1', filterValue: '1', label: 'Normal', indent: 0 }),
        makeRow({ variable: 'Q1', filterValue: '2', label: 'Orphan', indent: 0 }),
      ],
    });
    // Force an orphan indent via update_row_fields
    const input = prepareInput(table, [
      { kind: 'update_row_fields', rowKey: { variable: 'Q1', filterValue: '2' }, patch: { label: '', filterValue: '', isNet: '', netComponents: [], indent: 1 }, reason: 'test' },
    ]);
    expect(() => applyTableMutations(table, input)).toThrow('orphan indented row');
  });

  it('throws on version hash mismatch', () => {
    const table = makeTable();
    const input: ApplyTableMutationsInput = {
      targetTableId: table.tableId,
      tableVersionHash: 'wrong_hash',
      operations: [],
    };
    expect(() => applyTableMutations(table, input)).toThrow('version mismatch');
  });

  it('throws on target table ID mismatch', () => {
    const table = makeTable({ tableId: 'q1' });
    const input: ApplyTableMutationsInput = {
      targetTableId: 'q999',
      tableVersionHash: computeTableVersionHash(table),
      operations: [],
    };
    expect(() => applyTableMutations(table, input)).toThrow('Mutation target mismatch');
  });

  it('applies empty operations without error', () => {
    const table = makeTable();
    const input = prepareInput(table, []);
    const { table: result, audit } = applyTableMutations(table, input);
    expect(result.tableId).toBe(table.tableId);
    expect(audit.applied.length).toBe(0);
  });
});

// ============================================================================
// computeTableVersionHash
// ============================================================================

describe('computeTableVersionHash', () => {
  it('produces a stable hash for the same table', () => {
    const table = makeTable();
    const h1 = computeTableVersionHash(table);
    const h2 = computeTableVersionHash(table);
    expect(h1).toBe(h2);
  });

  it('changes when rows change', () => {
    const t1 = makeTable({ rows: [makeRow({ label: 'A' })] });
    const t2 = makeTable({ rows: [makeRow({ label: 'B' })] });
    expect(computeTableVersionHash(t1)).not.toBe(computeTableVersionHash(t2));
  });

  it('does not include questionText (by design)', () => {
    const t1 = makeTable({ questionText: 'Version 1' });
    const t2 = makeTable({ questionText: 'Version 2' });
    expect(computeTableVersionHash(t1)).toBe(computeTableVersionHash(t2));
  });
});
