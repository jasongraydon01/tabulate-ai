'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/*
 * GridLoader — 3×3 mini grid with spiral animation.
 * Replaces generic Loader2 spinners with an on-brand loading indicator.
 * Cells light up in a clockwise spiral pattern.
 */

// Spiral order: top-left → top-center → top-right → mid-right → bottom-right →
// bottom-center → bottom-left → mid-left → center
const SPIRAL: Array<{ col: number; row: number }> = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 2, row: 0 },
  { col: 2, row: 1 },
  { col: 2, row: 2 },
  { col: 1, row: 2 },
  { col: 0, row: 2 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
];

interface GridLoaderProps {
  /** Size preset */
  size?: 'sm' | 'default' | 'lg';
  /** Override accent color (default: primary) */
  color?: string;
  className?: string;
}

const SIZE_CONFIG = {
  sm: { cell: 3, gap: 1.5 },
  default: { cell: 5, gap: 2 },
  lg: { cell: 8, gap: 3 },
} as const;

export function GridLoader({
  size = 'default',
  color = 'var(--primary)',
  className,
}: GridLoaderProps) {
  const { cell, gap } = SIZE_CONFIG[size];
  const total = cell * 3 + gap * 2;

  return (
    <div
      className={cn('relative inline-block', className)}
      style={{ width: total, height: total }}
      role="status"
      aria-label="Loading"
    >
      {SPIRAL.map(({ col, row }, order) => (
        <motion.div
          key={`${col}-${row}`}
          className="absolute rounded-[0.5px]"
          style={{
            left: col * (cell + gap),
            top: row * (cell + gap),
            width: cell,
            height: cell,
            backgroundColor: color,
          }}
          animate={{ opacity: [0.1, 0.7, 0.1] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            delay: order * 0.12,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}
