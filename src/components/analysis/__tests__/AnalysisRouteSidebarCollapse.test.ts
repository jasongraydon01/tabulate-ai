import { describe, expect, it, vi } from "vitest";

import {
  applyAnalysisRouteSidebarCollapse,
  createAnalysisRouteSidebarCollapseState,
  restoreAnalysisRouteSidebarCollapse,
} from "@/components/analysis/AnalysisRouteSidebarCollapse";

describe("AnalysisRouteSidebarCollapse lifecycle", () => {
  it("temporarily collapses the desktop sidebar and restores the previous state", () => {
    const state = createAnalysisRouteSidebarCollapseState();
    const setOpen = vi.fn<(open: boolean) => void>();

    applyAnalysisRouteSidebarCollapse({
      isMobile: false,
      open: true,
      setOpen,
      state,
    });
    restoreAnalysisRouteSidebarCollapse({ setOpen, state });

    expect(setOpen).toHaveBeenNthCalledWith(1, false);
    expect(setOpen).toHaveBeenNthCalledWith(2, true);
  });

  it("does not collapse mobile sidebar state", () => {
    const state = createAnalysisRouteSidebarCollapseState();
    const setOpen = vi.fn<(open: boolean) => void>();

    applyAnalysisRouteSidebarCollapse({
      isMobile: true,
      open: true,
      setOpen,
      state,
    });
    restoreAnalysisRouteSidebarCollapse({ setOpen, state });

    expect(setOpen).not.toHaveBeenCalled();
  });

  it("restores a previously collapsed desktop sidebar after temporary access", () => {
    const state = createAnalysisRouteSidebarCollapseState();
    const setOpen = vi.fn<(open: boolean) => void>();

    applyAnalysisRouteSidebarCollapse({
      isMobile: false,
      open: false,
      setOpen,
      state,
    });
    restoreAnalysisRouteSidebarCollapse({ setOpen, state });

    expect(setOpen).toHaveBeenCalledOnce();
    expect(setOpen).toHaveBeenCalledWith(false);
  });
});
