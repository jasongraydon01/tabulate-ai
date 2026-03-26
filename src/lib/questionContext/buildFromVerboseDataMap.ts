/**
 * Production adapter: build QuestionContext[] from VerboseDataMap[].
 *
 * This adapter is used when the full v3 enrichment chain has NOT been run
 * (i.e., in the production pipeline where we only have .sav → DataMapProcessor output).
 * It provides question grouping and structured value labels but WITHOUT
 * enrichment metadata (analyticalSubtype, hiddenLink, surveyMatch are null).
 *
 * For the richer version with full enrichment, use buildQuestionContext()
 * from adapters.ts which reads questionid-final.json.
 */

import type { VerboseDataMap } from '../processors/DataMapProcessor';
import type { LoopGroupMapping } from '../validation/LoopCollapser';
import type { QuestionContext, QuestionContextItem } from '@/schemas/questionContextSchema';

const SKIP_TYPES = new Set(['text_open', 'admin', 'weight']);

/**
 * Build QuestionContext[] from VerboseDataMap[] by grouping rows by parentQuestion.
 *
 * @param verboseDataMap — enriched datamap from DataMapProcessor
 * @param loopMappings — optional loop group mappings from LoopCollapser
 */
export function buildQuestionContextFromVerboseDataMap(
  verboseDataMap: VerboseDataMap[],
  loopMappings?: LoopGroupMapping[],
): QuestionContext[] {
  // Filter out non-reportable types
  const reportable = verboseDataMap.filter(
    (v) => !SKIP_TYPES.has(v.normalizedType || ''),
  );

  // Group by parentQuestion
  const groups = new Map<string, VerboseDataMap[]>();
  for (const v of reportable) {
    const key = v.parentQuestion || v.column;
    const group = groups.get(key);
    if (group) {
      group.push(v);
    } else {
      groups.set(key, [v]);
    }
  }

  // Build loop lookup for optional loop metadata
  const loopByFamily = buildLoopLookup(loopMappings);

  const result: QuestionContext[] = [];

  for (const [questionId, members] of groups) {
    // Use the first (parent-level) member for question-level metadata
    const parent = members.find((m) => m.level === 'parent') || members[0];
    const questionText = extractQuestionText(parent, members);

    const items: QuestionContextItem[] = members.map((m) => ({
      column: m.column,
      label: extractItemLabel(m, questionText),
      normalizedType: m.normalizedType || 'unknown',
      valueLabels: parseValueLabels(m),
    }));

    if (items.length === 0) continue;

    // Derive loop metadata from loopMappings if available
    const loopInfo = loopByFamily.get(questionId) ?? null;

    result.push({
      questionId,
      questionText,
      normalizedType: parent.normalizedType || 'unknown',
      analyticalSubtype: null,   // Not available from VerboseDataMap
      disposition: 'reportable',
      isHidden: false,           // Conservative default
      hiddenLink: null,          // Not available from VerboseDataMap
      loop: loopInfo,
      loopQuestionId: loopInfo ? loopInfo.familyBase : null,
      surveyMatch: null,         // Not available from VerboseDataMap
      baseSummary: null,         // Not available from VerboseDataMap (Phase D)
      items,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract question-level text from the parent member's description.
 * If description has " - itemLabel" pattern, strip the item part.
 */
function extractQuestionText(
  parent: VerboseDataMap,
  members: VerboseDataMap[],
): string {
  const desc = (parent.description || '').trim();
  if (!desc) return parent.parentQuestion || parent.column;

  // If multi-item, parent description may be "Question text - Item label"
  // Try to extract just the question text
  if (members.length > 1) {
    const dashIdx = desc.indexOf(' - ');
    if (dashIdx > 0) {
      return desc.slice(0, dashIdx).trim();
    }
  }

  return desc;
}

/**
 * Extract item-level label from a member's description.
 * If description has "Question text - Item label", return just the item label.
 * Otherwise return the full description or the column name.
 */
function extractItemLabel(member: VerboseDataMap, questionText: string): string {
  const desc = (member.description || '').trim();
  if (!desc) return member.column;

  // If description starts with questionText + " - ", extract the item part
  const prefix = questionText + ' - ';
  if (desc.startsWith(prefix) && desc.length > prefix.length) {
    return desc.slice(prefix.length).trim();
  }

  // If the description IS the question text (single-item question), use column
  if (desc === questionText) return member.column;

  return desc;
}

/**
 * Parse value labels from a VerboseDataMap entry.
 * Prefers structured scaleLabels if available, otherwise parses answerOptions string.
 */
function parseValueLabels(
  member: VerboseDataMap,
): Array<{ value: string | number; label: string }> {
  const structured = member.scaleLabels && member.scaleLabels.length > 0
    ? member.scaleLabels.map((sl) => ({
        value: sl.value,
        label: String(sl.label || ''),
      }))
    : [];

  const opts = (member.answerOptions || '').trim();
  const parsed = (!opts || opts === 'NA')
    ? []
    : opts === '0=Unchecked,1=Checked' && member.normalizedType === 'binary_flag'
      ? [
          { value: 0, label: 'Unchecked' },
          { value: 1, label: 'Checked' },
        ]
      : parseAnswerOptionsString(opts);

  // Prefer structured scaleLabels (already parsed)
  if (structured.length === 0) {
    return parsed;
  }
  if (parsed.length === 0) {
    return structured;
  }

  return choosePreferredValueLabels(structured, parsed);
}

/**
 * Parse "1=Yes,2=No,3=Maybe" format into structured value labels.
 * Handles edge cases: values with commas in labels, numeric vs string values.
 */
function parseAnswerOptionsString(
  opts: string,
): Array<{ value: string | number; label: string }> {
  const result: Array<{ value: string | number; label: string }> = [];

  // Split on comma, but only when followed by a digit and equals sign
  // This handles labels that contain commas
  const parts = opts.split(/,(?=\s*(?:\d+|[a-zA-Z])\s*=)/);

  for (const part of parts) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;

    const rawValue = trimmed.slice(0, eqIdx).trim();
    const label = trimmed.slice(eqIdx + 1).trim();
    if (!rawValue) continue;

    // Try to parse as number
    const numValue = Number(rawValue);
    const value = !isNaN(numValue) ? numValue : rawValue;

    result.push({ value, label });
  }

  return result;
}

function choosePreferredValueLabels(
  structured: Array<{ value: string | number; label: string }>,
  parsed: Array<{ value: string | number; label: string }>,
): Array<{ value: string | number; label: string }> {
  const structuredCoverage = countUsableValueLabels(structured);
  const parsedCoverage = countUsableValueLabels(parsed);
  if (parsedCoverage !== structuredCoverage) {
    return parsedCoverage > structuredCoverage ? parsed : structured;
  }

  const structuredPenalty = computeValueLabelPenalty(structured);
  const parsedPenalty = computeValueLabelPenalty(parsed);
  if (parsedPenalty !== structuredPenalty) {
    return parsedPenalty < structuredPenalty ? parsed : structured;
  }

  const structuredNonEmpty = countNonEmptyLabels(structured);
  const parsedNonEmpty = countNonEmptyLabels(parsed);
  if (parsedNonEmpty !== structuredNonEmpty) {
    return parsedNonEmpty > structuredNonEmpty ? parsed : structured;
  }

  const structuredChars = totalLabelChars(structured);
  const parsedChars = totalLabelChars(parsed);
  if (parsedChars !== structuredChars) {
    return parsedChars > structuredChars ? parsed : structured;
  }

  return structured;
}

function countUsableValueLabels(
  labels: Array<{ value: string | number; label: string }>,
): number {
  return labels.filter(label => `${label.value}`.trim() !== '').length;
}

function countNonEmptyLabels(
  labels: Array<{ value: string | number; label: string }>,
): number {
  return labels.filter(label => label.label.trim() !== '').length;
}

function totalLabelChars(
  labels: Array<{ value: string | number; label: string }>,
): number {
  return labels.reduce((sum, label) => sum + label.label.trim().length, 0);
}

function computeValueLabelPenalty(
  labels: Array<{ value: string | number; label: string }>,
): number {
  return labels.reduce((sum, label) => sum + truncationSignalCount(label.label), 0);
}

function truncationSignalCount(label: string): number {
  const trimmed = label.trim();
  if (!trimmed) return 1;

  let penalty = 0;
  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  if (openParens !== closeParens) penalty += 1;
  if (/(?:\($|i\.e\.?$|\/$|:$)/i.test(trimmed)) penalty += 1;
  if (/\*\*|__|~~|\{\{|\}\}|\|/.test(trimmed)) penalty += 1;
  if (/(?:\b(?:and|or|with|for|to|of|the|a|an)\s*)$/i.test(trimmed)) penalty += 1;
  return penalty;
}

/**
 * Build a lookup from question family base → loop metadata.
 */
function buildLoopLookup(
  loopMappings?: LoopGroupMapping[],
): Map<string, QuestionContext['loop']> {
  const lookup = new Map<string, QuestionContext['loop']>();
  if (!loopMappings) return lookup;

  for (const mapping of loopMappings) {
    // Each variable in the mapping has a baseName that corresponds to a parentQuestion
    for (const varMapping of mapping.variables) {
      // The baseName is the parent question ID for this loop variable
      const familyBase = varMapping.baseName;
      if (!lookup.has(familyBase)) {
        lookup.set(familyBase, {
          familyBase,
          iterationIndex: 0,  // Not tracked at this level
          iterationCount: mapping.iterations.length,
        });
      }
    }
  }

  return lookup;
}
