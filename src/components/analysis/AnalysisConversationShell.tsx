"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  type ConversationProps,
} from "@/components/ai-elements/conversation";
import { cn } from "@/lib/utils";

export const ANALYSIS_CONVERSATION_INITIAL_SCROLL: ConversationProps["initial"] = "instant";
export const ANALYSIS_CONVERSATION_RESIZE_SCROLL: ConversationProps["resize"] = "smooth";

export function getNextAnalysisConversationScrollRequestKey(current: number): number {
  return current + 1;
}

interface AnalysisConversationShellProps {
  children: ReactNode;
  composer: ReactNode;
  scrollRequestKey: number;
  className?: string;
  contentClassName?: string;
}

export function AnalysisConversationShell({
  children,
  composer,
  scrollRequestKey,
  className,
  contentClassName,
}: AnalysisConversationShellProps) {
  const contextRef = useRef<StickToBottomContext | null>(null);
  const previousScrollRequestKeyRef = useRef(scrollRequestKey);

  useEffect(() => {
    if (scrollRequestKey === previousScrollRequestKeyRef.current) {
      return;
    }

    previousScrollRequestKeyRef.current = scrollRequestKey;
    const frame = window.requestAnimationFrame(() => {
      void contextRef.current?.scrollToBottom({
        animation: "smooth",
        wait: 0,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [scrollRequestKey]);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <Conversation
        className="min-h-0 min-w-0 flex-1"
        contextRef={contextRef}
        initial={ANALYSIS_CONVERSATION_INITIAL_SCROLL}
        resize={ANALYSIS_CONVERSATION_RESIZE_SCROLL}
      >
        <ConversationContent className={cn("gap-4 px-5 py-3 pb-24", contentClassName)}>
          {children}
        </ConversationContent>
        <ConversationScrollButton
          aria-label="Jump to latest analysis activity"
          title="Jump to latest analysis activity"
        />
      </Conversation>

      <div className="relative z-10 -mt-10 shrink-0 px-5 pb-4 pt-8">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-white via-white/88 to-transparent dark:from-card dark:via-card/84" />
        <div className="relative">{composer}</div>
      </div>
    </div>
  );
}
