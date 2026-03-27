'use client';

import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackedLink } from "@/components/TrackedLink";
import { TextRevealLine } from "@/components/ui/text-reveal";
import { FloatingData } from "@/components/ui/floating-data";
import dynamic from "next/dynamic";
import { buildRequestAccessPath } from "@/lib/accessRequests";
import { buildSignInPath } from "@/lib/navigation";
import { getMarketingPrimaryCta, getMarketingSecondaryCta } from "@/lib/navigation";

const CrystallizationHero = dynamic(
  () =>
    import("@/components/ui/crystallization-hero").then(
      (mod) => mod.CrystallizationHero
    ),
  { ssr: false }
);

interface HeroSectionProps {
  isAuthenticated: boolean;
}

export function HeroSection({ isAuthenticated }: HeroSectionProps) {
  const primaryCta = getMarketingPrimaryCta(isAuthenticated);
  const secondaryCta = getMarketingSecondaryCta(isAuthenticated);
  const signInHref = buildSignInPath('/dashboard');

  return (
    <section className="relative min-h-screen flex items-end lg:items-center overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 bg-editorial-radial" />
      <FloatingData density="sparse" className="opacity-60 dark:opacity-40" />

      {/* Content */}
      <div className="relative w-full px-6 lg:px-16 pt-32 pb-20 lg:pt-0 lg:pb-0">
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-16 lg:gap-0">
          {/* Left — Editorial Typography */}
          <div className="max-w-2xl z-10 lg:flex-1">
            {/* Eyebrow */}
            <div className="mb-10">
              <span className="data-label text-primary">
                Survey Data Processing
              </span>
              <span className="inline-block ml-4 h-px w-16 bg-primary/20 align-middle" />
            </div>

            {/* Headline — mixed weights for visual tension */}
            <TextRevealLine
              as="h1"
              className="editorial-display text-[clamp(2.75rem,5.5vw,5.5rem)] mb-8"
              lines={[
                { text: "From survey data" },
                { text: "to publication-ready" },
                {
                  text: "tables.",
                  className: "editorial-emphasis",
                },
              ]}
              stagger={0.18}
              delay={0.3}
            />

            {/* Gradient accent line */}
            <div
              className="h-0.5 w-16 gradient-accent mb-8 animate-fade-up"
              style={{ animationDelay: "0.8s" }}
            />

            {/* Subtitle */}
            <p
              className="animate-fade-up text-lg text-muted-foreground max-w-md leading-relaxed mb-12"
              style={{ animationDelay: "0.9s" }}
            >
              Upload your .sav file and survey document. TabulateAI understands
              your research design and produces formatted crosstabs with
              statistical testing, NET groupings, and proper bases.
            </p>

            {/* CTAs */}
            <div
              className="animate-fade-up flex gap-4 flex-wrap"
              style={{ animationDelay: "1.1s" }}
            >
              {isAuthenticated ? (
                <>
                  <Button
                    asChild
                    size="lg"
                    className="text-base px-8 rounded-full bg-foreground text-background hover:bg-foreground/90"
                  >
                    <TrackedLink
                      href="/dashboard"
                      eventName="cta_clicked"
                      eventProperties={{
                        location: "hero",
                        cta_text: "Go to Dashboard",
                      }}
                    >
                      Go to Dashboard
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </TrackedLink>
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="text-base text-muted-foreground"
                    asChild
                  >
                    <a href="#how-it-works">Learn more</a>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    asChild
                    size="lg"
                    className="text-base px-8 rounded-full bg-foreground text-background hover:bg-foreground/90"
                  >
                    <TrackedLink
                      href={primaryCta.href}
                      eventName="cta_clicked"
                      eventProperties={{
                        location: "hero",
                        cta_text: primaryCta.label,
                      }}
                    >
                      {!isAuthenticated && <Play className="mr-2 h-4 w-4" />}
                      {primaryCta.label}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </TrackedLink>
                  </Button>
                  {secondaryCta && (
                    <Button
                      variant="ghost"
                      size="lg"
                      className="text-base text-muted-foreground"
                      asChild
                    >
                      <TrackedLink
                        href={signInHref}
                        eventName="cta_clicked"
                        eventProperties={{
                          location: "hero",
                          cta_text: "Sign In",
                        }}
                      >
                        Sign In
                      </TrackedLink>
                    </Button>
                  )}
                </>
              )}
            </div>
            {!isAuthenticated && secondaryCta && (
              <p
                className="animate-fade-up mt-4 text-sm text-muted-foreground"
                style={{ animationDelay: "1.2s" }}
              >
                Need a workspace?{" "}
                <TrackedLink
                  href={buildRequestAccessPath('marketing')}
                  eventName="cta_clicked"
                  eventProperties={{
                    location: "hero_supporting_copy",
                    cta_text: secondaryCta.label,
                  }}
                  className="text-foreground underline underline-offset-4"
                >
                  {secondaryCta.label}
                </TrackedLink>
              </p>
            )}
          </div>

          {/* Right — Crystallization Animation */}
          <div
            className="animate-fade-up w-full lg:flex-[1.2] lg:min-w-0"
            style={{ animationDelay: "0.6s" }}
          >
            <CrystallizationHero />
          </div>
        </div>
      </div>
    </section>
  );
}
