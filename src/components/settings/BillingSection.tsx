'use client';

import { useState, useEffect } from 'react';
import {
  CreditCard,
  ExternalLink,
  Loader2,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { canPerform, type Role } from '@/lib/permissions';
import { type PlanId } from '@/lib/billing/plans';
import { isPreviewFeatureEnabled } from '@/lib/featureGates';

interface SubscriptionData {
  plan: PlanId;
  planName: string;
  status: string;
  projectsUsed: number;
  projectLimit: number;
  overageRate: number;
  overageRateFormatted: string;
  currentOverageCost: number;
  currentOverageCostFormatted: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  upgradeBreakpoint: { nextPlan: PlanId; projectCount: number } | null;
  monthlyPrice: number;
  monthlyPriceFormatted: string;
}

function statusBadge(status: string, cancelAtPeriodEnd: boolean) {
  if (cancelAtPeriodEnd) {
    return <Badge variant="outline" className="text-tab-amber border-tab-amber/30">Canceling</Badge>;
  }
  switch (status) {
    case 'active':
      return <Badge variant="outline" className="text-tab-teal border-tab-teal/30">Active</Badge>;
    case 'trialing':
      return <Badge variant="outline" className="text-primary border-primary/30">Trial</Badge>;
    case 'past_due':
      return <Badge variant="outline" className="text-tab-rose border-tab-rose/30">Past Due</Badge>;
    case 'unpaid':
      return <Badge variant="outline" className="text-tab-rose border-tab-rose/30">Unpaid</Badge>;
    case 'canceled':
      return <Badge variant="outline" className="text-muted-foreground border-border">Canceled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function formatDate(unixMs: number) {
  return new Date(unixMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function BillingSection({ role }: { role: Role | null }) {
  const canView = canPerform(role, 'view_billing');
  const canManage = canPerform(role, 'manage_billing');
  const [subscription, setSubscription] = useState<SubscriptionData | null | undefined>(undefined);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (!canView) return;
    fetch('/api/billing/subscription')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSubscription(data?.subscription ?? null))
      .catch(() => setSubscription(null));
  }, [canView]);

  if (!canView) return null;

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      if (res.ok) {
        const { url } = await res.json();
        if (url) {
          window.location.href = url;
          return;
        }
      }
    } catch {
      // non-fatal
    } finally {
      setPortalLoading(false);
    }
  }

  // Loading state
  if (subscription === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            Billing & Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // No subscription
  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            Billing & Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            No active billing plan. Choose a plan to start processing projects.
          </p>
          {/* @temporary — "View Plans" hidden in production */}
          {canManage && isPreviewFeatureEnabled() && (
            <Button variant="outline" size="sm" asChild>
              <a href="/pricing">View Plans</a>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const isPayg = subscription.projectLimit === 0;
  const usagePercent = Math.min(
    100,
    subscription.projectLimit > 0
      ? Math.round((subscription.projectsUsed / subscription.projectLimit) * 100)
      : 0,
  );
  const isOverLimit = !isPayg && subscription.projectsUsed > subscription.projectLimit;
  const overageProjects = isPayg ? 0 : Math.max(0, subscription.projectsUsed - subscription.projectLimit);
  const showUpgradeHint =
    subscription.upgradeBreakpoint &&
    subscription.projectsUsed >= subscription.upgradeBreakpoint.projectCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          Billing & Usage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Plan + Status */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{subscription.planName}</span>
              {statusBadge(subscription.status, subscription.cancelAtPeriodEnd)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {subscription.monthlyPriceFormatted}/mo
            </p>
          </div>
        </div>

        {/* Usage bar (not shown for PAYG — no limit to measure against) */}
        {isPayg ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">
                Projects this cycle
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {subscription.projectsUsed} {subscription.projectsUsed === 1 ? 'project' : 'projects'}
              </span>
            </div>
            {subscription.projectsUsed > 0 && (
              <p className="text-xs text-muted-foreground">
                {subscription.projectsUsed} &times; {subscription.overageRateFormatted} = {subscription.currentOverageCostFormatted} this cycle
              </p>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">
                Projects this cycle
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {subscription.projectsUsed} / {subscription.projectLimit}
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isOverLimit
                    ? 'bg-tab-amber'
                    : usagePercent >= 80
                      ? 'bg-tab-amber'
                      : 'bg-tab-teal'
                }`}
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Overage info */}
        {isOverLimit && (
          <div className="flex items-start gap-2 rounded-md bg-tab-amber-dim px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-tab-amber shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium text-foreground">
                {overageProjects} overage {overageProjects === 1 ? 'project' : 'projects'}
              </p>
              <p className="text-muted-foreground mt-0.5">
                {subscription.currentOverageCostFormatted} in overage charges this cycle
                ({subscription.overageRateFormatted}/project)
              </p>
            </div>
          </div>
        )}

        {/* Smart upgrade hint */}
        {showUpgradeHint && subscription.upgradeBreakpoint && (
          <div className="flex items-start gap-2 rounded-md bg-tab-indigo-dim px-3 py-2.5">
            <TrendingUp className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              At your current usage, upgrading to{' '}
              <span className="font-medium text-foreground">
                {subscription.upgradeBreakpoint.nextPlan.charAt(0).toUpperCase() +
                  subscription.upgradeBreakpoint.nextPlan.slice(1)}
              </span>{' '}
              would save you money this cycle.
            </p>
          </div>
        )}

        {/* Cycle dates */}
        <div className="text-xs text-muted-foreground">
          {subscription.cancelAtPeriodEnd ? (
            <p>Cancels on {formatDate(subscription.currentPeriodEnd)}</p>
          ) : (
            <p>
              Current cycle: {formatDate(subscription.currentPeriodStart)} &ndash;{' '}
              {formatDate(subscription.currentPeriodEnd)}
            </p>
          )}
        </div>

        {/* Actions */}
        {canManage && (
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePortal}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              )}
              Manage Plan
            </Button>
            <Button variant="ghost" size="sm" onClick={handlePortal} disabled={portalLoading}>
              Invoice History
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
