/**
 * Utilities
 * Purpose: UI-safe className merge and SSR-safe UTC datetime formatting
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// SSR-safe date formatter (fixed locale/timezone)
export function formatUtcDateTime(isoString: string): string {
  try {
    const dt = new Date(isoString)
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(dt)
  } catch {
    return isoString
  }
}
