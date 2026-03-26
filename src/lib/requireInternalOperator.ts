import { AuthenticationError, requireAuth, type AuthContext } from '@/lib/auth';
import { isInternalOperator } from '@/lib/internalOperators';

export async function requireInternalOperator(): Promise<AuthContext> {
  const auth = await requireAuth();

  if (!isInternalOperator(auth.email)) {
    throw new AuthenticationError('Unauthorized');
  }

  return auth;
}
