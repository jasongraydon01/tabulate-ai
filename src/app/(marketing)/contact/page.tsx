import { ContactForm } from '@/components/marketing/ContactForm';
import { parseContactTopic } from '@/lib/contact';
import { getContactReplyToAddress } from '@/lib/contactNotifications';

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const params = await searchParams;
  const topic = parseContactTopic(params.topic);
  const replyEmail = getContactReplyToAddress();

  return (
    <section className="relative overflow-hidden px-6 py-28">
      <div className="absolute inset-0 bg-editorial-radial" />
      <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_480px] lg:items-start">
        <div className="max-w-2xl">
          <span className="data-label text-primary mb-4 block">Contact</span>
          <h1 className="editorial-display text-4xl sm:text-5xl lg:text-6xl">
            Reach <span className="editorial-emphasis">TabulateAI</span> directly.
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Use this form for demo questions, workspace setup, billing, WinCross exports, or
            anything else you need help sorting out.
          </p>
          <div className="mt-10 space-y-5 text-sm leading-relaxed text-muted-foreground">
            <p>
              If you&apos;re already working with your team inside TabulateAI, this is also the right
              place to ask about admin-managed settings like billing or WinCross profiles.
            </p>
            {replyEmail && (
              <p>
                Prefer email? Reach us at{' '}
                <a
                  href={`mailto:${replyEmail}`}
                  className="text-foreground underline underline-offset-4"
                >
                  {replyEmail}
                </a>
                .
              </p>
            )}
          </div>
        </div>

        <ContactForm initialTopic={topic} replyEmail={replyEmail} />
      </div>
    </section>
  );
}
