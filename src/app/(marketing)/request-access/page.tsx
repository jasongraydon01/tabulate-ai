import type { Metadata } from 'next';
import { RequestAccessForm } from '@/components/marketing/RequestAccessForm';
import { parseAccessRequestSource } from '@/lib/accessRequests';

export const metadata: Metadata = {
  title: 'Request Workspace Access',
  description:
    'Request a TabulateAI workspace for your market research team. We set up your organization, domain mapping, and admin access.',
  alternates: { canonical: '/request-access' },
};

export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; demoToken?: string }>;
}) {
  const params = await searchParams;
  const source = parseAccessRequestSource(params.source);
  const demoToken = params.demoToken?.trim() || undefined;

  return (
    <section className="relative overflow-hidden px-6 py-28">
      <div className="absolute inset-0 bg-editorial-radial" />
      <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_480px] lg:items-start">
        <div className="max-w-2xl">
          <span className="data-label text-primary mb-4 block">Workspace Setup</span>
          <h1 className="editorial-display text-4xl sm:text-5xl lg:text-6xl">
            Request access to your <span className="editorial-emphasis">TabulateAI workspace.</span>
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
            We set up the initial workspace, domain mapping, and first admin manually so your
            team lands in the right place before billing begins.
          </p>
          <div className="mt-10 space-y-5 text-sm leading-relaxed text-muted-foreground">
            <p>
              Start here if you&apos;ve tried the demo, reviewed the pricing, or signed in and found
              that your organization hasn&apos;t been provisioned yet.
            </p>
            <p>
              Once your workspace is ready, same-domain teammates can join more smoothly through
              the existing organization flow.
            </p>
          </div>
        </div>

        <RequestAccessForm source={source} demoToken={demoToken} />
      </div>
    </section>
  );
}
