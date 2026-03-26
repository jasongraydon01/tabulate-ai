/**
 * Shared Test Fixtures
 *
 * Factory functions to produce valid test objects with sensible defaults.
 * Tests override only the fields they care about.
 */

import type { ExtendedTableDefinition, ExtendedTableRow } from '@/schemas/verificationAgentSchema';
import type { DataFileStats, SavVariableMetadata } from '../validation/types';
import type { QuestionGroup, QuestionItem } from '../tables/DataMapGrouper';
import type { RawDataMapVariable } from '../processors/DataMapProcessor';

// =============================================================================
// ExtendedTableRow
// =============================================================================

export function makeRow(overrides: Partial<ExtendedTableRow> = {}): ExtendedTableRow {
  return {
    variable: 'Q1',
    label: 'Option A',
    filterValue: '1',
    isNet: false,
    netComponents: [],
    indent: 0,
    ...overrides,
  };
}

// =============================================================================
// ExtendedTableDefinition
// =============================================================================

export function makeTable(overrides: Partial<ExtendedTableDefinition> = {}): ExtendedTableDefinition {
  return {
    tableId: 'q1',
    questionId: 'Q1',
    questionText: 'What is your preference?',
    tableType: 'frequency',
    rows: [makeRow()],
    sourceTableId: '',
    isDerived: false,
    exclude: false,
    excludeReason: '',
    surveySection: '',
    baseText: '',
    userNote: '',
    tableSubtitle: '',
    additionalFilter: '',
    filterReviewRequired: false,
    splitFromTableId: '',
    lastModifiedBy: 'VerificationAgent',
    ...overrides,
  };
}

// =============================================================================
// SavVariableMetadata
// =============================================================================

export function makeSavMeta(overrides: Partial<SavVariableMetadata> = {}): SavVariableMetadata {
  return {
    column: 'Q1',
    label: 'Question 1',
    format: 'F8.0',
    valueLabels: [],
    rClass: 'numeric',
    nUnique: 5,
    observedMin: 1,
    observedMax: 5,
    observedMean: 3.0,
    observedSd: 1.2,
    observedValues: null,
    ...overrides,
  };
}

// =============================================================================
// DataFileStats
// =============================================================================

export function makeDataFileStats(
  columns: string[],
  metadataMap: Record<string, Partial<SavVariableMetadata>> = {},
): DataFileStats {
  const variableMetadata: Record<string, SavVariableMetadata> = {};
  for (const col of columns) {
    variableMetadata[col] = makeSavMeta({
      column: col,
      ...(metadataMap[col] || {}),
    });
  }
  return {
    rowCount: 100,
    columns,
    stackingColumns: [],
    variableMetadata,
  };
}

// =============================================================================
// QuestionItem / QuestionGroup (for TableGenerator)
// =============================================================================

export function makeQuestionItem(overrides: Partial<QuestionItem> = {}): QuestionItem {
  return {
    column: 'Q1r1',
    label: 'Item 1',
    normalizedType: 'categorical_select',
    valueType: 'Values: 1-5',
    allowedValues: [1, 2, 3],
    scaleLabels: [
      { value: 1, label: 'Low' },
      { value: 2, label: 'Medium' },
      { value: 3, label: 'High' },
    ],
    ...overrides,
  };
}

export function makeQuestionGroup(overrides: Partial<QuestionGroup> = {}): QuestionGroup {
  return {
    questionId: 'Q1',
    questionText: 'How do you rate this?',
    items: [makeQuestionItem()],
    ...overrides,
  };
}

// =============================================================================
// RawDataMapVariable (for DataMapProcessor)
// =============================================================================

export function makeRawVariable(overrides: Partial<RawDataMapVariable> = {}): RawDataMapVariable {
  return {
    level: 'parent',
    column: 'Q1',
    description: 'Sample question',
    valueType: 'Values: 1-5',
    answerOptions: '1=Yes,2=No',
    parentQuestion: 'NA',
    ...overrides,
  };
}
