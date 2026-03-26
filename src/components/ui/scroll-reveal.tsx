'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type Direction = 'up' | 'down' | 'left' | 'right' | 'none';

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  /** Delay in seconds before animation starts */
  delay?: number;
  /** Direction content slides in from */
  direction?: Direction;
  /** Distance in pixels to travel */
  distance?: number;
  /** Duration in seconds */
  duration?: number;
  /** Render as a different element */
  as?: 'div' | 'section' | 'li';
}

const DIRECTION_OFFSET: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  none: { x: 0, y: 0 },
};

export function ScrollReveal({
  children,
  className,
  delay = 0,
  direction = 'up',
  distance = 24,
  duration = 0.5,
  as = 'div',
}: ScrollRevealProps) {
  const offset = DIRECTION_OFFSET[direction];
  const Component = motion[as];

  return (
    <Component
      initial={{ opacity: 0, x: offset.x * distance, y: offset.y * distance }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={cn(className)}
    >
      {children}
    </Component>
  );
}

/**
 * Stagger container — wraps children with sequential delays.
 * Use with ScrollReveal children that each have their own delay,
 * or use this to provide stagger context.
 */
export function StaggerContainer({
  children,
  className,
  stagger = 0.1,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-60px' }}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger item — child of StaggerContainer.
 * Animates when the parent enters the viewport.
 */
export function StaggerItem({
  children,
  className,
  direction = 'up',
  distance = 20,
}: {
  children: React.ReactNode;
  className?: string;
  direction?: Direction;
  distance?: number;
}) {
  const offset = DIRECTION_OFFSET[direction];

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: offset.x * distance, y: offset.y * distance },
        visible: { opacity: 1, x: 0, y: 0, transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] } },
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
