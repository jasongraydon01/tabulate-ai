'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Role } from '@/lib/permissions';
import posthog from 'posthog-js';
import { PipelineSoundNotifier } from '@/components/PipelineSoundNotifier';

interface AuthContextValue {
  convexOrgId: string | null;
  convexUserId: string | null;
  email: string | null;
  name: string | null;
  role: Role | null;
  isBypass: boolean;
  isInternalOperator: boolean;
  isInternalAccess: boolean;
  hasActiveSubscription: boolean;
  subscriptionPlan: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  convexOrgId: null,
  convexUserId: null,
  email: null,
  name: null,
  role: null,
  isBypass: false,
  isInternalOperator: false,
  isInternalAccess: false,
  hasActiveSubscription: false,
  subscriptionPlan: null,
});

interface AuthProviderProps {
  children: ReactNode;
  convexOrgId?: string | null;
  convexUserId?: string | null;
  email?: string | null;
  name?: string | null;
  role?: Role | null;
  isBypass?: boolean;
  isInternalOperator?: boolean;
  isInternalAccess?: boolean;
  hasActiveSubscription?: boolean;
  subscriptionPlan?: string | null;
}

export function AuthProvider({
  children,
  convexOrgId = null,
  convexUserId = null,
  email = null,
  name = null,
  role = null,
  isBypass = false,
  isInternalOperator = false,
  isInternalAccess = false,
  hasActiveSubscription = false,
  subscriptionPlan = null,
}: AuthProviderProps) {
  // Identify user in PostHog when authenticated (opaque IDs only — no PII)
  useEffect(() => {
    if (convexUserId) {
      posthog.identify(convexUserId, {
        org_id: convexOrgId ?? undefined,
        role: role ?? undefined,
      });
    } else {
      posthog.reset();
    }
  }, [convexUserId, convexOrgId, role]);

  return (
    <AuthContext.Provider
      value={{
        convexOrgId: convexOrgId ?? null,
        convexUserId: convexUserId ?? null,
        email: email ?? null,
        name: name ?? null,
        role: role ?? null,
        isBypass,
        isInternalOperator,
        isInternalAccess,
        hasActiveSubscription,
        subscriptionPlan,
      }}
    >
      <PipelineSoundNotifier />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}
