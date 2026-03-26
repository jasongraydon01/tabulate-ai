'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * FloatingData — Atmospheric background texture.
 *
 * Renders floating monospace data fragments at very low opacity.
 * Replaces `bg-dot-grid` with something more meaningful and distinctive.
 * Each fragment drifts slowly in a random direction, creating a living,
 * breathing data-atmosphere effect.
 */

const DEFAULT_FRAGMENTS = [
  'n=402', '62%', 'T2B', 'p<.05', '18-34', 'Base',
  'Gender', 'χ²', '95%', '.sav', 'NET', 'Mean',
  'sig', '3.8', 'Q4', 'Region', '%', 'n=198',
  'Total', 'Wt.', 'B2B', 'Age', '47%', 'Freq',
  'SD=1.2', 'CI', 'prop', 'tab', 'R×C', 'df=3',
];

const DENSITY_CONFIG = {
  sparse: { count: 12, opacity: 0.03 },
  normal: { count: 20, opacity: 0.05 },
  dense: { count: 30, opacity: 0.06 },
};

// Deterministic pseudo-random
function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

interface FragmentData {
  text: string;
  x: number; // percentage
  y: number; // percentage
  fontSize: number;
  driftX: number;
  driftY: number;
  duration: number;
  delay: number;
  opacity: number;
}

function generateFragments(
  fragments: string[],
  count: number,
  baseOpacity: number
): FragmentData[] {
  const result: FragmentData[] = [];
  for (let i = 0; i < count; i++) {
    const seed = i + 31;
    const text = fragments[i % fragments.length];
    result.push({
      text,
      x: seededRand(seed) * 90 + 5,       // 5–95%
      y: seededRand(seed + 50) * 85 + 5,   // 5–90%
      fontSize: 10 + seededRand(seed + 100) * 4, // 10–14px
      driftX: (seededRand(seed + 150) - 0.5) * 30, // ±15px
      driftY: (seededRand(seed + 200) - 0.5) * 20, // ±10px
      duration: 12 + seededRand(seed + 250) * 16,   // 12–28s per drift cycle
      delay: seededRand(seed + 300) * -20,            // stagger start
      opacity: baseOpacity * (0.5 + seededRand(seed + 350) * 0.5), // vary within range
    });
  }
  return result;
}

interface FloatingDataProps {
  density?: 'sparse' | 'normal' | 'dense';
  fragments?: string[];
  className?: string;
}

export function FloatingData({
  density = 'normal',
  fragments: customFragments,
  className,
}: FloatingDataProps) {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const config = DENSITY_CONFIG[density];
  const frags = useMemo(
    () =>
      generateFragments(
        customFragments ?? DEFAULT_FRAGMENTS,
        config.count,
        config.opacity
      ),
    [customFragments, config.count, config.opacity]
  );

  // Avoid hydration mismatch — this is purely decorative, render only on client
  if (!mounted) return null;

  // Reduced motion: show static fragments
  if (prefersReducedMotion) {
    return (
      <div
        className={cn('absolute inset-0 overflow-hidden pointer-events-none', className)}
        aria-hidden="true"
      >
        {frags.map((f, i) => (
          <span
            key={i}
            className="absolute font-mono text-foreground select-none"
            style={{
              left: `${f.x}%`,
              top: `${f.y}%`,
              fontSize: f.fontSize,
              opacity: f.opacity,
            }}
          >
            {f.text}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn('absolute inset-0 overflow-hidden pointer-events-none', className)}
      aria-hidden="true"
    >
      {frags.map((f, i) => (
        <motion.span
          key={i}
          className="absolute font-mono text-foreground select-none"
          style={{
            left: `${f.x}%`,
            top: `${f.y}%`,
            fontSize: f.fontSize,
          }}
          animate={{
            x: [0, f.driftX, -f.driftX * 0.5, 0],
            y: [0, f.driftY, -f.driftY * 0.7, 0],
            opacity: [
              f.opacity,
              f.opacity * 1.3,
              f.opacity * 0.7,
              f.opacity,
            ],
          }}
          transition={{
            duration: f.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: f.delay,
          }}
        >
          {f.text}
        </motion.span>
      ))}
    </div>
  );
}
