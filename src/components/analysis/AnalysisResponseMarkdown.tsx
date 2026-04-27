"use client";

import { useEffect, useRef, useState } from "react";

import { Response } from "@/components/ai-elements/response";

function useAnimationFrameThrottle<T>(value: T, enabled: boolean): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const latestValueRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    latestValueRef.current = value;

    if (!enabled) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setThrottledValue(value);
      return;
    }

    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setThrottledValue(latestValueRef.current);
    });
  }, [value, enabled]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return throttledValue;
}

export function AnalysisResponseMarkdown({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const throttledText = useAnimationFrameThrottle(text, isStreaming);
  return <Response>{throttledText}</Response>;
}
