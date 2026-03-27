import Link from 'next/link';
import { ArrowRight, FileSpreadsheet, FileText, LayoutGrid, MessageSquare, SlidersHorizontal, UserCheck, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TrackedLink } from '@/components/TrackedLink';
import { ScrollReveal } from '@/components/ui/scroll-reveal';
import { PlanCards } from '@/components/pricing/PlanCards';
import { PricingFAQ } from '@/components/pricing/PricingFAQ';
import {
  PLANS,
  PLAN_ORDER,
  formatPrice,
  getEffectiveCostPerProject,
} from '@/lib/billing/plans';
import {
  getPricingPagePrimaryCta,
  parsePlanId,
  PRICING_CHECKOUT_PLAN_PARAM,
} from '@/lib/billing/pricingFlow';
import { hasActiveSubscriptionStatus } from '@/lib/billing/subscriptionStatus';
import { getAuth, getSessionAuth } from '@/lib/auth';
import { syncAuthToConvex } from '@/lib/auth-sync';
import { queryInternal } from '@/lib/convex';
import { internal } from '../../../../convex/_generated/api';
import { canPerform } from '@/lib/permissions';
import { isInternalAccessUser } from '@/lib/internalOperators';

export const dynamic = 'force-dynamic';

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ [PRICING_CHECKOUT_PLAN_PARAM]?: string | string[] }>;
}) {
  const [sessionAuth, auth] = await Promise.all([getSessionAuth(), getAuth()]);
  const isAuthenticated = !!sessionAuth;
  const hasWorkspaceAccess = !!auth;
  const hasInternalAccess = isInternalAccessUser(auth?.email ?? null);
  const params = await searchParams;
  const checkoutPlanParam = params[PRICING_CHECKOUT_PLAN_PARAM];
  const checkoutPlan = parsePlanId(
    Array.isArray(checkoutPlanParam) ? checkoutPlanParam[0] : checkoutPlanParam,
  );

  let canManageBilling = false;
  let hasActiveSubscription = false;
  let currentPlanId: keyof typeof PLANS | null = null;

  if (auth) {
    try {
      const ids = await syncAuthToConvex(auth);
      const membership = await queryInternal(internal.orgMemberships.getByUserAndOrg, {
        userId: ids.userId,
        orgId: ids.orgId,
      });
      canManageBilling = canPerform(membership?.role ?? null, 'manage_billing');

      const subscription = await queryInternal(internal.subscriptions.getByOrgInternal, {
        orgId: ids.orgId,
      });
      hasActiveSubscription = hasInternalAccess || hasActiveSubscriptionStatus(subscription?.status ?? null);
      currentPlanId = parsePlanId(subscription?.plan ?? null);
    } catch (error) {
      console.warn('[PricingPage] Could not load pricing context:', error);
    }
  }

  const primaryCta = getPricingPagePrimaryCta({
    isAuthenticated,
    hasWorkspaceAccess,
    canManageBilling,
    hasActiveSubscription,
  });

  return (
    <>
      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden pt-32 pb-36 px-6">
        <div className="absolute inset-0 bg-editorial-radial" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/[0.03] rounded-full blur-[120px]" />

        <div className="relative max-w-3xl mx-auto text-center">
          <div
            className="animate-fade-up inline-flex items-center gap-2.5 px-3.5 py-1.5 bg-secondary/80 border border-border/60 rounded-full text-xs font-mono text-muted-foreground tracking-wider uppercase mb-12"
          >
            <span className="size-1.5 rounded-full bg-tab-teal animate-pulse" />
            Simple, volume-based pricing
          </div>

          <h1
            className="animate-fade-up editorial-display text-4xl sm:text-5xl lg:text-6xl mb-8"
            style={{ animationDelay: '0.1s' }}
          >
            One product.{' '}
            <span className="editorial-emphasis">Choose your volume.</span>
          </h1>

          <p
            className="animate-fade-up text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed"
            style={{ animationDelay: '0.2s' }}
          >
            Every plan includes the full pipeline, every output format, and every feature.
            The only difference is how many projects you run each month.
          </p>
        </div>
      </section>

      {/* ============ PLAN CARDS ============ */}
      <section id="pricing-plans" className="relative z-10 -mt-16 px-6 pb-28 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <PlanCards
            isAuthenticated={isAuthenticated}
            hasWorkspaceAccess={hasWorkspaceAccess}
            canManageBilling={canManageBilling}
            hasActiveSubscription={hasActiveSubscription}
            currentPlanId={currentPlanId}
            resumePlanId={checkoutPlan}
          />
        </div>
      </section>

      {/* ============ WHAT EVERY PLAN INCLUDES ============ */}
      <section className="py-28 px-6 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal>
            <span className="data-label text-primary mb-4 block">
              Included In Every Plan
            </span>
            <h2 className="editorial-display text-3xl sm:text-4xl lg:text-5xl mb-5">
              Every feature.{' '}
              <span className="editorial-emphasis">Every plan.</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl leading-relaxed mb-20">
              No feature gates, no upgrade walls. Your team gets the full product from day one.
            </p>
          </ScrollReveal>

          {/* Features — flowing vertical layout */}
          <div className="space-y-12">
            {[
              { icon: SlidersHorizontal, title: 'Banner spec interpretation', description: 'Upload your banner plan and the system matches every cut to the actual variables in your data.', color: 'text-primary', bg: 'bg-tab-indigo-dim' },
              { icon: LayoutGrid, title: 'Full pipeline processing', description: 'AI reads your survey to understand the intent behind each question, then structures every table.', color: 'text-tab-teal', bg: 'bg-tab-teal-dim' },
              { icon: FileSpreadsheet, title: 'Professional Excel output', description: 'Publication-ready workbooks with statistical testing, NET rows, and T2B/B2B summaries.', color: 'text-tab-blue', bg: 'bg-tab-blue-dim' },
              { icon: FileText, title: 'Q and WinCross export', description: 'Generate Q scripts and WinCross .job files. Apply org-level style profiles for your house format.', color: 'text-tab-amber', bg: 'bg-tab-amber-dim' },
              { icon: UserCheck, title: 'Human in the loop', description: 'When the system flags uncertainty, you review and correct before compute runs.', color: 'text-muted-foreground', bg: 'bg-muted' },
              { icon: MessageSquare, title: 'Pipeline decisions briefing', description: 'After every run, a plain-language summary of what was found, built, and structured.', color: 'text-tab-rose', bg: 'bg-tab-rose-dim' },
            ].map((feature, i) => (
              <ScrollReveal key={feature.title} delay={i * 0.05}>
                <div className={`flex items-start gap-6 max-w-xl ${i % 2 === 1 ? 'ml-auto' : ''}`}>
                  <div className={`size-10 rounded-lg ${feature.bg} flex items-center justify-center shrink-0`}>
                    <feature.icon className={`h-5 w-5 ${feature.color}`} />
                  </div>
                  <div>
                    <h3 className="font-serif text-lg font-light mb-1.5">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW OVERAGE WORKS ============ */}
      <section className="py-28 px-6 border-t border-border/40">
        <div className="max-w-4xl mx-auto">
          <ScrollReveal>
            <span className="data-label text-primary mb-4 block">
              Transparent Billing
            </span>
            <h2 className="editorial-display text-3xl sm:text-4xl mb-5">
              Go beyond your plan? <span className="editorial-emphasis">No surprises.</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl leading-relaxed mb-14">
              Each plan includes a set number of projects. If you need more, overage billing is straightforward and predictable.
            </p>
          </ScrollReveal>

          {/* Overage table */}
          <ScrollReveal delay={0.1}>
            <div className="overflow-x-auto mb-8 bg-card border border-border/60 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="text-left py-3.5 pl-5 pr-4 data-label text-muted-foreground">Plan</th>
                    <th className="text-left py-3.5 px-4 data-label text-muted-foreground">Included</th>
                    <th className="text-left py-3.5 px-4 data-label text-muted-foreground">Effective / Project</th>
                    <th className="text-left py-3.5 pr-5 pl-4 data-label text-muted-foreground">Overage Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_ORDER.map((planId) => {
                    const plan = PLANS[planId];
                    const isPayg = plan.projectLimit === 0;
                    return (
                      <tr key={planId} className="border-b border-border/30 last:border-b-0">
                        <td className="py-3.5 pl-5 pr-4 font-medium">{plan.name}</td>
                        <td className="py-3.5 px-4 font-mono text-muted-foreground">
                          {isPayg ? 'Per project' : `${plan.projectLimit} projects`}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-muted-foreground">
                          {formatPrice(getEffectiveCostPerProject(planId))}
                        </td>
                        <td className="py-3.5 pr-5 pl-4 font-mono text-muted-foreground">
                          {isPayg ? <span className="text-muted-foreground/50">&mdash;</span> : formatPrice(plan.overageRate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ScrollReveal>

          {/* Notification callout */}
          <ScrollReveal delay={0.15}>
            <div className="flex items-start gap-4 bg-card border border-border/60 rounded-lg p-5">
              <div className="size-9 rounded-lg bg-tab-amber-dim flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-tab-amber" />
              </div>
              <p className="text-sm leading-relaxed">
                <span className="font-medium text-foreground">We keep you informed.</span>{' '}
                <span className="text-muted-foreground">
                  You&apos;ll receive a notification as you approach your included project limit, another if you exceed it,
                  and a recommendation if upgrading to the next tier would save you money.
                </span>
              </p>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className="py-28 px-6 border-t border-border/40">
        <div className="max-w-3xl mx-auto">
          <ScrollReveal>
            <span className="data-label text-primary mb-4 block">
              Questions
            </span>
            <h2 className="editorial-display text-3xl sm:text-4xl mb-14">
              Frequently asked
            </h2>
          </ScrollReveal>

          <PricingFAQ />
        </div>
      </section>

      {/* ============ BOTTOM CTA ============ */}
      <section className="relative overflow-hidden py-36 px-6 text-center">
        <div className="absolute inset-0 bg-editorial-radial" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/[0.03] rounded-full blur-[120px]" />

        <div className="relative">
          <ScrollReveal>
            <h2 className="editorial-display text-4xl sm:text-5xl lg:text-6xl mb-6">
              Ready to automate your <span className="editorial-emphasis">tabs?</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-12 max-w-lg mx-auto">
              Start with the demo if you want to see the workflow on your own data. If your team is
              ready for a workspace, request access and we&apos;ll provision it cleanly.
            </p>
            <Button asChild size="lg" className="text-base px-8 rounded-full bg-foreground text-background hover:bg-foreground/90">
              <TrackedLink
                href={primaryCta.href}
                eventName="cta_clicked"
                eventProperties={{ location: 'pricing_bottom_cta', cta_text: primaryCta.label }}
              >
                {primaryCta.label}
                <ArrowRight className="ml-2 h-4 w-4" />
              </TrackedLink>
            </Button>
          </ScrollReveal>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-border/40 text-center py-16 px-6">
        <div className="flex items-center justify-center gap-0.5 mb-4">
          <span className="font-serif text-lg font-semibold tracking-tight text-foreground">Tabulate</span>
          <span className="font-serif text-lg font-semibold tracking-tight text-primary">AI</span>
        </div>
        <p className="text-[11px] text-muted-foreground/40 mb-5 font-mono tracking-wider">Research data, clearly structured.</p>
        <div className="flex items-center justify-center gap-6">
          <Link href="/data-privacy" className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors duration-200">
            Data & Privacy
          </Link>
          <Link href="/pricing" className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors duration-200">
            Pricing
          </Link>
        </div>
      </footer>
    </>
  );
}
