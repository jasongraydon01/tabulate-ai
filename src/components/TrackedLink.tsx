'use client';

import Link, { type LinkProps } from 'next/link';
import { type ReactNode } from 'react';
import posthog from 'posthog-js';

interface TrackedLinkProps extends Omit<LinkProps, 'onClick'> {
  children: ReactNode;
  eventName: string;
  eventProperties?: Record<string, unknown>;
  className?: string;
}

/**
 * A Link component that tracks clicks in PostHog.
 * For use on marketing pages and other server components where we need
 * client-side tracking on individual links.
 */
export function TrackedLink({
  children,
  eventName,
  eventProperties = {},
  className,
  ...linkProps
}: TrackedLinkProps) {
  return (
    <Link
      {...linkProps}
      className={className}
      onClick={() => {
        posthog.capture(eventName, {
          destination: typeof linkProps.href === 'string' ? linkProps.href : linkProps.href.pathname,
          ...eventProperties,
        });
      }}
    >
      {children}
    </Link>
  );
}
