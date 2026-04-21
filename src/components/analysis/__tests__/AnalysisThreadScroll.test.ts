import { describe, expect, it, vi } from "vitest";

import {
  getAnalysisThreadBottomDistance,
  getAnalysisThreadMessageScrollTop,
  isAnalysisThreadNearBottom,
  scrollAnalysisThreadToBottom,
  scrollAnalysisThreadToMessageStart,
  type AnalysisThreadScrollTarget,
  type AnalysisThreadScrollViewport,
} from "@/components/analysis/analysisThreadScroll";

function createViewport({
  clientHeight = 600,
  top,
  scrollTop,
  scrollHeight = 1200,
}: {
  clientHeight?: number;
  top: number;
  scrollTop: number;
  scrollHeight?: number;
}): AnalysisThreadScrollViewport & { scrollTo: (options: ScrollToOptions) => void } {
  const scrollToSpy = vi.fn<(options: ScrollToOptions) => void>();

  return {
    clientHeight,
    scrollHeight,
    scrollTop,
    scrollTo: scrollToSpy,
    getBoundingClientRect: () => ({ top }),
  };
}

function createTarget(top: number): AnalysisThreadScrollTarget {
  return {
    getBoundingClientRect: () => ({ top }),
  };
}

describe("analysis thread scroll helpers", () => {
  it("computes message scroll offset relative to the viewport", () => {
    const viewport = createViewport({ top: 120, scrollTop: 360 });
    const target = createTarget(420);

    expect(getAnalysisThreadMessageScrollTop(viewport, target)).toBe(660);
  });

  it("scrolls to the newest message without relying on page-level scrollIntoView", () => {
    const viewport = createViewport({ top: 80, scrollTop: 220 });
    const target = createTarget(260);

    scrollAnalysisThreadToMessageStart(viewport, target, "auto");

    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 400, behavior: "auto" });
  });

  it("keeps streaming output pinned to the bottom of the thread viewport", () => {
    const viewport = createViewport({ top: 0, scrollTop: 0, scrollHeight: 1850 });

    scrollAnalysisThreadToBottom(viewport, "auto");

    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 1850, behavior: "auto" });
  });

  it("computes remaining distance to the bottom of the viewport", () => {
    const viewport = createViewport({
      top: 0,
      scrollTop: 980,
      clientHeight: 600,
      scrollHeight: 1680,
    });

    expect(getAnalysisThreadBottomDistance(viewport)).toBe(100);
  });

  it("treats the viewport as sticky only when the user is near the bottom", () => {
    const nearBottomViewport = createViewport({
      top: 0,
      scrollTop: 980,
      clientHeight: 600,
      scrollHeight: 1650,
    });
    const awayFromBottomViewport = createViewport({
      top: 0,
      scrollTop: 700,
      clientHeight: 600,
      scrollHeight: 1650,
    });

    expect(isAnalysisThreadNearBottom(nearBottomViewport)).toBe(true);
    expect(isAnalysisThreadNearBottom(awayFromBottomViewport)).toBe(false);
  });
});
