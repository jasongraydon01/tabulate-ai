import { describe, expect, it } from 'vitest';
import { buildContactNotificationEmail } from '@/lib/notifications/contactEmails';

describe('contact emails', () => {
  it('renders the internal contact notification with the submitted details', () => {
    const { subject, html } = buildContactNotificationEmail({
      name: 'Casey Analyst',
      email: 'casey@example.com',
      company: 'Example Co',
      topic: 'wincross',
      message: 'We need help getting a house style profile into TabulateAI.',
    });

    expect(subject).toContain('WinCross / Exports');
    expect(html).toContain('Casey Analyst');
    expect(html).toContain('casey@example.com');
    expect(html).toContain('Example Co');
    expect(html).toContain('WinCross / Exports');
    expect(html).toContain('house style profile');
  });
});
