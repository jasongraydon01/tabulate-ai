"use client";

import { useEffect, useRef } from "react";

import { useSidebar } from "@/components/ui/sidebar";

interface AnalysisRouteSidebarCollapseState {
  hasApplied: boolean;
  previousOpen: boolean;
}

export function createAnalysisRouteSidebarCollapseState(): AnalysisRouteSidebarCollapseState {
  return {
    hasApplied: false,
    previousOpen: true,
  };
}

export function applyAnalysisRouteSidebarCollapse({
  isMobile,
  open,
  setOpen,
  state,
}: {
  isMobile: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  state: AnalysisRouteSidebarCollapseState;
}) {
  if (isMobile || state.hasApplied) {
    return;
  }

  state.hasApplied = true;
  state.previousOpen = open;

  if (open) {
    setOpen(false);
  }
}

export function restoreAnalysisRouteSidebarCollapse({
  setOpen,
  state,
}: {
  setOpen: (open: boolean) => void;
  state: AnalysisRouteSidebarCollapseState;
}) {
  if (!state.hasApplied) {
    return;
  }

  const previousOpen = state.previousOpen;
  state.hasApplied = false;
  setOpen(previousOpen);
}

export function AnalysisRouteSidebarCollapse() {
  const { isMobile, open, setOpen } = useSidebar();
  const collapseStateRef = useRef(createAnalysisRouteSidebarCollapseState());
  const latestOpenRef = useRef(open);
  const latestSetOpenRef = useRef(setOpen);

  latestOpenRef.current = open;
  latestSetOpenRef.current = setOpen;

  useEffect(() => {
    const collapseState = collapseStateRef.current;

    applyAnalysisRouteSidebarCollapse({
      isMobile,
      open: latestOpenRef.current,
      setOpen: (nextOpen) => latestSetOpenRef.current(nextOpen),
      state: collapseState,
    });

    return () => {
      restoreAnalysisRouteSidebarCollapse({
        setOpen: (nextOpen) => latestSetOpenRef.current(nextOpen),
        state: collapseState,
      });
    };
  }, [isMobile]);

  return null;
}
