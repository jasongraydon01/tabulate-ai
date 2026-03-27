'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ContactTopic } from '@/lib/contact';

interface ContactFormProps {
  initialTopic: ContactTopic;
  replyEmail?: string | null;
}

const TOPIC_OPTIONS: Array<{ value: ContactTopic; label: string }> = [
  { value: 'demo', label: 'Demo' },
  { value: 'access', label: 'Access / Workspace setup' },
  { value: 'billing', label: 'Billing' },
  { value: 'wincross', label: 'WinCross / Exports' },
  { value: 'general', label: 'General question' },
];

export function ContactForm({ initialTopic, replyEmail }: ContactFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [topic, setTopic] = useState<ContactTopic>(initialTopic);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          company,
          topic,
          message,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error || 'Unable to send your message right now.');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Unable to send your message right now.');
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
        <h2 className="font-serif text-3xl font-light tracking-tight">Message sent</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          We received your note and will follow up as soon as we can.
        </p>
        {replyEmail && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            If you need to follow up directly, email{' '}
            <a href={`mailto:${replyEmail}`} className="text-foreground underline underline-offset-4">
              {replyEmail}
            </a>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-8">
      <div className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="contact-name">Name</Label>
          <Input
            id="contact-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="contact-email">Email</Label>
          <Input
            id="contact-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="contact-company">Company</Label>
          <Input
            id="contact-company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="grid gap-2">
          <Label>Topic</Label>
          <Select value={topic} onValueChange={(value) => setTopic(value as ContactTopic)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a topic" />
            </SelectTrigger>
            <SelectContent>
              {TOPIC_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="contact-message">Message</Label>
          <Textarea
            id="contact-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Tell us what you need help with."
            rows={6}
            required
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
              Sending message
            </>
          ) : (
            'Contact TabulateAI'
          )}
        </Button>
      </div>
    </form>
  );
}
