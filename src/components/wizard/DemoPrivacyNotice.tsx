import Link from 'next/link';
import { Shield } from 'lucide-react';

/**
 * Compact data privacy notice shown on the demo wizard's lead capture step.
 */
export function DemoPrivacyNotice() {
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-secondary/50 border border-border px-3 py-2.5 mt-4">
      <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <p className="text-xs text-muted-foreground leading-relaxed">
        For demo submissions, we store your contact details to verify and
        deliver the output, keep uploaded files while the demo is running,
        and attempt to remove demo outputs after successful delivery.{' '}
        <Link href="/data-privacy" className="text-foreground underline underline-offset-2 hover:text-foreground/80">
          Data &amp; Privacy
        </Link>
      </p>
    </div>
  );
}
