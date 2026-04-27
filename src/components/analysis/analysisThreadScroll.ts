/**
 * @deprecated Slice 2 moved live analysis thread stickiness to
 * `AnalysisConversationShell` and AI Elements Conversation. These helpers are
 * no longer in the live render path and should be removed with the remaining
 * legacy reveal machinery cleanup.
 */
export interface AnalysisThreadScrollViewport {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  scrollTo: (options: ScrollToOptions) => void;
  getBoundingClientRect: () => Pick<DOMRect, "top">;
}

export interface AnalysisThreadScrollTarget {
  getBoundingClientRect: () => Pick<DOMRect, "top">;
}

export type AnalysisThreadRevealScrollEvent =
  | "answer-start"
  | "text-step"
  | "table-shell"
  | "table-ready";

export function getAnalysisThreadMessageScrollTop(
  viewport: AnalysisThreadScrollViewport,
  target: AnalysisThreadScrollTarget,
): number {
  const viewportTop = viewport.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;

  return Math.max(0, viewport.scrollTop + (targetTop - viewportTop));
}

export function scrollAnalysisThreadToMessageStart(
  viewport: AnalysisThreadScrollViewport,
  target: AnalysisThreadScrollTarget,
  behavior: ScrollBehavior = "smooth",
) {
  viewport.scrollTo({
    top: getAnalysisThreadMessageScrollTop(viewport, target),
    behavior,
  });
}

export function scrollAnalysisThreadToBottom(
  viewport: AnalysisThreadScrollViewport,
  behavior: ScrollBehavior = "smooth",
) {
  viewport.scrollTo({
    top: viewport.scrollHeight,
    behavior,
  });
}

export function getAnalysisThreadBottomDistance(
  viewport: AnalysisThreadScrollViewport,
): number {
  return Math.max(0, viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight));
}

export function isAnalysisThreadNearBottom(
  viewport: AnalysisThreadScrollViewport,
  threshold = 96,
): boolean {
  return getAnalysisThreadBottomDistance(viewport) <= threshold;
}

export function scrollAnalysisThreadForRevealEvent(
  viewport: AnalysisThreadScrollViewport,
  target: AnalysisThreadScrollTarget,
  event: AnalysisThreadRevealScrollEvent,
) {
  if (event === "answer-start") {
    scrollAnalysisThreadToMessageStart(viewport, target, "smooth");
    return;
  }

  scrollAnalysisThreadToBottom(viewport, "smooth");
}
