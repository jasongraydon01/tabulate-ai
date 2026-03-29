'use client';

import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollReveal } from '@/components/ui/scroll-reveal';

export const FAQ_ITEMS = [
  {
    question: 'How do I get started?',
    answer:
      'Start with the demo to see how TabulateAI handles your survey workflow. If you want workspace access for your team, submit a request access form. We then provision the initial workspace, domain mapping, and first admin before you begin billing inside the product.',
  },
  {
    question: 'Can I subscribe before my workspace is set up?',
    answer:
      'Not yet. Pricing is public so you can evaluate the plans, but billing starts after your workspace exists and the right admin is in place. That keeps organization setup, permissions, and billing ownership aligned from the start.',
  },
  {
    question: 'What counts as a project?',
    answer:
      'One dataset (.sav file) and all associated activity: initial runs, re-runs, additional banner cuts, and human-in-the-loop review cycles. There are no caps within a project. You pay once per dataset, not per run.',
  },
  {
    question: 'How does Pay-As-You-Go work?',
    answer:
      'Pay-As-You-Go lets you use TabulateAI without a monthly commitment. Each project is billed at $200 when it completes successfully. No monthly fee, no minimum usage. If your volume grows, switching to a subscription plan will save you money.',
  },
  {
    question: 'What happens if I exceed my included projects?',
    answer:
      "Your service continues uninterrupted. Each additional project beyond your plan's included count is billed at the overage rate shown on your plan. We'll notify you as you approach your limit and let you know if upgrading would save you money.",
  },
  {
    question: 'Can I change my plan?',
    answer:
      'Yes. You can upgrade or downgrade at any time through the Billing Portal in your account settings. Changes take effect on your next billing cycle.',
  },
  {
    question: 'What if a pipeline run fails?',
    answer:
      "Failed runs are free. You're only billed when a project delivers results successfully. If a run fails or is cancelled, it does not count toward your project usage.",
  },
  {
    question: 'Do unused projects roll over?',
    answer:
      'No. Each billing cycle starts fresh. Your subscription covers capacity and availability for that month. This does not apply to Pay-As-You-Go, which has no included projects.',
  },
  {
    question: 'What output formats are included?',
    answer:
      'Every plan includes Excel workbooks with statistical testing, Q script export, and WinCross .job export. There are no format restrictions on any tier.',
  },
] as const;

export function PricingFAQ() {
  return (
    <div className="space-y-3">
      {FAQ_ITEMS.map((item, i) => (
        <ScrollReveal key={i} delay={i * 0.05}>
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-card px-6 py-4 text-left transition-colors hover:bg-secondary/50 group data-[state=open]:rounded-b-none data-[state=open]:border-b-0">
              <span className="font-medium text-sm">{item.question}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="rounded-b-lg border border-t-0 border-border bg-card px-6 py-4 text-sm text-muted-foreground leading-relaxed">
                {item.answer}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </ScrollReveal>
      ))}
    </div>
  );
}
