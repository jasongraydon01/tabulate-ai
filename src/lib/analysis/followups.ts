import { isToolUIPart, type UIMessage } from "ai";

import type { AnalysisGroundingContext } from "@/lib/analysis/grounding";
import { isAnalysisTableCard, type AnalysisGroundingRef } from "@/lib/analysis/types";

interface BuildDeterministicFollowUpSuggestionsParams {
  groundingContext: Pick<AnalysisGroundingContext, "tables" | "bannerGroups" | "bannerPlanGroups">;
  groundingRefs: AnalysisGroundingRef[];
  responseParts: UIMessage["parts"];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
  }

  return results;
}

function getRenderedTableCards(parts: UIMessage["parts"]) {
  return parts.flatMap((part) => {
    if (
      isToolUIPart(part)
      && part.type === "tool-getTableCard"
      && part.state === "output-available"
      && isAnalysisTableCard(part.output)
    ) {
      return [part.output];
    }

    return [];
  });
}

function getVisibleBannerGroupNames(cards: ReturnType<typeof getRenderedTableCards>): string[] {
  return uniqueStrings(
    cards
      .flatMap((card) => {
        if (card.columnGroups && card.columnGroups.length > 0) {
          return card.columnGroups.map((group) => group.groupName);
        }

        return card.columns.map((column) => column.groupName);
      })
      .filter((groupName) => groupName && groupName.toLocaleLowerCase() !== "total"),
  );
}

function hasStatTestingSignal(cards: ReturnType<typeof getRenderedTableCards>): boolean {
  return cards.some((card) => {
    if (card.significanceTest || card.comparisonGroups.length > 0) {
      return true;
    }

    return card.rows.some((row) => row.values.some((cell) => {
      return cell.sigHigherThan.length > 0 || typeof cell.sigVsTotal === "string";
    }));
  });
}

export function buildDeterministicFollowUpSuggestions(
  params: BuildDeterministicFollowUpSuggestionsParams,
): string[] {
  const renderedTableCards = getRenderedTableCards(params.responseParts);
  const hasGrounding = renderedTableCards.length > 0 || params.groundingRefs.length > 0;
  if (!hasGrounding) return [];

  const suggestionCandidates: string[] = [];
  const currentTableIds = uniqueStrings([
    ...renderedTableCards.map((card) => card.tableId),
    ...params.groundingRefs.map((ref) => ref.sourceTableId),
    ...params.groundingRefs.filter((ref) => ref.refType === "table").map((ref) => ref.refId),
  ]);
  const questionIds = uniqueStrings([
    ...renderedTableCards.map((card) => card.questionId),
    ...params.groundingRefs.map((ref) => ref.sourceQuestionId),
    ...params.groundingRefs.filter((ref) => ref.refType === "question").map((ref) => ref.refId),
  ]);
  const primaryQuestionId = questionIds[0] ?? null;
  const visibleBannerGroups = new Set(
    getVisibleBannerGroupNames(renderedTableCards).map((value) => value.toLocaleLowerCase()),
  );
  const candidateBannerGroups = uniqueStrings([
    ...params.groundingContext.bannerGroups.map((group) => group.groupName),
    ...params.groundingContext.bannerPlanGroups.map((group) => group.groupName),
  ]).filter((groupName) => {
    return groupName.toLocaleLowerCase() !== "total" && !visibleBannerGroups.has(groupName.toLocaleLowerCase());
  });
  const relatedTableIds = primaryQuestionId
    ? uniqueStrings(
      Object.entries(params.groundingContext.tables)
        .filter(([, table]) => table.questionId === primaryQuestionId)
        .map(([tableId]) => tableId),
    )
    : [];

  for (const groupName of candidateBannerGroups.slice(0, 2)) {
    suggestionCandidates.push(`Break this down by ${groupName}`);
  }

  if (renderedTableCards.length > 0 && renderedTableCards.every((card) => card.valueMode !== "count")) {
    suggestionCandidates.push("Show this in counts");
  }

  if (renderedTableCards.length > 0 && renderedTableCards.every((card) => card.valueMode !== "n")) {
    suggestionCandidates.push("Show the base sizes here");
  }

  if (primaryQuestionId) {
    suggestionCandidates.push(`How was ${primaryQuestionId} asked?`);
  }

  if (primaryQuestionId && relatedTableIds.some((tableId) => !currentTableIds.includes(tableId))) {
    suggestionCandidates.push(`Show the related tables for ${primaryQuestionId}`);
  }

  if (hasStatTestingSignal(renderedTableCards)) {
    suggestionCandidates.push("Which differences are statistically significant?");
  }

  return uniqueStrings(suggestionCandidates).slice(0, 4);
}
