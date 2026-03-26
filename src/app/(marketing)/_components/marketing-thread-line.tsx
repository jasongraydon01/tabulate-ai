'use client';

import { usePathname } from 'next/navigation';
import { ThreadLine } from '@/components/ui/thread-line';

/**
 * Renders the ThreadLine only on the landing page (/).
 * Other marketing pages (pricing, demo, privacy) don't show it.
 */
export function MarketingThreadLine() {
  const pathname = usePathname();

  if (pathname !== '/') return null;

  return <ThreadLine />;
}
