'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

type GridVariant = 'hero' | 'section' | 'subtle';

interface GridBackgroundProps {
  /** Visual density and animation intensity */
  variant?: GridVariant;
  /** Show gradient fade at bottom edge */
  fadeBottom?: boolean;
  /** Show radial vignette (fades edges to background) */
  vignette?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const VARIANT_CONFIG: Record<GridVariant, { cellSize: number; lineOpacity: number }> = {
  hero: { cellSize: 40, lineOpacity: 0.5 },
  section: { cellSize: 32, lineOpacity: 0.35 },
  subtle: { cellSize: 24, lineOpacity: 0.25 },
};

// Animated cells: [x%, y%, animDelay_s, animDuration_s, peakOpacity]
// Positioned as percentages so they work at any container size.
// The slight grid misalignment is invisible at these opacity levels.
const HERO_CELLS: [number, number, number, number, number][] = [
  [6, 12, 0, 7, 0.035],
  [18, 6, 1.8, 8.5, 0.04],
  [32, 18, 0.6, 6.5, 0.05],
  [48, 10, 2.4, 9, 0.03],
  [62, 22, 0.3, 7.5, 0.045],
  [78, 8, 1.2, 8, 0.035],
  [88, 20, 2.8, 6, 0.04],
  [12, 42, 1.5, 9, 0.03],
  [28, 52, 0.9, 7, 0.05],
  [42, 38, 3.2, 8.5, 0.035],
  [58, 48, 0.4, 6.5, 0.04],
  [72, 55, 2.0, 9, 0.03],
  [92, 42, 1.0, 7.5, 0.045],
  [8, 72, 2.6, 8, 0.035],
  [24, 68, 0.7, 6, 0.04],
  [52, 75, 1.8, 9, 0.03],
  [66, 62, 3.5, 7, 0.05],
  [82, 70, 0.2, 8.5, 0.035],
  [38, 82, 2.2, 6.5, 0.04],
  [96, 58, 1.4, 7.5, 0.03],
];

const SECTION_CELLS: [number, number, number, number, number][] = [
  [10, 18, 0, 8, 0.03],
  [32, 12, 1.8, 7, 0.04],
  [55, 28, 0.6, 9, 0.035],
  [78, 8, 2.4, 6.5, 0.03],
  [22, 65, 1.2, 8, 0.04],
  [48, 58, 2.8, 7.5, 0.035],
  [72, 72, 0.4, 9, 0.03],
  [88, 48, 3.2, 6, 0.04],
];

export function GridBackground({
  variant = 'hero',
  fadeBottom = false,
  vignette = false,
  className,
  children,
}: GridBackgroundProps) {
  const id = useId();
  const config = VARIANT_CONFIG[variant];
  const cells = variant === 'hero' ? HERO_CELLS : variant === 'section' ? SECTION_CELLS : [];
  const cellDisplaySize = config.cellSize - 1;

  return (
    <div className={cn('relative isolate overflow-hidden', className)}>
      {/* Grid lines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--border) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border) 1px, transparent 1px)
          `,
          backgroundSize: `${config.cellSize}px ${config.cellSize}px`,
          opacity: config.lineOpacity,
        }}
      />

      {/* Animated highlight cells */}
      {cells.length > 0 && (
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {cells.map(([x, y, delay, duration, opacity], i) => (
            <div
              key={`${id}-cell-${i}`}
              className="absolute rounded-[1px]"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: cellDisplaySize,
                height: cellDisplaySize,
                backgroundColor: 'var(--foreground)',
                animation: `grid-cell-pulse ${duration}s ease-in-out ${delay}s infinite`,
                '--cell-opacity': String(opacity),
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}

      {/* Radial vignette — fades grid at edges */}
      {vignette && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 30%, var(--background) 80%)',
          }}
        />
      )}

      {/* Bottom gradient fade */}
      {fadeBottom && (
        <div
          className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-[1]"
          style={{
            background: 'linear-gradient(to bottom, transparent, var(--background))',
          }}
        />
      )}

      {/* Content */}
      <div className="relative z-[2]">{children}</div>
    </div>
  );
}
