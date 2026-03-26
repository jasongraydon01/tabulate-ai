/**
 * V3 Runtime — Table Report Generator
 *
 * Generates a human-readable plain-text report of the pipeline's table output.
 * Designed for quick spot-checking without reading JSON artifacts.
 *
 * Three sections:
 *   1. Dashboard — totals, distribution by subtype/kind, tables-per-question stats
 *   2. Per-question index — every question with ID, text, table kinds
 *   3. Ambiguous table detail — flagged/ambiguous tables with row-level structure
 *
 * Called from all three pipeline code paths after the compute chain completes.
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  CanonicalTable,
  CanonicalRow,
  QuestionDiagnostic,
  PlannerAmbiguity,
  StructureReview,
  HiddenSuppressionDecision,
  CanonicalChainResult,
  TablePlanOutput,
  ValidatedPlanOutput,
} from './canonical/types';
import type { TableTriageOutput } from './canonical/triage';
import type { PostRQcResult } from './compute/types';

// =============================================================================
// Public Interface
// =============================================================================

export interface TableReportInput {
  dataset: string;
  tables: CanonicalTable[];
  questionDiagnostics?: QuestionDiagnostic[];
  triageOutput?: TableTriageOutput;
  qcResult?: PostRQcResult;
  structureReviews?: StructureReview[];
  ambiguities?: PlannerAmbiguity[];
  suppressionDecisions?: HiddenSuppressionDecision[];
  pipelineTimingMs?: number;
}

/** Maximum number of ambiguous tables shown in detail in section 3. */
const MAX_AMBIGUOUS_DETAIL = 50;

/** Truncate question text to this length in the per-question index. */
const QUESTION_TEXT_MAX = 80;

/** Maximum rows to show per table in the ambiguous detail section. */
const MAX_ROWS_PER_TABLE = 20;

// =============================================================================
// Main Entry Point
// =============================================================================

export function generateTableReport(input: TableReportInput): string {
  const {
    dataset,
    tables,
    questionDiagnostics,
    triageOutput,
    qcResult,
    structureReviews,
    ambiguities,
    suppressionDecisions,
  } = input;

  const nonExcluded = tables.filter(t => !t.exclude);
  const lines: string[] = [];

  // Header
  lines.push('═'.repeat(72));
  lines.push('  TABULATE AI — TABLE REPORT');
  lines.push(`  Dataset: ${dataset}`);
  lines.push(`  Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  if (input.pipelineTimingMs != null) {
    lines.push(`  Pipeline duration: ${formatDuration(input.pipelineTimingMs)}`);
  }
  lines.push('═'.repeat(72));
  lines.push('');

  // Section 1: Dashboard
  lines.push(...renderDashboard(nonExcluded, questionDiagnostics, triageOutput, qcResult, structureReviews, ambiguities, suppressionDecisions));
  lines.push('');

  // Section 2: Per-question index
  lines.push(...renderPerQuestionIndex(nonExcluded, questionDiagnostics));
  lines.push('');

  // Section 3: Ambiguous table detail
  lines.push(...renderAmbiguousDetail(nonExcluded, triageOutput, ambiguities));
  lines.push('');

  // Section 4: Table similarity audit
  lines.push(...renderTableSimilarity(nonExcluded));

  return lines.join('\n');
}

// =============================================================================
// Section 1: Dashboard
// =============================================================================

function renderDashboard(
  tables: CanonicalTable[],
  _diagnostics: QuestionDiagnostic[] | undefined,
  triageOutput: TableTriageOutput | undefined,
  qcResult: PostRQcResult | undefined,
  structureReviews: StructureReview[] | undefined,
  ambiguities: PlannerAmbiguity[] | undefined,
  suppressionDecisions: HiddenSuppressionDecision[] | undefined,
): string[] {
  const lines: string[] = [];

  // --- Totals ---
  const questionIds = new Set(tables.map(t => t.questionId));
  const tablesPerQuestion = Array.from(
    tables.reduce((acc, t) => {
      acc.set(t.questionId, (acc.get(t.questionId) ?? 0) + 1);
      return acc;
    }, new Map<string, number>()).values(),
  ).sort((a, b) => a - b);

  const avg = tablesPerQuestion.length > 0
    ? (tablesPerQuestion.reduce((a, b) => a + b, 0) / tablesPerQuestion.length).toFixed(1)
    : '0';
  const median = tablesPerQuestion.length > 0
    ? tablesPerQuestion[Math.floor(tablesPerQuestion.length / 2)]
    : 0;
  const max = tablesPerQuestion.length > 0
    ? tablesPerQuestion[tablesPerQuestion.length - 1]
    : 0;

  lines.push('SUMMARY');
  lines.push(`  Total tables:           ${tables.length}`);
  lines.push(`  Questions covered:      ${questionIds.size}`);
  lines.push(`  Tables per question:    avg ${avg} / median ${median} / max ${max}`);

  if (suppressionDecisions && suppressionDecisions.length > 0) {
    lines.push(`  Suppressed questions:   ${suppressionDecisions.length}`);
  }
  lines.push('');

  // --- By analytical subtype ---
  const bySubtype = countBy(tables, t => t.analyticalSubtype);
  const subtypeEntries = Object.entries(bySubtype).sort((a, b) => b[1] - a[1]);
  lines.push('BY ANALYTICAL SUBTYPE');
  for (const [subtype, count] of subtypeEntries) {
    const pct = ((count / tables.length) * 100).toFixed(1);
    lines.push(`  ${pad(subtype, 24)} ${padNum(count, 5)} tables (${padNum(pct, 5)}%)`);
  }
  lines.push('');

  // --- By table kind ---
  const byKind = countBy(tables, t => t.tableKind);
  const kindEntries = Object.entries(byKind).sort((a, b) => b[1] - a[1]);
  lines.push('BY TABLE KIND');
  for (const [kind, count] of kindEntries) {
    lines.push(`  ${pad(kind, 40)} ${padNum(count, 5)}`);
  }
  lines.push('');

  // --- Tables-per-question distribution ---
  const tpqDistribution = countBy(tablesPerQuestion.map(String), v => v);
  const tpqEntries = Object.entries(tpqDistribution)
    .map(([k, v]) => [parseInt(k, 10), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  lines.push('TABLES-PER-QUESTION DISTRIBUTION');
  for (const [count, freq] of tpqEntries) {
    const bar = '█'.repeat(Math.min(freq, 40));
    lines.push(`  ${padNum(count, 3)} tables: ${padNum(freq, 3)} questions  ${bar}`);
  }
  lines.push('');

  // --- QC / Triage / Structure Gate Summary ---
  lines.push('PIPELINE QUALITY');
  if (qcResult) {
    lines.push(`  Post-R QC errors:       ${qcResult.errors.length}`);
    lines.push(`  Post-R QC warnings:     ${qcResult.warnings.length}`);
    for (const err of qcResult.errors) {
      lines.push(`    ERROR: ${err}`);
    }
    for (const warn of qcResult.warnings.slice(0, 10)) {
      lines.push(`    WARN:  ${warn}`);
    }
    if (qcResult.warnings.length > 10) {
      lines.push(`    ... and ${qcResult.warnings.length - 10} more warnings`);
    }
  }
  if (triageOutput) {
    lines.push(`  Triage flagged:         ${triageOutput.summary.flaggedTables} of ${triageOutput.summary.totalTables} tables`);
    if (Object.keys(triageOutput.summary.bySignal).length > 0) {
      for (const [signal, count] of Object.entries(triageOutput.summary.bySignal).sort((a, b) => b[1] - a[1])) {
        lines.push(`    ${pad(signal, 30)} ${count}`);
      }
    }
  }
  if (structureReviews && structureReviews.length > 0) {
    const confirmed = structureReviews.filter(r => r.reviewOutcome === 'confirmed').length;
    const corrected = structureReviews.filter(r => r.reviewOutcome === 'corrected').length;
    const flagged = structureReviews.filter(r => r.reviewOutcome === 'flagged_for_human').length;
    lines.push(`  Structure gate:         ${structureReviews.length} reviewed (${confirmed} confirmed, ${corrected} corrected, ${flagged} flagged)`);
  }
  if (ambiguities && ambiguities.length > 0) {
    lines.push(`  Planner ambiguities:    ${ambiguities.length}`);
    const ambByCodes = countBy(ambiguities, a => a.code);
    for (const [code, count] of Object.entries(ambByCodes).sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${pad(code, 40)} ${count}`);
    }
  }

  return lines;
}

// =============================================================================
// Section 2: Per-Question Index
// =============================================================================

function renderPerQuestionIndex(
  tables: CanonicalTable[],
  diagnostics: QuestionDiagnostic[] | undefined,
): string[] {
  const lines: string[] = [];
  lines.push('─'.repeat(72));
  lines.push('  PER-QUESTION INDEX');
  lines.push('─'.repeat(72));
  lines.push('');

  // Group tables by questionId
  const byQuestion = new Map<string, CanonicalTable[]>();
  for (const t of tables) {
    const list = byQuestion.get(t.questionId) ?? [];
    list.push(t);
    byQuestion.set(t.questionId, list);
  }

  // Build diagnostic lookup
  const diagByQid = new Map(
    (diagnostics ?? []).map(d => [d.questionId, d]),
  );

  // Sort questions by sortOrder of first table, then alphabetically
  const sortedQuestions = Array.from(byQuestion.entries())
    .sort((a, b) => {
      const aSort = a[1][0]?.sortOrder ?? 0;
      const bSort = b[1][0]?.sortOrder ?? 0;
      if (aSort !== bSort) return aSort - bSort;
      return a[0].localeCompare(b[0]);
    });

  for (const [questionId, qTables] of sortedQuestions) {
    const firstTable = qTables[0];
    const questionText = truncate(firstTable?.questionText ?? '', QUESTION_TEXT_MAX);
    const subtype = firstTable?.analyticalSubtype ?? 'unknown';
    const diag = diagByQid.get(questionId);

    // Count table kinds with multiplicity
    const kindCounts = countBy(qTables, t => t.tableKind);
    const kindSummary = Object.entries(kindCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => count > 1 ? `${kind} x${count}` : kind)
      .join(', ');
    const familyRoots = Array.from(
      new Set(
        qTables
          .map(t => t.familyRoot.trim())
          .filter(Boolean),
      ),
    ).sort();

    lines.push(`  ${pad(questionId, 12)} │ ${pad(subtype, 12)} │ ${padNum(qTables.length, 3)} tables`);
    lines.push(`  ${' '.repeat(12)} │ "${questionText}"`);
    lines.push(`  ${' '.repeat(12)} │ ${kindSummary}`);
    if (familyRoots.length > 1) {
      lines.push(`  ${' '.repeat(12)} │ Roots: ${familyRoots.join(', ')}`);
    }

    // Show base info and signals if available from diagnostic
    if (diag) {
      const baseParts: string[] = [];
      if (diag.precisionRouting && diag.precisionRouting !== 'none') {
        baseParts.push(`precision: ${diag.precisionRouting}`);
      }
      if (diag.genuineSplit) baseParts.push('genuine-split');
      if (diag.lowBase) baseParts.push('low-base');
      if (baseParts.length > 0) {
        lines.push(`  ${' '.repeat(12)} │ flags: ${baseParts.join(', ')}`);
      }
    }
    lines.push('');
  }

  return lines;
}

// =============================================================================
// Section 3: Ambiguous Table Detail
// =============================================================================

function renderAmbiguousDetail(
  tables: CanonicalTable[],
  triageOutput: TableTriageOutput | undefined,
  ambiguities: PlannerAmbiguity[] | undefined,
): string[] {
  const lines: string[] = [];

  // Collect tables that are "ambiguous" — flagged by triage or have planner ambiguities
  const triageFlaggedIds = new Set<string>();
  const triageSignalsByTableId = new Map<string, string[]>();
  if (triageOutput) {
    for (const decision of triageOutput.decisions) {
      if (decision.flagged) {
        triageFlaggedIds.add(decision.tableId);
        triageSignalsByTableId.set(
          decision.tableId,
          decision.reasons.map(r => `${r.signal} (${r.severity})`),
        );
      }
    }
  }

  const ambiguousQuestionIds = new Set<string>();
  if (ambiguities) {
    for (const amb of ambiguities) {
      if (amb.questionId) ambiguousQuestionIds.add(amb.questionId);
    }
  }

  // Score tables by ambiguity level for sorting
  const scored = tables
    .filter(t => triageFlaggedIds.has(t.tableId) || ambiguousQuestionIds.has(t.questionId))
    .map(t => {
      const signals = triageSignalsByTableId.get(t.tableId) ?? [];
      const hasAmbiguity = ambiguousQuestionIds.has(t.questionId);
      const score = signals.length * 2 + (hasAmbiguity ? 1 : 0);
      return { table: t, signals, hasAmbiguity, score };
    })
    .sort((a, b) => b.score - a.score);

  const toShow = scored.slice(0, MAX_AMBIGUOUS_DETAIL);

  lines.push('─'.repeat(72));
  lines.push(`  AMBIGUOUS TABLES — DETAIL (${toShow.length} of ${scored.length} flagged)`);
  lines.push('─'.repeat(72));
  lines.push('');

  if (toShow.length === 0) {
    lines.push('  No tables flagged for review.');
    return lines;
  }

  // Show planner ambiguity summary first
  if (ambiguities && ambiguities.length > 0) {
    lines.push('  PLANNER AMBIGUITIES:');
    for (const amb of ambiguities) {
      lines.push(`    ${pad(amb.questionId ?? '(global)', 12)} [${amb.code}]`);
      lines.push(`    ${' '.repeat(12)} ${amb.detail}`);
    }
    lines.push('');
  }

  // Show each ambiguous table with its rows
  for (const { table, signals } of toShow) {
    lines.push(`  ┌── ${table.tableId} ──`);
    lines.push(`  │ Kind: ${table.tableKind}  │  Subtype: ${table.analyticalSubtype}  │  Type: ${table.tableType}`);
    lines.push(`  │ Question: "${truncate(table.questionText, 65)}"`);

    if (table.tableSubtitle) {
      lines.push(`  │ Subtitle: "${truncate(table.tableSubtitle, 65)}"`);
    }
    if (table.baseText) {
      lines.push(`  │ Base: "${truncate(table.baseText, 65)}"`);
    }
    if (signals.length > 0) {
      lines.push(`  │ Triage: ${signals.join(', ')}`);
    }
    if (table.splitReason) {
      lines.push(`  │ Split: ${table.splitReason}`);
    }
    if (table.stimuliSetSlice) {
      const ss = table.stimuliSetSlice;
      lines.push(`  │ Stimuli set: ${ss.setLabel} (set ${ss.setIndex}, family: ${ss.familySource})`);
    }
    if (table.binarySide) {
      lines.push(`  │ Binary side: ${table.binarySide}`);
    }

    // Show rows
    const rowsToShow = table.rows.slice(0, MAX_ROWS_PER_TABLE);
    lines.push(`  │ Rows (${table.rows.length}):`);
    for (let i = 0; i < rowsToShow.length; i++) {
      const row = rowsToShow[i];
      lines.push(`  │   ${formatRow(row, i + 1)}`);
    }
    if (table.rows.length > MAX_ROWS_PER_TABLE) {
      lines.push(`  │   ... ${table.rows.length - MAX_ROWS_PER_TABLE} more rows`);
    }

    lines.push(`  └${'─'.repeat(70)}`);
    lines.push('');
  }

  return lines;
}

// =============================================================================
// Section 4: Table Similarity Audit
// =============================================================================

/** Jaccard similarity threshold for flagging a pair of tables. */
const SIMILARITY_THRESHOLD = 0.7;

const SCALE_ROLLUP_KINDS = new Set([
  'scale_overview_full',
  'scale_overview_rollup_combined',
  'scale_overview_rollup_t2b',
  'scale_overview_rollup_b2b',
  'scale_overview_rollup_middle',
  'scale_overview_rollup_mean',
  'scale_item_detail_full',
]);

const RANKING_KINDS = new Set([
  'ranking_overview_rank',
  'ranking_overview_topk',
  'ranking_item_rank',
]);

const GRID_KINDS = new Set([
  'grid_row_detail',
  'grid_col_detail',
]);

type SimilarityClassification =
  | 'expected_scale_views'
  | 'expected_ranking_views'
  | 'expected_ranking_decompositions'
  | 'expected_grid_views'
  | 'expected_overview_detail'
  | 'suspicious';

interface SimilarityPair {
  tableA: string;
  tableB: string;
  questionA: string;
  questionB: string;
  kindA: string;
  kindB: string;
  varSimilarity: number;
  classification: SimilarityClassification;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

function classifySimilarityPair(
  a: CanonicalTable,
  b: CanonicalTable,
): SimilarityClassification {
  const sameQuestion = a.questionId === b.questionId;
  const aKind = a.tableKind;
  const bKind = b.tableKind;
  const differentKind = aKind !== bKind;

  if (!sameQuestion) return 'suspicious';

  if (SCALE_ROLLUP_KINDS.has(aKind) && SCALE_ROLLUP_KINDS.has(bKind)) {
    return 'expected_scale_views';
  }

  if (RANKING_KINDS.has(aKind) && RANKING_KINDS.has(bKind) && differentKind) {
    return 'expected_ranking_views';
  }

  if (RANKING_KINDS.has(aKind) && aKind === bKind && a.tableId !== b.tableId) {
    return 'expected_ranking_decompositions';
  }

  if (GRID_KINDS.has(aKind) && GRID_KINDS.has(bKind)) {
    return 'expected_grid_views';
  }

  if (differentKind) {
    if (
      (aKind.includes('overview') && bKind.includes('detail')) ||
      (aKind.includes('detail') && bKind.includes('overview'))
    ) {
      return 'expected_overview_detail';
    }
  }

  return 'suspicious';
}

function renderTableSimilarity(tables: CanonicalTable[]): string[] {
  const lines: string[] = [];
  lines.push('─'.repeat(72));
  lines.push('  TABLE SIMILARITY AUDIT');
  lines.push('─'.repeat(72));
  lines.push('');

  // Precompute row variable sets
  const varSets = tables.map(t => {
    const vars = new Set<string>();
    for (const row of t.rows) {
      if (row.variable) vars.add(row.variable);
    }
    return vars;
  });

  // Pairwise comparison
  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const sim = jaccard(varSets[i], varSets[j]);
      if (sim < SIMILARITY_THRESHOLD) continue;

      pairs.push({
        tableA: tables[i].tableId,
        tableB: tables[j].tableId,
        questionA: tables[i].questionId,
        questionB: tables[j].questionId,
        kindA: tables[i].tableKind,
        kindB: tables[j].tableKind,
        varSimilarity: sim,
        classification: classifySimilarityPair(tables[i], tables[j]),
      });
    }
  }

  const suspicious = pairs.filter(p => p.classification === 'suspicious');
  const expected = pairs.filter(p => p.classification !== 'suspicious');

  lines.push(`  Pairs above ${(SIMILARITY_THRESHOLD * 100).toFixed(0)}% variable overlap: ${pairs.length}`);
  lines.push(`  Suspicious:        ${suspicious.length}`);
  lines.push(`  Expected siblings: ${expected.length}`);

  const sameQ = pairs.filter(p => p.questionA === p.questionB).length;
  const crossQ = pairs.length - sameQ;
  lines.push(`  Same-question:     ${sameQ}`);
  lines.push(`  Cross-question:    ${crossQ}`);
  lines.push('');

  // Suspicious pairs — show detail
  if (suspicious.length > 0) {
    lines.push(`  !!! SUSPICIOUS PAIRS (${suspicious.length}) !!!`);
    lines.push('');
    for (const p of suspicious.slice(0, 20)) {
      const pct = `${(p.varSimilarity * 100).toFixed(0)}%`;
      lines.push(`    ${p.tableA}`);
      lines.push(`      vs ${p.tableB}`);
      lines.push(`      Overlap: ${pct}  |  Questions: ${p.questionA} vs ${p.questionB}  |  Kinds: ${p.kindA} vs ${p.kindB}`);
      lines.push('');
    }
    if (suspicious.length > 20) {
      lines.push(`    ... and ${suspicious.length - 20} more suspicious pairs`);
      lines.push('');
    }
  } else {
    lines.push('  Verdict: All overlap is structurally expected. No redundancy detected.');
    lines.push('');
  }

  // Expected siblings — compact summary by classification
  if (expected.length > 0) {
    const classLabels: Record<string, string> = {
      expected_scale_views: 'Scale rollup variants (T2B / B2B / middle / mean / full)',
      expected_ranking_views: 'Ranking view variants (overview / topK / item rank)',
      expected_ranking_decompositions: 'Ranking rank/topK decompositions',
      expected_grid_views: 'Grid view variants (row detail / col detail)',
      expected_overview_detail: 'Overview vs item detail',
    };

    const byClass = new Map<string, SimilarityPair[]>();
    for (const p of expected) {
      const list = byClass.get(p.classification) ?? [];
      list.push(p);
      byClass.set(p.classification, list);
    }

    lines.push(`  Expected structural siblings:`);
    for (const [cls, clsPairs] of Array.from(byClass.entries()).sort((a, b) => b[1].length - a[1].length)) {
      const label = classLabels[cls] ?? cls;
      const questions = new Set<string>();
      for (const p of clsPairs) {
        questions.add(p.questionA);
        questions.add(p.questionB);
      }
      lines.push(`    ${label}`);
      lines.push(`      ${clsPairs.length} pairs across ${questions.size} questions: ${Array.from(questions).sort().join(', ')}`);
    }
  }

  return lines;
}

// =============================================================================
// Row Formatting
// =============================================================================

function formatRow(row: CanonicalRow, index: number): string {
  const num = padNum(index, 3);
  const label = pad(row.label, 40);
  const variable = row.variable !== '_CAT_' ? `[${row.variable}]` : '';

  const tags: string[] = [];
  if (row.isNet) tags.push('NET');
  if (row.rowKind === 'stat') tags.push(`stat:${row.statType}`);
  if (row.rowKind === 'not_answered') tags.push('NA');
  if (row.rollupConfig) tags.push(`rollup:${row.rollupConfig.boxPosition}`);
  if (row.excludeFromStats) tags.push('excl');
  if (row.indent > 0) tags.push(`indent:${row.indent}`);

  const tagStr = tags.length > 0 ? ` {${tags.join(', ')}}` : '';
  return `${num}. ${label} ${variable}${tagStr}`;
}

// =============================================================================
// Utilities
// =============================================================================

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function padNum(value: number | string, width: number): string {
  const s = String(value);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// =============================================================================
// Pipeline Integration Helper
// =============================================================================

/**
 * Convenience function for pipeline code paths. Assembles report input from
 * the canonical chain result, loads triage/QC from disk, generates the report,
 * and writes it to `{outputDir}/report.txt`.
 *
 * Non-fatal: if anything fails, logs a warning and returns without throwing.
 */
export async function writeTableReport(opts: {
  dataset: string;
  outputDir: string;
  canonical?: CanonicalChainResult;
  tables?: CanonicalTable[];
  pipelineTimingMs?: number;
}): Promise<void> {
  try {
    const { dataset, outputDir, canonical, pipelineTimingMs } = opts;
    const tables = opts.tables ?? canonical?.tables ?? [];
    if (tables.length === 0) {
      console.warn('[TableReport] No tables available — skipping report');
      return;
    }

    const tablePlan: TablePlanOutput | undefined = canonical?.tablePlan;
    const validatedPlan: ValidatedPlanOutput | undefined = canonical?.validatedPlan;

    const reportInput: TableReportInput = {
      dataset,
      tables,
      questionDiagnostics: tablePlan?.summary?.questionDiagnostics,
      ambiguities: tablePlan?.ambiguities,
      suppressionDecisions: tablePlan?.summary?.suppressionDecisions,
      structureReviews: validatedPlan?.structureReviews,
      pipelineTimingMs,
    };

    // Best-effort: load table plan from disk (for reviewCompletion path)
    if (!tablePlan) {
      try {
        const planPath = path.join(outputDir, 'tables', '13b-table-plan.json');
        const loadedPlan = JSON.parse(await fs.readFile(planPath, 'utf-8')) as TablePlanOutput;
        reportInput.questionDiagnostics = loadedPlan.summary?.questionDiagnostics;
        reportInput.ambiguities = loadedPlan.ambiguities;
        reportInput.suppressionDecisions = loadedPlan.summary?.suppressionDecisions;
      } catch { /* table plan may not exist */ }
    }

    // Best-effort: load validated plan from disk (for structure reviews)
    if (!validatedPlan) {
      try {
        const vpPath = path.join(outputDir, 'tables', '13c-table-plan-validated.json');
        const loadedVp = JSON.parse(await fs.readFile(vpPath, 'utf-8')) as ValidatedPlanOutput;
        reportInput.structureReviews = loadedVp.structureReviews;
      } catch { /* validated plan may not exist */ }
    }

    // Best-effort: load triage output from disk
    try {
      const triagePath = path.join(outputDir, 'tables', '13e-triage.json');
      reportInput.triageOutput = JSON.parse(await fs.readFile(triagePath, 'utf-8'));
    } catch { /* triage file may not exist */ }

    // Best-effort: load QC report from disk
    try {
      const qcPath = path.join(outputDir, 'compute', 'post-r-qc-report.json');
      reportInput.qcResult = JSON.parse(await fs.readFile(qcPath, 'utf-8'));
    } catch { /* QC file may not exist */ }

    const report = generateTableReport(reportInput);
    await fs.writeFile(path.join(outputDir, 'report.txt'), report, 'utf-8');
    console.log(`[TableReport] Written to ${path.join(outputDir, 'report.txt')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[TableReport] Failed to generate report (non-fatal): ${msg}`);
  }
}
