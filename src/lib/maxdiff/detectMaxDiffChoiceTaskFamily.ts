import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { MessageListEntry } from './MessageListParser';

export interface MaxDiffChoiceTaskCandidate {
  questionId: string;
  confidence: number;
  evidence: string[];
  variableCount: number;
  mostLikeCount: number;
  leastLikeCount: number;
  pairedMostLeastCount: number;
  medianOptionCardinality: number;
}

export interface MaxDiffChoiceTaskDetectionResult {
  detected: boolean;
  questionIds: string[];
  candidates: MaxDiffChoiceTaskCandidate[];
}

function parseOptionCount(entry: VerboseDataMapType): number {
  if (entry.scaleLabels && entry.scaleLabels.length > 0) return entry.scaleLabels.length;
  if (entry.allowedValues && entry.allowedValues.length > 0) return entry.allowedValues.length;

  const raw = entry.answerOptions?.trim();
  if (!raw) return 0;

  if (raw.includes(';')) {
    return raw.split(';').map(s => s.trim()).filter(Boolean).length;
  }
  if (raw.includes(',')) {
    return raw.split(',').map(s => s.trim()).filter(Boolean).length;
  }
  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

const MOST_PATTERN = /\b(most|best|preferred|like most)\b/i;
const LEAST_PATTERN = /\b(least|worst|like least)\b/i;

/**
 * Detect MaxDiff choice-task families using structure, not question IDs.
 */
export function detectMaxDiffChoiceTaskFamily(
  verboseDataMap: VerboseDataMapType[],
  messages?: MessageListEntry[],
): MaxDiffChoiceTaskDetectionResult {
  const byParent = new Map<string, VerboseDataMapType[]>();

  for (const entry of verboseDataMap) {
    if (entry.level !== 'sub') continue;
    if (!entry.parentQuestion || entry.parentQuestion === 'NA') continue;
    if (!byParent.has(entry.parentQuestion)) byParent.set(entry.parentQuestion, []);
    byParent.get(entry.parentQuestion)!.push(entry);
  }

  const candidates: MaxDiffChoiceTaskCandidate[] = [];
  const messageCount = messages?.length ?? 0;

  for (const [questionId, vars] of byParent) {
    if (vars.length < 6) continue;

    const mostLikeCount = vars.filter(v => MOST_PATTERN.test(v.description)).length;
    const leastLikeCount = vars.filter(v => LEAST_PATTERN.test(v.description)).length;
    const pairedMostLeastCount = Math.min(mostLikeCount, leastLikeCount);

    const optionCounts = vars
      .map(parseOptionCount)
      .filter(n => Number.isFinite(n) && n > 0);
    const medianOptionCardinality = Math.round(median(optionCounts));
    const distinctOptionCounts = new Set(optionCounts).size;
    const hasSharedLargeOptionUniverse =
      optionCounts.length >= 4 &&
      medianOptionCardinality >= 8 &&
      distinctOptionCounts <= 2;

    let confidence = 0;
    const evidence: string[] = [];

    if (vars.length >= 8) {
      confidence += 0.35;
      evidence.push(`repeated sibling group (${vars.length} variables)`);
    } else if (vars.length >= 6) {
      confidence += 0.2;
      evidence.push(`moderate sibling group (${vars.length} variables)`);
    }

    if (pairedMostLeastCount >= 2) {
      confidence += 0.35;
      evidence.push(`paired most/least structure (${mostLikeCount}/${leastLikeCount})`);
    } else if (pairedMostLeastCount >= 1) {
      confidence += 0.2;
      evidence.push(`partial most/least structure (${mostLikeCount}/${leastLikeCount})`);
    }

    if (hasSharedLargeOptionUniverse) {
      confidence += 0.2;
      evidence.push(`shared option universe (median=${medianOptionCardinality})`);
    }

    if (messageCount > 0 && Math.abs(medianOptionCardinality - messageCount) <= 2) {
      confidence += 0.1;
      evidence.push(`option cardinality aligned with message list (${messageCount})`);
    }

    confidence = Math.max(0, Math.min(1, confidence));
    if (confidence < 0.6) continue;

    candidates.push({
      questionId,
      confidence,
      evidence,
      variableCount: vars.length,
      mostLikeCount,
      leastLikeCount,
      pairedMostLeastCount,
      medianOptionCardinality,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  return {
    detected: candidates.length > 0,
    questionIds: candidates.map(c => c.questionId),
    candidates,
  };
}

