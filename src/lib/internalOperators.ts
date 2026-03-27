function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const address = normalized.match(/<([^>]+)>/)?.[1] ?? normalized;
  const atIndex = address.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === address.length - 1) {
    return null;
  }

  return address.slice(atIndex + 1);
}

export function getInternalOpsAllowlist(): string[] {
  const rawValue = process.env.INTERNAL_OPS_ALLOWLIST ?? '';
  return rawValue
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function getInternalAccessDomains(): string[] {
  const configuredDomains = (process.env.INTERNAL_ACCESS_DOMAINS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (configuredDomains.length > 0) {
    return configuredDomains;
  }

  const resendDomain = extractDomain(process.env.RESEND_FROM_ADDRESS ?? null);
  if (resendDomain) {
    return [resendDomain];
  }

  return ['tabulate-ai.com'];
}

export function isInternalAccessUser(email: string | null | undefined): boolean {
  if (!email) return false;

  if (isInternalOperator(email)) {
    return true;
  }

  const domain = extractDomain(email);
  if (!domain) return false;

  return getInternalAccessDomains().includes(domain);
}

export function isInternalOperator(email: string | null | undefined): boolean {
  if (!email) return false;
  return getInternalOpsAllowlist().includes(email.trim().toLowerCase());
}
