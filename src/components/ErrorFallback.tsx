'use client';

import { AlertCircle, RefreshCw, LayoutDashboard, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';

// =============================================================================
// Error Fallback — shown when a route error boundary catches a render crash
// =============================================================================

interface ErrorFallbackProps {
  /** The caught error */
  error: Error & { digest?: string };
  /** Next.js reset function — re-renders the route segment */
  reset: () => void;
  /** Page name for context (e.g., "Dashboard", "Project Detail") */
  pageName?: string;
}

export function ErrorFallback({ error, reset, pageName }: ErrorFallbackProps) {
  const heading = pageName
    ? `Something went wrong loading ${pageName}`
    : 'Something went wrong';

  return (
    <div className="flex items-center justify-center py-20 px-6">
      <Card className="max-w-md w-full border-tab-rose/40">
        <CardContent className="p-6">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="rounded-full bg-tab-rose-dim p-3">
              <AlertCircle className="h-6 w-6 text-tab-rose" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">{heading}</h2>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. This has been reported automatically.
              </p>
              {process.env.NODE_ENV === 'development' && error.message && (
                <p className="text-xs text-muted-foreground/70 font-mono mt-2 break-all">
                  {error.message}
                </p>
              )}
            </div>
            <div className="flex gap-3 mt-2">
              <Button variant="outline" size="sm" onClick={reset}>
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Loading Timeout — shown when a Convex query takes too long
// =============================================================================

interface LoadingTimeoutProps {
  /** Page name for context */
  pageName?: string;
}

export function LoadingTimeoutFallback({ pageName }: LoadingTimeoutProps) {
  const heading = pageName
    ? `${pageName} is taking longer than expected`
    : 'Loading is taking longer than expected';

  return (
    <div className="flex items-center justify-center py-20 px-6">
      <Card className="max-w-md w-full border-tab-amber/30">
        <CardContent className="p-6">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="rounded-full bg-tab-amber-dim p-3">
              <Clock className="h-6 w-6 text-tab-amber" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">{heading}</h2>
              <p className="text-sm text-muted-foreground">
                This may be a connection issue. Try refreshing the page.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
