import { redirect } from 'next/navigation';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { AccessRequestsQueue } from '@/components/ops/AccessRequestsQueue';
import { queryInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import { requireAuth } from '@/lib/auth';
import { isInternalOperator } from '@/lib/internalOperators';

export default async function OpsAccessRequestsPage() {
  const auth = await requireAuth().catch(() => null);

  if (!auth || !isInternalOperator(auth.email)) {
    redirect('/dashboard');
  }

  const requests = await queryInternal(internal.accessRequests.listAll, {});

  return (
    <div>
      <AppBreadcrumbs segments={[{ label: 'Ops' }, { label: 'Access Requests' }]} />

      <div className="mt-6 space-y-6">
        <div className="max-w-3xl">
          <h1 className="font-serif text-3xl font-light tracking-tight">Access Requests</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review new workspace requests, then provision the WorkOS organization, domain, and first
            admin manually before marking the request complete.
          </p>
        </div>

        <AccessRequestsQueue initialRequests={requests} />
      </div>
    </div>
  );
}
