import Link from 'next/link';
import { Info } from 'lucide-react';

/**
 * Demo limitations + privacy callout shown on the review/launch step.
 */
export function DemoLimitationsCallout() {
  return (
    <div className="rounded-lg border border-tab-indigo/20 bg-tab-indigo-dim p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-tab-indigo shrink-0" />
        <h4 className="text-sm font-medium text-foreground">Demo mode</h4>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        TabulateAI will process the first <strong className="text-foreground">100 respondents</strong> from your data
        and produce the first <strong className="text-foreground">25 tables</strong>. This gives you a representative
        preview of the full output on your own data.
      </p>
      <p className="text-xs text-muted-foreground/80 leading-relaxed">
        We attempt to remove demo outputs after delivery, and any remaining
        run artifacts are automatically purged within 30 days. The only
        place your data is sent is to our AI providers during processing.
        We won&apos;t use your contact information for marketing.{' '}
        <Link href="/data-privacy" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Data &amp; Privacy
        </Link>
        {' '}&middot;{' '}
        <Link href="/pricing" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          See our plans
        </Link>
      </p>
    </div>
  );
}
