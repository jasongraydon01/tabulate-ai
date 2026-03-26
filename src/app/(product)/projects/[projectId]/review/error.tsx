'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { ErrorFallback } from '@/components/ErrorFallback';

export default function ReviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { route: '/projects/[projectId]/review' },
    });
  }, [error]);

  return <ErrorFallback error={error} reset={reset} pageName="Review" />;
}
