/**
 * NET Enrichment Renderer — Builds XML context block for the NETEnrichmentAgent
 *
 * Pure function that converts a flagged canonical table + its question-id entry
 * + raw survey text into the XML context block the AI agent sees.
 *
 * One table per call (unlike TableContextAgent which groups by questionId).
 * Only structural metadata and labels are included — no data values.
 */

import type {
  CanonicalTable,
  QuestionIdEntry,
  ParsedSurveyQuestion,
} from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NetEnrichmentContext {
  table: CanonicalTable;
  entry: QuestionIdEntry;
  surveyQuestion: ParsedSurveyQuestion | undefined;
  triageReasons: string[];
}

// ─── Main Function ───────────────────────────────────────────────────────────

export function renderNetEnrichmentBlock(context: NetEnrichmentContext): string {
  const { table, entry, surveyQuestion } = context;

  const valueRows = table.rows.filter(r => r.rowKind === 'value');
  const parts: string[] = [];

  // Section 1: Question context
  parts.push('<question_context>');
  parts.push(`  <questionId>${escapeXml(entry.questionId)}</questionId>`);
  parts.push(`  <questionText>${escapeXml(entry.questionText || table.questionText || '')}</questionText>`);
  parts.push(`  <analyticalSubtype>${escapeXml(entry.analyticalSubtype || table.analyticalSubtype || '')}</analyticalSubtype>`);
  parts.push(`  <normalizedType>${escapeXml(entry.normalizedType || table.normalizedType || '')}</normalizedType>`);
  parts.push(`  <totalRows>${valueRows.length}</totalRows>`);
  parts.push('</question_context>');
  parts.push('');

  // Section 2: Survey raw text (if available)
  if (surveyQuestion) {
    const rawText = surveyQuestion.rawText || '';
    if (rawText.trim()) {
      parts.push('<survey_raw_text>');
      parts.push(escapeXml(rawText.trim()));
      parts.push('</survey_raw_text>');
      parts.push('');
    }
  }

  // Section 3: Table with rows
  parts.push(`<table id="${escapeXml(table.tableId)}" kind="${escapeXml(table.tableKind)}">`);
  parts.push(`  <subtitle>${escapeXml(table.tableSubtitle || '')}</subtitle>`);
  parts.push(`  <base_text>${escapeXml(table.baseText || '')}</base_text>`);
  parts.push(`  <user_note>${escapeXml(table.userNote || '')}</user_note>`);
  parts.push('  <rows>');

  for (const row of valueRows) {
    parts.push(
      `    <row variable="${escapeXml(row.variable)}" label="${escapeXml(row.label)}" filterValue="${escapeXml(row.filterValue)}" rowKind="value" />`,
    );
  }

  parts.push('  </rows>');
  parts.push('</table>');

  return parts.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
