/**
 * V3 Runtime — Step 12: Reconciliation Re-pass
 *
 * Re-enriches AI-corrected entries so they match what the pipeline would have
 * produced if they'd been correctly classified from the start.
 *
 * Ten passes per dataset:
 *   1. Sibling consistency (batch, all entries) — majority-vote subtype, orphan link propagation
 *   2. Small-scale override (all entries) — deterministic safety: 3-4pt scales → standard
 *   3. AI reconciliation (corrected entries only) — recompute fields based on AI mutations
 *   4. Item activity summary (all reportable entries) — derived sparsity signal from itemBase
 *   5. Strip questionId prefix (all entries) — remove redundant "S5: " from questionText
 *   6. Section header propagation (all entries) — copy sectionHeader from survey parse
 *   7. Clean markdown artifacts (all entries) — strip ~~, **, *, backslash escapes
 *   8. Refresh surveyLabel (all entries) — NON-OPTIMAL: re-apply cleaned 08b labels to items
 *   9. Resolve display overrides (all entries)
 *  10. Refresh questionText from cleaned 08b parse (all matched entries)
 *
 * No .sav re-read needed: all base data is already on the entries from step 03.
 *
 * Ported from: scripts/v3-enrichment/12-reconciliation-repass.ts
 */

import type {
  QuestionIdEntry,
  SurveyMetadata,
  RankingDetail,
  ParsedSurveyQuestion,
  ItemActivitySummary,
} from './types';
import { buildEntryBaseContract } from '../baseContract';

// =============================================================================
// Internal Types
// =============================================================================

interface ReconciliationChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}

// =============================================================================
// Ranking K Derivation
// =============================================================================

export function deriveRankingK(
  items: Array<{ itemBase?: number | null }>,
  questionBase: number,
): number | null {
  if (questionBase <= 0) return null;
  const itemBases = items.map(i => i.itemBase).filter((b): b is number => b != null && b > 0);
  if (itemBases.length === 0) return null;

  const totalSelections = itemBases.reduce((sum, b) => sum + b, 0);
  const rawK = totalSelections / questionBase;
  const K = Math.round(rawK);

  if (K < 1 || K > 20) return null;
  if (Math.abs(rawK - K) > 0.5) return null;
  return K;
}

export function makeRankingDetail(
  items: Array<{ itemBase?: number | null }>,
  variableCount: number,
  questionBase: number,
): RankingDetail | null {
  const K = deriveRankingK(items, questionBase);
  if (K === null) return null;
  const N = variableCount;
  const pattern = K < N ? `top-${K}-of-${N}` : `rank-all-${N}`;
  return { K, N, pattern, source: 'reconciliation' };
}

// =============================================================================
// Base Classification Recomputation
// =============================================================================

function recomputeBaseClassification(
  entry: Record<string, unknown>,
  changes: ReconciliationChange[],
): void {
  const items = (entry.items as Array<Record<string, unknown>>) || [];
  const rankingDetail = entry.rankingDetail as RankingDetail | null;
  const questionId = String(entry.questionId || '');
  const questionBase = Number(entry.questionBase || 0);
  const totalN = Number(entry.totalN || 0);
  const isFiltered = Boolean(entry.isFiltered);

  const itemBases = items.map(i => Number(i.itemBase ?? 0)).filter(b => !isNaN(b));
  if (itemBases.length === 0) return;

  const minBase = Math.min(...itemBases);
  const maxBase = Math.max(...itemBases);
  const hasVariableItemBases = itemBases.length > 1 && minBase !== maxBase;

  let newVariableBaseReason: string | null = null;
  if (hasVariableItemBases && rankingDetail?.K) {
    newVariableBaseReason = 'ranking-artifact';
  } else if (hasVariableItemBases) {
    newVariableBaseReason = 'genuine';
  }

  const oldVariableBaseReason = entry.variableBaseReason as string | null;
  if (newVariableBaseReason !== oldVariableBaseReason) {
    changes.push({ field: 'variableBaseReason', oldValue: oldVariableBaseReason, newValue: newVariableBaseReason, reason: `Recomputed after subtype change (rankingDetail ${rankingDetail ? 'present' : 'absent'})` });
    entry.variableBaseReason = newVariableBaseReason;
  }

  let newProposedBase: number;
  let newProposedBaseLabel: string;

  if (hasVariableItemBases && newVariableBaseReason === 'ranking-artifact') {
    newProposedBase = questionBase;
    newProposedBaseLabel = isFiltered ? `Those answering ${questionId}` : 'Total';
  } else if (hasVariableItemBases) {
    newProposedBase = questionBase;
    newProposedBaseLabel = 'Varies by item';
  } else if (isFiltered) {
    newProposedBase = questionBase;
    newProposedBaseLabel = `Those answering ${questionId}`;
  } else {
    newProposedBase = totalN;
    newProposedBaseLabel = 'Total';
  }

  if (newProposedBase !== (entry.proposedBase as number | undefined)) {
    changes.push({ field: 'proposedBase', oldValue: entry.proposedBase, newValue: newProposedBase, reason: 'Recomputed after base classification change' });
    entry.proposedBase = newProposedBase;
  }
  if (newProposedBaseLabel !== (entry.proposedBaseLabel as string | undefined)) {
    changes.push({ field: 'proposedBaseLabel', oldValue: entry.proposedBaseLabel, newValue: newProposedBaseLabel, reason: 'Recomputed after base classification change' });
    entry.proposedBaseLabel = newProposedBaseLabel;
  }
  if (entry.hasVariableItemBases !== hasVariableItemBases) {
    changes.push({ field: 'hasVariableItemBases', oldValue: entry.hasVariableItemBases, newValue: hasVariableItemBases, reason: 'Recomputed from item bases' });
    entry.hasVariableItemBases = hasVariableItemBases;
  }

  const nextBaseContract = buildEntryBaseContract({
    totalN: Number.isFinite(totalN) ? totalN : null,
    questionBase: Number.isFinite(questionBase) ? questionBase : null,
    itemBase: null,
    itemBaseRange: (entry.itemBaseRange as [number, number] | null) ?? null,
    hasVariableItemBases,
    variableBaseReason: (entry.variableBaseReason as 'ranking-artifact' | 'genuine' | null) ?? null,
    rankingDetail,
    exclusionReason: (entry.exclusionReason as string | null | undefined) ?? null,
  });

  if (JSON.stringify(nextBaseContract) !== JSON.stringify(entry.baseContract)) {
    changes.push({
      field: 'baseContract',
      oldValue: entry.baseContract,
      newValue: nextBaseContract,
      reason: 'Recomputed after base classification change',
    });
    entry.baseContract = nextBaseContract;
  }
}

// =============================================================================
// Label Reconciliation
// =============================================================================

function normalizeQuestionId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findSurveyQuestionExact(
  questions: ParsedSurveyQuestion[],
  targetId: string,
): ParsedSurveyQuestion | null {
  const normalizedTarget = normalizeQuestionId(targetId);
  if (!normalizedTarget) return null;
  for (const q of questions) {
    const normalizedQId = normalizeQuestionId(q.questionId || '');
    if (normalizedQId === normalizedTarget) return q;
  }
  return null;
}

function findSurveyQuestion(
  questions: ParsedSurveyQuestion[],
  targetId: string,
): ParsedSurveyQuestion | null {
  // Strategy 1: exact normalized ID match (highest precedence).
  const exact = findSurveyQuestionExact(questions, targetId);
  if (exact) return exact;

  // Strategy 2: short suffix match for minor formatting variance.
  const normalizedTarget = normalizeQuestionId(targetId);
  if (!normalizedTarget) return null;
  for (const q of questions) {
    const normalizedQId = normalizeQuestionId(q.questionId || '');
    if (normalizedQId.endsWith(normalizedTarget) && normalizedQId.length <= normalizedTarget.length + 2) {
      return q;
    }
  }

  // Strategy 3: child-letter -> multipart-parent fallback.
  // Handles A100a -> A100 when the survey's A100 text explicitly contains
  // an `a.` subpart marker.
  const multipartParent = findMultipartParentSurveyQuestion(questions, targetId);
  if (multipartParent) return multipartParent;

  // Strategy 4: strip iteration suffix (_\d+$) from target and retry exact.
  // Handles B500_1 → B500, where the survey has B500 as the parent question.
  const baseTarget = targetId.replace(/_\d+$/, '');
  if (baseTarget !== targetId) {
    const baseExact = findSurveyQuestionExact(questions, baseTarget);
    if (baseExact) return baseExact;
  }

  return null;
}

function findMultipartParentSurveyQuestion(
  questions: ParsedSurveyQuestion[],
  targetId: string,
): ParsedSurveyQuestion | null {
  const parsed = parseMultipartChildQuestionId(targetId);
  if (!parsed) return null;

  for (const question of questions) {
    if (normalizeQuestionId(question.questionId || '') !== normalizeQuestionId(parsed.parentId)) continue;
    if (surveyQuestionContainsPart(question, parsed.partLetter)) {
      return question;
    }
  }

  return null;
}

function parseMultipartChildQuestionId(
  targetId: string,
): { parentId: string; partLetter: string } | null {
  const match = targetId.match(/^([A-Za-z][A-Za-z0-9_]*\d+)([a-z])$/i);
  if (!match) return null;
  return { parentId: match[1], partLetter: match[2].toLowerCase() };
}

function surveyQuestionContainsPart(
  question: ParsedSurveyQuestion,
  partLetter: string,
): boolean {
  const partRegex = new RegExp(`(?:^|[\\r\\n])\\s*(?:\\*\\*)?${partLetter}\\.(?:\\*\\*)?\\s+`, 'im');
  const fallbackRegex = new RegExp(`(?:^|[.?!:]\\s+)(?:\\*\\*)?${partLetter}\\.(?:\\*\\*)?\\s+`, 'i');
  const candidates = [question.rawText, question.questionText]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return candidates.some(value => partRegex.test(value) || fallbackRegex.test(value));
}

function cleanSurveyText(text: string): string {
  return text.replace(/\|\s*---\s*\|/g, '').replace(/\s{2,}/g, ' ').trim();
}

function extractItemCode(column: string): string | null {
  const match = column.match(/[_r](\d+)$/);
  return match ? match[1] : null;
}

function countTruncationSignals(text: string): number {
  const trimmed = text.trim();
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

function shouldPreferSurveyText(current: string | undefined, candidate: string): boolean {
  const currentText = (current || '').trim();
  const nextText = candidate.trim();
  if (!nextText) return false;
  if (!currentText) return true;

  const currentPenalty = countTruncationSignals(currentText);
  const nextPenalty = countTruncationSignals(nextText);
  if (nextPenalty !== currentPenalty) return nextPenalty < currentPenalty;
  if (nextText.length !== currentText.length) return nextText.length > currentText.length;
  return nextText !== currentText;
}

function applyQuestionIdCleanup(text: string, matchedId: string, anchorId: string): string {
  return cleanQuestionText(
    stripQuestionIdPrefix(
      cleanSurveyText(text),
      matchedId,
      anchorId,
    ),
  );
}

function extractMultipartChildQuestionText(
  question: ParsedSurveyQuestion,
  childId: string,
): string | null {
  const parsed = parseMultipartChildQuestionId(childId);
  if (!parsed) return null;
  if (normalizeQuestionId(question.questionId || '') !== normalizeQuestionId(parsed.parentId)) return null;

  const raw = question.rawText || '';
  if (!raw.trim()) return null;

  const siblingRegex = /(^|\n)(\s*(?:\*\*)?([a-z])\.(?:\*\*)?\s+)/gim;
  const starts: Array<{ letter: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = siblingRegex.exec(raw)) !== null) {
    const prefix = match[1] || '';
    const headerStart = match.index + prefix.length;
    starts.push({ letter: match[3].toLowerCase(), index: headerStart });
  }

  const currentIndex = starts.findIndex(entry => entry.letter === parsed.partLetter);
  if (currentIndex < 0) return null;

  const start = starts[currentIndex].index;
  const end = currentIndex + 1 < starts.length ? starts[currentIndex + 1].index : raw.length;
  const stemStart = raw.search(/\S/);
  const introEnd = starts[0]?.index ?? start;
  const intro = stemStart >= 0 && stemStart < introEnd ? raw.slice(stemStart, introEnd).trim() : '';
  const block = raw.slice(start, end);
  const partLines: string[] = [];
  let started = false;

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (started) break;
      continue;
    }
    if (/^\|/.test(line) || /^\{\{/.test(line) || /^\d+\./.test(line)) break;
    if (/^(?:\*{0,2}[a-z]\.\*{0,2}\s+)/i.test(line) && started) break;
    started = true;
    partLines.push(line);
  }

  const partBlock = partLines.join(' ').trim();
  if (!partBlock) return null;

  return [intro, partBlock].filter(Boolean).join(' ');
}

type ReconcileScaleLabel = {
  value: number | string;
  label: string;
  savLabel?: string;
  surveyLabel?: string;
} & Record<string, unknown>;

type ReconcileItem = {
  label?: string;
  column?: string;
  savLabel?: string;
  surveyLabel?: string;
  scaleLabels?: ReconcileScaleLabel[];
} & Record<string, unknown>;

function reconcileLabelsFromSurvey(
  entry: Record<string, unknown>,
  surveyQuestions: ParsedSurveyQuestion[],
  changes: ReconciliationChange[],
): void {
  const questionId = String(entry.questionId || '');
  const surveyText = entry.surveyText as string | null;
  const loopQuestionId = entry.loopQuestionId as string | null;

  const anchorId = loopQuestionId ?? questionId;
  const matched = findSurveyQuestion(surveyQuestions, anchorId);
  if (!matched) return;

  if (matched.questionText) {
    const cleanedText = cleanSurveyText(matched.questionText);
    const currentText = entry.questionText as string | undefined;
    if (cleanedText && cleanedText !== currentText) {
      changes.push({ field: 'questionText', oldValue: currentText, newValue: cleanedText, reason: `Label reconciliation from survey match (${anchorId})` });
      entry.questionText = cleanedText;
    }
  }

  if (matched.questionText && !surveyText) {
    changes.push({ field: 'surveyText', oldValue: null, newValue: matched.questionText, reason: `Survey text populated from parsed survey (${anchorId})` });
    entry.surveyText = matched.questionText;
  }

  const items = (entry.items as ReconcileItem[]) || [];
  const options = matched.answerOptions || [];
  if (options.length === 0 || items.length === 0) return;

  const optionMap = new Map<string, string>();
  for (const opt of options) {
    if (opt.code && opt.text) optionMap.set(String(opt.code), opt.text);
  }
  if (optionMap.size === 0) return;

  for (const [itemIndex, item] of items.entries()) {
    const itemLabel = typeof item.label === 'string' ? item.label : undefined;
    const scaleLabels = item.scaleLabels;

    // Snapshot .sav label even when stage 12 does not overwrite this item label.
    if (itemLabel !== undefined && item.savLabel == null) {
      item.savLabel = itemLabel;
    }

    if (scaleLabels && scaleLabels.length > 0) {
      let updated = false;
      const newScaleLabels = scaleLabels.map(sl => {
        const savLabelVal = sl.savLabel ?? sl.label;
        const surveyLabel = optionMap.get(String(sl.value));
        if (surveyLabel && surveyLabel !== sl.label && surveyLabel.length > sl.label.length) {
          updated = true;
          return { ...sl, label: surveyLabel, savLabel: savLabelVal, surveyLabel };
        }
        return { ...sl, savLabel: savLabelVal };
      });
      if (updated) {
        changes.push({ field: `items[${itemIndex}].scaleLabels`, oldValue: scaleLabels.map(sl => sl.label).join(', '), newValue: newScaleLabels.map(sl => sl.label).join(', '), reason: 'Scale labels enriched from survey options' });
        item.scaleLabels = newScaleLabels;
      } else {
        // Ensure savLabel is set even when no update occurs
        item.scaleLabels = newScaleLabels;
      }
    }

    if (itemLabel && itemLabel.length < 40) {
      const column = typeof item.column === 'string' ? item.column : undefined;
      if (column) {
        const code = extractItemCode(column);
        if (code) {
          const surveyLabel = optionMap.get(code);
          const savLabelVal = item.savLabel ?? itemLabel;
          if (surveyLabel && surveyLabel !== itemLabel && surveyLabel.length > itemLabel.length) {
            changes.push({ field: `items[${itemIndex}].label`, oldValue: itemLabel, newValue: surveyLabel, reason: `Item label enriched from survey option (code=${code})` });
            item.label = surveyLabel;
            item.savLabel = savLabelVal;
            item.surveyLabel = surveyLabel;
          }
        }
      }
    }
  }
}

// =============================================================================
// Priority Recalculation
// =============================================================================

function recomputePriority(entry: Record<string, unknown>, changes: ReconciliationChange[]): void {
  const isHidden = Boolean(entry.isHidden);
  const surveyMatch = entry.surveyMatch as string | null;
  const currentPriority = entry.priority as string | undefined;
  const newPriority = (isHidden && surveyMatch === 'none') ? 'secondary' : 'primary';
  if (newPriority !== currentPriority) {
    changes.push({ field: 'priority', oldValue: currentPriority, newValue: newPriority, reason: `Recomputed: isHidden=${isHidden}, surveyMatch=${surveyMatch}` });
    entry.priority = newPriority;
  }
}

// =============================================================================
// Small Scale Override
// =============================================================================

const SMALL_SCALE_MAX_POINTS = 4;

function applySmallScaleOverride(entry: Record<string, unknown>): ReconciliationChange[] {
  const changes: ReconciliationChange[] = [];
  if (entry.analyticalSubtype !== 'scale') return changes;

  const items = (entry.items as Array<Record<string, unknown>>) || [];
  let pointCount = 0;
  for (const item of items) {
    const scaleLabels = item.scaleLabels as Array<unknown> | undefined;
    if (scaleLabels && scaleLabels.length > 0) { pointCount = scaleLabels.length; break; }
  }

  if (pointCount === 0 || pointCount > SMALL_SCALE_MAX_POINTS) return changes;

  changes.push({ field: 'analyticalSubtype', oldValue: 'scale', newValue: 'standard', reason: `${pointCount}-point scale reclassified as standard: too few points for meaningful roll-ups` });
  entry.analyticalSubtype = 'standard';
  entry.subtypeSource = 'reconciliation-small-scale-override';

  if (entry.normalizedType !== 'categorical_select') {
    changes.push({ field: 'normalizedType', oldValue: entry.normalizedType, newValue: 'categorical_select', reason: 'Aligned normalizedType after small-scale reclassification' });
    entry.normalizedType = 'categorical_select';
  }

  return changes;
}

// =============================================================================
// Sibling Consistency
// =============================================================================

const SIBLING_LINK_PROPAGATION_THRESHOLD = 0.75;
const SIBLING_MIN_GROUP_SIZE = 3;

function extractFamilyPrefix(questionId: string): string {
  return questionId.replace(/\d+$/, '');
}

function buildSiblingGroups(entries: Record<string, unknown>[]): Array<{
  prefix: string;
  members: Record<string, unknown>[];
  subtypeCounts: Record<string, number>;
  majoritySubtype: string;
  majorityPct: number;
  linkedParents: Record<string, number>;
  majorityParent: string | null;
  parentPct: number;
}> {
  const byPrefix = new Map<string, Record<string, unknown>[]>();
  for (const entry of entries) {
    if (entry.disposition !== 'reportable') continue;
    const qid = String(entry.questionId || '');
    const prefix = extractFamilyPrefix(qid);
    if (!prefix || prefix === qid) continue;
    const arr = byPrefix.get(prefix) || [];
    arr.push(entry);
    byPrefix.set(prefix, arr);
  }

  const groups: Array<{
    prefix: string; members: Record<string, unknown>[];
    subtypeCounts: Record<string, number>; majoritySubtype: string; majorityPct: number;
    linkedParents: Record<string, number>; majorityParent: string | null; parentPct: number;
  }> = [];

  for (const [prefix, members] of byPrefix) {
    if (members.length < SIBLING_MIN_GROUP_SIZE) continue;
    const normalizedTypes = new Set(members.map(m => String(m.normalizedType || '')));
    if (normalizedTypes.size !== 1) continue;
    const itemCounts = new Set(members.map(m => {
      const items = m.items as Array<unknown> | undefined;
      return items ? items.length : Number(m.variableCount || 0);
    }));
    if (itemCounts.size !== 1) continue;

    const subtypeCounts: Record<string, number> = {};
    for (const m of members) {
      const sub = String(m.analyticalSubtype || 'null');
      subtypeCounts[sub] = (subtypeCounts[sub] || 0) + 1;
    }

    let majoritySubtype = '';
    let majorityCount = 0;
    for (const [sub, count] of Object.entries(subtypeCounts)) {
      if (count > majorityCount) { majorityCount = count; majoritySubtype = sub; }
    }

    const linkedParents: Record<string, number> = {};
    for (const m of members) {
      const link = m.hiddenLink as { linkedTo?: string | null } | null;
      const parent = link?.linkedTo;
      if (parent) linkedParents[parent] = (linkedParents[parent] || 0) + 1;
    }

    let majorityParent: string | null = null;
    let parentCount = 0;
    for (const [parent, count] of Object.entries(linkedParents)) {
      if (count > parentCount) { parentCount = count; majorityParent = parent; }
    }

    groups.push({
      prefix, members, subtypeCounts, majoritySubtype,
      majorityPct: majorityCount / members.length,
      linkedParents, majorityParent,
      parentPct: members.length > 0 ? parentCount / members.length : 0,
    });
  }

  return groups;
}

function applySiblingConsistencyPass(entries: Record<string, unknown>[]): Map<string, ReconciliationChange[]> {
  const changeMap = new Map<string, ReconciliationChange[]>();
  const groups = buildSiblingGroups(entries);

  for (const group of groups) {
    const hasMismatch = Object.keys(group.subtypeCounts).length > 1;
    const majorityIsStrong = group.majorityPct > 0.5;
    const isTied = hasMismatch && !majorityIsStrong;
    const canPropagateLinks = group.majorityParent && group.parentPct >= SIBLING_LINK_PROPAGATION_THRESHOLD;

    if (!hasMismatch && !canPropagateLinks) continue;

    for (const member of group.members) {
      const qid = String(member.questionId || '');
      const changes: ReconciliationChange[] = changeMap.get(qid) || [];

      if (hasMismatch && majorityIsStrong) {
        const currentSubtype = String(member.analyticalSubtype || 'null');
        if (currentSubtype !== group.majoritySubtype) {
          changes.push({ field: 'analyticalSubtype', oldValue: currentSubtype, newValue: group.majoritySubtype, reason: `Sibling consistency: ${group.prefix}* family is ${Math.round(group.majorityPct * 100)}% ${group.majoritySubtype}` });
          member.analyticalSubtype = group.majoritySubtype;
          member.subtypeSource = 'reconciliation-sibling-consistency';
          if (currentSubtype === 'ranking' && member.rankingDetail) { member.rankingDetail = null; }
          if (group.majoritySubtype === 'ranking' && !member.rankingDetail) {
            const items = (member.items as Array<Record<string, unknown>>) || [];
            const rd = makeRankingDetail(items, Number(member.variableCount || items.length), Number(member.questionBase || 0));
            if (rd) member.rankingDetail = rd;
          }
          recomputeBaseClassification(member, changes);
        }
      }

      if (isTied) {
        const currentSubtype = String(member.analyticalSubtype || 'standard');
        if (currentSubtype !== 'standard') {
          changes.push({ field: 'analyticalSubtype', oldValue: currentSubtype, newValue: 'standard', reason: `Sibling tie-break: ${group.prefix}* forced to standard (safe default)` });
          member.analyticalSubtype = 'standard';
          member.subtypeSource = 'reconciliation-sibling-tie-forced';
          if (currentSubtype === 'ranking' && member.rankingDetail) member.rankingDetail = null;
          recomputeBaseClassification(member, changes);
        }
      }

      if (canPropagateLinks) {
        const link = member.hiddenLink as { linkedTo?: string | null } | null;
        if (!link?.linkedTo && group.majorityParent) {
          member.hiddenLink = { linkedTo: group.majorityParent, linkMethod: 'sibling-consistency-propagation' };
          changes.push({ field: 'hiddenLink', oldValue: null, newValue: member.hiddenLink, reason: `Orphan link propagated from sibling family ${group.prefix}*` });
        }
      }

      if (changes.length > 0) changeMap.set(qid, changes);
    }
  }

  return changeMap;
}

// =============================================================================
// Core Reconciliation per Entry
// =============================================================================

function reconcileEntry(
  entry: Record<string, unknown>,
  surveyQuestions: ParsedSurveyQuestion[],
): ReconciliationChange[] {
  const changes: ReconciliationChange[] = [];
  const review = entry._aiGateReview as { reviewOutcome?: string; reasoning?: string } | null;

  if (!review || review.reviewOutcome !== 'corrected') return changes;

  const reasoning = review.reasoning || '';

  // 1. Subtype change
  const subtypeWasChanged = reasoning.includes('analyticalSubtype') || entry.subtypeSource === 'ai-gate';
  if (subtypeWasChanged) {
    const subtype = entry.analyticalSubtype as string;
    const currentRankingDetail = entry.rankingDetail as RankingDetail | null;
    const items = (entry.items as Array<Record<string, unknown>>) || [];
    const variableCount = Number(entry.variableCount || items.length);
    const questionBase = Number(entry.questionBase || 0);

    if (subtype === 'ranking' && !currentRankingDetail) {
      const newRankingDetail = makeRankingDetail(items, variableCount, questionBase);
      if (newRankingDetail) {
        changes.push({ field: 'rankingDetail', oldValue: null, newValue: newRankingDetail, reason: `Derived ranking detail (K=${newRankingDetail.K}, N=${newRankingDetail.N}) after subtype correction` });
        entry.rankingDetail = newRankingDetail;
      }
    } else if (subtype !== 'ranking' && currentRankingDetail) {
      changes.push({ field: 'rankingDetail', oldValue: currentRankingDetail, newValue: null, reason: `Cleared ranking detail after subtype correction to ${subtype}` });
      entry.rankingDetail = null;
    }

    recomputeBaseClassification(entry, changes);
  }

  // 2. Survey match resolved
  const surveyMatchChanged = reasoning.includes('surveyMatch');
  const surveyMatch = entry.surveyMatch as string | null;
  if (surveyMatchChanged && surveyMatch && surveyMatch !== 'none' && surveyQuestions.length > 0) {
    reconcileLabelsFromSurvey(entry, surveyQuestions, changes);
  }

  // 3. Priority recalculation
  recomputePriority(entry, changes);

  // 4. Provenance
  if (changes.length > 0) {
    entry._reconciliation = {
      reconciledAt: new Date().toISOString(),
      changesApplied: changes.length,
      fields: changes.map(c => c.field),
    };
  }

  return changes;
}

// =============================================================================
// Item Activity Summary
// =============================================================================

/**
 * Compute item-level activity summary from itemBase values.
 * Returns null for non-reportable entries or entries with no items.
 */
export function computeItemActivity(entry: QuestionIdEntry): ItemActivitySummary | null {
  if (entry.disposition !== 'reportable') return null;
  const items = entry.items || [];
  if (items.length === 0) return null;

  let activeCount = 0;
  for (const item of items) {
    if (item.itemBase != null && item.itemBase > 0) activeCount++;
  }

  const totalCount = items.length;
  return {
    activeItemCount: activeCount,
    inactiveItemCount: totalCount - activeCount,
    activePct: Math.round((activeCount / totalCount) * 1000) / 1000,
  };
}

// =============================================================================
// Pass 5: Strip QuestionID Prefix from questionText
// =============================================================================

/**
 * Remove the questionId (or loopQuestionId) from the start of questionText.
 * e.g. "S5: What is your primary..." → "What is your primary..."
 * Preserves text as-is if stripping would empty it.
 */
export function stripQuestionIdPrefix(
  questionText: string,
  questionId: string,
  loopQuestionId: string | null,
): string {
  if (!questionText) return questionText;

  for (const id of [questionId, loopQuestionId]) {
    if (!id) continue;
    // Escape special regex chars in the questionId
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: questionId followed by separator(s) and optional whitespace
    const re = new RegExp(`^${escaped}[\\s.:;,)\\-]+\\s*`, 'i');
    const stripped = questionText.replace(re, '');
    if (stripped.length > 0 && stripped !== questionText) {
      return stripped;
    }
  }

  return questionText;
}

// =============================================================================
// Pass 6: Section Header Propagation
// =============================================================================

function propagateSectionHeaders(
  entries: QuestionIdEntry[],
  surveyQuestions: ParsedSurveyQuestion[],
): void {
  if (surveyQuestions.length === 0) return;

  for (const entry of entries) {
    const anchorId = entry.loopQuestionId ?? entry.questionId;
    const matched = findSurveyQuestion(surveyQuestions, anchorId);
    entry.sectionHeader = matched?.sectionHeader ?? null;
  }
}

// =============================================================================
// Pass 7: Clean Markdown Artifacts from questionText
// =============================================================================

/**
 * Strip markdown formatting artifacts from questionText:
 * - ~~strikethrough~~ markers (keep enclosed text)
 * - **bold** and *italic* markers
 * - Stacked backslash escapes
 * - Collapse whitespace, trim
 */
export function cleanQuestionText(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // Remove strikethrough markers, keep content: ~~text~~ → text
  cleaned = cleaned.replace(/~~/g, '');

  // Remove bold markers: **text** → text
  // Remove italic markers: *text* → text
  // Must handle ** before * to avoid leaving stray asterisks
  cleaned = cleaned.replace(/\*{1,2}([^*]*)\*{1,2}/g, '$1');
  // Catch any remaining stray asterisks from malformed markdown
  cleaned = cleaned.replace(/\*/g, '');

  // Clean stacked backslash escapes: \\\\ → single space
  cleaned = cleaned.replace(/\\{2,}/g, ' ');
  // Remove lone trailing backslashes
  cleaned = cleaned.replace(/\\(?=\s|$)/g, '');

  // Collapse whitespace and trim
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  return cleaned || text; // Preserve original if cleaning empties it
}

// =============================================================================
// Pass 8: Refresh surveyLabel from Cleaned Survey Parse
// =============================================================================

/**
 * NON-OPTIMAL WORKAROUND — see comment in runReconcile() Pass 8.
 *
 * Stage 08a sets `surveyLabel` on items from the raw survey parse. Stage 08b
 * cleans that parse (fixes markdown, truncation, misextracted labels), but the
 * cleaned text is NOT propagated back to `surveyLabel` on items. This pass
 * fixes that by re-matching items against the cleaned survey parse and updating
 * `surveyLabel` (and `label`) with the cleaned text.
 *
 * Also applies `cleanQuestionText()` to any `surveyLabel` that still has
 * markdown artifacts, as a safety net.
 *
 * The proper fix is to refactor 08a to only parse (not match), and do label
 * matching after 08b so `surveyLabel` is set from cleaned text from the start.
 */
function refreshSurveyLabelsFromCleanedParse(
  entries: QuestionIdEntry[],
  surveyParsed: ParsedSurveyQuestion[],
): void {
  for (const entry of entries) {
    const anchorId = entry.loopQuestionId ?? entry.questionId;
    const matched = findSurveyQuestion(surveyParsed, anchorId);

    const items = entry.items as ReconcileItem[] | undefined;
    if (!items || items.length === 0) continue;

    // Build option map from cleaned survey parse
    const optionMap = new Map<string, string>();
    if (matched?.answerOptions) {
      for (const opt of matched.answerOptions) {
        if (opt.code && opt.text) optionMap.set(String(opt.code), opt.text);
      }
    }

    // Build scale label map from cleaned survey parse
    const scaleMap = new Map<string, string>();
    if (matched?.scaleLabels) {
      for (const sl of matched.scaleLabels) {
        if (sl.label) scaleMap.set(String(sl.value), sl.label);
      }
    }

    for (const item of items) {
      // Refresh item-level surveyLabel
      const column = typeof item.column === 'string' ? item.column : undefined;
      const code = column ? extractItemCode(column) : null;
      const cleanedOption = code ? optionMap.get(code) : null;

      if (cleanedOption) {
        if (!item.savLabel && item.label) {
          item.savLabel = item.label;
        }
        item.surveyLabel = cleanedOption;
        if (shouldPreferSurveyText(item.label, cleanedOption)) {
          item.label = cleanedOption;
        }
      } else if (item.surveyLabel) {
        item.surveyLabel = cleanQuestionText(item.surveyLabel);
      }

      // Refresh scale-level surveyLabels
      if (item.scaleLabels) {
        for (const sl of item.scaleLabels) {
          const cleanedScale = scaleMap.get(String(sl.value)) ?? optionMap.get(String(sl.value));
          if (cleanedScale) {
            if (!sl.savLabel) {
              sl.savLabel = sl.label;
            }
            sl.surveyLabel = cleanedScale;
            if (shouldPreferSurveyText(sl.label, cleanedScale)) {
              sl.label = cleanedScale;
            }
          } else if (sl.surveyLabel) {
            sl.surveyLabel = cleanQuestionText(sl.surveyLabel);
          }
        }
      }
    }
  }
}

// =============================================================================
// Pass 9: Resolve Display Overrides
// =============================================================================

/**
 * For entries whose questionId has an iteration suffix (e.g. B500_1, B500_2),
 * set displayQuestionId to the base (B500) and displayQuestionText to the
 * parent survey question's text — so renderers show the parent identity
 * instead of the internal iteration ID.
 *
 * Also resolves displayQuestionText for hidden variables linked to a parent.
 */
function resolveDisplayOverrides(
  entries: QuestionIdEntry[],
  surveyQuestions: ParsedSurveyQuestion[],
): void {
  // Build a lookup from questionId → entry for parent resolution
  const entryIndex = new Map<string, QuestionIdEntry>();
  const iterationFamilyCounts = new Map<string, number>();
  for (const entry of entries) {
    entryIndex.set(entry.questionId, entry);
    const iterBase = entry.questionId.replace(/_\d+$/, '');
    if (iterBase !== entry.questionId) {
      iterationFamilyCounts.set(iterBase, (iterationFamilyCounts.get(iterBase) || 0) + 1);
    }
  }

  for (const entry of entries) {
    // Default: no override
    entry.displayQuestionId = null;
    entry.displayQuestionText = null;

    const qid = entry.questionId;

    // Strategy 1: Iteration suffix (e.g. B500_1 → B500)
    const iterBase = qid.replace(/_\d+$/, '');
    if (iterBase !== qid) {
      const textIsBare = !entry.questionText || entry.questionText === qid || entry.questionText === iterBase;

      // If survey has an explicit question for this exact ID (Q5_1),
      // treat it as its own question — do not force parent display (Q5).
      const exactSurveyQuestion = findSurveyQuestionExact(surveyQuestions, qid);
      if (!exactSurveyQuestion) {
        // Primary path: base matches a survey question.
        const surveyMatch = findSurveyQuestion(surveyQuestions, iterBase);
        if (surveyMatch) {
          entry.displayQuestionId = iterBase;
          // Use parent survey question text if this entry only has a bare ID label.
          if (textIsBare && surveyMatch.questionText) {
            const cleaned = cleanQuestionText(
              stripQuestionIdPrefix(cleanSurveyText(surveyMatch.questionText), iterBase, null),
            );
            entry.displayQuestionText = cleaned || null;
          }
        } else if (textIsBare) {
          // No-survey fallback: preserve readable parent ID when there is
          // family evidence this is a true iteration series.
          const familyCount = iterationFamilyCounts.get(iterBase) || 0;
          const hasParentEntry = entryIndex.has(iterBase);
          const loopAnchoredToBase = entry.loopQuestionId === iterBase;
          const hasIterationEvidence = familyCount > 1 || hasParentEntry || loopAnchoredToBase;
          if (hasIterationEvidence) {
            entry.displayQuestionId = iterBase;
          }
        }
      }
    }

    // Strategy 2: Hidden variable linked to a parent
    if (entry.isHidden && entry.hiddenLink?.linkedTo) {
      const parent = entryIndex.get(entry.hiddenLink.linkedTo);
      if (parent) {
        if (!entry.displayQuestionId) {
          entry.displayQuestionId = parent.displayQuestionId ?? parent.questionId;
        }
        const parentDisplayText = parent.displayQuestionText ?? parent.questionText;
        if (!entry.displayQuestionText && parentDisplayText) {
          entry.displayQuestionText = parentDisplayText;
        }
      }
    }
  }
}

// =============================================================================
// Pass 10: Refresh questionText from Cleaned Survey Parse
// =============================================================================

/**
 * Ensure cleaned 08b question text propagates to all matched entries.
 *
 * Stage 08a applies raw parsed text. Stage 08b improves that text, but until
 * this pass the cleaned question text may not overwrite existing entry text in
 * `questionid-final.json`. This pass makes cleaned survey text authoritative.
 */
function refreshQuestionTextFromCleanedParse(
  entries: QuestionIdEntry[],
  surveyParsed: ParsedSurveyQuestion[],
): void {
  if (surveyParsed.length === 0) return;

  for (const entry of entries) {
    const anchorId = entry.loopQuestionId ?? entry.questionId;
    const matched = findSurveyQuestion(surveyParsed, anchorId);
    if (!matched?.questionText) continue;

    const matchedId = matched.questionId || anchorId;
    const childSpecific = extractMultipartChildQuestionText(matched, anchorId);
    const sourceText = childSpecific ?? matched.questionText;
    const cleaned = applyQuestionIdCleanup(sourceText, matchedId, anchorId);
    if (!cleaned) continue;

    entry.questionText = cleaned;

    // Keep surveyText hydrated for downstream consumers that still read it.
    if (!entry.surveyText && matched.rawText) {
      entry.surveyText = matched.rawText;
    }
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

export interface ReconcileInput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  surveyParsed: ParsedSurveyQuestion[];
}

export interface ReconcileResult {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
}

/**
 * Run the reconciliation re-pass (step 12).
 * Ten passes: sibling consistency → small-scale override → AI reconciliation
 * → item activity → strip prefix → section headers → clean markdown
 * → refresh survey labels → display override resolution
 * → refresh question text from cleaned parse.
 * Returns the final questionid entries.
 */
export function runReconcile(input: ReconcileInput): ReconcileResult {
  const { metadata, surveyParsed } = input;
  // Deep clone entries so mutations don't affect caller's array
  const entries = JSON.parse(JSON.stringify(input.entries)) as QuestionIdEntry[];

  // Pass 1: Sibling consistency (batch, all entries)
  applySiblingConsistencyPass(entries as unknown as Record<string, unknown>[]);

  // Pass 2: Small-scale override (all entries)
  for (const entry of entries) {
    applySmallScaleOverride(entry as unknown as Record<string, unknown>);
  }

  // Pass 3: AI reconciliation (corrected entries only)
  for (const entry of entries) {
    reconcileEntry(entry as unknown as Record<string, unknown>, surveyParsed);
  }

  // Pass 4: Item activity summary (all entries)
  for (const entry of entries) {
    entry.itemActivity = computeItemActivity(entry);
  }

  // Pass 5: Strip questionId prefix from questionText (all entries)
  for (const entry of entries) {
    entry.questionText = stripQuestionIdPrefix(
      entry.questionText,
      entry.questionId,
      entry.loopQuestionId,
    );
  }

  // Pass 6: Section header propagation (all entries)
  propagateSectionHeaders(entries, surveyParsed);

  // Pass 7: Clean markdown artifacts from questionText (all entries)
  for (const entry of entries) {
    entry.questionText = cleanQuestionText(entry.questionText);
  }

  // Pass 8: Refresh surveyLabel from cleaned survey parse (all entries)
  // NON-OPTIMAL: This pass exists because 08a sets surveyLabel from the raw
  // survey parse, and 08b cleans the parse afterward but doesn't propagate
  // cleaned labels back to items. The proper fix is to split 08a into
  // parse-only + match-after-08b, so surveyLabel is set from cleaned text
  // from the start. This pass is a workaround until that refactor happens.
  refreshSurveyLabelsFromCleanedParse(entries, surveyParsed);

  // Pass 9: Resolve display overrides for iteration-suffix entries
  resolveDisplayOverrides(entries, surveyParsed);

  // Pass 10: Refresh question text from cleaned survey parse (all matched entries)
  refreshQuestionTextFromCleanedParse(entries, surveyParsed);

  return { entries, metadata };
}
