'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * CrystallizationHero — The signature animation.
 *
 * ~35 data fragments drift as constellations, then flow into a crosstab table.
 * One sig-test letter glows teal — the only color in an otherwise monochrome hero.
 *
 * Cycle: scatter (2s) → crystallize (1.5s) → hold (3s) → dissolve (2s) ≈ 8.5s
 */

// --- Configuration ---
const CYCLE = 8.5;
const SCATTER_END = 0.18;     // 0–18% scatter
const CRYSTAL_END = 0.35;     // 18–35% crystallize
const HOLD_END = 0.70;        // 35–70% hold
// 70–100% dissolve back

const TABLE_COLS = 5;
const TABLE_ROWS = 7; // header + 6 data rows
const CELL_W = 110;
const CELL_H = 44;
const GAP_X = 6;
const GAP_Y = 4;

// Deterministic pseudo-random
function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

// --- Table data (what the crystallized table looks like) ---
const TABLE_DATA: string[][] = [
  ['', 'Total', 'Male', 'Female', '18-34'],
  ['Base', '402', '198', '204', '134'],
  ['T2B', '62%', '58%', '66%', '71%'],
  ['Satisfied', '38%', '35%', '41%', '43%'],
  ['Neutral', '24%', '27%', '21%', '19%'],
  ['Dissatisfied', '10%', '12%', '9%', '7%'],
  ['Mean', '3.8', '3.6', '4.0', '4.1'],
];

// Which cell gets the teal sig glow: row 2 ("T2B"), col 3 ("Female" = 66%)
const SIG_ROW = 2;
const SIG_COL = 3;
const SIG_LETTER = 'B';

interface Fragment {
  text: string;
  // Grid (crystallized) position
  gx: number;
  gy: number;
  // Scatter (random) position
  sx: number;
  sy: number;
  // Stagger delay (0–1s)
  delay: number;
  // Is this the sig-test cell?
  isSig: boolean;
  // Is header row?
  isHeader: boolean;
  // Font size
  fontSize: number;
}

function generateFragments(): Fragment[] {
  const fragments: Fragment[] = [];
  const gridW = TABLE_COLS * (CELL_W + GAP_X);
  const gridH = TABLE_ROWS * (CELL_H + GAP_Y);

  for (let row = 0; row < TABLE_ROWS; row++) {
    for (let col = 0; col < TABLE_COLS; col++) {
      const text = TABLE_DATA[row][col];
      if (!text) continue;

      const i = row * TABLE_COLS + col;
      const seed = i + 77;

      const gx = col * (CELL_W + GAP_X);
      const gy = row * (CELL_H + GAP_Y);

      // Scatter: distribute across a wider area
      const cx = gridW / 2;
      const cy = gridH / 2;
      const dx = gx - cx;
      const dy = gy - cy;
      const scatter = 1.6 + seededRand(seed) * 1.8;
      const jitterX = (seededRand(seed + 50) - 0.5) * 180;
      const jitterY = (seededRand(seed + 100) - 0.5) * 120;
      const sx = cx + dx * scatter + jitterX;
      const sy = cy + dy * scatter + jitterY;

      fragments.push({
        text,
        gx,
        gy,
        sx,
        sy,
        delay: seededRand(seed + 200) * 0.8,
        isSig: row === SIG_ROW && col === SIG_COL,
        isHeader: row === 0,
        fontSize: row === 0 ? 14 : 16,
      });
    }
  }
  return fragments;
}

// SVG viewBox dimensions
const gridW = TABLE_COLS * (CELL_W + GAP_X);
const gridH = TABLE_ROWS * (CELL_H + GAP_Y);
const PAD_X = 120;
const PAD_Y = 90;
const VB_W = gridW + PAD_X * 2;
const VB_H = gridH + PAD_Y * 2;

export function CrystallizationHero({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const fragments = useMemo(() => generateFragments(), []);

  // Reduced motion: show static crystallized state
  if (prefersReducedMotion) {
    return (
      <div className={cn('relative', className)} aria-hidden="true">
        <svg
          viewBox={`0 0 ${gridW} ${gridH}`}
          className="w-full h-auto"
        >
          {fragments.map((f, i) => (
            <text
              key={i}
              x={f.gx + CELL_W / 2}
              y={f.gy + CELL_H / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={f.fontSize}
              fontFamily="var(--font-jetbrains-mono)"
              fill={f.isSig ? 'var(--tab-teal)' : 'currentColor'}
              opacity={f.isHeader ? 0.4 : 0.7}
            >
              {f.text}{f.isSig && SIG_LETTER}
            </text>
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div className={cn('relative select-none', className)} aria-hidden="true">
      <svg
        viewBox={`${-PAD_X} ${-PAD_Y} ${VB_W} ${VB_H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Horizontal rules that appear during crystallization */}
        {Array.from({ length: TABLE_ROWS + 1 }, (_, i) => (
          <motion.line
            key={`rule-${i}`}
            x1={-GAP_X}
            y1={i * (CELL_H + GAP_Y) - GAP_Y / 2}
            x2={gridW + GAP_X}
            y2={i * (CELL_H + GAP_Y) - GAP_Y / 2}
            stroke="currentColor"
            strokeWidth={i === 1 ? 0.8 : 0.4}
            animate={{
              opacity: [0, 0, i === 1 ? 0.15 : 0.06, i === 1 ? 0.15 : 0.06, 0],
            }}
            transition={{
              duration: CYCLE,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, SCATTER_END, CRYSTAL_END, HOLD_END, 1],
            }}
          />
        ))}

        {/* Data fragments */}
        {fragments.map((f, i) => (
          <motion.text
            key={i}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={f.fontSize}
            fontFamily="var(--font-jetbrains-mono)"
            fill={f.isSig ? 'var(--tab-teal)' : 'currentColor'}
            animate={{
              x: [
                f.sx + CELL_W / 2,
                f.sx + CELL_W / 2,
                f.gx + CELL_W / 2,
                f.gx + CELL_W / 2,
                f.sx + CELL_W / 2,
              ],
              y: [
                f.sy + CELL_H / 2,
                f.sy + CELL_H / 2,
                f.gy + CELL_H / 2,
                f.gy + CELL_H / 2,
                f.sy + CELL_H / 2,
              ],
              opacity: f.isSig
                ? [0.15, 0.15, 0.95, 0.95, 0.15]
                : f.isHeader
                  ? [0.08, 0.08, 0.4, 0.4, 0.08]
                  : [0.12, 0.12, 0.7, 0.7, 0.12],
            }}
            transition={{
              duration: CYCLE,
              repeat: Infinity,
              delay: f.delay,
              ease: 'easeInOut',
              times: [0, SCATTER_END, CRYSTAL_END, HOLD_END, 1],
            }}
          >
            {f.text}
            {f.isSig && (
              <tspan
                fontSize={11}
                dy={-4}
                fill="var(--tab-teal)"
                fontWeight={700}
              >
                {SIG_LETTER}
              </tspan>
            )}
          </motion.text>
        ))}

        {/* Sig glow — a pulsing circle behind the sig cell during hold */}
        <motion.circle
          cx={fragments.find(f => f.isSig)!.gx + CELL_W / 2}
          cy={fragments.find(f => f.isSig)!.gy + CELL_H / 2}
          r={28}
          fill="var(--tab-teal)"
          animate={{
            opacity: [0, 0, 0, 0.08, 0.04, 0],
          }}
          transition={{
            duration: CYCLE,
            repeat: Infinity,
            ease: 'easeInOut',
            times: [0, SCATTER_END, CRYSTAL_END, 0.45, 0.6, HOLD_END],
          }}
        />
      </svg>
    </div>
  );
}
