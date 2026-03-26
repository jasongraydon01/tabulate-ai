'use client';

import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * ThreadLine — A continuous vertical line running down the page.
 *
 * Represents the pipeline metaphor — a literal thread connecting sections.
 * The line color transitions from teal → cyan → blue as the user scrolls.
 * Decorative nodes glow at section boundaries.
 *
 * Uses scroll-linked Framer Motion transforms for GPU-accelerated performance.
 */

interface ThreadLineProps {
  className?: string;
}

export function ThreadLine({ className }: ThreadLineProps) {
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();

  // Color journey: teal → cyan → blue as user scrolls
  const strokeColor = useTransform(
    scrollYProgress,
    [0, 0.3, 0.6, 1],
    [
      'var(--tab-teal)',
      'var(--tab-teal)',
      'var(--tab-blue)',
      'var(--tab-blue)',
    ]
  );

  const glowColor = useTransform(
    scrollYProgress,
    [0, 0.3, 0.6, 1],
    [
      'rgba(52, 211, 153, 0.15)',
      'rgba(52, 211, 153, 0.15)',
      'rgba(56, 189, 248, 0.15)',
      'rgba(56, 189, 248, 0.15)',
    ]
  );

  // Line opacity — fades in after hero, fades out near bottom
  const lineOpacity = useTransform(
    scrollYProgress,
    [0, 0.05, 0.85, 1],
    [0, 0.6, 0.6, 0]
  );

  if (prefersReducedMotion) {
    return null; // Thread line is decorative; skip entirely for reduced motion
  }

  return (
    <div
      className={cn(
        'fixed left-[8%] lg:left-[11%] top-0 bottom-0 w-px z-0 pointer-events-none',
        className
      )}
      aria-hidden="true"
    >
      {/* Main line */}
      <motion.div
        className="absolute inset-0 w-px"
        style={{
          backgroundColor: strokeColor,
          opacity: lineOpacity,
        }}
      />

      {/* Glow effect */}
      <motion.div
        className="absolute inset-0 w-[3px] -left-px blur-[2px]"
        style={{
          backgroundColor: glowColor,
          opacity: lineOpacity,
        }}
      />

      {/* Fork points — decorative nodes at ~25%, 50%, 75% of page */}
      {[0.25, 0.5, 0.75].map((position) => (
        <ThreadNode
          key={position}
          scrollProgress={scrollYProgress}
          position={position}
        />
      ))}
    </div>
  );
}

interface ThreadNodeProps {
  scrollProgress: MotionValue<number>;
  position: number;
}

function ThreadNode({ scrollProgress, position }: ThreadNodeProps) {
  // Node glows when scroll position is near it
  const nodeOpacity = useTransform(
    scrollProgress,
    [position - 0.08, position - 0.02, position, position + 0.02, position + 0.08],
    [0, 0.3, 0.8, 0.3, 0]
  );

  const nodeScale = useTransform(
    scrollProgress,
    [position - 0.05, position, position + 0.05],
    [0.5, 1, 0.5]
  );

  return (
    <motion.div
      className="absolute left-1/2 -translate-x-1/2 size-1.5 rounded-full bg-primary"
      style={{
        top: `${position * 100}%`,
        opacity: nodeOpacity,
        scale: nodeScale,
      }}
    />
  );
}
