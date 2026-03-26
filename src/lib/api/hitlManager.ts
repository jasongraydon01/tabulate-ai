import type { FlaggedCrosstabColumn, ReviewAlternative } from './types';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { BannerProcessingResult } from '@/agents/BannerAgent';

function expressionKey(expression: string): string {
  return expression.replace(/\s+/g, '').toLowerCase();
}

function normalizeOriginalExpression(original: string): string {
  let expression = original.trim();
  if (!expression) return '';

  expression = expression.replace(
    /\b([A-Za-z][A-Za-z0-9_.]*)\s*=\s*([-+]?\d+(?:\s*,\s*[-+]?\d+)+)\b/g,
    (_match, variable: string, values: string) => {
      const normalizedValues = values
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .join(',');
      return `${variable} %in% c(${normalizedValues})`;
    },
  );

  expression = expression.replace(/\bAND\b/gi, '&').replace(/\bOR\b/gi, '|');
  expression = expression.replace(/(^|[^<>=!])=([^=])/g, '$1==$2');
  expression = expression.replace(/\s+/g, ' ').trim();
  return expression;
}

function buildReviewAlternatives(
  original: string,
  proposed: string,
  alternatives: Array<{ expression: string; rank: number; userSummary: string }>,
): ReviewAlternative[] {
  const originalTrimmed = original.trim();
  const normalizedOriginal = normalizeOriginalExpression(original);
  const normalizedProposedKey = expressionKey(proposed || '');
  const normalizedOriginalKey = expressionKey(normalizedOriginal);
  const primaryDiffersFromOriginal =
    normalizedOriginal.length > 0 && normalizedOriginalKey !== normalizedProposedKey;

  const reviewAlternatives: ReviewAlternative[] = alternatives.map((alternative) => {
    const isLiteralOriginal =
      primaryDiffersFromOriginal &&
      expressionKey(alternative.expression) === normalizedOriginalKey;

    return {
      expression: alternative.expression,
      rank: alternative.rank,
      userSummary: alternative.userSummary,
      selectable: true,
      source: isLiteralOriginal ? 'literal_original' as const : 'model_alternative' as const,
    };
  });

  const literalAlreadyPresent = reviewAlternatives.some(
    (alternative) => alternative.source === 'literal_original',
  );

  if (primaryDiffersFromOriginal && !literalAlreadyPresent) {
    const nextRank = reviewAlternatives.reduce(
      (maxRank, alternative) => Math.max(maxRank, alternative.rank),
      1,
    ) + 1;

    reviewAlternatives.push({
      expression: originalTrimmed || normalizedOriginal,
      rank: nextRank,
      userSummary: 'Original banner expression shown for reviewer reference.',
      selectable: false,
      nonSelectableReason: 'Original banner expression could not be confirmed as a valid executable fallback.',
      source: 'literal_original',
    });
  }

  return reviewAlternatives;
}

/**
 * Build the crosstab review payload shown at the HITL checkpoint.
 * Every crosstab column is included so review always pauses after stage 21.
 */
export function getFlaggedCrosstabColumns(
  crosstabResult: ValidationResultType,
  bannerResult: BannerProcessingResult
): FlaggedCrosstabColumn[] {
  const flagged: FlaggedCrosstabColumn[] = [];

  // Build a lookup for original expressions from banner
  const originalLookup = new Map<string, string>();
  const extractedStructure = bannerResult.verbose?.data?.extractedStructure;
  if (extractedStructure?.bannerCuts) {
    for (const group of extractedStructure.bannerCuts) {
      for (const col of group.columns) {
        const key = `${group.groupName}::${col.name}`;
        originalLookup.set(key, col.original);
      }
    }
  }

  for (const group of crosstabResult.bannerCuts) {
    for (const col of group.columns) {
      const lookupKey = `${group.groupName}::${col.name}`;
      const original = originalLookup.get(lookupKey) || col.name;
      flagged.push({
        groupName: group.groupName,
        columnName: col.name,
        original,
        proposed: col.adjusted,
        confidence: col.confidence,
        reasoning: col.reasoning,
        userSummary: col.userSummary,
        alternatives: buildReviewAlternatives(original, col.adjusted, col.alternatives || []),
        uncertainties: col.uncertainties || [],
        expressionType: col.expressionType,
      });
    }
  }

  return flagged;
}
