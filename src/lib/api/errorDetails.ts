export function shouldExposeApiErrorDetails(): boolean {
  // Opt-in only. Prevent accidental leakage when NODE_ENV is misconfigured.
  return process.env.EXPOSE_API_ERROR_DETAILS === 'true';
}

export function getApiErrorDetails(error: unknown): string | undefined {
  if (!shouldExposeApiErrorDetails()) return undefined;

  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}
