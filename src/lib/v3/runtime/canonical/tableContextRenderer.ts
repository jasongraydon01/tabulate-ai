/**
 * V3 Runtime — Table Context Renderer (Stage 13e)
 *
 * Pure function that converts a group of flagged tables + their parent
 * questionId entry + survey rawText into an XML context block for the
 * TableContextAgent AI prompt.
 *
 * No AI calls, no file I/O — pure transformation.
 */

import type {
  CanonicalRow,
  CanonicalTable,
  QuestionIdEntry,
  ParsedSurveyQuestion,
} from './types';
import type { TableTriageReason } from './triage';
import {
  computeNormalizedDivergence,
  LABEL_DIVERGENCE_THRESHOLD,
} from './triage';

// =============================================================================
// Public Types
// =============================================================================

export interface TableContextGroup {
  questionId: string;
  entry: QuestionIdEntry;
  tables: CanonicalTable[];
  triageReasons: Map<string, TableTriageReason[]>; // tableId → reasons
  surveyQuestion: ParsedSurveyQuestion | undefined;
}

// =============================================================================
// Main Renderer
// =============================================================================

/**
 * Render an XML context block for a group of flagged tables.
 * This becomes the user prompt content for the TableContextAgent.
 */
export function renderTableContextBlock(group: TableContextGroup): string {
  const sections: string[] = [];

  // 1. Question context
  sections.push(renderQuestionContext(group));

  // 2. Survey text (if available)
  sections.push(renderSurveyText(group.surveyQuestion));

  // 3. Binary pair annotations (if any paired selected/unselected tables exist)
  sections.push(renderBinaryPairAnnotations(group));

  // 4. Tables
  sections.push(renderTables(group));

  return sections.filter(Boolean).join('\n\n');
}

// =============================================================================
// Section Renderers
// =============================================================================

function renderQuestionContext(group: TableContextGroup): string {
  const { entry } = group;

  // Merge all triage signals across tables for a summary
  const allSignals = new Set<string>();
  for (const reasons of group.triageReasons.values()) {
    for (const r of reasons) {
      allSignals.add(r.signal);
    }
  }

  const lines: string[] = [
    '<question_context>',
    `  <questionId>${escapeXml(group.questionId)}</questionId>`,
    `  <questionText>${escapeXml(entry.questionText || '')}</questionText>`,
    `  <analyticalSubtype>${escapeXml(entry.analyticalSubtype || '')}</analyticalSubtype>`,
    `  <normalizedType>${escapeXml(entry.normalizedType || '')}</normalizedType>`,
    `  <triageSignals>${Array.from(allSignals).join(', ')}</triageSignals>`,
    `  <baseSignals>${escapeXml((entry.baseContract?.signals ?? []).join(', '))}</baseSignals>`,
    '</question_context>',
  ];

  return lines.join('\n');
}

function renderSurveyText(surveyQuestion: ParsedSurveyQuestion | undefined): string {
  if (!surveyQuestion) return '';

  const lines: string[] = [
    '<survey_text>',
    `  <rawText>${escapeXml(surveyQuestion.rawText)}</rawText>`,
  ];

  if (surveyQuestion.answerOptions && surveyQuestion.answerOptions.length > 0) {
    lines.push('  <answer_options>');
    for (const opt of surveyQuestion.answerOptions) {
      lines.push(`    <option code="${escapeXml(String(opt.code))}">${escapeXml(opt.text)}</option>`);
    }
    lines.push('  </answer_options>');
  }

  if (surveyQuestion.scaleLabels && surveyQuestion.scaleLabels.length > 0) {
    lines.push('  <scale_labels>');
    for (const sl of surveyQuestion.scaleLabels) {
      lines.push(`    <label value="${sl.value}">${escapeXml(sl.label)}</label>`);
    }
    lines.push('  </scale_labels>');
  }

  lines.push('</survey_text>');
  return lines.join('\n');
}

interface BinaryPairDescriptor {
  selectedTableId: string;
  unselectedTableId: string;
  familySource: string;
  setIndex: number;
  setLabel: string;
}

/**
 * Identify binary pairs within a group's tables.
 * A pair is two tables with the same stimuliSetSlice (familySource + setIndex)
 * but complementary binarySide values.
 */
function identifyBinaryPairs(tables: CanonicalTable[]): BinaryPairDescriptor[] {
  const groups = new Map<string, { selected?: CanonicalTable; unselected?: CanonicalTable }>();

  for (const table of tables) {
    if (!table.binarySide || !table.stimuliSetSlice) continue;

    const key = `${table.stimuliSetSlice.familySource}||${table.stimuliSetSlice.setIndex}`;
    let group = groups.get(key);
    if (!group) {
      group = {};
      groups.set(key, group);
    }
    group[table.binarySide] = table;
  }

  const pairs: BinaryPairDescriptor[] = [];
  for (const group of groups.values()) {
    if (group.selected && group.unselected) {
      pairs.push({
        selectedTableId: group.selected.tableId,
        unselectedTableId: group.unselected.tableId,
        familySource: group.selected.stimuliSetSlice!.familySource,
        setIndex: group.selected.stimuliSetSlice!.setIndex,
        setLabel: group.selected.stimuliSetSlice!.setLabel,
      });
    }
  }

  return pairs;
}

/**
 * Render group-level binary pair annotations so the AI sees the pairing
 * relationship before processing individual tables.
 */
function renderBinaryPairAnnotations(group: TableContextGroup): string {
  const pairs = identifyBinaryPairs(group.tables);
  if (pairs.length === 0) return '';

  const lines: string[] = ['<binary_pairs>'];
  for (const pair of pairs) {
    lines.push(`  <pair setLabel="${escapeXml(pair.setLabel)}" setIndex="${pair.setIndex}" familySource="${escapeXml(pair.familySource)}">`);
    lines.push(`    <selected tableId="${escapeXml(pair.selectedTableId)}" />`);
    lines.push(`    <unselected tableId="${escapeXml(pair.unselectedTableId)}" />`);
    lines.push('    <guidance>Subtitles and base descriptions should be parallel across both views. The selected view shows respondents who chose the option; the unselected view shows those who did not.</guidance>');
    lines.push('  </pair>');
  }
  lines.push('</binary_pairs>');
  return lines.join('\n');
}

function renderTables(group: TableContextGroup): string {
  const { entry, tables, triageReasons } = group;

  // Determine which tables have label-divergence flagged
  const tablesWithLabelDivergence = new Set<string>();
  for (const [tableId, reasons] of triageReasons.entries()) {
    if (reasons.some(r => r.signal === 'label-divergence')) {
      tablesWithLabelDivergence.add(tableId);
    }
  }

  const lines: string[] = ['<tables>'];

  for (const table of tables) {
    lines.push(`  <table tableId="${escapeXml(table.tableId)}" tableKind="${escapeXml(table.tableKind)}" tableType="${escapeXml(table.tableType)}">`);
    lines.push(`    <subtitle>${escapeXml(table.tableSubtitle)}</subtitle>`);
    lines.push(`    <baseText>${escapeXml(table.baseText)}</baseText>`);
    lines.push(`    <userNote>${escapeXml(table.userNote)}</userNote>`);
    lines.push(`    <basePolicy>${escapeXml(table.basePolicy)}</basePolicy>`);
    if (table.baseViewRole) {
      lines.push(`    <baseViewRole>${escapeXml(table.baseViewRole)}</baseViewRole>`);
    }
    if (table.plannerBaseComparability) {
      lines.push(`    <plannerBaseComparability>${escapeXml(table.plannerBaseComparability)}</plannerBaseComparability>`);
    }
    if (table.plannerBaseSignals && table.plannerBaseSignals.length > 0) {
      lines.push(`    <plannerBaseSignals>${escapeXml(table.plannerBaseSignals.join(', '))}</plannerBaseSignals>`);
    }
    if (table.computeRiskSignals && table.computeRiskSignals.length > 0) {
      lines.push(`    <computeRiskSignals>${escapeXml(table.computeRiskSignals.join(', '))}</computeRiskSignals>`);
    }
    if (table.questionBase != null) {
      lines.push(`    <questionBase>${table.questionBase}</questionBase>`);
    }
    if (table.itemBase != null) {
      lines.push(`    <itemBase>${table.itemBase}</itemBase>`);
    }
    if (table.baseDisclosure) {
      lines.push(`    <baseDisclosure source="${escapeXml(table.baseDisclosure.source)}">`);
      lines.push(`      <defaultBaseText>${escapeXml(table.baseDisclosure.defaultBaseText)}</defaultBaseText>`);
      if (table.baseDisclosure.referenceBaseN != null) {
        lines.push(`      <referenceBaseN>${table.baseDisclosure.referenceBaseN}</referenceBaseN>`);
      }
      if (table.baseDisclosure.itemBaseRange) {
        lines.push(`      <itemBaseRange>${table.baseDisclosure.itemBaseRange[0]}-${table.baseDisclosure.itemBaseRange[1]}</itemBaseRange>`);
      }
      if (table.baseDisclosure.defaultNoteTokens.length > 0) {
        lines.push(`      <defaultNoteTokens>${escapeXml(table.baseDisclosure.defaultNoteTokens.join(', '))}</defaultNoteTokens>`);
      }
      if (table.baseDisclosure.rangeDisclosure) {
        lines.push(`      <rangeDisclosure>${table.baseDisclosure.rangeDisclosure.min}-${table.baseDisclosure.rangeDisclosure.max}</rangeDisclosure>`);
      }
      lines.push('    </baseDisclosure>');
    }
    if (table.stimuliSetSlice) {
      lines.push(`    <stimuliSetSlice familySource="${escapeXml(table.stimuliSetSlice.familySource)}" setIndex="${table.stimuliSetSlice.setIndex}" setLabel="${escapeXml(table.stimuliSetSlice.setLabel)}" sourceQuestionId="${escapeXml(table.stimuliSetSlice.sourceQuestionId)}" />`);
    }
    if (table.binarySide) {
      lines.push(`    <binarySide>${escapeXml(table.binarySide)}</binarySide>`);
    }

    // Rows
    const showLabelAnnotations = tablesWithLabelDivergence.has(table.tableId);
    if (table.rows.length > 0) {
      lines.push('    <rows>');
      for (const row of table.rows) {
        const attrs = [`variable="${escapeXml(row.variable)}"`, `rowKind="${escapeXml(row.rowKind)}"`];

        // Include savLabel/surveyLabel annotations only for label-divergence tables
        if (showLabelAnnotations) {
          const itemLabelInfo = findItemLabelInfo(entry, row);
          if (itemLabelInfo) {
            const divergence = computeNormalizedDivergence(
              itemLabelInfo.savLabel,
              itemLabelInfo.surveyLabel,
              entry.questionText,
            );
            if (divergence != null && divergence > LABEL_DIVERGENCE_THRESHOLD) {
              if (itemLabelInfo.savLabel) attrs.push(`savLabel="${escapeXml(itemLabelInfo.savLabel)}"`);
              if (itemLabelInfo.surveyLabel) attrs.push(`surveyLabel="${escapeXml(itemLabelInfo.surveyLabel)}"`);
            }
          }
        }

        lines.push(`      <row ${attrs.join(' ')}>${escapeXml(row.label)}</row>`);
      }
      lines.push('    </rows>');
    }

    // Triage reasons for this table
    const tableReasons = triageReasons.get(table.tableId);
    if (tableReasons && tableReasons.length > 0) {
      lines.push('    <triage_reasons>');
      for (const r of tableReasons) {
        lines.push(`      <reason signal="${escapeXml(r.signal)}" severity="${escapeXml(r.severity)}">${escapeXml(r.detail)}</reason>`);
      }
      lines.push('    </triage_reasons>');
    }

    lines.push('  </table>');
  }

  lines.push('</tables>');
  return lines.join('\n');
}

// =============================================================================
// Helpers
// =============================================================================

interface ItemLabelInfo {
  savLabel: string | undefined;
  surveyLabel: string | undefined;
}

/**
 * Find the savLabel/surveyLabel for a row variable from the parent entry's items.
 * Checks both item-level labels and scale labels.
 */
function findItemLabelInfo(
  entry: QuestionIdEntry,
  row: CanonicalRow,
): ItemLabelInfo | null {
  if (!entry.items) return null;

  const rowValueKey = toComparableValueKey(row.filterValue);

  for (const item of entry.items) {
    if (item.column !== row.variable) continue;

    // Scale-label tables often use the item column as the row variable and
    // row.filterValue as the scale point. Prefer value-level labels when available.
    if (item.scaleLabels && rowValueKey) {
      for (const scaleLabel of item.scaleLabels) {
        if (toComparableValueKey(scaleLabel.value) === rowValueKey) {
          return {
            savLabel: scaleLabel.savLabel ?? item.savLabel,
            surveyLabel: scaleLabel.surveyLabel ?? item.surveyLabel,
          };
        }
      }
    }

    return { savLabel: item.savLabel, surveyLabel: item.surveyLabel };
  }

  // Fallback: if exactly one scale-label value match exists across items,
  // use it; otherwise skip to avoid ambiguous/misleading annotations.
  if (rowValueKey) {
    let matched: ItemLabelInfo | null = null;
    for (const item of entry.items) {
      for (const scaleLabel of item.scaleLabels ?? []) {
        if (toComparableValueKey(scaleLabel.value) !== rowValueKey) continue;
        const candidate: ItemLabelInfo = {
          savLabel: scaleLabel.savLabel ?? item.savLabel,
          surveyLabel: scaleLabel.surveyLabel ?? item.surveyLabel,
        };
        if (matched) return null;
        matched = candidate;
      }
    }
    if (matched) return matched;
  }

  return null;
}

function toComparableValueKey(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Numeric equivalence: "5", "5.0", 5 -> num:5
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return `num:${numeric}`;
    }
  }

  return `str:${raw.toLowerCase()}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
