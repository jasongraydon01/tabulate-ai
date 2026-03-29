'use client';

import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollReveal } from '@/components/ui/scroll-reveal';
import { FAQ_ITEMS } from '@/lib/billing/faqItems';

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
