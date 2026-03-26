import { z } from 'zod';

export const ACCESS_REQUEST_SOURCES = [
  'demo_status',
  'demo_email',
  'pricing',
  'auth_no_org',
  'marketing',
] as const;

export type AccessRequestSource = typeof ACCESS_REQUEST_SOURCES[number];
export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

const FREE_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'yahoo.com',
]);

export const AccessRequestSourceSchema = z.enum(ACCESS_REQUEST_SOURCES);
export function parseAccessRequestSource(value: string | null | undefined): AccessRequestSource {
  const parsed = AccessRequestSourceSchema.safeParse(value);
  return parsed.success ? parsed.data : 'marketing';
}

export const AccessRequestSubmissionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  email: z.string().trim().min(1, 'Work email is required').email('Enter a valid work email'),
  company: z.string().trim().min(1, 'Company name is required').max(160, 'Company name is too long'),
  initialAdminEmail: z
    .string()
    .trim()
    .email('Enter a valid admin email')
    .max(254, 'Admin email is too long')
    .optional()
    .or(z.literal('')),
  notes: z
    .string()
    .trim()
    .max(1000, 'Notes are too long')
    .optional()
    .or(z.literal('')),
  source: AccessRequestSourceSchema.default('marketing'),
  demoToken: z.string().trim().optional().or(z.literal('')),
});

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function extractEmailDomain(email: string): string | null {
  const normalizedEmail = normalizeEmail(email);
  const atIndex = normalizedEmail.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    return null;
  }

  return normalizedEmail.slice(atIndex + 1);
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

export function buildRequestAccessPath(
  source: AccessRequestSource,
  options?: {
    demoToken?: string | null;
  },
): string {
  const searchParams = new URLSearchParams({ source });
  if (options?.demoToken) {
    searchParams.set('demoToken', options.demoToken);
  }
  return `/request-access?${searchParams.toString()}`;
}

export function sanitizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
