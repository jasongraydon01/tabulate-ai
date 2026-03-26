'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { StaggerContainer, StaggerItem } from '@/components/ui/scroll-reveal';
import {
  PLANS,
  PLAN_ORDER,
  RECOMMENDED_PLAN,
  formatPrice,
  type PlanId,
} from '@/lib/billing/plans';

export function PlanCards() {
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  async function handleSubscribe(planId: PlanId) {
    setLoadingPlan(planId);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });

      if (res.ok) {
        const { url } = await res.json();
        if (url) {
          window.location.href = url;
          return;
        }
      }

      // Not authenticated or other error — redirect to login
      window.location.href = '/dashboard';
    } catch {
      // Network error — redirect to login flow as fallback
      window.location.href = '/dashboard';
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <StaggerContainer
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5"
      stagger={0.1}
    >
      {PLAN_ORDER.map((planId) => {
        const plan = PLANS[planId];
        const isRecommended = planId === RECOMMENDED_PLAN;
        const isPayg = planId === 'payg';
        const isLoading = loadingPlan === planId;
        const dollars = plan.monthlyPrice / 100;

        return (
          <StaggerItem key={planId}>
            <div
              className={`group relative flex flex-col bg-card border rounded-lg p-8 transition-all duration-300 overflow-hidden h-full ${
                isRecommended
                  ? 'border-tab-indigo/50 glow-indigo'
                  : 'border-border hover:border-ring'
              }`}
            >
              {/* Crosshatch texture */}
              <div className="absolute inset-0 bg-grain opacity-[0.012] dark:opacity-[0.025] pointer-events-none transition-opacity duration-300 group-hover:opacity-[0.025] dark:group-hover:opacity-[0.05]" />

              <div className="relative flex flex-col flex-1">
                {/* Plan name + recommended badge on same line */}
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-serif text-2xl">{plan.name}</h3>
                  {isRecommended && (
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-tab-indigo-dim border border-tab-indigo/20 rounded-full text-[10px] font-mono text-tab-indigo tracking-wider uppercase">
                      Popular
                    </div>
                  )}
                </div>

                {/* Description */}
                <p className="text-sm text-muted-foreground mb-6">{plan.description}</p>

                {/* Price — PAYG shows per-project rate instead of monthly */}
                {isPayg ? (
                  <>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="font-mono text-3xl font-medium tracking-tight">
                        {formatPrice(plan.overageRate)}
                      </span>
                      <span className="text-sm text-muted-foreground">/project</span>
                    </div>
                    <p className="font-mono text-sm text-muted-foreground mb-2">
                      No monthly fee
                    </p>
                    <p className="text-xs text-muted-foreground/70 mb-8">
                      Pay only for what you use
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="font-mono text-3xl font-medium tracking-tight">
                        $<AnimatedNumber value={dollars} format={(n) => n.toLocaleString()} />
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>
                    <p className="font-mono text-sm text-muted-foreground mb-2">
                      {plan.projectLimit} projects included
                    </p>
                    <p className="text-xs text-muted-foreground/70 mb-8">
                      {formatPrice(plan.overageRate)} per additional project
                    </p>
                  </>
                )}

                {/* CTA */}
                <div className="mt-auto">
                  <Button
                    onClick={() => handleSubscribe(planId)}
                    disabled={loadingPlan !== null}
                    variant={isRecommended ? 'default' : 'outline'}
                    className="w-full"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Get Started'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </StaggerItem>
        );
      })}
    </StaggerContainer>
  );
}
