'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { ErrorFallback } from '@/components/ErrorFallback';

export default function NewProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { route: '/projects/new' },
    });
  }, [error]);

  return <ErrorFallback error={error} reset={reset} pageName="New Project" />;
}
