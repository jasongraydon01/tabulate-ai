/**
 * V3 Runtime — Step 10a: Stimuli Set Detection
 *
 * Detects deterministic stimuli sets from loop families that were cleared as
 * false-positive loops. This is primarily used for message/concept testing
 * surveys where the same logical question is repeated across predetermined
 * stimuli sets.
 *
 * Detection rule:
 *   - Only run for message testing or concept testing surveys
 *   - For each cleared loop family, compare normalized item-label sets across
 *     iterations
 *   - If more than one distinct label set exists, annotate the family's
 *     members with the detected set definitions
 */

import type { LoopFamily } from '../gates/loopGate';
import type {
  QuestionIdEntry,
  QuestionIdItem,
  StimuliSetDefinition,
  StimuliSetInfo,
  SurveyMetadata,
} from '../types';

export interface DetectStimuliSetsInput {
  entries: QuestionIdEntry[];
  clearedFamilies: LoopFamily[];
  metadata: SurveyMetadata;
}

interface DetectedFamily {
  memberQuestionIds: string[];
  stimuliSetInfo: StimuliSetInfo;
}

function stripVariablePrefix(text: string, column: string): string {
  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const columnPrefix = new RegExp(`^${escapedColumn}\\s*[:\\-]\\s*`, 'i');
  const genericPrefix = /^[A-Za-z0-9_]+\s*[:\-]\s*/;

  const withoutColumn = text.replace(columnPrefix, '');
  return withoutColumn.replace(genericPrefix, '').trim();
}

function stripQuestionStemSuffix(text: string, questionText: string): string {
  if (!questionText || questionText.length < 10) return text.trim();

  const normalizedQuestion = normalizeLabel(questionText);
  const anchor = normalizedQuestion.split(/\s+/).slice(0, 6).join(' ').trim();
  if (anchor.length < 10) return text.trim();

  const normalizedText = normalizeLabel(text);
  const anchorIdx = normalizedText.lastIndexOf(anchor);
  if (anchorIdx <= 0) return text.trim();

  const leading = normalizedText.slice(0, anchorIdx);
  if (!/[-:]\s*$/.test(leading)) return text.trim();

  return leading.replace(/[-:]\s*$/, '').trim();
}

function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''""]/g, '\'')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveComparableLabel(item: QuestionIdItem, questionText: string): string | null {
  const raw =
    item.messageText?.trim() ||
    item.surveyLabel?.trim() ||
    item.label?.trim() ||
    item.savLabel?.trim() ||
    '';

  if (!raw) return null;

  const withoutPrefix = stripVariablePrefix(raw, item.column);
  const withoutStem = item.messageText
    ? withoutPrefix
    : stripQuestionStemSuffix(withoutPrefix, questionText);
  const normalized = normalizeLabel(withoutStem);

  return normalized || null;
}

function buildLabelSignature(entry: QuestionIdEntry): string | null {
  const labels = entry.items
    .map(item => deriveComparableLabel(item, entry.questionText))
    .filter((label): label is string => Boolean(label));

  if (labels.length === 0) return null;

  return [...new Set(labels)].sort().join('||');
}

function extractSetColumns(entry: QuestionIdEntry): string[] {
  if (entry.items.length > 0) {
    return entry.items.map(item => item.column);
  }
  return [...entry.variables];
}

function detectFamily(family: LoopFamily): DetectedFamily | null {
  const members = [...family.members].sort((a, b) => {
    const left = a.loop?.iterationIndex ?? 0;
    const right = b.loop?.iterationIndex ?? 0;
    return left - right;
  });

  const representative = members[0];
  if (!representative || representative.disposition !== 'reportable' || representative.isHidden) {
    return null;
  }

  const definitions: StimuliSetDefinition[] = [];
  const seenSignatures = new Set<string>();

  for (const member of members) {
    const signature = buildLabelSignature(member);
    if (!signature || seenSignatures.has(signature)) continue;

    seenSignatures.add(signature);
    const columns = extractSetColumns(member);
    definitions.push({
      setIndex: definitions.length,
      sourceQuestionId: member.questionId,
      items: columns,
      itemCount: columns.length,
    });
  }

  if (definitions.length <= 1) return null;

  return {
    memberQuestionIds: members.map(member => member.questionId),
    stimuliSetInfo: {
      detected: true,
      setCount: definitions.length,
      familySource: family.familyBase,
      sets: definitions,
      detectionMethod: 'label_comparison',
    },
  };
}

export function detectStimuliSets(input: DetectStimuliSetsInput): QuestionIdEntry[] {
  const { entries, clearedFamilies, metadata } = input;

  if (!metadata.isMessageTestingSurvey && !metadata.isConceptTestingSurvey) {
    return entries;
  }

  if (clearedFamilies.length === 0) {
    return entries;
  }

  const stimuliSetsByQuestionId = new Map<string, StimuliSetInfo>();

  for (const family of clearedFamilies) {
    const detected = detectFamily(family);
    if (!detected) continue;

    for (const questionId of detected.memberQuestionIds) {
      stimuliSetsByQuestionId.set(questionId, detected.stimuliSetInfo);
    }
  }

  if (stimuliSetsByQuestionId.size === 0) {
    return entries;
  }

  return entries.map(entry => {
    const stimuliSets = stimuliSetsByQuestionId.get(entry.questionId);
    if (!stimuliSets) return entry;
    return { ...entry, stimuliSets };
  });
}
