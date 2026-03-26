'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';

interface AnimatedNumberProps {
  /** Target value to animate to */
  value: number;
  /** Animation duration in seconds */
  duration?: number;
  /** Format function (e.g., for adding commas or suffixes) */
  format?: (n: number) => string;
  className?: string;
}

/**
 * Animates a number counting up from 0 to the target value
 * when the element scrolls into view.
 */
export function AnimatedNumber({
  value,
  duration = 0.8,
  format,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-40px' });
  const [displayed, setDisplayed] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isInView || hasAnimated.current) return;
    if (value === 0) {
      setDisplayed(0);
      return;
    }
    hasAnimated.current = true;

    const durationMs = duration * 1000;
    const start = performance.now();

    function step(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // Cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(value * eased));

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }, [isInView, value, duration]);

  const display = format ? format(displayed) : String(displayed);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
