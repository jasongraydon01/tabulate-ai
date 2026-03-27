import { z } from 'zod';

export const CONTACT_TOPICS = [
  'demo',
  'access',
  'billing',
  'wincross',
  'general',
] as const;

export type ContactTopic = typeof CONTACT_TOPICS[number];

export const ContactTopicSchema = z.enum(CONTACT_TOPICS);

export const ContactSubmissionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  company: z.string().trim().max(160, 'Company name is too long').optional().or(z.literal('')),
  topic: ContactTopicSchema.default('general'),
  message: z.string().trim().min(1, 'Message is required').max(2000, 'Message is too long'),
});

export function parseContactTopic(value: string | null | undefined): ContactTopic {
  const parsed = ContactTopicSchema.safeParse(value);
  return parsed.success ? parsed.data : 'general';
}

export function buildContactPath(options?: { topic?: ContactTopic | null }): string {
  const searchParams = new URLSearchParams();
  if (options?.topic) {
    searchParams.set('topic', options.topic);
  }

  const query = searchParams.toString();
  return query ? `/contact?${query}` : '/contact';
}
