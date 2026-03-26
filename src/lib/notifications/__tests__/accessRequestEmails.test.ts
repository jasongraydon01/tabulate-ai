import { describe, expect, it } from 'vitest';
import {
  buildAccessRequestConfirmationEmail,
  buildAccessRequestInternalEmail,
} from '@/lib/notifications/accessRequestEmails';
import { buildOutputDeliveryEmail } from '@/lib/notifications/demoEmails';

describe('access request emails', () => {
  it('renders requester confirmation copy', () => {
    const { subject, html } = buildAccessRequestConfirmationEmail({
      name: 'Casey',
      company: 'Example Co',
    });

    expect(subject).toContain('access request');
    expect(html).toContain('Example Co');
    expect(html).toContain('workspace');
  });

  it('renders the internal notification with queue link and source label', () => {
    const { html } = buildAccessRequestInternalEmail({
      name: 'Casey',
      email: 'casey@example.com',
      company: 'Example Co',
      emailDomain: 'example.com',
      source: 'pricing',
      queueUrl: 'https://tabulate-ai.com/ops/access-requests',
      notes: 'Looking to onboard a new team',
    });

    expect(html).toContain('https://tabulate-ai.com/ops/access-requests');
    expect(html).toContain('Pricing page');
    expect(html).toContain('Looking to onboard a new team');
  });

  it('renders the demo delivery CTA as request access', () => {
    const { html } = buildOutputDeliveryEmail({
      name: 'Casey',
      projectName: 'Demo Study',
      tableCount: 25,
      requestAccessUrl: 'https://tabulate-ai.com/request-access?source=demo_email',
    });

    expect(html).toContain('Request Access');
    expect(html).toContain('https://tabulate-ai.com/request-access?source=demo_email');
  });
});
