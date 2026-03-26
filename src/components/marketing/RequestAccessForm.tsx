'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AccessRequestSource } from '@/lib/accessRequests';

interface RequestAccessFormProps {
  source: AccessRequestSource;
  demoToken?: string;
}

export function RequestAccessForm({
  source,
  demoToken,
}: RequestAccessFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [initialAdminEmail, setInitialAdminEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          company,
          initialAdminEmail,
          notes,
          source,
          demoToken,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error || 'Unable to submit your request right now.');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Unable to submit your request right now.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-left">
        <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-tab-emerald-dim text-ct-emerald">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <h2 className="font-serif text-3xl font-light tracking-tight">Request received</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          We&apos;ll review your workspace request and follow up with the right sign-in path once the
          initial TabulateAI workspace and admin access are set up.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Pricing and billing happen after that workspace setup step, so you won&apos;t hit a dead end
          trying to subscribe first.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-8">
      <div className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="request-name">Name</Label>
          <Input
            id="request-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="request-email">Work Email</Label>
          <Input
            id="request-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
          />
          <p className="text-xs text-muted-foreground">
            Use your work email so we can place you in the right workspace.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="request-company">Company</Label>
          <Input
            id="request-company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Your company"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="request-admin">Initial Admin Email</Label>
          <Input
            id="request-admin"
            type="email"
            value={initialAdminEmail}
            onChange={(event) => setInitialAdminEmail(event.target.value)}
            placeholder="If someone else should be the first admin"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="request-notes">Notes</Label>
          <Textarea
            id="request-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional: team size, timeline, or anything useful for setup"
            rows={4}
          />
        </div>

        {error && (
          <p className="rounded-md border border-ct-red/20 bg-ct-red-dim px-3 py-2 text-sm text-ct-red">
            {error}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="justify-center rounded-full bg-foreground text-background hover:bg-foreground/90"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending request
            </>
          ) : (
            'Request Access'
          )}
        </Button>
      </div>
    </form>
  );
}
