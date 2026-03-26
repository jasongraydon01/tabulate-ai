'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { Loader2, CheckCircle2, AlertTriangle, Mail, Clock } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { isPreviewFeatureEnabled } from '@/lib/featureGates';

function DemoStatusContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const demoRun = useQuery(
    api.demoRuns.getStatusByToken,
    token ? { verificationToken: token } : 'skip',
  );

  if (!token) {
    return (
      <StatusCard>
        <AlertTriangle className="h-8 w-8 text-tab-amber mx-auto mb-4" />
        <h2 className="font-serif text-xl mb-2">Invalid link</h2>
        <p className="text-sm text-muted-foreground">
          This link is missing a verification token.{' '}
          <Link href="/demo" className="text-foreground underline underline-offset-2">
            Try the demo again
          </Link>
        </p>
      </StatusCard>
    );
  }

  // Loading state
  if (demoRun === undefined) {
    return (
      <StatusCard>
        <Loader2 className="h-8 w-8 text-muted-foreground animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Loading status...</p>
      </StatusCard>
    );
  }

  // Token not found
  if (demoRun === null) {
    return (
      <StatusCard>
        <AlertTriangle className="h-8 w-8 text-tab-amber mx-auto mb-4" />
        <h2 className="font-serif text-xl mb-2">Demo not found</h2>
        <p className="text-sm text-muted-foreground">
          This link may have expired.{' '}
          <Link href="/demo" className="text-foreground underline underline-offset-2">
            Start a new demo
          </Link>
        </p>
      </StatusCard>
    );
  }

  const { pipelineStatus, emailVerified, projectName, outputSentAt } = demoRun;

  // Output already sent
  if (outputSentAt) {
    return (
      <StatusCard>
        <CheckCircle2 className="h-8 w-8 text-tab-teal mx-auto mb-4" />
        <h2 className="font-serif text-xl mb-2">Your results have been emailed</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Check your inbox for <strong className="text-foreground">{projectName}</strong>.
          The zip file contains your Excel crosstabs and any export files you selected.
        </p>
        <Link
          href="/pricing"
          className="inline-block px-5 py-2.5 bg-primary text-primary-foreground font-medium text-sm rounded-full hover:opacity-90 transition-opacity"
        >
          See our plans
        </Link>
      </StatusCard>
    );
  }

  // Pipeline complete + verified → email is being sent
  if ((pipelineStatus === 'success' || pipelineStatus === 'partial') && emailVerified) {
    return (
      <StatusCard>
        <Mail className="h-8 w-8 text-tab-blue mx-auto mb-4" />
        <h2 className="font-serif text-xl mb-2">Sending your results</h2>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{projectName}</strong> is complete. Your output email is on its way.
        </p>
      </StatusCard>
    );
  }

  // Pipeline complete but NOT verified
  if ((pipelineStatus === 'success' || pipelineStatus === 'partial') && !emailVerified) {
    return (
      <StatusCard>
        <Mail className="h-8 w-8 text-tab-amber mx-auto mb-4" />
        <h2 className="font-serif text-xl mb-2">Almost there — check your email</h2>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{projectName}</strong> is ready, but we need you to confirm your email address before we can send the results.
          Check your inbox for the verification email.
        </p>
      </StatusCard>
    );
  }

  // Pipeline errored
  if (pipelineStatus === 'error') {
    return (
      <StatusCard>
        <AlertTriangle className="h-8 w-8 text-tab-rose mx-auto mb-4" />
        <h2 className="font-serif text-xl mb-2">Something went wrong</h2>
        <p className="text-sm text-muted-foreground mb-6">
          We ran into an issue processing <strong className="text-foreground">{projectName}</strong>.
          This sometimes happens with unusually structured data files.
        </p>
        <Link
          href="/demo"
          className="inline-block px-5 py-2.5 bg-primary text-primary-foreground font-medium text-sm rounded-full hover:opacity-90 transition-opacity"
        >
          Try again
        </Link>
      </StatusCard>
    );
  }

  // Pipeline expired
  if (pipelineStatus === 'expired') {
    return (
      <StatusCard>
        <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-4" />
        <h2 className="font-serif text-xl mb-2">This demo has expired</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Demo runs expire after 48 hours.{' '}
          <Link href="/demo" className="text-foreground underline underline-offset-2">
            Start a new demo
          </Link>
        </p>
      </StatusCard>
    );
  }

  // Pipeline still processing (queued or in_progress)
  return (
    <StatusCard>
      <Loader2 className="h-8 w-8 text-tab-indigo animate-spin mx-auto mb-4" />
      <h2 className="font-serif text-xl mb-2">Processing your data</h2>
      <p className="text-sm text-muted-foreground mb-2">
        <strong className="text-foreground">{projectName}</strong> is running through the TabulateAI pipeline.
      </p>
      <p className="text-xs text-muted-foreground/70">
        This typically takes 15&ndash;45 minutes depending on your dataset.
        {!emailVerified && (
          <> Meanwhile, <strong className="text-foreground">check your inbox</strong> and click the verification link so we can send your results when they&apos;re ready.</>
        )}
      </p>
    </StatusCard>
  );
}

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-card border border-border rounded-lg p-10 text-center">
        {children}
      </div>
    </div>
  );
}

/** @temporary — remove gate when demo is production-ready */
export default function DemoStatusPage() {
  const router = useRouter();

  // @temporary — redirect to home in production
  useEffect(() => {
    if (!isPreviewFeatureEnabled()) router.replace('/');
  }, [router]);

  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
      </div>
    }>
      <DemoStatusContent />
    </Suspense>
  );
}
