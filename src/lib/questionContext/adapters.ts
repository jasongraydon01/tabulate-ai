/**
 * Question-centric adapters for building QuestionContext from various sources.
 *
 * Primary source: questionid-final.json (v3 enrichment chain output)
 * These adapters are promoted from scripts/v3-enrichment/lib/question-context.ts.
 */

import type { VerboseDataMap } from '../processors/DataMapProcessor';
import { extractVariableNames } from './extractVariableNames';
import type {
  QuestionContext,
  QuestionContextItem,
  BannerQuestionSummary,
} from '@/schemas/questionContextSchema';

// ---------------------------------------------------------------------------
// Source types — shape of questionid-final.json
// ---------------------------------------------------------------------------

export interface ScaleLabel {
  value?: string | number;
  label?: string;
}

export interface QuestionItem {
  normalizedType?: string | null;
  itemBase?: number | null;
  column?: string;
  label?: string;
  scaleLabels?: ScaleLabel[];
}

export interface HiddenLink {
  linkedTo?: string | null;
  linkMethod?: string | null;
  method?: string | null;
}

export interface LoopInfo {
  detected?: boolean;
  familyBase?: string;
  iterationIndex?: number;
  iterationCount?: number;
  siblingFamilyBases?: string[];
}

export interface QuestionIdEntry {
  questionId: string;
  questionText?: string;
  variables?: string[];
  variableCount?: number;
  disposition?: string;
  isHidden?: boolean;
  hiddenLink?: HiddenLink | null;
  analyticalSubtype?: string | null;
  priority?: string;
  surveyMatch?: string | null;
  loop?: LoopInfo | null;
  loopQuestionId?: string | null;
  normalizedType?: string;
  items?: QuestionItem[];
  // Base contract fields (Phase D — populated by stage 03/12)
  baseContract?: {
    classification?: {
      situation?: string | null;
    };
    signals?: string[];
  } | null;
  totalN?: number | null;
  questionBase?: number | null;
  itemBaseRange?: [number, number] | null;
}

export interface QuestionIdFinalFile {
  metadata?: Record<string, unknown>;
  questionIds: QuestionIdEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKIP_TYPES = new Set(['text_open', 'admin', 'weight']);

function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

function toValueLabels(scaleLabels: ScaleLabel[] | undefined): Array<{ value: string | number; label: string }> {
  if (!scaleLabels || scaleLabels.length === 0) return [];
  return scaleLabels
    .filter((sl) => sl.value !== undefined && sl.value !== null)
    .map((sl) => ({
      value: sl.value!,
      label: normalizeText(sl.label),
    }));
}

function resolveHiddenLink(
  entry: QuestionIdEntry,
): QuestionContext['hiddenLink'] {
  if (!entry.isHidden) return null;
  const link = entry.hiddenLink;
  if (!link) return null;
  const linkedTo = link.linkedTo;
  if (!linkedTo) return null;
  const method = link.linkMethod || link.method || 'unknown';
  return { linkedTo, method };
}

function resolveBaseSummary(entry: QuestionIdEntry): QuestionContext['baseSummary'] {
  const contract = entry.baseContract;
  if (!contract) return null;

  return {
    situation: contract.classification?.situation ?? null,
    signals: contract.signals ?? [],
    questionBase: entry.questionBase ?? null,
    totalN: entry.totalN ?? null,
    itemBaseRange: entry.itemBaseRange ?? null,
  };
}

function resolveLoop(entry: QuestionIdEntry): QuestionContext['loop'] {
  const loop = entry.loop;
  if (!loop?.detected) return null;
  return {
    familyBase: loop.familyBase || entry.questionId,
    iterationIndex: loop.iterationIndex ?? 0,
    iterationCount: loop.iterationCount ?? 1,
  };
}

// ---------------------------------------------------------------------------
// buildQuestionContext — from questionid-final.json
// ---------------------------------------------------------------------------

/**
 * Build question-centric context from questionid-final.json.
 * Filters to reportable entries only, skips text_open/admin/weight items.
 * Preserves question grouping instead of flattening to variable rows.
 */
export function buildQuestionContext(
  questionFile: QuestionIdFinalFile,
): QuestionContext[] {
  const result: QuestionContext[] = [];

  for (const entry of questionFile.questionIds || []) {
    if (entry.disposition !== 'reportable') continue;
    if (!entry.questionId) continue;

    const entryType = (entry.normalizedType || '').trim();
    const variables = Array.isArray(entry.variables) ? entry.variables : [];
    const rawItems = Array.isArray(entry.items) ? entry.items : [];

    const items: QuestionContextItem[] = [];
    const seenColumns = new Set<string>();

    for (const item of rawItems) {
      const col = item.column;
      if (!col) continue;

      const itemType = (item.normalizedType || entryType).trim();
      if (SKIP_TYPES.has(itemType)) continue;

      seenColumns.add(col);
      items.push({
        column: col,
        label: normalizeText(item.label) || col,
        normalizedType: itemType || 'unknown',
        valueLabels: toValueLabels(item.scaleLabels),
      });
    }

    for (const variable of variables) {
      if (seenColumns.has(variable)) continue;

      const varType = entryType;
      if (SKIP_TYPES.has(varType)) continue;

      seenColumns.add(variable);
      items.push({
        column: variable,
        label: variable,
        normalizedType: varType || 'unknown',
        valueLabels: [],
      });
    }

    if (items.length === 0) continue;

    result.push({
      questionId: entry.questionId,
      questionText: normalizeText(entry.questionText) || entry.questionId,
      normalizedType: entryType || 'unknown',
      analyticalSubtype: entry.analyticalSubtype ?? null,
      disposition: 'reportable',
      isHidden: Boolean(entry.isHidden),
      hiddenLink: resolveHiddenLink(entry),
      loop: resolveLoop(entry),
      loopQuestionId: entry.loopQuestionId ?? null,
      surveyMatch: entry.surveyMatch ?? null,
      baseSummary: resolveBaseSummary(entry),
      items,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// buildBannerContext — question-level projection for BannerGenerateAgent
// ---------------------------------------------------------------------------

/**
 * Build question-level summaries for BannerGenerateAgent.
 * One entry per question (not per variable).
 */
export function buildBannerContext(
  questionFile: QuestionIdFinalFile,
): BannerQuestionSummary[] {
  const questions = buildQuestionContext(questionFile);

  return questions.map((q) => {
    const firstWithLabels = q.items.find((i) => i.valueLabels.length > 0);
    const valueLabels = firstWithLabels?.valueLabels ?? [];

    return {
      questionId: q.questionId,
      questionText: q.questionText,
      normalizedType: q.normalizedType,
      analyticalSubtype: q.analyticalSubtype,
      itemCount: q.items.length,
      valueLabels,
      itemLabels: q.items.map((i) => ({ column: i.column, label: i.label })),
      loopIterationCount: q.loop?.iterationCount ?? null,
      isHidden: q.isHidden,
      hiddenLinkedTo: q.hiddenLink?.linkedTo ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// deriveLoopIterationCount
// ---------------------------------------------------------------------------

/**
 * Max loop iteration count across all questions.
 */
export function deriveLoopIterationCount(
  questionFile: QuestionIdFinalFile,
): number {
  let max = 0;
  for (const entry of questionFile.questionIds || []) {
    const loop = entry.loop;
    if (loop?.detected && typeof loop.iterationCount === 'number') {
      max = Math.max(max, loop.iterationCount);
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// extractAllColumns — column set for post-model validation
// ---------------------------------------------------------------------------

/**
 * Flatten all item column names from QuestionContext[] into a Set.
 */
export function extractAllColumns(questions: QuestionContext[]): Set<string> {
  const columns = new Set<string>();
  for (const q of questions) {
    for (const item of q.items) {
      columns.add(item.column);
    }
  }
  return columns;
}

// ---------------------------------------------------------------------------
// toBannerVerboseDataMap — backward-compat shim for BannerGenerateAgent V1
// ---------------------------------------------------------------------------

/**
 * Convert BannerQuestionSummary[] back into flat VerboseDataMap[] rows.
 * @deprecated Use BannerGenerateAgent V2 with question-centric input instead.
 */
export function toBannerVerboseDataMap(
  summaries: BannerQuestionSummary[],
): VerboseDataMap[] {
  const rows: VerboseDataMap[] = [];

  for (const summary of summaries) {
    const answerOptions = packValueLabels(summary.valueLabels);

    if (summary.itemLabels.length <= 1) {
      const item = summary.itemLabels[0];
      rows.push({
        level: 'parent',
        column: item?.column ?? summary.questionId,
        description: summary.questionText,
        valueType: summary.normalizedType || 'unknown',
        answerOptions,
        parentQuestion: summary.questionId,
        normalizedType: summary.normalizedType as VerboseDataMap['normalizedType'],
      });
    } else {
      for (let i = 0; i < summary.itemLabels.length; i++) {
        const item = summary.itemLabels[i];
        const label = item.label;
        const description =
          label && label !== summary.questionText
            ? `${summary.questionText} - ${label}`
            : summary.questionText;

        rows.push({
          level: i === 0 ? 'parent' : 'sub',
          column: item.column,
          description,
          valueType: summary.normalizedType || 'unknown',
          answerOptions: i === 0 ? answerOptions : answerOptionsFallback(summary.normalizedType),
          parentQuestion: summary.questionId,
          normalizedType: summary.normalizedType as VerboseDataMap['normalizedType'],
        });
      }
    }
  }

  return rows;
}

function packValueLabels(valueLabels: Array<{ value: string | number; label: string }>): string {
  if (valueLabels.length === 0) return '';
  return valueLabels
    .slice(0, 80)
    .map((vl) => `${vl.value}=${vl.label}`)
    .join(',');
}

function answerOptionsFallback(normalizedType: string | undefined): string {
  if (normalizedType === 'binary_flag') return '0=Unchecked,1=Checked';
  return '';
}

// ---------------------------------------------------------------------------
// LoopSemanticsExcerptEntry — enriched excerpt for LoopSemanticsPolicyAgent
// ---------------------------------------------------------------------------

export interface LoopSemanticsExcerptEntry {
  // Existing fields (backward-compatible with old datamapExcerpt shape):
  column: string;
  description: string;
  normalizedType: string;
  answerOptions: string;

  // New enriched fields from V3:
  questionId: string;
  questionText: string;
  analyticalSubtype: string | null;
  loop: {
    familyBase: string;
    iterationIndex: number;
    iterationCount: number;
  } | null;
  loopQuestionId: string | null;
}

/**
 * Build an enriched datamap excerpt for LoopSemanticsPolicyAgent from
 * QuestionIdEntry[] (V3 enrichment output).
 *
 * Replaces the legacy buildDatamapExcerpt() which used raw VerboseDataMap.
 * Includes question grouping, loop metadata, and analytical subtypes —
 * giving the agent much richer evidence for entity-anchored classification.
 */
export function buildLoopSemanticsExcerpt(
  entries: QuestionIdEntry[],
  cuts: { rExpression: string }[],
): LoopSemanticsExcerptEntry[] {
  // 1. Collect needed variable names from cut expressions + h/d-prefix variants
  const neededVars = new Set<string>();
  for (const cut of cuts) {
    for (const v of extractVariableNames(cut.rExpression)) {
      neededVars.add(v);
    }
  }
  // Add h-prefix and d-prefix variants
  const prefixed = new Set<string>();
  for (const v of neededVars) {
    prefixed.add(`h${v}`);
    prefixed.add(`d${v}`);
  }
  for (const pv of prefixed) {
    neededVars.add(pv);
  }

  // 2. Build column → { item, parentEntry } lookup
  const columnLookup = new Map<string, { item: QuestionItem; entry: QuestionIdEntry }>();
  for (const entry of entries) {
    const items = Array.isArray(entry.items) ? entry.items : [];
    for (const item of items) {
      if (item.column) {
        columnLookup.set(item.column, { item, entry });
      }
    }
    // Also index entry.variables[] that aren't in items
    const itemColumns = new Set(items.map(i => i.column).filter(Boolean));
    const variables = Array.isArray(entry.variables) ? entry.variables : [];
    for (const varName of variables) {
      if (!itemColumns.has(varName) && !columnLookup.has(varName)) {
        // Create a synthetic item for variables-only entries
        columnLookup.set(varName, {
          item: { column: varName, label: varName, normalizedType: entry.normalizedType },
          entry,
        });
      }
    }
  }

  // 3. Build excerpt entries for needed variables found in lookup
  const excerpt: LoopSemanticsExcerptEntry[] = [];
  const added = new Set<string>();

  for (const varName of neededVars) {
    if (added.has(varName)) continue;
    const match = columnLookup.get(varName);
    if (!match) continue;

    const { item, entry } = match;
    const loopInfo = entry.loop?.detected
      ? {
          familyBase: entry.loop.familyBase || entry.questionId,
          iterationIndex: entry.loop.iterationIndex ?? 0,
          iterationCount: entry.loop.iterationCount ?? 1,
        }
      : null;

    excerpt.push({
      column: varName,
      description: item.label || entry.questionText || varName,
      normalizedType: item.normalizedType || entry.normalizedType || 'unknown',
      answerOptions: packValueLabels(
        toValueLabels(item.scaleLabels),
      ),
      questionId: entry.questionId,
      questionText: normalizeText(entry.questionText) || entry.questionId,
      analyticalSubtype: entry.analyticalSubtype ?? null,
      loop: loopInfo,
      loopQuestionId: entry.loopQuestionId ?? null,
    });
    added.add(varName);
  }

  return excerpt;
}
