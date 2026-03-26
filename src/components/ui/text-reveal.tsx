'use client';

import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

type RevealMode = 'char' | 'word' | 'line';
type TriggerMode = 'mount' | 'inView';

interface TextRevealProps {
  /** The text to reveal */
  text: string;
  /** HTML element to render as */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'div';
  /** Additional class names */
  className?: string;
  /** Delay before animation starts (seconds) */
  delay?: number;
  /** Stagger between each unit (seconds). Defaults: char=0.02, word=0.06, line=0.12 */
  stagger?: number;
  /** Split mode */
  mode?: RevealMode;
  /** When to trigger */
  trigger?: TriggerMode;
  /** Children rendered after text (e.g., for mixed content) */
  children?: React.ReactNode;
}

const defaultStagger: Record<RevealMode, number> = {
  char: 0.02,
  word: 0.06,
  line: 0.12,
};

function splitText(text: string, mode: RevealMode): string[] {
  switch (mode) {
    case 'char':
      return text.split('');
    case 'word':
      // Split but keep spaces attached to the preceding word for proper spacing
      return text.split(/(\s+)/).filter(Boolean);
    case 'line':
      return text.split('\n');
  }
}

const containerVariants = {
  hidden: {},
  visible: (stagger: number) => ({
    transition: {
      staggerChildren: stagger,
    },
  }),
};

const unitVariants = {
  hidden: {
    clipPath: 'inset(0 100% 0 0)',
    opacity: 0,
  },
  visible: {
    clipPath: 'inset(0 0% 0 0)',
    opacity: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    },
  },
};

export function TextReveal({
  text,
  as: Tag = 'div',
  className,
  delay = 0,
  stagger: customStagger,
  mode = 'word',
  trigger = 'mount',
  children,
}: TextRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  const prefersReducedMotion = useReducedMotion();

  const MotionTag = motion[Tag as keyof typeof motion] as typeof motion.div;
  const stagger = customStagger ?? defaultStagger[mode];
  const units = splitText(text, mode);

  const shouldAnimate = trigger === 'mount' || isInView;

  // Reduced motion: show immediately
  if (prefersReducedMotion) {
    return (
      <div ref={ref} className={className}>
        {text}
        {children}
      </div>
    );
  }

  return (
    <MotionTag
      ref={ref}
      className={cn(className)}
      variants={containerVariants}
      custom={stagger}
      initial="hidden"
      animate={shouldAnimate ? 'visible' : 'hidden'}
      transition={{ delayChildren: delay }}
      aria-label={text}
    >
      {units.map((unit, i) => (
        <motion.span
          key={`${i}-${unit}`}
          variants={unitVariants}
          className="inline-block"
          style={{
            // Preserve whitespace for word mode
            whiteSpace: mode === 'word' && unit.trim() === '' ? 'pre' : undefined,
          }}
          aria-hidden="true"
        >
          {unit}
        </motion.span>
      ))}
      {children}
    </MotionTag>
  );
}

/**
 * TextRevealLine — renders multi-line text with per-line reveal.
 * Each line is a separate motion element for staggered reveal.
 * Use `\n` in the text prop or pass JSX children for mixed content lines.
 */
interface TextRevealLineProps {
  lines: Array<{ text: string; className?: string }>;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'div';
  className?: string;
  delay?: number;
  stagger?: number;
  trigger?: TriggerMode;
}

const lineContainerVariants = {
  hidden: {},
  visible: (stagger: number) => ({
    transition: {
      staggerChildren: stagger,
    },
  }),
};

const lineVariants = {
  hidden: {
    clipPath: 'inset(0 100% 0 0)',
    opacity: 0,
  },
  visible: {
    clipPath: 'inset(0 0% 0 0)',
    opacity: 1,
    transition: {
      duration: 0.7,
      ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    },
  },
};

export function TextRevealLine({
  lines,
  as: Tag = 'h1',
  className,
  delay = 0,
  stagger = 0.15,
  trigger = 'mount',
}: TextRevealLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  const prefersReducedMotion = useReducedMotion();

  const MotionTag = motion[Tag as keyof typeof motion] as typeof motion.div;
  const shouldAnimate = trigger === 'mount' || isInView;

  if (prefersReducedMotion) {
    return (
      <div ref={ref} className={className}>
        {lines.map((line, i) => (
          <span key={i} className={cn('block', line.className)}>
            {line.text}
          </span>
        ))}
      </div>
    );
  }

  return (
    <MotionTag
      ref={ref}
      className={className}
      variants={lineContainerVariants}
      custom={stagger}
      initial="hidden"
      animate={shouldAnimate ? 'visible' : 'hidden'}
      transition={{ delayChildren: delay }}
    >
      {lines.map((line, i) => (
        <motion.span
          key={i}
          variants={lineVariants}
          className={cn('block', line.className)}
        >
          {line.text}
        </motion.span>
      ))}
    </MotionTag>
  );
}
