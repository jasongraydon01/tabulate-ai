'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/*
 * DataFlowHero — Animated visualization of the data→grid transformation.
 *
 * Renders ~24 particles that continuously cycle through three states:
 *   1. Scattered — Random positions, low opacity (raw survey data)
 *   2. Crystallized — Locked into a perfect grid, peak opacity (crosstab output)
 *   3. Dispersing — Drift back to scatter positions (loop reset)
 *
 * The brief "crystallized" moment is the payoff — you see the grid form
 * for ~2 seconds before it dissolves and rebuilds. Particles have slight
 * timing offsets so the grid assembles organically, not all at once.
 */

const COLS = 8;
const ROWS = 3;
const CELL = 24;
const GAP = 5;
const CYCLE_DURATION = 10; // seconds per full loop

// Deterministic pseudo-random
function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

interface Particle {
  /** Scatter (random) x */
  sx: number;
  /** Scatter (random) y */
  sy: number;
  /** Grid (final) x */
  gx: number;
  /** Grid (final) y */
  gy: number;
  /** Stagger delay in seconds */
  delay: number;
}

function generateParticles(): Particle[] {
  const particles: Particle[] = [];
  const gridW = COLS * (CELL + GAP) - GAP;
  const gridH = ROWS * (CELL + GAP) - GAP;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      const seed = i + 42;

      // Grid position
      const gx = col * (CELL + GAP);
      const gy = row * (CELL + GAP);

      // Scatter: random offset from grid, biased outward from center
      const cx = gridW / 2;
      const cy = gridH / 2;
      const dx = gx - cx;
      const dy = gy - cy;
      const scatter = 1.8 + rand(seed) * 1.2; // 1.8x-3x outward
      const jitterX = (rand(seed + 50) - 0.5) * 60;
      const jitterY = (rand(seed + 100) - 0.5) * 40;
      const sx = cx + dx * scatter + jitterX;
      const sy = cy + dy * scatter + jitterY;

      particles.push({
        sx,
        sy,
        gx,
        gy,
        delay: rand(seed + 200) * 1.0, // up to 1s stagger
      });
    }
  }
  return particles;
}

const particles = generateParticles();

// SVG viewBox dimensions (with padding for scatter overflow)
const gridW = COLS * (CELL + GAP) - GAP;
const gridH = ROWS * (CELL + GAP) - GAP;
const PAD_X = 100;
const PAD_Y = 50;
const VB_W = gridW + PAD_X * 2;
const VB_H = gridH + PAD_Y * 2;

export function DataFlowHero({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-center', className)} aria-hidden="true">
      <svg
        viewBox={`${-PAD_X} ${-PAD_Y} ${VB_W} ${VB_H}`}
        className="w-full max-w-xl"
        style={{ height: 'auto', maxHeight: 140 }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Ghost grid lines — visible during crystallized phase */}
        {Array.from({ length: COLS + 1 }, (_, i) => (
          <motion.line
            key={`v-${i}`}
            x1={i * (CELL + GAP) - GAP / 2}
            y1={-GAP / 2}
            x2={i * (CELL + GAP) - GAP / 2}
            y2={gridH + GAP / 2}
            stroke="var(--foreground)"
            strokeWidth={0.5}
            animate={{ opacity: [0, 0, 0.06, 0.06, 0] }}
            transition={{
              duration: CYCLE_DURATION,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, 0.3, 0.45, 0.65, 0.8],
            }}
          />
        ))}
        {Array.from({ length: ROWS + 1 }, (_, i) => (
          <motion.line
            key={`h-${i}`}
            x1={-GAP / 2}
            y1={i * (CELL + GAP) - GAP / 2}
            x2={gridW + GAP / 2}
            y2={i * (CELL + GAP) - GAP / 2}
            stroke="var(--foreground)"
            strokeWidth={0.5}
            animate={{ opacity: [0, 0, 0.06, 0.06, 0] }}
            transition={{
              duration: CYCLE_DURATION,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, 0.3, 0.45, 0.65, 0.8],
            }}
          />
        ))}

        {/* Data particles */}
        {particles.map((p, i) => (
          <motion.rect
            key={i}
            width={CELL - 2}
            height={CELL - 2}
            rx={2}
            fill="var(--foreground)"
            animate={{
              x: [p.sx, p.gx, p.gx, p.sx],
              y: [p.sy, p.gy, p.gy, p.sy],
              opacity: [0.025, 0.12, 0.12, 0.025],
            }}
            transition={{
              duration: CYCLE_DURATION,
              repeat: Infinity,
              delay: p.delay,
              ease: 'easeInOut',
              times: [0, 0.4, 0.6, 1],
            }}
          />
        ))}
      </svg>
    </div>
  );
}
