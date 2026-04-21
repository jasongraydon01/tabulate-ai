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
