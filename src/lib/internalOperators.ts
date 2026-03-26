export function getInternalOpsAllowlist(): string[] {
  const rawValue = process.env.INTERNAL_OPS_ALLOWLIST ?? '';
  return rawValue
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isInternalOperator(email: string | null | undefined): boolean {
  if (!email) return false;
  return getInternalOpsAllowlist().includes(email.trim().toLowerCase());
}
